import { vec3 } from '../math/vec3.js';
import type { Vec3 } from '../math/vec3.js';
import { capsuleFits } from '../physics/character.js';
import { makeRaycastResult, SurfaceFlags } from '../physics/types.js';
import type { PhysicsWorld } from '../physics/world.js';
import type { PlayerState } from '../player/state.js';
import { respawnPlayer } from '../player/state.js';
import type { LevelDef } from '../world/level.js';
import { BODY_DEFS } from '../bodies/index.js';
import type { Body } from '../bodies/index.js';
import { RoundMode, activePlayers } from './base.js';
import { registerMode } from './registry.js';
import type { GameModeDef, ModeContext, ModeMarkerView, ModeStateView, Objective } from './types.js';

export const ROO_BALL_DEF: GameModeDef = {
  id: 'roo-ball',
  name: 'Roo Ball',
  description: 'Two teams, one ball, no hands. Hop into it to kick it; knock it through the other side’s goal.',
  minPlayers: 2,
  maxPlayers: 16,
  roundSeconds: 240,
  countdownSeconds: 5,
  icon: 'ball',
  combat: false,
  tagging: false,
  gadgetsEnabled: false,
};

export type Team = 'red' | 'blue';

/** The pitch length the goal search aims for: a few hops' sprint end to end, on every map. */
export const PITCH_LENGTH = 34;
const PITCH_MIN = 22;
const PITCH_MAX = 50;
/** How far the ground may wander from a straight line between the goals and still be a pitch. */
const PITCH_FLATNESS = 1.5;
/** A goal is a mouth this wide (radius) and this tall; the ball scores anywhere inside it. */
export const GOAL_RADIUS = 2.6;
export const GOAL_HEIGHT = 2.4;
/** Seconds the ball sits on the spot after a goal, so both teams see the score and reset. */
const KICKOFF_SECONDS = 2;
/** Seconds a ball that went out of play is held where it is put back. */
const RESTART_SECONDS = 1;
/** Half the pitch's width: the touchlines. */
export const PITCH_HALF_WIDTH = 12;
/** How far past a goal line the ball may run before it is out (the goal mouth is inside this). */
const BYLINE_MARGIN = 3;
/** A ball this far below the pitch has fallen into something and is out. */
const DROP_OUT = 2;

export interface Pitch {
  centre: Vec3;
  /** Red defends `goals[0]`, blue defends `goals[1]`. Ground points. */
  goals: [Vec3, Vec3];
}

const _ray = makeRaycastResult();
const DOWN = { x: 0, y: -1, z: 0 };

/** The ground under a point, or null over a hole or water. */
function groundBelow(world: PhysicsWorld, x: number, y: number, z: number, depth: number): Vec3 | null {
  world.raycast(_ray, { x, y, z }, DOWN, depth);
  if (!_ray.hit || (_ray.surface.flags & SurfaceFlags.Water) !== 0 || _ray.normal.y < 0.7) return null;
  return vec3(_ray.point.x, _ray.point.y, _ray.point.z);
}

/**
 * Find a pitch on any map: two spawn points about `PITCH_LENGTH` apart with open, level ground
 * between them.
 *
 * Found rather than authored, the way King of the Hill finds its hills, so the mode works on every
 * map that exists — including one a player made — without a designer placing goals. Deterministic
 * (no random draw), so the server and a solo client agree on where the goals are.
 */
export function findPitch(level: LevelDef, world: PhysicsWorld): Pitch {
  const grounds: Vec3[] = [];
  for (const spawn of level.spawns) {
    if (spawn.tag === 'lobby') continue;
    const g = groundBelow(world, spawn.position.x, spawn.position.y + 1, spawn.position.z, 6);
    if (g) grounds.push(g);
  }

  let best: [Vec3, Vec3] | null = null;
  let bestScore = Infinity;
  let fallback: [Vec3, Vec3] | null = null;
  let fallbackScore = Infinity;
  for (let i = 0; i < grounds.length; i++) {
    for (let j = i + 1; j < grounds.length; j++) {
      const a = grounds[i] as Vec3;
      const b = grounds[j] as Vec3;
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      const score = Math.abs(length - PITCH_LENGTH);
      if (score < fallbackScore) {
        fallbackScore = score;
        fallback = [a, b];
      }
      if (length < PITCH_MIN || length > PITCH_MAX || Math.abs(a.y - b.y) > PITCH_FLATNESS) continue;
      if (score >= bestScore || !levelBetween(world, a, b)) continue;
      best = [a, b];
      bestScore = score;
    }
  }

  const goals = best ?? fallback ?? [vec3(-PITCH_LENGTH / 2, 0, 0), vec3(PITCH_LENGTH / 2, 0, 0)];
  const [a, b] = goals;
  const mid = { x: (a.x + b.x) / 2, y: Math.max(a.y, b.y) + 2, z: (a.z + b.z) / 2 };
  const centre = groundBelow(world, mid.x, mid.y, mid.z, 8) ?? vec3(mid.x, (a.y + b.y) / 2, mid.z);
  return { centre, goals: [a, b] };
}

/** Is the ground between two goals continuous, near the line joining them, and open above? */
function levelBetween(world: PhysicsWorld, a: Vec3, b: Vec3): boolean {
  const samples = 11;
  for (let s = 1; s < samples; s++) {
    const t = s / samples;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    const y = a.y + (b.y - a.y) * t;
    const g = groundBelow(world, x, y + 3, z, 6);
    if (!g || Math.abs(g.y - y) > PITCH_FLATNESS) return false;
    // A wall or a tree across the pitch is not a pitch.
    if (world.isPointInsideSolid({ x, y: g.y + 0.6, z }) || world.isPointInsideSolid({ x, y: g.y + 1.6, z })) return false;
  }
  return true;
}

/**
 * Roo Ball.
 *
 * Escape Simulator 2's lesson carried one step further: the loose balls in every lobby are the
 * most-touched thing in it, so they get a game. Two teams, one football, goals found on the map,
 * and — deliberately — no hands. A ball you can pick up gets carried into the goal, so the match
 * ball is kick-only: every touch is a hop into it, which is the kangaroo's one
 * verb and works identically with a thumbstick, a keyboard and a headset.
 *
 * The match ball is the 1.1 m `rooball`, not a lobby football — see `BODY_DEFS` for the measurement
 * that ruled out a real-sized ball — and it is kick-only by definition, so nobody can pick it up.
 */
export class RooBallMode extends RoundMode {
  private pitch: Pitch | null = null;
  private ball: Body | null = null;
  private ballHome: Vec3 = vec3();
  private goals: Record<Team, number> = { red: 0, blue: 0 };
  private kickoffTicks = 0;
  /** Where the ball is held during a restart. */
  private restartAt: Vec3 = vec3();
  private flash = '';

  protected override onRoundStart(ctx: ModeContext): void {
    this.pitch = findPitch(ctx.level, ctx.world);
    this.goals = { red: 0, blue: 0 };
    this.flash = '';

    const spot = this.spot();
    this.ball = ctx.bodies.ensure('rooball', spot);
    this.ballHome = { ...this.ball.home };
    // Home is the centre spot for the match, so a ball knocked off the world comes back into play.
    ctx.bodies.place(this.ball, spot, spot);
    this.kickoffTicks = 0;
    this.restartAt = spot;

    const players = activePlayers(ctx);
    ctx.rand.shuffle(players);
    players.forEach((player, i) => this.join(ctx, player, i % 2 === 0 ? 'red' : 'blue'));
    this.updateHeadline();
  }

  protected override onLateJoin(ctx: ModeContext, player: PlayerState): void {
    const counts = this.teamSizes(ctx);
    this.join(ctx, player, counts.red <= counts.blue ? 'red' : 'blue');
  }

  private teamSizes(ctx: ModeContext): Record<Team, number> {
    const counts: Record<Team, number> = { red: 0, blue: 0 };
    for (const p of ctx.players.values()) if (p.active && (p.role === 'red' || p.role === 'blue')) counts[p.role]++;
    return counts;
  }

  private join(ctx: ModeContext, player: PlayerState, team: Team): void {
    player.role = team;
    player.roleTicks = 0;
    this.entry(player.id);
    this.kickoffPosition(ctx, player, team);
    ctx.events.emit('roleChange', player.id, player.position, ctx.tick, 0, { data: team });
  }

  /** In your own half, facing the ball, spread across the pitch so nobody spawns on anybody. */
  private kickoffPosition(ctx: ModeContext, player: PlayerState, team: Team): void {
    const pitch = this.pitch;
    if (!pitch) return;
    const own = pitch.goals[team === 'red' ? 0 : 1];
    const dx = pitch.centre.x - own.x;
    const dz = pitch.centre.z - own.z;
    const length = Math.hypot(dx, dz) || 1;
    const fx = dx / length;
    const fz = dz / length;
    // Lateral slot from how many team-mates are already placed: 0, +1, −1, +2, −2 …
    let placed = 0;
    for (const p of ctx.players.values()) if (p !== player && p.role === team) placed++;
    const lateral = (placed % 2 === 0 ? 1 : -1) * Math.ceil(placed / 2) * 2.2;
    const along = length * 0.45;
    const x = own.x + fx * along - fz * lateral;
    const z = own.z + fz * along + fx * lateral;
    const ground = groundBelow(ctx.world, x, own.y + 3, z, 8);
    const position = ground ? vec3(ground.x, ground.y + 0.05, ground.z) : null;
    if (position && capsuleFits(ctx.world, position, { radius: player.config.radius, height: player.config.standHeight })) {
      respawnPlayer(player, position, ctx.tick);
    } else {
      ctx.respawn(player, 'runner');
    }
    player.yaw = Math.atan2(fx, fz);
  }

  private spot(): Vec3 {
    const c = this.pitch?.centre ?? vec3();
    return vec3(c.x, c.y + BODY_DEFS.rooball.radius + 0.2, c.z);
  }

  protected override onPlaying(ctx: ModeContext): void {
    const ball = this.ball;
    const pitch = this.pitch;
    if (!ball || !pitch) return;
    for (const p of ctx.players.values()) if (p.active) p.roleTicks++;

    if (this.kickoffTicks > 0) {
      // Held on the spot until the restart, so the goal just scored is the only thing happening.
      this.kickoffTicks--;
      ctx.bodies.place(ball, this.restartAt);
      if (this.kickoffTicks === 0) this.flash = '';
      if (this.roundTicks % 30 === 0) this.updateHeadline();
      return;
    }

    // Goal zones: `goals[0]` is red's, so a ball in it is a goal for blue.
    for (let g = 0; g < 2; g++) {
      const mouth = pitch.goals[g] as Vec3;
      const inside =
        Math.hypot(ball.position.x - mouth.x, ball.position.z - mouth.z) <= GOAL_RADIUS &&
        ball.position.y <= mouth.y + GOAL_HEIGHT;
      if (inside) {
        this.scoreGoal(ctx, g === 0 ? 'blue' : 'red', mouth);
        return;
      }
    }
    const out = this.outOfPlay(ball.position);
    if (out) {
      this.restartAt = out;
      this.kickoffTicks = Math.round(RESTART_SECONDS / ctx.dt);
      ctx.bodies.place(ball, out);
      this.flash = 'Out of play';
      this.updateHeadline();
      return;
    }
    if (this.roundTicks % 30 === 0) this.updateHeadline();
  }

  /**
   * Where the ball goes back into play, or null while it is still in.
   *
   * A ball with no touchlines leaves the pitch and stays gone: measured on the jungle, it came to
   * rest 30 m off the pitch among the trees and slept there for 94 % of a round while six bots
   * searched for a way to it. Football's answer is the right one: out is out, and play restarts
   * level with where it went out, on the centre line — the one strip `findPitch` checked is open,
   * level ground — rather than wherever it stopped, which may be inside a thicket or down a pit.
   */
  private outOfPlay(p: Vec3): Vec3 | null {
    const pitch = this.pitch;
    if (!pitch) return null;
    const [a, b] = pitch.goals;
    const ax = b.x - a.x;
    const az = b.z - a.z;
    const length = Math.hypot(ax, az) || 1;
    const ux = ax / length;
    const uz = az / length;
    const along = (p.x - pitch.centre.x) * ux + (p.z - pitch.centre.z) * uz;
    const across = (p.x - pitch.centre.x) * uz - (p.z - pitch.centre.z) * ux;
    const half = length / 2;
    const inside = Math.abs(across) <= PITCH_HALF_WIDTH && Math.abs(along) <= half + BYLINE_MARGIN && p.y >= pitch.centre.y - DROP_OUT;
    if (inside) return null;
    // Back on the centre line, level with where it went out, and clear of both goal mouths.
    const clamped = Math.max(-half + GOAL_RADIUS + 3, Math.min(half - GOAL_RADIUS - 3, along));
    const t = (clamped + half) / length;
    const y = a.y + (b.y - a.y) * t;
    return vec3(a.x + ax * t, y + BODY_DEFS.rooball.radius + 0.2, a.z + az * t);
  }

  private scoreGoal(ctx: ModeContext, team: Team, mouth: Vec3): void {
    this.goals[team]++;
    const scorer = this.ball?.lastTouchedBy ? ctx.players.get(this.ball.lastTouchedBy) : undefined;
    const ownGoal = scorer !== undefined && scorer.role !== team;
    if (scorer && !ownGoal) this.entry(scorer.id).tags++;
    // Every player's score is their team's goals, so placements group by team.
    for (const p of ctx.players.values()) {
      if (p.role === 'red' || p.role === 'blue') this.entry(p.id).score = this.goals[p.role];
    }
    ctx.events.emit('goal', scorer?.id ?? 'system', mouth, ctx.tick, this.goals[team], { data: team });
    const who = scorer ? (ownGoal ? `own goal by ${scorer.name}` : scorer.name) : 'a lucky bounce';
    this.flash = `${team.toUpperCase()} SCORES — ${who}`;
    this.kickoffTicks = Math.round(KICKOFF_SECONDS / ctx.dt);
    this.restartAt = this.spot();
    this.updateHeadline();
  }

  private updateHeadline(): void {
    // No-break spaces: the score is one unit. With ordinary ones a goal flash wrapped it in the
    // HUD's 520 px headline as "… RED 0 – 1" over "BLUE", which a Steam screenshot caught.
    const score = `RED\u00a0${this.goals.red}\u00a0–\u00a0${this.goals.blue}\u00a0BLUE`;
    this.headline = this.flash ? `${this.flash} · ${score}` : score;
  }

  /**
   * Where a bot should run: behind the ball on the line to the goal it attacks, then through it.
   *
   * A kick goes along the contact normal — from the kangaroo through the ball — so a bot that
   * arrives from the far side of the ball knocks it towards the goal, and one that runs straight
   * at the ball from wherever it happens to be knocks it anywhere.
   */
  objectiveFor(player: PlayerState): Objective | null {
    const ball = this.ball;
    const pitch = this.pitch;
    if (this.phase !== 'playing' || !ball || !pitch || (player.role !== 'red' && player.role !== 'blue')) return null;
    const target = pitch.goals[player.role === 'red' ? 1 : 0];
    const gx = target.x - ball.position.x;
    const gz = target.z - ball.position.z;
    const g = Math.hypot(gx, gz) || 1;
    const ux = gx / g;
    const uz = gz / g;
    // Where the player is relative to the ball, along and across the line to the goal.
    const px = player.position.x - ball.position.x;
    const pz = player.position.z - ball.position.z;
    const behind = -(px * ux + pz * uz);
    const across = Math.abs(px * uz - pz * ux);
    const r = BODY_DEFS[ball.kind].radius;
    // Inside a cone behind the ball: run straight through it. A bot always runs flat out and turns
    // at a bounded rate, so a narrow window it has to hit exactly is a window it circles forever.
    if (behind > 0 && across < behind * 0.5 + r) {
      return { ...vec3(ball.position.x + ux * 2, ball.position.y, ball.position.z + uz * 2), arrive: true };
    }
    // Otherwise get round behind it first, further back the further away you are, so the turn
    // onto the line happens before the ball rather than on top of it.
    const distance = Math.hypot(px, pz);
    const standoff = r + 1.5 + Math.min(distance * 0.2, 3);
    const sx = -ux * standoff;
    const sz = -uz * standoff;
    // And never through it on the way. The straight line to a point behind the ball runs across
    // the ball for anyone approaching from the goal side, and that pass is a kick towards your own
    // goal: measured, more than half of all goals were own goals before this. Go round on the side
    // you are already on.
    const dx = sx - px;
    const dz = sz - pz;
    const segment = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, -(px * dx + pz * dz) / segment));
    const miss = Math.hypot(px + dx * t, pz + dz * t);
    if (miss < r + 1.8 && behind <= 0) {
      const side = px * uz - pz * ux >= 0 ? 1 : -1;
      const clear = r + 2.4;
      return { ...vec3(ball.position.x + uz * side * clear - ux * 0.5, ball.position.y, ball.position.z - ux * side * clear - uz * 0.5), arrive: true };
    }
    return { ...vec3(ball.position.x + sx, ball.position.y, ball.position.z + sz), arrive: true };
  }

  protected override extraState(): Partial<ModeStateView> {
    const pitch = this.pitch;
    if (!pitch || this.phase === 'waiting') return {};
    const markers: ModeMarkerView[] = pitch.goals.map((mouth, g) => ({
      kind: 'goal' as const,
      x: mouth.x,
      y: mouth.y,
      z: mouth.z,
      radius: GOAL_RADIUS,
      team: g === 0 ? ('red' as const) : ('blue' as const),
      // Facing the centre spot, so the mouth opens onto the pitch.
      yaw: Math.atan2(pitch.centre.x - mouth.x, pitch.centre.z - mouth.z),
    }));
    const [a, b] = pitch.goals;
    markers.push({
      kind: 'pitch',
      x: pitch.centre.x,
      y: pitch.centre.y,
      z: pitch.centre.z,
      radius: 0,
      yaw: Math.atan2(b.x - a.x, b.z - a.z),
      halfLength: Math.hypot(b.x - a.x, b.z - a.z) / 2,
      halfWidth: PITCH_HALF_WIDTH,
    });
    return { markers, tally: { red: this.goals.red, blue: this.goals.blue } };
  }

  /** Where the goals are, for tests and tooling. */
  get currentPitch(): Readonly<Pitch> | null {
    return this.pitch;
  }

  get score(): Readonly<Record<Team, number>> {
    return this.goals;
  }

  protected override finish(ctx: ModeContext, reason: string): void {
    super.finish(ctx, reason);
    // Back on the spot it was made on, where it stays as a toy between rounds.
    if (this.ball) ctx.bodies.place(this.ball, this.ballHome, this.ballHome);
  }

  protected override computeWinners(ctx: ModeContext): string[] {
    if (this.goals.red === this.goals.blue) return [];
    const team: Team = this.goals.red > this.goals.blue ? 'red' : 'blue';
    return [...ctx.players.values()].filter((p) => p.role === team).map((p) => p.id);
  }

  protected override winnerHeadline(): string {
    const { red, blue } = this.goals;
    if (red === blue) return `Draw, ${red} – ${blue}`;
    return `${red > blue ? 'RED' : 'BLUE'} wins ${Math.max(red, blue)} – ${Math.min(red, blue)}`;
  }
}

registerMode(ROO_BALL_DEF, (def) => new RooBallMode(def));
