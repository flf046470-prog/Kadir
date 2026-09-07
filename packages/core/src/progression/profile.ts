import type { CosmeticSlot } from '../content/cosmetics.js';
import type { AchievementMetric } from '../content/achievements.js';
import { DEFAULT_LOADOUT, freeGadgetIds } from '../gadgets/catalog.js';
import { listAnimals } from './../content/animals.js';
import { listCosmetics } from './../content/cosmetics.js';
import type { GadgetSlot } from '../gadgets/types.js';

export const SAVE_VERSION = 3;

export type StatBlock = Record<AchievementMetric, number>;

export interface EquippedLoadout {
  animalId: string;
  cosmetics: Partial<Record<CosmeticSlot, string>>;
  /** Chosen before the round. The server re-validates it against `ownedGadgets` every time. */
  gadgets: Partial<Record<GadgetSlot, string>>;
}

export interface PurchaseRecord {
  itemId: string;
  priceCents: number;
  /** Store transaction id from the platform receipt (or "coins" for soft-currency buys). */
  transactionId: string;
  at: number;
}

export interface DailyState {
  /** Days since epoch of the last claim; -1 when never claimed. */
  lastClaimDay: number;
  streak: number;
}

export interface SeasonState {
  seasonId: string;
  xp: number;
  premiumOwned: boolean;
  claimedFree: number[];
  claimedPremium: number[];
}

export interface PlayerProfile {
  version: number;
  playerId: string;
  name: string;
  createdAt: number;
  updatedAt: number;

  coins: number;
  xp: number;
  level: number;

  ownedAnimals: string[];
  ownedCosmetics: string[];
  ownedGadgets: string[];
  equipped: EquippedLoadout;

  stats: StatBlock;
  achievements: Record<string, number>;
  daily: DailyState;
  season: SeasonState;
  purchases: PurchaseRecord[];

  /** Moderation state kept with the profile so it survives reconnects. */
  mutedPlayerIds: string[];
  blockedPlayerIds: string[];
}

export function emptyStats(): StatBlock {
  return {
    tags: 0,
    wins: 0,
    rounds: 0,
    escapes: 0,
    climbMetres: 0,
    parkourFinishes: 0,
    knockouts: 0,
    playSeconds: 0,
    distanceMetres: 0,
    bestLapSeconds: -1,
  };
}

export function createProfile(playerId: string, name: string, now = Date.now()): PlayerProfile {
  return {
    version: SAVE_VERSION,
    playerId,
    name,
    createdAt: now,
    updatedAt: now,
    coins: 250,
    xp: 0,
    level: 1,
    // Everything, from the moment the account exists. There is nothing to unlock and nothing to
    // buy, so an inventory is a list of what the game contains rather than a record of spending.
    ownedAnimals: listAnimals().map((animal) => animal.id),
    ownedCosmetics: listCosmetics().map((cosmetic) => cosmetic.id),
    ownedGadgets: freeGadgetIds(),
    equipped: {
      animalId: 'kangaroo',
      cosmetics: {},
      gadgets: { ...DEFAULT_LOADOUT },
    },
    stats: emptyStats(),
    achievements: {},
    daily: { lastClaimDay: -1, streak: 0 },
    // The premium track is free like everything else; the flag stays so the two reward
    // tracks remain distinguishable in the season data.
    season: { seasonId: 'season-1', xp: 0, premiumOwned: true, claimedFree: [], claimedPremium: [] },
    purchases: [],
    mutedPlayerIds: [],
    blockedPlayerIds: [],
  };
}

/** XP curve: gentle and predictable — no paywall shaped like a difficulty spike. */
export function levelForXp(xp: number): number {
  return Math.max(1, Math.floor(Math.sqrt(xp / 250)) + 1);
}

export function xpForLevel(level: number): number {
  const l = Math.max(1, level) - 1;
  return l * l * 250;
}
