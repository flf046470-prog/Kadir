import { ACHIEVEMENTS } from '../content/achievements.js';
import type { AchievementDef, AchievementMetric } from '../content/achievements.js';
import type { MatchResult } from '../modes/types.js';
import { grantContent } from './inventory.js';
import type { PlayerProfile } from './profile.js';
import { secretKey } from '../world/level.js';

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
  // Measured by the simulation (`Simulation.results`); a client never reports either.
  addMetric(profile, 'distanceMetres', entry.distanceMetres ?? 0);
  addMetric(profile, 'climbMetres', entry.climbMetres ?? 0);
  // Found by the simulation (`Simulation.findSecrets`). The room usually credited each the tick it
  // happened; this is the round's own record of it, and adding one twice changes nothing.
  for (const id of entry.secrets ?? []) recordSecret(profile, result.levelId, id);
  if (entry.won) stats.wins += 1;
  if (result.modeId === 'boxing') stats.knockouts += entry.tags;
  if (result.modeId === 'infection') stats.infectionSurvivals += entry.escapes;
  if (result.modeId === 'parkour' && entry.bestLapTicks > 0) {
    stats.parkourFinishes += 1;
    const seconds = entry.bestLapTicks / 60;
    if (stats.bestLapSeconds < 0 || seconds < stats.bestLapSeconds) stats.bestLapSeconds = seconds;
  }
  profile.updatedAt = Date.now();
}

/**
 * Keep a golden boomerang on the profile. Returns whether it was new. Only ever called with what
 * the server's simulation reported (`secret` events, or a round result), never a client's claim.
 */
export function recordSecret(profile: PlayerProfile, levelId: string, id: string): boolean {
  const key = secretKey(levelId, id);
  const fresh = !profile.secretsFound.includes(key);
  if (fresh) profile.secretsFound.push(key);
  profile.stats.secretsFound = profile.secretsFound.length;
  return fresh;
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
