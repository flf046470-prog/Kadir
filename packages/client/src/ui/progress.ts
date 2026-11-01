import type { AchievementMetric } from '@kc/core';

/**
 * How far along a goal is, in words and as a bar — the part of the challenges screen that has a
 * right answer, kept away from the DOM so it can be tested.
 *
 * The stats are stored in the units the simulation measures (seconds, metres), which are the wrong
 * units to read: "21,600 / 36,000" is six hours of Marathon Roo, and "4,120.5 / 5,000" is a
 * distance nobody counts in decimetres.
 */
export interface ProgressLine {
  text: string;
  /** 0..1, for the bar. */
  fraction: number;
}

export function formatMetric(metric: AchievementMetric, value: number): string {
  switch (metric) {
    case 'climbMetres':
      return `${Math.floor(value).toLocaleString('en-US')} m`;
    case 'distanceMetres':
      return value >= 1000 ? `${(Math.floor(value / 100) / 10).toFixed(1)} km` : `${Math.floor(value)} m`;
    case 'playSeconds':
      return `${(Math.floor(value / 360) / 10).toFixed(1)} h`;
    case 'bestLapSeconds':
      return `${value.toFixed(1)} s`;
    default:
      return Math.floor(value).toLocaleString('en-US');
  }
}

/**
 * `lowerIsBetter` goals (a lap time) are reached by getting *under* the threshold, and a stored
 * value of -1 means no lap has been run at all — which must not read as a lap of -1 seconds, the
 * best time anyone could post.
 */
export function progressLine(metric: AchievementMetric, value: number, threshold: number, lowerIsBetter = false, done = false): ProgressLine {
  if (lowerIsBetter) {
    if (value < 0) return { text: `No time yet · under ${formatMetric(metric, threshold)}`, fraction: done ? 1 : 0 };
    const fraction = done || value <= threshold ? 1 : Math.max(0, Math.min(1, threshold / value));
    return { text: `Best ${formatMetric(metric, value)} · under ${formatMetric(metric, threshold)}`, fraction };
  }
  // Done reads as the goal met ("1 / 1"), not the lifetime total over it ("7 / 1").
  const shown = done ? threshold : Math.min(value, threshold);
  const fraction = done ? 1 : Math.max(0, Math.min(1, value / Math.max(1e-9, threshold)));
  return { text: `${formatMetric(metric, shown)} / ${formatMetric(metric, threshold)}`, fraction };
}

const DAY_MS = 24 * 3600 * 1000;

/** "ends in 3 days", "starts tomorrow" — whole days, rounded up, so the last day reads "today". */
export function countdown(iso: string, now: number, verb: 'starts' | 'ends'): string {
  const days = Math.ceil((Date.parse(iso) - now) / DAY_MS);
  if (days <= 0) return `${verb} today`;
  if (days === 1) return `${verb} ${verb === 'ends' ? 'in 1 day' : 'tomorrow'}`;
  return `${verb} in ${days} days`;
}
