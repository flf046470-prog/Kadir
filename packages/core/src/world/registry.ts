import type { LevelDef } from './level.js';

/**
 * Every level the game knows how to build.
 *
 * Until now there was exactly one map and `buildJungleWorld()` was called directly in three
 * places — the client, the room, and the room manager — so a second map could not exist without
 * editing all three and guessing which one was authoritative. The server already announced a
 * `levelId` in its welcome message and the client's handler did not even declare the field, let
 * alone read it: whatever the server said, the client built the jungle.
 *
 * A level is a *builder*, not a built level, because levels are generated from a seed rather than
 * loaded. Handing out a fresh one per call keeps them independent — a room mutating its own world
 * cannot reach into another room's — and keeps determinism visible at the call site.
 */
export type LevelBuilderFn = (seed?: number) => LevelDef;

export interface LevelEntry {
  id: string;
  name: string;
  /** One line for the menus, describing how the place plays rather than how it looks. */
  description: string;
  build: LevelBuilderFn;
}

const levels = new Map<string, LevelEntry>();

/**
 * The level a room gets when nothing asks for one in particular.
 *
 * Named explicitly rather than taken as "the first one registered", which is what this was and
 * which a test caught immediately: registration order is *module import* order, so the default
 * map changed depending on which file happened to import which first. A bundler reordering its
 * chunks would have moved every player to a different world with nothing in the diff to explain
 * it.
 */
const DEFAULT_LEVEL_ID = 'jungle-world';

export function registerLevel(entry: LevelEntry): void {
  levels.set(entry.id, entry);
}

export function listLevels(): LevelEntry[] {
  return [...levels.values()];
}

export function getLevelEntry(id: string): LevelEntry | undefined {
  return levels.get(id);
}

/** Built versions, so asking for one does not rebuild a whole world every time. */
const versions = new Map<string, number>();

/**
 * A level's course version.
 *
 * Read from the built level rather than declared on the registry entry, so the two can never
 * disagree — a version that lived in both places would eventually be bumped in only one, and the
 * thing it protects is a leaderboard, where being quietly wrong is the whole failure.
 *
 * Returns 0 for an unknown id: callers key records with it, and inventing a version for a map
 * that does not exist here would file those records under a real map's name.
 */
export function levelVersion(id: string): number {
  const cached = versions.get(id);
  if (cached !== undefined) return cached;
  const entry = levels.get(id);
  if (!entry) return 0;
  const version = entry.build().version;
  versions.set(id, version);
  return version;
}

/**
 * Build a level by id, falling back to the first registered one.
 *
 * The fallback is deliberate and must never throw: this runs on the client against an id chosen
 * by the *server*, so a client older than a map would otherwise crash on joining a room playing
 * it. Falling back puts the player in the wrong world, which is visibly wrong and recoverable;
 * throwing here takes the whole client down.
 */
export function buildLevel(id: string, seed?: number): LevelDef {
  const entry = levels.get(id) ?? levels.get(DEFAULT_LEVEL_ID) ?? levels.values().next().value;
  if (!entry) throw new Error('no levels are registered');
  return entry.build(seed);
}

export function defaultLevelId(): string {
  if (levels.has(DEFAULT_LEVEL_ID)) return DEFAULT_LEVEL_ID;
  const first = levels.values().next().value;
  if (!first) throw new Error('no levels are registered');
  return first.id;
}
