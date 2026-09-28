/** Metrics the achievement engine tracks. Extend the union to add a new kind of goal. */
export type AchievementMetric =
  | 'tags'
  | 'wins'
  | 'rounds'
  | 'escapes'
  /** Rounds of Infection ended uninfected — the last survivors. A subset of `escapes`. */
  | 'infectionSurvivals'
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
  { id: 'tags_100', name: '100 Tags', description: 'Tag 100 players.', metric: 'tags', threshold: 100, rewardCoins: 1200 },
  { id: 'wins_1', name: 'First Win', description: 'Win a round.', metric: 'wins', threshold: 1, rewardCoins: 150 },
  { id: 'wins_100', name: '100 Wins', description: 'Win 100 rounds.', metric: 'wins', threshold: 100, rewardCoins: 2500 },
  { id: 'master_climber', name: 'Master Climber', description: 'Climb 1,000 metres in total.', metric: 'climbMetres', threshold: 1000, rewardCoins: 800 },
  { id: 'parkour_master', name: 'Parkour Master', description: 'Finish the parkour route 25 times.', metric: 'parkourFinishes', threshold: 25, rewardCoins: 1500 },
  { id: 'boxing_champion', name: 'Boxing Champion', description: 'Score 50 knockouts.', metric: 'knockouts', threshold: 50, rewardCoins: 1500 },
  { id: 'escape_artist', name: 'Escape Artist', description: 'Survive 25 rounds without being tagged.', metric: 'escapes', threshold: 25, rewardCoins: 1200 },
  // Counted `escapes` until the challenges screen showed its bar: an escape in *any* mode moved a
  // goal that names Infection, so its description and its progress disagreed on screen.
  { id: 'survivor', name: 'Survivor', description: 'Be the last survivor in Infection 10 times.', metric: 'infectionSurvivals', threshold: 10, rewardCoins: 700 },
  { id: 'marathon', name: 'Marathon Roo', description: 'Play for 10 hours.', metric: 'playSeconds', threshold: 36000, rewardCoins: 2000 },
  { id: 'speedrunner', name: 'Speedrunner', description: 'Finish the parkour route in under 90 seconds.', metric: 'bestLapSeconds', threshold: 90, lowerIsBetter: true, rewardCoins: 2000 },
];

/*
 * No achievement names a cosmetic. Six used to — Grip Gloves (twice), Jungle Crown, Dust Trail,
 * Boxing Gloves and Rainbow Trail — and every one is a launch item every account owns from
 * creation, so the reward was the coins alone and the cosmetic part granted nothing. An achievement
 * that should pay out a look needs a look of its own that nobody starts with; `season-pass.test.ts`
 * refuses a reward that names one they already have.
 */

export function getAchievement(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}
