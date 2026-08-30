import type { CosmeticSlot } from '../content/cosmetics.js';
import type { AchievementMetric } from '../content/achievements.js';
import { STARTER_GADGETS } from '../gadgets/catalog.js';
import type { GadgetSlot } from '../gadgets/types.js';

export const SAVE_VERSION = 2;

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
    ownedAnimals: ['kangaroo'],
    ownedCosmetics: [],
    // The starter set is free and universal, so a player who never spends anything still walks
    // into Hunt with a freeze gun, smoke and a vest.
    ownedGadgets: [...STARTER_GADGETS],
    equipped: {
      animalId: 'kangaroo',
      cosmetics: {},
      gadgets: { primary: 'freeze_gun', secondary: 'smoke_bomb', armour: 'steel_vest' },
    },
    stats: emptyStats(),
    achievements: {},
    daily: { lastClaimDay: -1, streak: 0 },
    season: { seasonId: 'season-1', xp: 0, premiumOwned: false, claimedFree: [], claimedPremium: [] },
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
