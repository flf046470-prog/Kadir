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
    },
    daily: { ...fallback.daily, ...(raw.daily as PlayerProfile['daily']) },
    season: { ...fallback.season, ...(raw.season as PlayerProfile['season']) },
    achievements: (raw.achievements as PlayerProfile['achievements']) ?? {},
    ownedAnimals: uniqueStrings(raw.ownedAnimals, ['kangaroo']),
    ownedCosmetics: uniqueStrings(raw.ownedCosmetics, []),
    purchases: Array.isArray(raw.purchases) ? (raw.purchases as PlayerProfile['purchases']) : [],
    mutedPlayerIds: uniqueStrings(raw.mutedPlayerIds, []),
    blockedPlayerIds: uniqueStrings(raw.blockedPlayerIds, []),
  };

  profile.coins = safeNumber(profile.coins, 0);
  profile.xp = safeNumber(profile.xp, 0);
  profile.level = levelForXp(profile.xp);
  if (!profile.ownedAnimals.includes('kangaroo')) profile.ownedAnimals.push('kangaroo');
  if (!profile.ownedAnimals.includes(profile.equipped.animalId)) profile.equipped.animalId = 'kangaroo';
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
