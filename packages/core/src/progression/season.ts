import { SEASONS, activeSeason } from '../content/rewards.js';
import type { Reward, SeasonDef } from '../content/rewards.js';
import { grantContent } from './inventory.js';
import type { PlayerProfile } from './profile.js';

export interface SeasonProgress {
  season: SeasonDef | undefined;
  level: number;
  xp: number;
  xpIntoLevel: number;
  xpPerLevel: number;
  premiumOwned: boolean;
  claimable: { level: number; track: 'free' | 'premium'; reward: Reward }[];
}

export function seasonLevel(season: SeasonDef, xp: number): number {
  return Math.max(1, Math.floor(xp / season.xpPerLevel) + 1);
}

export function getSeasonProgress(profile: PlayerProfile, now = Date.now()): SeasonProgress {
  const season = activeSeason(now) ?? SEASONS[0];
  if (!season) {
    return { season: undefined, level: 1, xp: 0, xpIntoLevel: 0, xpPerLevel: 1, premiumOwned: false, claimable: [] };
  }
  // Rolling into a new season resets progress but never removes owned content.
  if (profile.season.seasonId !== season.id) {
    profile.season = { seasonId: season.id, xp: 0, premiumOwned: false, claimedFree: [], claimedPremium: [] };
  }

  const xp = profile.season.xp;
  const level = seasonLevel(season, xp);
  const claimable: SeasonProgress['claimable'] = [];
  for (const entry of season.track) {
    if (entry.level > level) continue;
    if (entry.free && !profile.season.claimedFree.includes(entry.level)) {
      claimable.push({ level: entry.level, track: 'free', reward: entry.free });
    }
    if (entry.premium && profile.season.premiumOwned && !profile.season.claimedPremium.includes(entry.level)) {
      claimable.push({ level: entry.level, track: 'premium', reward: entry.premium });
    }
  }

  return {
    season,
    level,
    xp,
    xpIntoLevel: xp % season.xpPerLevel,
    xpPerLevel: season.xpPerLevel,
    premiumOwned: profile.season.premiumOwned,
    claimable,
  };
}

export interface SeasonClaimResult {
  ok: boolean;
  claimed: { level: number; track: 'free' | 'premium'; reward: Reward }[];
}

/** Claim every reward the player is entitled to. Premium rewards need the optional pass. */
export function claimSeasonRewards(profile: PlayerProfile, now = Date.now()): SeasonClaimResult {
  const progress = getSeasonProgress(profile, now);
  if (!progress.season) return { ok: false, claimed: [] };

  for (const item of progress.claimable) {
    if (item.reward.kind === 'coins') profile.coins += item.reward.amount ?? 0;
    else if (item.reward.contentId) grantContent(profile, [item.reward.contentId]);

    if (item.track === 'free') profile.season.claimedFree.push(item.level);
    else profile.season.claimedPremium.push(item.level);
  }
  profile.updatedAt = now;
  return { ok: true, claimed: progress.claimable };
}
