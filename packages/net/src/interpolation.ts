import type { EntitySnapshot, PlayerSnapshot } from '@kc/core';
import { FAR_SNAPSHOT_DIVISOR, SNAPSHOT_RATE } from './constants.js';

export interface InterpolationOptions {
  /** How far in the past remote players are rendered. One snapshot interval + jitter margin. */
  delayMs: number;
  /** Never extrapolate further than this; beyond it a player is frozen rather than guessed. */
  maxExtrapolationMs: number;
  /**
   * A player missing from every snapshot that has arrived for this long is no longer being sent —
   * out of sight in a mode about hiding (`sim/concealment.ts`), or gone — and is not drawn.
   *
   * It has to be longer than the gap a far player is *meant* to have: the server sends them one
   * snapshot in `FAR_SNAPSHOT_DIVISOR`. Measured from the newest snapshot received, not from the
   * clock, so a stalled connection — no snapshots at all — freezes everyone as before rather than
   * making them vanish.
   */
  staleMs: number;
}

/** A far player's gap between snapshots, in ms: 200 at 20 Hz and a divisor of 4. */
const FAR_GAP_MS = (1000 / SNAPSHOT_RATE) * FAR_SNAPSHOT_DIVISOR;

export const DEFAULT_INTERPOLATION: InterpolationOptions = {
  delayMs: 100,
  maxExtrapolationMs: 250,
  staleMs: FAR_GAP_MS * 2.5,
};

interface TimedSnapshot {
  tick: number;
  receivedAt: number;
  players: Map<string, PlayerSnapshot>;
  entities: Map<number, EntitySnapshot>;
}

/**
 * Snapshot buffer with time-shifted interpolation.
 *
 * Remote players are rendered `delayMs` in the past so that normal jitter is absorbed by having
 * two snapshots to interpolate between. Extrapolation is deliberately capped: a guessed position
 * that turns out wrong is what produces "ghost tags", and this game is built on tags being fair.
 *
 * Gadget entities ride the *same* buffer and the same clock, and must keep doing so. They used to
 * be assigned straight from the newest snapshot while players came from here, which put a
 * projectile `delayMs` ahead of the world it was flying through — measured at **6.00 m** for the
 * hunter's 60 m/s rifle round, 2.60 m for a freeze-gun bolt, against a 0.35 m player radius. The
 * round visibly passed through and well beyond its victim before the victim reacted to it. One
 * buffer is the fix: two lists sampled at one target time cannot drift apart again.
 */
export class InterpolationBuffer {
  private buffer: TimedSnapshot[] = [];

  private readonly options: InterpolationOptions;

  constructor(options: Partial<InterpolationOptions> = {}) {
    this.options = { ...DEFAULT_INTERPOLATION, ...options };
  }

  push(tick: number, players: PlayerSnapshot[], entities: EntitySnapshot[] = [], now = Date.now()): void {
    const map = new Map<string, PlayerSnapshot>();
    for (const p of players) map.set(p.id, p);
    const entityMap = new Map<number, EntitySnapshot>();
    for (const e of entities) entityMap.set(e.id, e);
    this.buffer.push({ tick, receivedAt: now, players: map, entities: entityMap });
    // Keep a second of history — plenty for interpolation, bounded for memory.
    while (this.buffer.length > 2 && (this.buffer[0] as TimedSnapshot).receivedAt < now - 1000) {
      this.buffer.shift();
    }
  }

  /**
   * The two snapshots the render time falls between, and how far between them it is.
   *
   * Shared by the player and entity samplers rather than written twice, so a projectile is always
   * resolved against the same instant as the players around it.
   */
  private pair(now: number): { older: TimedSnapshot | null; newer: TimedSnapshot | null; t: number } {
    const target = now - this.options.delayMs;
    let older: TimedSnapshot | null = null;
    let newer: TimedSnapshot | null = null;
    for (const snap of this.buffer) {
      if (snap.receivedAt <= target) older = snap;
      else {
        newer = snap;
        break;
      }
    }
    if (!older || !newer) return { older, newer, t: 0 };
    const span = newer.receivedAt - older.receivedAt || 1;
    return { older, newer, t: Math.max(0, Math.min(1, (target - older.receivedAt) / span)) };
  }

  /**
   * Live gadget entities at render time — projectiles, placed traps and smoke clouds — on the
   * same clock as `sample`.
   *
   * An entity present in only the newer snapshot has just spawned, so it appears at its spawn
   * point rather than being lerped from a position it never occupied. One present only in the
   * older has expired by the newer, and is dropped rather than left frozen in the air for a
   * frame: a projectile that stops dead reads worse than one that is simply gone.
   */
  sampleEntities(now = Date.now()): EntitySnapshot[] {
    if (this.buffer.length === 0) return [];
    const { older, newer, t } = this.pair(now);
    if (!older || !newer) return [...(this.buffer.at(-1) as TimedSnapshot).entities.values()];

    const out: EntitySnapshot[] = [];
    for (const [id, b] of newer.entities) {
      const a = older.entities.get(id);
      out.push(a ? lerpEntity(a, b, t) : b);
    }
    return out;
  }

  /** Interpolated state for one player at render time, or null when unknown. */
  /**
   * One remote player at render time, from the two snapshots *that contain them* either side of
   * it — not from the two newest snapshots.
   *
   * The server sends a player further than `NEAR_DISTANCE` in one snapshot of every four. Looking
   * only at the pair around the render time found them in neither half the time, and a null hides
   * the avatar: measured, a far player was drawn on **50 %** of frames — blinking at about 5 Hz, on
   * maps whose whole subject is being seen — and jumped whenever it reappeared.
   */
  sample(playerId: string, now = Date.now()): PlayerSnapshot | null {
    if (this.buffer.length === 0) return null;
    const target = now - this.options.delayMs;
    let before: TimedSnapshot | null = null;
    let after: TimedSnapshot | null = null;
    for (const snap of this.buffer) {
      if (!snap.players.has(playerId)) continue;
      if (snap.receivedAt <= target) before = snap;
      else {
        after = snap;
        break;
      }
    }

    const a = before?.players.get(playerId);
    const b = after?.players.get(playerId);
    if (before && after && a && b) {
      const span = after.receivedAt - before.receivedAt || 1;
      return lerpSnapshot(a, b, Math.max(0, Math.min(1, (target - before.receivedAt) / span)));
    }
    // Only a newer one: they have just appeared, so they are drawn where they appeared.
    if (b) return b;
    if (!before || !a) return null;

    // Only an older one. Snapshots that keep arriving without them mean the server has stopped
    // sending them; a connection that has stalled has sent nothing, and freezes them instead.
    const latest = this.buffer.at(-1) as TimedSnapshot;
    if (latest.receivedAt - before.receivedAt > this.options.staleMs) return null;

    const age = target - before.receivedAt;
    if (age <= 0) return a;
    // Short, bounded extrapolation from the last known velocity.
    const extra = Math.min(age, this.options.maxExtrapolationMs) / 1000;
    return {
      ...a,
      x: a.x + a.vx * extra,
      y: a.y + a.vy * extra,
      z: a.z + a.vz * extra,
    };
  }

  ids(): string[] {
    const latest = this.buffer.at(-1);
    return latest ? [...latest.players.keys()] : [];
  }

  latestTick(): number {
    return this.buffer.at(-1)?.tick ?? 0;
  }

  clear(): void {
    this.buffer = [];
  }
}

export function lerpSnapshot(a: PlayerSnapshot, b: PlayerSnapshot, t: number): PlayerSnapshot {
  return {
    ...b,
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
    vx: lerp(a.vx, b.vx, t),
    vy: lerp(a.vy, b.vy, t),
    vz: lerp(a.vz, b.vz, t),
    yaw: lerpAngle(a.yaw, b.yaw, t),
    pitch: lerp(a.pitch, b.pitch, t),
    headY: lerp(a.headY, b.headY, t),
    hands:
      a.hands && b.hands
        ? [
            { x: lerp(a.hands[0].x, b.hands[0].x, t), y: lerp(a.hands[0].y, b.hands[0].y, t), z: lerp(a.hands[0].z, b.hands[0].z, t) },
            { x: lerp(a.hands[1].x, b.hands[1].x, t), y: lerp(a.hands[1].y, b.hands[1].y, t), z: lerp(a.hands[1].z, b.hands[1].z, t) },
          ]
        : b.hands,
  };
}

/**
 * `EntitySnapshot` carries no velocity, so there is nothing to dead-reckon from — which is
 * exactly what the delay buffer exists to make unnecessary. Radius is lerped too: a smoke cloud
 * grows, and stepping its size once per network tick is as visible as stepping its position.
 */
export function lerpEntity(a: EntitySnapshot, b: EntitySnapshot, t: number): EntitySnapshot {
  return {
    ...b,
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
    radius: lerp(a.radius, b.radius, t),
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  const TAU = Math.PI * 2;
  let delta = (b - a) % TAU;
  if (delta > Math.PI) delta -= TAU;
  if (delta < -Math.PI) delta += TAU;
  return a + delta * t;
}
