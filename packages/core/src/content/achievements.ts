/** Metrics the achievement engine tracks. Extend the union to add a new kind of goal. */
export type AchievementMetric =
  | 'tags'
  | 'wins'
  | 'rounds'
  | 'escapes'
  | 'climbMetres'
  | 'parkourFinishes'
  | 'knockouts'
  | 'playSeconds'
  | 'distanceMetres'
  | 'bestLapSeconds';

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  metric: AchievementMetric;
  /** Reached when the metric is >= threshold, or <= for "lower is better" metrics. */
  threshold: number;
  lowerIsBetter?: boolean;
  rewardCoins: number;
  rewardCosmeticId?: string;
  hidden?: boolean;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_tag', name: 'First Tag', description: 'Tag another player.', metric: 'tags', threshold: 1, rewardCoins: 100 },
  { id: 'tags_100', name: '100 Tags', description: 'Tag 100 players.', metric: 'tags', threshold: 100, rewardCoins: 1200, rewardCosmeticId: 'hands_gloves' },
  { id: 'wins_1', name: 'First Win', description: 'Win a round.', metric: 'wins', threshold: 1, rewardCoins: 150 },
  { id: 'wins_100', name: '100 Wins', description: 'Win 100 rounds.', metric: 'wins', threshold: 100, rewardCoins: 2500, rewardCosmeticId: 'hat_crown' },
  { id: 'master_climber', name: 'Master Climber', description: 'Climb 1,000 metres in total.', metric: 'climbMetres', threshold: 1000, rewardCoins: 800, rewardCosmeticId: 'hands_gloves' },
  { id: 'parkour_master', name: 'Parkour Master', description: 'Finish the parkour route 25 times.', metric: 'parkourFinishes', threshold: 25, rewardCoins: 1500, rewardCosmeticId: 'trail_dust' },
  { id: 'boxing_champion', name: 'Boxing Champion', description: 'Score 50 knockouts.', metric: 'knockouts', threshold: 50, rewardCoins: 1500, rewardCosmeticId: 'hands_boxing' },
  { id: 'escape_artist', name: 'Escape Artist', description: 'Survive 25 rounds without being tagged.', metric: 'escapes', threshold: 25, rewardCoins: 1200 },
  { id: 'survivor', name: 'Survivor', description: 'Be the last survivor in Infection 10 times.', metric: 'escapes', threshold: 10, rewardCoins: 700 },
  { id: 'marathon', name: 'Marathon Roo', description: 'Play for 10 hours.', metric: 'playSeconds', threshold: 36000, rewardCoins: 2000 },
  { id: 'speedrunner', name: 'Speedrunner', description: 'Finish the parkour route in under 90 seconds.', metric: 'bestLapSeconds', threshold: 90, lowerIsBetter: true, rewardCoins: 2000, rewardCosmeticId: 'trail_rainbow' },
];

export function getAchievement(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}
