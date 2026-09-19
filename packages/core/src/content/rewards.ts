import type { CosmeticSlot } from './cosmetics.js';

export type RewardKind = 'coins' | 'cosmetic' | 'animal' | 'xp';

export interface Reward {
  kind: RewardKind;
  /** Coins/xp amount, or the content id for cosmetic/animal rewards. */
  amount?: number;
  contentId?: string;
  slot?: CosmeticSlot;
}

/** Seven-day cycle. Day 7 is a cosmetic so the week has a visible payoff. */
export const DAILY_REWARDS: Reward[] = [
  { kind: 'coins', amount: 150 },
  { kind: 'cosmetic', contentId: 'emote_sleep', slot: 'emote' },
  { kind: 'coins', amount: 250 },
  { kind: 'cosmetic', contentId: 'hat_leaf', slot: 'hat' },
  { kind: 'cosmetic', contentId: 'effect_leaves', slot: 'effect' },
  { kind: 'coins', amount: 400 },
  { kind: 'cosmetic', contentId: 'tail_stripe', slot: 'tail' },
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
    track: [
      { level: 1, free: { kind: 'coins', amount: 200 }, premium: { kind: 'cosmetic', contentId: 'glasses_star' } },
      { level: 2, free: { kind: 'cosmetic', contentId: 'trail_dust' }, premium: { kind: 'coins', amount: 500 } },
      { level: 3, free: { kind: 'coins', amount: 300 }, premium: { kind: 'cosmetic', contentId: 'mask_tribal' } },
      { level: 4, premium: { kind: 'cosmetic', contentId: 'effect_sparkle' } },
      { level: 5, free: { kind: 'cosmetic', contentId: 'emote_victory' }, premium: { kind: 'animal', contentId: 'tiger' } },
      { level: 6, free: { kind: 'coins', amount: 500 }, premium: { kind: 'cosmetic', contentId: 'tail_glow' } },
      { level: 7, free: { kind: 'cosmetic', contentId: 'glasses_round' }, premium: { kind: 'cosmetic', contentId: 'trail_rainbow' } },
    ],
  },
];

export interface EventDef {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  /** Cosmetics unlocked or purchasable only while the event runs. */
  cosmeticIds: string[];
  /** Level decoration hint for the client. */
  decoration: 'halloween' | 'winter' | 'summer' | 'festival' | 'none';
  challenges: { id: string; name: string; metric: string; threshold: number; rewardCoins: number }[];
}

export const EVENTS: EventDef[] = [
  {
    id: 'jungle-festival',
    name: 'Jungle Festival',
    startsAt: '2026-06-01T00:00:00.000Z',
    endsAt: '2026-06-14T23:59:59.000Z',
    cosmeticIds: ['hat_crown', 'effect_leaves'],
    decoration: 'festival',
    challenges: [
      { id: 'festival_tags', name: 'Festival Tagger', metric: 'tags', threshold: 25, rewardCoins: 500 },
      { id: 'festival_laps', name: 'Festival Runner', metric: 'parkourFinishes', threshold: 5, rewardCoins: 500 },
    ],
  },
  {
    id: 'halloween',
    name: 'Spooky Jungle',
    startsAt: '2026-10-24T00:00:00.000Z',
    endsAt: '2026-11-02T23:59:59.000Z',
    cosmeticIds: ['mask_tribal', 'hat_leaf'],
    decoration: 'halloween',
    challenges: [{ id: 'spooky_escapes', name: 'Not Today', metric: 'escapes', threshold: 5, rewardCoins: 600 }],
  },
  {
    id: 'winter',
    name: 'Frozen Canopy',
    startsAt: '2026-12-15T00:00:00.000Z',
    endsAt: '2027-01-05T23:59:59.000Z',
    cosmeticIds: ['trail_rainbow'],
    decoration: 'winter',
    challenges: [{ id: 'winter_wins', name: 'Winter Champion', metric: 'wins', threshold: 10, rewardCoins: 800 }],
  },
];

export function activeSeason(now: number): SeasonDef | undefined {
  return SEASONS.find((s) => Date.parse(s.startsAt) <= now && now <= Date.parse(s.endsAt));
}

export function activeEvents(now: number): EventDef[] {
  return EVENTS.filter((e) => Date.parse(e.startsAt) <= now && now <= Date.parse(e.endsAt));
}
