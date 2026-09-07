import { v3distance, vec3 } from '../math/vec3.js';
import type { Vec3 } from '../math/vec3.js';
import type { PlayerState } from '../player/state.js';
import { RoundMode, activePlayers } from './base.js';
import { registerMode } from './registry.js';
import type { GameModeDef, ModeContext } from './types.js';

export const HILL_DEF: GameModeDef = {
  id: 'hill',
  name: 'King of the Hill',
  description: 'Hold the glowing ring. It moves every forty seconds, and it is never somewhere easy.',
  minPlayers: 2,
  maxPlayers: 16,
  roundSeconds: 240,
  countdownSeconds: 5,
  icon: 'hill',
  combat: false,
  tagging: false,
};

/** Seconds before the hill relocates. */
const HILL_SECONDS = 40;
const HILL_RADIUS = 5;
/** Points per second held, per holder. */
const HOLD_SCORE = 4;
/**
 * Contested hills score nothing.
 *
 * Splitting the points instead would reward crowding, and the interesting version of this mode
 * is the one where you have to push someone off rather than stand next to them.
 */
const CONTESTED_SCORE = 0;

/**
 * King of the Hill.
 *
 * A ring appears somewhere on the map and moves every forty seconds. Standing inside it alone
 * scores; standing inside it with someone from another "team" scores nothing at all, because
 * this is a free-for-all and the mode is more interesting when a crowded hill is worth nothing
 * to anyone in it.
 *
 * The hill positions come from the level's own spawn points, so this mode works on any map that
 * exists — including a player-made one — without a designer placing hill markers by hand.
 */
export class HillMode extends RoundMode {
  private hill: Vec3 = vec3();
  private hillIndex = -1;
  private sinceMove = 0;
  private holders: string[] = [];

  protected override onRoundStart(ctx: ModeContext): void {
    this.hillIndex = -1;
    this.sinceMove = 0;
    this.holders = [];
    for (const player of activePlayers(ctx)) {
      player.role = 'racer';
      player.roleTicks = 0;
      ctx.respawn(player, 'runner');
    }
    this.moveHill(ctx);
  }

  /**
   * Pick the next hill: a spawn point far from the current one.
   *
   * "Far" rather than "random" because a random pick can land two hills next to each other, and
   * the mode's rhythm depends on everyone having to actually cross the map.
   */
  private moveHill(ctx: ModeContext): void {
    const candidates = ctx.level.spawns;
    if (candidates.length === 0) {
      this.hill = vec3(0, 2, 0);
      return;
    }

    let bestIndex = 0;
    let bestDistance = -1;
    // Sample rather than scan: a deterministic shuffle of a handful of candidates keeps this
    // cheap on a large map and still guarantees a real move.
    for (let i = 0; i < Math.min(6, candidates.length); i++) {
      const index = ctx.rand.int(0, candidates.length);
      if (index === this.hillIndex) continue;
      const spawn = candidates[index];
      if (!spawn) continue;
      const distance = this.hillIndex < 0 ? 1 : v3distance(spawn.position, this.hill);
      if (distance > bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }

    const chosen = candidates[bestIndex];
    if (chosen) {
      this.hill = vec3(chosen.position.x, chosen.position.y, chosen.position.z);
      this.hillIndex = bestIndex;
    }
    this.sinceMove = 0;
    ctx.events.emit('checkpoint', 'system', this.hill, ctx.tick, HILL_RADIUS, { data: 'hill' });
  }

  protected override onPlaying(ctx: ModeContext): void {
    this.sinceMove += ctx.dt;
    if (this.sinceMove >= HILL_SECONDS) this.moveHill(ctx);

    this.holders = [];
    for (const player of ctx.players.values()) {
      if (!player.active || !player.alive) continue;
      player.roleTicks++;
      if (v3distance(player.position, this.hill) <= HILL_RADIUS) this.holders.push(player.id);
    }

    const perTick = (this.holders.length === 1 ? HOLD_SCORE : CONTESTED_SCORE) * ctx.dt;
    if (perTick > 0) {
      for (const id of this.holders) {
        const entry = this.entry(id);
        entry.score += perTick;
        entry.survivalTicks++;
      }
    }

    if (this.roundTicks % 60 === 0) {
      const countdown = Math.ceil(HILL_SECONDS - this.sinceMove);
      this.headline =
        this.holders.length === 0
          ? `Hill is open — moves in ${countdown}s`
          : this.holders.length === 1
            ? `${ctx.players.get(this.holders[0] as string)?.name ?? 'Someone'} holds it`
            : `Contested by ${this.holders.length}`;
    }
  }

  /** Where the ring is, for the renderer and the HUD compass. */
  get hillPosition(): Readonly<Vec3> {
    return this.hill;
  }

  get hillRadius(): number {
    return HILL_RADIUS;
  }

  /** Who is standing in it right now. */
  get currentHolders(): readonly string[] {
    return this.holders;
  }

  protected override computeWinners(ctx: ModeContext): string[] {
    let best = -Infinity;
    let winners: string[] = [];
    for (const [id, entry] of this.scores) {
      if (!ctx.players.has(id)) continue;
      if (entry.score > best + 1e-6) {
        best = entry.score;
        winners = [id];
      } else if (Math.abs(entry.score - best) <= 1e-6) {
        winners.push(id);
      }
    }
    return winners;
  }

  protected override winnerHeadline(ctx: ModeContext): string {
    const names = this.winnerIds.map((id) => ctx.players.get(id)?.name ?? 'Roo');
    if (names.length === 0) return 'Nobody held the hill';
    return names.length === 1 ? `${names[0]} is king` : `Shared crown: ${names.join(', ')}`;
  }

  protected override onLateJoin(ctx: ModeContext, player: PlayerState): void {
    player.role = 'racer';
    ctx.respawn(player, 'runner');
  }
}

registerMode(HILL_DEF, (def) => new HillMode(def));
