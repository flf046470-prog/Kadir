import type { InputIntent, PlayerSnapshot, PlayerState, Simulation } from '@kc/core';
import { applySnapshot, copyIntent, createIntent } from '@kc/core';

export interface ReconcileOptions {
  /** Below this positional error the correction is smoothed instead of snapped. */
  smoothThreshold: number;
  /** Above this error the client hard-snaps (teleport, respawn, or a real desync). */
  snapThreshold: number;
  /** Fraction of the remaining error removed per frame while smoothing. */
  smoothRate: number;
}

export const DEFAULT_RECONCILE: ReconcileOptions = {
  smoothThreshold: 0.04,
  snapThreshold: 3.5,
  smoothRate: 0.22,
};

/**
 * Client-side prediction with server reconciliation.
 *
 * The local player is simulated immediately from local input; every intent is kept until the
 * server acknowledges the tick it belongs to. When a snapshot arrives we rewind the local player
 * to the server's state and replay the unacknowledged inputs through the *same* simulation code
 * the server ran — which is the entire reason `@kc/core` is renderer- and transport-free.
 */
export class PredictionBuffer {
  private history: { tick: number; intent: InputIntent }[] = [];
  /** Visual offset that decays to zero, so a small correction never looks like a teleport. */
  readonly smoothingOffset = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly capacity = 180,
    private readonly options: ReconcileOptions = DEFAULT_RECONCILE,
  ) {}

  record(tick: number, intent: InputIntent): void {
    const stored = createIntent();
    copyIntent(stored, intent);
    stored.tick = tick;
    this.history.push({ tick, intent: stored });
    if (this.history.length > this.capacity) this.history.shift();
  }

  /** Drop everything the server has already accounted for. */
  acknowledge(tick: number): void {
    while (this.history.length > 0 && (this.history[0] as { tick: number }).tick <= tick) {
      this.history.shift();
    }
  }

  pending(): { tick: number; intent: InputIntent }[] {
    return this.history;
  }

  /**
   * Rewind to the authoritative snapshot and replay unacknowledged input.
   * Returns the positional error that was corrected (metres).
   */
  reconcile(sim: Simulation, local: PlayerState, snapshot: PlayerSnapshot, serverTick: number): number {
    const before = { x: local.position.x, y: local.position.y, z: local.position.z };

    applySnapshot(local, snapshot);
    this.acknowledge(serverTick);

    sim.tick = serverTick;
    for (const entry of this.history) {
      sim.setIntent(local.id, entry.intent, false);
      sim.step();
    }

    const error = Math.hypot(
      before.x - local.position.x,
      before.y - local.position.y,
      before.z - local.position.z,
    );

    if (error > this.options.snapThreshold) {
      this.smoothingOffset.x = 0;
      this.smoothingOffset.y = 0;
      this.smoothingOffset.z = 0;
    } else if (error > this.options.smoothThreshold) {
      // Keep rendering where the player *was*, then walk that offset to zero over a few frames.
      this.smoothingOffset.x = before.x - local.position.x;
      this.smoothingOffset.y = before.y - local.position.y;
      this.smoothingOffset.z = before.z - local.position.z;
    }
    return error;
  }

  /** Call once per rendered frame to decay the visual offset. */
  decaySmoothing(): void {
    const k = 1 - this.options.smoothRate;
    this.smoothingOffset.x *= k;
    this.smoothingOffset.y *= k;
    this.smoothingOffset.z *= k;
    if (Math.abs(this.smoothingOffset.x) < 1e-4) this.smoothingOffset.x = 0;
    if (Math.abs(this.smoothingOffset.y) < 1e-4) this.smoothingOffset.y = 0;
    if (Math.abs(this.smoothingOffset.z) < 1e-4) this.smoothingOffset.z = 0;
  }

  clear(): void {
    this.history = [];
  }
}
