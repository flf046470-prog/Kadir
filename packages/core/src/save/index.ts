import { DEFAULT_LOADOUT, freeGadgetIds, getGadget } from '../gadgets/catalog.js';
import { listAnimals } from '../content/animals.js';
import { listCosmetics } from '../content/cosmetics.js';
import type { PlayerProfile } from '../progression/profile.js';
import { SAVE_VERSION, createProfile, emptyStats, levelForXp } from '../progression/profile.js';

/**
 * Versioned save handling.
 *
 * A commercial game changes its profile shape constantly; migrations run on load so a player
 * who last played months ago never loses their inventory. Unknown fields are dropped, missing
 * fields are filled — a corrupt save degrades to a valid one rather than crashing the client.
 */
export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

export const MIGRATIONS: Record<number, Migration> = {
  // 0 → 1: the first shipped schema. Older test builds stored a flat coin count only.
  0: (raw) => ({
    ...raw,
    version: 1,
    ownedAnimals: Array.isArray(raw.ownedAnimals) ? raw.ownedAnimals : ['kangaroo'],
    equipped: raw.equipped ?? { animalId: 'kangaroo', cosmetics: {} },
  }),
  // 1 → 2: gadgets exist. Grant the loadout so an old account is not dropped into Hunt
  // empty-handed.
  1: (raw) => ({
    ...raw,
    version: 2,
    ownedGadgets: Array.isArray(raw.ownedGadgets) ? raw.ownedGadgets : freeGadgetIds(),
    equipped: {
      ...((raw.equipped as Record<string, unknown>) ?? { animalId: 'kangaroo', cosmetics: {} }),
      gadgets: (raw.equipped as { gadgets?: unknown })?.gadgets ?? { ...DEFAULT_LOADOUT },
    },
  }),
  // 2 → 3: the game became free. Every existing account is granted everything, including the
  // animals and cosmetics it never bought — the alternative is a returning player finding a
  // locked roster in a game that no longer has locks.
  2: (raw) => ({
    ...raw,
    version: 3,
    ownedAnimals: listAnimals().map((animal) => animal.id),
    ownedCosmetics: listCosmetics().map((cosmetic) => cosmetic.id),
    ownedGadgets: freeGadgetIds(),
    season: { ...(raw.season as Record<string, unknown>), premiumOwned: true },
  }),
};

export function migrateProfile(input: unknown, playerId: string, name = 'Roo'): PlayerProfile {
  const fallback = createProfile(playerId, name);
  if (!input || typeof input !== 'object') return fallback;

  let raw = { ...(input as Record<string, unknown>) };
  let version = typeof raw.version === 'number' ? raw.version : 0;
  while (version < SAVE_VERSION) {
    const migration = MIGRATIONS[version];
    if (!migration) break;
    raw = migration(raw);
    version = typeof raw.version === 'number' ? raw.version : version + 1;
  }

  const profile: PlayerProfile = {
    ...fallback,
    ...(raw as Partial<PlayerProfile>),
    version: SAVE_VERSION,
    playerId,
    stats: { ...emptyStats(), ...(raw.stats as PlayerProfile['stats']) },
    equipped: {
      animalId: (raw.equipped as PlayerProfile['equipped'])?.animalId ?? 'kangaroo',
      cosmetics: (raw.equipped as PlayerProfile['equipped'])?.cosmetics ?? {},
      gadgets: (raw.equipped as PlayerProfile['equipped'])?.gadgets ?? {},
    },
    daily: { ...fallback.daily, ...(raw.daily as PlayerProfile['daily']) },
    season: { ...fallback.season, ...(raw.season as PlayerProfile['season']) },
    achievements: (raw.achievements as PlayerProfile['achievements']) ?? {},
    ownedAnimals: uniqueStrings(raw.ownedAnimals, ['kangaroo']),
    ownedCosmetics: uniqueStrings(raw.ownedCosmetics, []),
    ownedGadgets: uniqueStrings(raw.ownedGadgets, freeGadgetIds()),
    purchases: Array.isArray(raw.purchases) ? (raw.purchases as PlayerProfile['purchases']) : [],
    mutedPlayerIds: uniqueStrings(raw.mutedPlayerIds, []),
    blockedPlayerIds: uniqueStrings(raw.blockedPlayerIds, []),
  };

  profile.coins = safeNumber(profile.coins, 0);
  profile.xp = safeNumber(profile.xp, 0);
  profile.level = levelForXp(profile.xp);
  // Re-granted on every load rather than only on migration: content added after this save was
  // written is free too, and a player should not have to wait for a migration bump to see it.
  for (const animal of listAnimals()) if (!profile.ownedAnimals.includes(animal.id)) profile.ownedAnimals.push(animal.id);
  for (const item of listCosmetics()) if (!profile.ownedCosmetics.includes(item.id)) profile.ownedCosmetics.push(item.id);
  for (const id of freeGadgetIds()) if (!profile.ownedGadgets.includes(id)) profile.ownedGadgets.push(id);
  if (!profile.ownedAnimals.includes(profile.equipped.animalId)) profile.equipped.animalId = 'kangaroo';
  // Content removed from the catalog since this save was written would otherwise sit in the
  // inventory forever, silently occupying a slot the player cannot fill.
  profile.ownedGadgets = profile.ownedGadgets.filter((id) => getGadget(id) !== undefined);
  return profile;
}

function uniqueStrings(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  return [...new Set(value.filter((v): v is string => typeof v === 'string'))];
}

function safeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function serializeProfile(profile: PlayerProfile): string {
  return JSON.stringify(profile);
}

export function parseProfile(json: string, playerId: string): PlayerProfile {
  try {
    return migrateProfile(JSON.parse(json), playerId);
  } catch {
    return createProfile(playerId, 'Roo');
  }
}

/** Storage abstraction: memory in tests, files on the server, IndexedDB/localStorage offline. */
export interface SaveStore {
  load(playerId: string): Promise<PlayerProfile | null>;
  save(profile: PlayerProfile): Promise<void>;
  delete?(playerId: string): Promise<void>;
}

export class MemorySaveStore implements SaveStore {
  private map = new Map<string, string>();

  async load(playerId: string): Promise<PlayerProfile | null> {
    const raw = this.map.get(playerId);
    return raw ? parseProfile(raw, playerId) : null;
  }

  async save(profile: PlayerProfile): Promise<void> {
    this.map.set(profile.playerId, serializeProfile(profile));
  }

  async delete(playerId: string): Promise<void> {
    this.map.delete(playerId);
  }

  get size(): number {
    return this.map.size;
  }
}
