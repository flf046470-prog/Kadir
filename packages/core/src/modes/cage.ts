import { vec3 } from '../math/vec3.js';
import type { Vec3 } from '../math/vec3.js';
import { capsuleFits } from '../physics/character.js';
import { makeRaycastResult, SurfaceFlags } from '../physics/types.js';
import type { PhysicsWorld } from '../physics/world.js';
import { regenerateStamina } from '../player/combat.js';
import type { PlayerState } from '../player/state.js';
import { respawnPlayer } from '../player/state.js';
import type { ArenaDef, LevelDef } from '../world/level.js';
import { RoundMode, activePlayers } from './base.js';
import { registerMode } from './registry.js';
import type { GameModeDef, ModeContext, ModeStateView, Objective } from './types.js';

export const CAGE_FIGHT_DEF: GameModeDef = {
  id: 'cage-fight',
  name: 'Cage Fight',
  description: 'Two teams, one cage. 1v1, 2v2, 3v3, then 4v4: knock out the other corner or leave them fewest standing.',
  minPlayers: 2,
  maxPlayers: 8,
  roundSeconds: 300,
  countdownSeconds: 5,
  icon: 'cage',
  combat: true,
  tagging: false,
  gadgetsEnabled: false,
};

export type Corner = 'red' | 'blue';

/** The largest fight on the card: four a side fills the cage. */
export const MAX_TEAM_FIGHT = 4;
/** Fighters walk to their corners and touch gloves. */
const INTRO_SECONDS = 3;
/** A fight nobody finishes is decided on who is left standing. */
export const FIGHT_SECONDS = 45;
/** The result stays on screen before the next fight is called. */
const DECIDED_SECONDS = 3;
const KO_SCORE = 25;
/** Every fighter on the side that wins a fight, knocked out or not: it is a team's fight. */
const WIN_SCORE = 10;
/** Past the fence by this much, or this far below the floor, a fighter has left the cage. */
const RING_OUT_MARGIN = 0.3;
const RING_OUT_DROP = 1.2;
/** Where the people not fighting stand, beyond the fence. */
const CAGESIDE = 2.4;

type Stage = 'intro' | 'fight' | 'decided';

const _ray = makeRaycastResult();
const DOWN = { x: 0, y: -1, z: 0 };

function groundBelow(world: PhysicsWorld, x: number, y: number, z: number, depth: number): Vec3 | null {
  world.raycast(_ray, { x, y, z }, DOWN, depth);
  if (!_ray.hit || (_ray.surface.flags & SurfaceFlags.Water) !== 0 || _ray.normal.y < 0.7) return null;
  return vec3(_ray.point.x, _ray.point.y, _ray.point.z);
}

/**
 * The cage the fights happen in: the level's own, or a ring round its start for a map without one.
 *
 * A map with no cage still plays — a player-made map need not have built one — but its ring has no
 * fence, so the ring-out rule is the only thing that keeps a fight in one place.
 */
export function arenaFor(level: LevelDef): ArenaDef {
  const built = level.arenas?.[0];
  if (built) return built;
  const spot = level.spawns.find((s) => s.tag === 'start') ?? level.spawns[0];
  const at = spot?.position ?? vec3();
  return { center: vec3(at.x, at.y, at.z), radius: 6, fenceHeight: 0 };
}

/**
 * The fight sizes, in order, for teams of these sizes: 1v1, 2v2 … up to the smaller team or four.
 *
 * A card rather than one size, so a room of eight plays every format the mode is named for, and a
 * smaller team is never asked to field more than it has. A team one larger than the other benches
 * someone in every fight, and who sits out rotates (see `pickFighters`).
 */
export function fightCard(red: number, blue: number): number[] {
  const most = Math.min(MAX_TEAM_FIGHT, red, blue);
  return Array.from({ length: most }, (_, i) => i + 1);
}

/**
 * Is `point` outside the cage? The fence is an octagon, so this is the octagon: past the fence by
 * `RING_OUT_MARGIN` along any of its eight faces, or fallen below the floor.
 */
export function outsideCage(arena: ArenaDef, point: Vec3): boolean {
  if (point.y < arena.center.y - RING_OUT_DROP) return true;
  const dx = point.x - arena.center.x;
  const dz = point.z - arena.center.z;
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    if (dx * Math.sin(angle) + dz * Math.cos(angle) > arena.radius + RING_OUT_MARGIN) return true;
  }
  return false;
}

/**
 * Cage Fight: team boxing in the cage beside the lobby.
 *
 * The room splits into a red corner and a blue corner for the whole round, and the round is a card
 * of fights — 1v1, then 2v2, 3v3 and 4v4 as far as the teams go, and round again. A fight is a
 * team's: it is won when the other corner has nobody standing, or, at the bell, by whoever has
 * more fighters standing (then more health). The corner with more fights won takes the round.
 *
 * Knocked out, or out over the fence, is out of that fight: you go cageside and watch through the
 * chain-link. Who fights next is whoever has fought least, so a bench rotates and a team of four
 * all get the 1v1.
 *
 * Punches are Boxing's, unchanged (`player/combat.ts`), with `canDamage` keeping them to the two
 * corners of the fight in progress: a team-mate cannot be hit, and nobody cageside can hit or be
 * hit through the fence.
 */
export class CageFightMode extends RoundMode {
  private arena: ArenaDef = { center: vec3(), radius: 6, fenceHeight: 0 };
  private corners = new Map<string, Corner>();
  /** Fights each player has been picked for this round, so the bench rotates. */
  private fought = new Map<string, number>();
  /** Shuffled once a round: the tie-break between players who have fought as often. */
  private order = new Map<string, number>();
  private wins: Record<Corner, number> = { red: 0, blue: 0 };
  private stage: Stage = 'intro';
  private stageTicks = 0;
  private fightNumber = 0;
  private size = 1;
  /** Everybody picked for the fight in progress, and the ones still in it. */
  private fighters = new Set<string>();
  private standing = new Set<string>();
  /** Where each fighter starts, and where each person not fighting stands. */
  private spots = new Map<string, Vec3>();
  private flash = '';

  protected override onRoundStart(ctx: ModeContext): void {
    this.arena = arenaFor(ctx.level);
    this.corners.clear();
    this.fought.clear();
    this.order.clear();
    this.wins = { red: 0, blue: 0 };
    this.fightNumber = 0;
    this.flash = '';
    const players = activePlayers(ctx);
    ctx.rand.shuffle(players);
    players.forEach((player, i) => {
      this.corners.set(player.id, i % 2 === 0 ? 'red' : 'blue');
      this.order.set(player.id, i);
      this.entry(player.id);
    });
    this.callFight(ctx);
  }

  protected override onLateJoin(ctx: ModeContext, player: PlayerState): void {
    const sizes = this.teamSizes(ctx);
    this.corners.set(player.id, sizes.red <= sizes.blue ? 'red' : 'blue');
    this.order.set(player.id, this.order.size);
    // Fought as much as anybody, so a late arrival does not jump the queue to fight every bout.
    this.fought.set(player.id, Math.max(0, ...this.fought.values()));
    this.toCageside(ctx, player);
  }

  override playerLeft(ctx: ModeContext, playerId: string): void {
    super.playerLeft(ctx, playerId);
    this.corners.delete(playerId);
    this.fought.delete(playerId);
    this.order.delete(playerId);
    this.fighters.delete(playerId);
    this.standing.delete(playerId);
    this.spots.delete(playerId);
  }

  private teamSizes(ctx: ModeContext): Record<Corner, number> {
    const sizes: Record<Corner, number> = { red: 0, blue: 0 };
    for (const [id, corner] of this.corners) if (ctx.players.get(id)?.active) sizes[corner]++;
    return sizes;
  }

  /**
   * The fighters for the next fight: on each side, the `size` who have fought least, ties broken
   * by the order the room was shuffled into at the start.
   */
  pickFighters(ctx: ModeContext, size: number): string[] {
    const picked: string[] = [];
    for (const corner of ['red', 'blue'] as const) {
      const members = [...this.corners]
        .filter(([id, c]) => c === corner && ctx.players.get(id)?.active)
        .map(([id]) => id)
        .sort((a, b) => (this.fought.get(a) ?? 0) - (this.fought.get(b) ?? 0) || (this.order.get(a) ?? 0) - (this.order.get(b) ?? 0));
      picked.push(...members.slice(0, size));
    }
    return picked;
  }

  /** Put the next fight in the cage, and everybody else beside it. */
  private callFight(ctx: ModeContext): void {
    let sizes = this.teamSizes(ctx);
    // A corner emptied by people leaving takes somebody from the other, so there is a fight at all.
    if ((sizes.red === 0 || sizes.blue === 0) && sizes.red + sizes.blue >= 2) {
      const from: Corner = sizes.red === 0 ? 'blue' : 'red';
      const mover = [...this.corners].find(([id, c]) => c === from && ctx.players.get(id)?.active)?.[0];
      if (mover) this.corners.set(mover, from === 'red' ? 'blue' : 'red');
      sizes = this.teamSizes(ctx);
    }
    const card = fightCard(sizes.red, sizes.blue);
    this.fighters.clear();
    this.standing.clear();
    this.stage = 'intro';
    this.stageTicks = 0;
    if (card.length === 0) {
      this.flash = 'Waiting for an opponent';
      this.updateHeadline();
      return;
    }
    this.size = card[this.fightNumber % card.length] as number;
    this.fightNumber++;
    const picked = this.pickFighters(ctx, this.size);
    for (const id of picked) {
      this.fighters.add(id);
      this.standing.add(id);
      this.fought.set(id, (this.fought.get(id) ?? 0) + 1);
    }

    const slots: Record<Corner, number> = { red: 0, blue: 0 };
    for (const player of ctx.players.values()) {
      if (!player.active) continue;
      const corner = this.corners.get(player.id);
      if (!corner) continue;
      if (this.fighters.has(player.id)) {
        this.toCorner(ctx, player, corner, slots[corner]++);
        ctx.events.emit('roleChange', player.id, player.position, ctx.tick, 0, { data: corner });
      } else if (player.role !== 'spectator') {
        this.toCageside(ctx, player);
      }
    }
    this.flash = '';
    this.updateHeadline();
  }

  /** In their own half, side by side, facing the other corner. */
  private toCorner(ctx: ModeContext, player: PlayerState, corner: Corner, slot: number): void {
    const { center, radius } = this.arena;
    const side = corner === 'red' ? -1 : 1;
    const lateral = (slot - (this.size - 1) / 2) * 1.6;
    const position = vec3(center.x + lateral, center.y + 0.05, center.z + side * radius * 0.55);
    respawnPlayer(player, position, ctx.tick);
    player.role = corner;
    player.roleTicks = 0;
    // The last punch of a fight before is not this fight's.
    player.lastTaggedBy = null;
    player.yaw = side < 0 ? 0 : Math.PI;
    this.spots.set(player.id, position);
  }

  /**
   * Out of the fight: beside the cage, at a spot of their own round it, facing in. A player who was
   * not already there is told so (`roleChange`), which is the only cue a fighter who stepped out of
   * the cage gets, and how the bench learns it is the bench.
   */
  private toCageside(ctx: ModeContext, player: PlayerState): void {
    if (player.role !== 'spectator') ctx.events.emit('roleChange', player.id, player.position, ctx.tick, 0, { data: 'spectator' });
    const { center, radius } = this.arena;
    const index = this.order.get(player.id) ?? 0;
    const reach = radius + CAGESIDE;
    // Eight-ish places round the cage, starting from the doors' side; a few tries each way past
    // anything standing there.
    for (let attempt = 0; attempt < 16; attempt++) {
      const angle = ((index * 3 + attempt) / 16) * Math.PI * 2;
      const x = center.x + Math.sin(angle) * reach;
      const z = center.z + Math.cos(angle) * reach;
      const ground = groundBelow(ctx.world, x, center.y + 4, z, 8);
      if (!ground) continue;
      const position = vec3(ground.x, ground.y + 0.05, ground.z);
      if (outsideCage(this.arena, position) && capsuleFits(ctx.world, position, { radius: player.config.radius, height: player.config.standHeight })) {
        respawnPlayer(player, position, ctx.tick);
        player.yaw = Math.atan2(center.x - x, center.z - z);
        player.role = 'spectator';
        player.roleTicks = 0;
        this.spots.set(player.id, position);
        return;
      }
    }
    ctx.respawn(player, 'runner');
    player.role = 'spectator';
    this.spots.delete(player.id);
  }

  protected override onPlaying(ctx: ModeContext): void {
    this.stageTicks++;
    const seconds = this.stageTicks * ctx.dt;
    for (const player of ctx.players.values()) if (player.active) player.roleTicks++;

    if (this.stage === 'intro') {
      if (this.fighters.size === 0) {
        // Nobody to fight; try again once somebody joins.
        if (this.stageTicks % 60 === 0) this.callFight(ctx);
        return;
      }
      if (seconds >= INTRO_SECONDS) {
        this.stage = 'fight';
        this.stageTicks = 0;
        this.flash = 'FIGHT!';
        // The bell Conversion Duel rings for its bouts: one cue for "the fight has started".
        ctx.events.emit('roundState', 'system', this.arena.center, ctx.tick, 0, { data: 'bout' });
        this.updateHeadline();
      }
      return;
    }

    if (this.stage === 'decided') {
      if (seconds >= DECIDED_SECONDS) this.callFight(ctx);
      return;
    }

    // Deleting the element being visited is safe while iterating a Set.
    for (const id of this.standing) {
      const player = ctx.players.get(id);
      if (!player || !player.active) {
        this.standing.delete(id);
        continue;
      }
      if (!player.alive) {
        this.knockOut(ctx, player, 'knocked out');
        continue;
      }
      if (outsideCage(this.arena, player.position)) {
        this.knockOut(ctx, player, 'is out of the cage');
        continue;
      }
      this.entry(id).survivalTicks++;
      regenerateStamina(player, ctx.dt);
    }

    const left = this.standingBy(ctx);
    if (left.red === 0 || left.blue === 0) {
      this.decide(ctx, left.red === left.blue ? null : left.red > 0 ? 'red' : 'blue');
    } else if (seconds >= FIGHT_SECONDS) {
      this.decide(ctx, this.onPoints(ctx, left));
    } else if (this.stageTicks % 30 === 0) {
      this.updateHeadline();
    }
  }

  private standingBy(ctx: ModeContext): Record<Corner, number> {
    const left: Record<Corner, number> = { red: 0, blue: 0 };
    for (const id of this.standing) {
      const corner = this.corners.get(id);
      if (corner && ctx.players.get(id)) left[corner]++;
    }
    return left;
  }

  /** At the bell: more fighters standing, then more health between them; else nobody. */
  private onPoints(ctx: ModeContext, left: Record<Corner, number>): Corner | null {
    if (left.red !== left.blue) return left.red > left.blue ? 'red' : 'blue';
    const health: Record<Corner, number> = { red: 0, blue: 0 };
    for (const id of this.standing) {
      const corner = this.corners.get(id);
      const player = ctx.players.get(id);
      if (corner && player) health[corner] += player.health;
    }
    if (Math.abs(health.red - health.blue) < 1) return null;
    return health.red > health.blue ? 'red' : 'blue';
  }

  /**
   * Out of this fight, by a knockout or over the fence. The last punch scores it when it came from
   * the other corner of this fight; nobody's does otherwise, and nothing punch-shaped is sent. It
   * used to be sent as a knockout landed by the victim, so a fighter who stepped out untouched got
   * the hardest hit cue in the game, on their own client, as the puncher.
   */
  private knockOut(ctx: ModeContext, victim: PlayerState, how: string): void {
    this.standing.delete(victim.id);
    const attackerId = victim.lastTaggedBy;
    const credited =
      attackerId && this.fighters.has(attackerId) && this.corners.get(attackerId) !== this.corners.get(victim.id) ? attackerId : null;
    if (credited) {
      const entry = this.entry(credited);
      entry.score += KO_SCORE;
      entry.tags++;
      ctx.events.emit('punchHit', credited, victim.position, ctx.tick, 100, { otherId: victim.id, data: 'knockout' });
    }
    this.flash = `${victim.name} ${how}`;
    this.toCageside(ctx, victim);
    victim.lastTaggedBy = null;
  }

  private decide(ctx: ModeContext, winner: Corner | null): void {
    this.stage = 'decided';
    this.stageTicks = 0;
    if (winner) {
      this.wins[winner]++;
      for (const id of this.fighters) if (this.corners.get(id) === winner) this.entry(id).score += WIN_SCORE;
    }
    this.flash = winner ? `${winner === 'red' ? 'RED' : 'BLUE'} takes fight ${this.fightNumber}` : `Fight ${this.fightNumber} is a draw`;
    ctx.events.emit('roundState', 'system', this.arena.center, ctx.tick, 0, { data: winner ? `fight:${winner}` : 'fight:draw' });
    this.updateHeadline();
  }

  private updateHeadline(): void {
    // No-break spaces, as Roo Ball's: with ordinary ones the HUD's 520 px headline broke this as
    // "… RED 1 – 1" over "BLUE", seen in a practice screenshot.
    const score = `RED\u00a0${this.wins.red}\u00a0–\u00a0${this.wins.blue}\u00a0BLUE`;
    const card = this.fighters.size > 0 ? `${this.size}v${this.size}` : '';
    this.headline = [this.flash, card, score].filter(Boolean).join(' · ');
  }

  canDamage(attacker: PlayerState, victim: PlayerState): boolean {
    return (
      this.stage === 'fight' &&
      this.standing.has(attacker.id) &&
      this.standing.has(victim.id) &&
      this.corners.get(attacker.id) !== this.corners.get(victim.id)
    );
  }

  /**
   * A fighter in a fight brawls (`Objective.brawl`: the nearest fighter of the other corner); in
   * the walk-out a fighter holds its corner, and everyone else holds their place cageside.
   */
  objectiveFor(player: PlayerState): Objective | null {
    if (this.phase !== 'playing') return null;
    if (this.stage === 'fight' && this.standing.has(player.id)) return { ...this.arena.center, brawl: true };
    const spot = this.spots.get(player.id);
    return spot ? { ...spot, arrive: true } : null;
  }

  protected override extraState(): Partial<ModeStateView> {
    if (this.phase === 'waiting') return {};
    return { tally: { red: this.wins.red, blue: this.wins.blue } };
  }

  protected override computeWinners(ctx: ModeContext): string[] {
    if (this.wins.red === this.wins.blue) return [];
    const corner: Corner = this.wins.red > this.wins.blue ? 'red' : 'blue';
    return [...this.corners].filter(([id, c]) => c === corner && ctx.players.has(id)).map(([id]) => id);
  }

  protected override winnerHeadline(): string {
    const { red, blue } = this.wins;
    if (red === blue) return `Draw, ${red} – ${blue}`;
    return `${red > blue ? 'RED' : 'BLUE'} corner wins ${Math.max(red, blue)} – ${Math.min(red, blue)}`;
  }

  /** For tests and tooling. */
  get currentArena(): Readonly<ArenaDef> {
    return this.arena;
  }

  get score(): Readonly<Record<Corner, number>> {
    return this.wins;
  }

  get currentFight(): { number: number; size: number; stage: Stage; fighters: string[]; standing: string[] } {
    return { number: this.fightNumber, size: this.size, stage: this.stage, fighters: [...this.fighters], standing: [...this.standing] };
  }

  cornerOf(id: string): Corner | null {
    return this.corners.get(id) ?? null;
  }
}

registerMode(CAGE_FIGHT_DEF, (def) => new CageFightMode(def));
