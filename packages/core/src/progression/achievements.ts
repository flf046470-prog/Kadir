import { ACHIEVEMENTS } from '../content/achievements.js';
import type { AchievementDef, AchievementMetric } from '../content/achievements.js';
import type { MatchResult } from '../modes/types.js';
import { grantContent } from './inventory.js';
import type { PlayerProfile } from './profile.js';

export interface AchievementUnlock {
  def: AchievementDef;
  coins: number;
  cosmeticId?: string;
}

/** Apply the server-observed match result to a profile's lifetime stats. */
export function applyMatchStats(profile: PlayerProfile, result: MatchResult, playerId: string): void {
  const entry = result.players.find((p) => p.playerId === playerId);
  if (!entry) return;

  const stats = profile.stats;
  stats.rounds += 1;
  stats.tags += entry.tags;
  stats.escapes += entry.escapes;
  stats.playSeconds += result.durationTicks / 60;
  if (entry.won) stats.wins += 1;
  if (result.modeId === 'boxing') stats.knockouts += entry.tags;
  if (result.modeId === 'parkour' && entry.bestLapTicks > 0) {
    stats.parkourFinishes += 1;
    const seconds = entry.bestLapTicks / 60;
    if (stats.bestLapSeconds < 0 || seconds < stats.bestLapSeconds) stats.bestLapSeconds = seconds;
  }
  profile.updatedAt = Date.now();
}

/** Track continuous metrics the match result cannot express (climbing, distance travelled). */
export function addMetric(profile: PlayerProfile, metric: AchievementMetric, amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) return;
  profile.stats[metric] += amount;
}

/**
 * Evaluate every achievement and unlock the ones that have been reached.
 * Idempotent: an already-unlocked achievement is never granted twice.
 */
export function evaluateAchievements(profile: PlayerProfile, now = Date.now()): AchievementUnlock[] {
  const unlocked: AchievementUnlock[] = [];
  for (const def of ACHIEVEMENTS) {
    if (profile.achievements[def.id]) continue;
    const value = profile.stats[def.metric];
    const reached = def.lowerIsBetter ? value >= 0 && value <= def.threshold : value >= def.threshold;
    if (!reached) continue;

    profile.achievements[def.id] = now;
    profile.coins += def.rewardCoins;
    if (def.rewardCosmeticId) grantContent(profile, [def.rewardCosmeticId]);
    unlocked.push({
      def,
      coins: def.rewardCoins,
      ...(def.rewardCosmeticId ? { cosmeticId: def.rewardCosmeticId } : {}),
    });
  }
  if (unlocked.length > 0) profile.updatedAt = now;
  return unlocked;
}

export function achievementProgress(profile: PlayerProfile): { def: AchievementDef; value: number; done: boolean }[] {
  return ACHIEVEMENTS.map((def) => ({
    def,
    value: profile.stats[def.metric],
    done: Boolean(profile.achievements[def.id]),
  }));
}
