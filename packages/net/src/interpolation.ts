import type { PlayerSnapshot } from '@kc/core';

export interface InterpolationOptions {
  /** How far in the past remote players are rendered. One snapshot interval + jitter margin. */
  delayMs: number;
  /** Never extrapolate further than this; beyond it a player is frozen rather than guessed. */
  maxExtrapolationMs: number;
}

export const DEFAULT_INTERPOLATION: InterpolationOptions = {
  delayMs: 100,
  maxExtrapolationMs: 250,
};

interface TimedSnapshot {
  tick: number;
  receivedAt: number;
  players: Map<string, PlayerSnapshot>;
}

/**
 * Snapshot buffer with time-shifted interpolation.
 *
 * Remote players are rendered `delayMs` in the past so that normal jitter is absorbed by having
 * two snapshots to interpolate between. Extrapolation is deliberately capped: a guessed position
 * that turns out wrong is what produces "ghost tags", and this game is built on tags being fair.
 */
export class InterpolationBuffer {
  private buffer: TimedSnapshot[] = [];

  constructor(private readonly options: InterpolationOptions = DEFAULT_INTERPOLATION) {}

  push(tick: number, players: PlayerSnapshot[], now = Date.now()): void {
    const map = new Map<string, PlayerSnapshot>();
    for (const p of players) map.set(p.id, p);
    this.buffer.push({ tick, receivedAt: now, players: map });
    // Keep a second of history — plenty for interpolation, bounded for memory.
    while (this.buffer.length > 2 && (this.buffer[0] as TimedSnapshot).receivedAt < now - 1000) {
      this.buffer.shift();
    }
  }

  /** Interpolated state for one player at render time, or null when unknown. */
  sample(playerId: string, now = Date.now()): PlayerSnapshot | null {
    if (this.buffer.length === 0) return null;
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

    if (older && newer) {
      const a = older.players.get(playerId);
      const b = newer.players.get(playerId);
      if (a && b) {
        const span = newer.receivedAt - older.receivedAt || 1;
        const t = Math.max(0, Math.min(1, (target - older.receivedAt) / span));
        return lerpSnapshot(a, b, t);
      }
      return b ?? a ?? null;
    }

    const latest = this.buffer.at(-1) as TimedSnapshot;
    const player = latest.players.get(playerId);
    if (!player) return null;

    const age = now - latest.receivedAt;
    if (age <= this.options.delayMs) return player;
    // Short, bounded extrapolation from the last known velocity.
    const extra = Math.min(age - this.options.delayMs, this.options.maxExtrapolationMs) / 1000;
    return {
      ...player,
      x: player.x + player.vx * extra,
      y: player.y + player.vy * extra,
      z: player.z + player.vz * extra,
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
