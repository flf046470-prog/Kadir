import { DAILY_REWARDS } from '../content/rewards.js';
import type { Reward } from '../content/rewards.js';
import { grantContent } from './inventory.js';
import type { PlayerProfile } from './profile.js';

const DAY_MS = 86_400_000;

export function dayIndex(now: number): number {
  return Math.floor(now / DAY_MS);
}

export interface DailyClaim {
  ok: boolean;
  reason?: 'already-claimed';
  day: number;
  streak: number;
  reward?: Reward;
  nextClaimInMs: number;
}

/**
 * Seven-day reward cycle, evaluated against the **server** clock so changing the device date
 * does nothing. Missing a day resets the streak but never takes anything away.
 */
export function claimDaily(profile: PlayerProfile, now = Date.now()): DailyClaim {
  const today = dayIndex(now);
  const nextClaimInMs = (today + 1) * DAY_MS - now;

  if (profile.daily.lastClaimDay === today) {
    return { ok: false, reason: 'already-claimed', day: today, streak: profile.daily.streak, nextClaimInMs };
  }

  const consecutive = profile.daily.lastClaimDay === today - 1;
  const streak = consecutive ? profile.daily.streak + 1 : 1;
  const rewardIndex = (streak - 1) % DAILY_REWARDS.length;
  const reward = DAILY_REWARDS[rewardIndex] as Reward;

  if (reward.kind === 'coins') profile.coins += reward.amount ?? 0;
  else if (reward.contentId) grantContent(profile, [reward.contentId]);

  profile.daily.lastClaimDay = today;
  profile.daily.streak = streak;
  profile.updatedAt = now;

  return { ok: true, day: today, streak, reward, nextClaimInMs };
}

export function dailyPreview(profile: PlayerProfile, now = Date.now()): { index: number; reward: Reward; claimable: boolean }[] {
  const today = dayIndex(now);
  const claimedToday = profile.daily.lastClaimDay === today;
  const consecutive = profile.daily.lastClaimDay === today - 1 || profile.daily.lastClaimDay === today;
  const currentStreak = consecutive ? profile.daily.streak : 0;
  return DAILY_REWARDS.map((reward, index) => ({
    index,
    reward,
    claimable: !claimedToday && index === currentStreak % DAILY_REWARDS.length,
  }));
}
