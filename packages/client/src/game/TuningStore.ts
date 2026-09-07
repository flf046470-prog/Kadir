import {
  DEFAULT_MOVEMENT,
  TUNABLES,
  applyTuning,
  clampTunable,
  formatTuningExport,
  quantise,
  sanitiseOverrides,
  tunableFor,
} from '@kc/core';
import type { Simulation, Tunable, TuningOverrides } from '@kc/core';

const STORAGE_KEY = 'kc.tuning';

/**
 * The live movement-tuning session.
 *
 * Finding the feel means changing one number and immediately feeling the difference — with the
 * headset still on. So values apply to the running simulation on the next tick rather than at
 * the next match, and they survive a reload, because a tuning session outlives a page refresh.
 *
 * Deliberately confined to solo practice. In a real match the server owns every player's config
 * and would simply overwrite these, so allowing it there would produce a client that mispredicts
 * its own movement — and it would look like an attempt to cheat even though it could not work.
 * `GameClient` enforces that; this class holds no opinion beyond refusing to persist junk.
 */
export class TuningStore {
  private overrides: TuningOverrides;
  private storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;

  constructor(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null = safeStorage()) {
    this.storage = storage;
    this.overrides = this.load();
  }

  private load(): TuningOverrides {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      // sanitiseOverrides is the trust boundary: this string can be edited by hand.
      return raw ? sanitiseOverrides(JSON.parse(raw)) : {};
    } catch {
      return {};
    }
  }

  private persist(): void {
    try {
      if (Object.keys(this.overrides).length === 0) this.storage?.removeItem(STORAGE_KEY);
      else this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.overrides));
    } catch {
      // Private browsing and storage-blocked contexts throw. Losing persistence is survivable;
      // losing the tuning session in progress is not, so the in-memory values stand either way.
    }
  }

  /** Current value of a field — the override if there is one, otherwise the shipped default. */
  value(field: Tunable['field']): number {
    return this.overrides[field] ?? DEFAULT_MOVEMENT[field];
  }

  isOverridden(field: Tunable['field']): boolean {
    return this.overrides[field] !== undefined;
  }

  set(field: Tunable['field'], value: number): void {
    const tunable = tunableFor(field);
    if (!tunable) return;
    const clamped = clampTunable(tunable, value);
    // Returning to the default drops the override entirely, so the export stays a list of real
    // decisions rather than every field that was ever touched.
    if (clamped === quantise(tunable, DEFAULT_MOVEMENT[field])) delete this.overrides[field];
    else this.overrides[field] = clamped;
    this.persist();
  }

  /** Move a field by whole steps — what a `−` / `+` button on the VR panel does. */
  nudge(field: Tunable['field'], steps: number): void {
    const tunable = tunableFor(field);
    if (!tunable) return;
    this.set(field, this.value(field) + tunable.step * steps);
  }

  reset(): void {
    this.overrides = {};
    this.persist();
  }

  get modifiedCount(): number {
    return Object.keys(this.overrides).length;
  }

  /** The tuned values as source to paste into `DEFAULT_MOVEMENT`. */
  exportText(): string {
    return formatTuningExport(this.overrides);
  }

  /**
   * Push the current values into a running simulation.
   *
   * Every player gets them, not just the local one: tuning asks "how does this world feel", and
   * a world where the bots move under different physics answers a different question. Each gets
   * its own object — `createPlayerState` clones for the same reason.
   */
  applyTo(sim: Simulation): void {
    for (const player of sim.players.values()) {
      player.config = applyTuning(DEFAULT_MOVEMENT, this.overrides);
    }
  }

  /** Field metadata for whichever panel is drawing it. */
  get tunables(): readonly Tunable[] {
    return TUNABLES as readonly Tunable[];
  }
}

function safeStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // blocked by policy — tuning still works, it just will not persist
  }
}
