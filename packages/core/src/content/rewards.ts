import type { CosmeticSlot } from './cosmetics.js';
import type { AchievementMetric } from './achievements.js';

export type RewardKind = 'coins' | 'cosmetic' | 'animal' | 'xp';

export interface Reward {
  kind: RewardKind;
  /** Coins/xp amount, or the content id for cosmetic/animal rewards. */
  amount?: number;
  contentId?: string;
  slot?: CosmeticSlot;
}

/**
 * Seven-day cycle, coins only, rising to the week's payoff on day 7.
 *
 * Four of these days used to be cosmetics — the Power Nap emote, the Leaf Cap, Leaf Swirl and the
 * Striped Tail — every one of which a new account already owns, so four days in seven paid out
 * nothing. Coins buy a season's cosmetics now, so a coin day is worth something.
 */
export const DAILY_REWARDS: Reward[] = [
  { kind: 'coins', amount: 150 },
  { kind: 'coins', amount: 200 },
  { kind: 'coins', amount: 250 },
  { kind: 'coins', amount: 300 },
  { kind: 'coins', amount: 350 },
  { kind: 'coins', amount: 400 },
  { kind: 'coins', amount: 700 },
];

export interface SeasonTrackEntry {
  level: number;
  free?: Reward;
  premium?: Reward;
}

export interface SeasonDef {
  id: string;
  name: string;
  /** ISO timestamps; the server clock decides what is active. */
  startsAt: string;
  endsAt: string;
  premiumPriceCents: number;
  /** XP needed per level. */
  xpPerLevel: number;
  track: SeasonTrackEntry[];
}

export const SEASONS: SeasonDef[] = [
  {
    id: 'season-1',
    name: 'Season 1 — Jungle',
    startsAt: '2026-01-01T00:00:00.000Z',
    endsAt: '2026-12-31T23:59:59.000Z',
    premiumPriceCents: 199,
    xpPerLevel: 1000,
    // Every cosmetic here is one of the season's own (`SEASON_ONE_COSMETICS`), which no account
    // owns until it earns it. The track used to name nine launch items and the tiger, all owned by
    // every account from creation — claiming them granted nothing.
    track: [
      { level: 1, free: { kind: 'coins', amount: 200 }, premium: { kind: 'cosmetic', contentId: 'glasses_goggles' } },
      { level: 2, free: { kind: 'cosmetic', contentId: 'tail_bow' }, premium: { kind: 'coins', amount: 400 } },
      { level: 3, free: { kind: 'coins', amount: 300 }, premium: { kind: 'cosmetic', contentId: 'backpack_boomerang' } },
      { level: 4, free: { kind: 'cosmetic', contentId: 'mask_snorkel' }, premium: { kind: 'coins', amount: 500 } },
      { level: 5, free: { kind: 'coins', amount: 400 }, premium: { kind: 'cosmetic', contentId: 'hat_propeller' } },
      { level: 6, free: { kind: 'coins', amount: 500 }, premium: { kind: 'coins', amount: 600 } },
      { level: 7, free: { kind: 'cosmetic', contentId: 'hat_flower' }, premium: { kind: 'coins', amount: 800 } },
    ],
  },
];

/**
 * A dated event: a few challenges counted only while it runs, each paying coins once.
 *
 * These were declared with dates and challenges and read by nothing — no server counted them, no
 * screen showed them. They also named "cosmetics unlocked while the event runs", every one a launch
 * item all accounts own, and a decoration hint no renderer read; both fields are gone rather than
 * left promising. Progress is the rise in a profile stat since the player's first round of the
 * event (`progression/events.ts`), so it is counted from the server's own match results.
 */
export interface EventDef {
  id: string;
  name: string;
  /** The first occurrence's dates. A `yearly` event comes back on the same dates every year. */
  startsAt: string;
  endsAt: string;
  yearly?: boolean;
  challenges: EventChallenge[];
}

export interface EventChallenge {
  id: string;
  name: string;
  description: string;
  metric: AchievementMetric;
  threshold: number;
  rewardCoins: number;
}

export const EVENTS: EventDef[] = [
  {
    id: 'jungle-festival',
    name: 'Jungle Festival',
    startsAt: '2026-06-01T00:00:00.000Z',
    endsAt: '2026-06-14T23:59:59.000Z',
    yearly: true,
    challenges: [
      { id: 'festival_tags', name: 'Festival Tagger', description: 'Tag 25 players during the festival.', metric: 'tags', threshold: 25, rewardCoins: 500 },
      { id: 'festival_laps', name: 'Festival Runner', description: 'Finish the parkour route 5 times.', metric: 'parkourFinishes', threshold: 5, rewardCoins: 500 },
    ],
  },
  {
    id: 'halloween',
    name: 'Spooky Jungle',
    startsAt: '2026-10-24T00:00:00.000Z',
    endsAt: '2026-11-02T23:59:59.000Z',
    yearly: true,
    challenges: [
      { id: 'spooky_escapes', name: 'Not Today', description: 'Survive 5 rounds without being tagged.', metric: 'escapes', threshold: 5, rewardCoins: 600 },
      { id: 'spooky_heights', name: 'Haunted Heights', description: 'Climb 100 metres with your hands.', metric: 'climbMetres', threshold: 100, rewardCoins: 500 },
    ],
  },
  {
    id: 'winter',
    name: 'Frozen Canopy',
    startsAt: '2026-12-15T00:00:00.000Z',
    endsAt: '2027-01-05T23:59:59.000Z',
    yearly: true,
    challenges: [
      { id: 'winter_wins', name: 'Winter Champion', description: 'Win 10 rounds.', metric: 'wins', threshold: 10, rewardCoins: 800 },
      { id: 'winter_miles', name: 'Snow Miles', description: 'Cover 5 km on foot.', metric: 'distanceMetres', threshold: 5000, rewardCoins: 500 },
    ],
  },
];

export function activeSeason(now: number): SeasonDef | undefined {
  return SEASONS.find((s) => Date.parse(s.startsAt) <= now && now <= Date.parse(s.endsAt));
}

