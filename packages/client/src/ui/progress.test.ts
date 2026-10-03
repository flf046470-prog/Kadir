import { describe, expect, it } from 'vitest';

import { ACHIEVEMENTS, EVENTS } from '@kc/core';
import { countdown, formatMetric, progressLine } from './progress.js';
import { unlockedLines } from './Shell.js';

describe('progress lines', () => {
  it('reads in the units a player counts in', () => {
    expect(progressLine('playSeconds', 21600, 36000).text).toBe('6.0 h / 10.0 h');
    expect(progressLine('distanceMetres', 4120.5, 5000).text).toBe('4.1 km / 5.0 km');
    expect(progressLine('climbMetres', 12.7, 100).text).toBe('12 m / 100 m');
    expect(progressLine('tags', 3, 25).text).toBe('3 / 25');
  });

  it('fills the bar by the fraction, and no further', () => {
    expect(progressLine('tags', 5, 20).fraction).toBe(0.25);
    expect(progressLine('tags', 50, 20).fraction).toBe(1);
    expect(progressLine('tags', 50, 20).text).toBe('20 / 20');
    // Done shows the goal met — not "7 / 1" for a first tag long passed, nor less if a stat reset.
    expect(progressLine('tags', 7, 1, false, true)).toEqual({ text: '1 / 1', fraction: 1 });
    expect(progressLine('tags', 0, 20, false, true)).toEqual({ text: '20 / 20', fraction: 1 });
    expect(progressLine('climbMetres', 63.4, 1000).text).toBe('63 m / 1,000 m');
  });

  it('never shows "no lap yet" as the best lap anyone could run', () => {
    // -1 is the stored "never finished". Read as a number it is a lap under any threshold.
    const none = progressLine('bestLapSeconds', -1, 90, true);
    expect(none.fraction).toBe(0);
    expect(none.text).toBe('No time yet · under 90.0 s');
    expect(progressLine('bestLapSeconds', 120, 90, true).fraction).toBe(0.75);
    expect(progressLine('bestLapSeconds', 80, 90, true).fraction).toBe(1);
  });

  it('formats an unknown count as a whole number', () => {
    expect(formatMetric('wins', 3.9)).toBe('3');
  });

  it('counts whole days down to today', () => {
    const now = Date.parse('2026-09-28T09:00:00Z');
    expect(countdown('2026-10-24T00:00:00Z', now, 'starts')).toBe('starts in 26 days');
    expect(countdown('2026-09-29T00:00:00Z', now, 'starts')).toBe('starts tomorrow');
    expect(countdown('2026-09-28T23:00:00Z', now, 'ends')).toBe('ends in 1 day');
    expect(countdown('2026-09-28T08:00:00Z', now, 'ends')).toBe('ends today');
  });
});

describe('what a round unlocked', () => {
  it('is named, with what it paid', () => {
    const climber = ACHIEVEMENTS.find((a) => a.id === 'master_climber')!;
    const lines = unlockedLines({ coins: 40, xp: 90, achievements: ['master_climber'], challenges: ['spooky_heights'] });
    expect(lines).toEqual([
      `🏆 Achievement: ${climber.name} · +${climber.rewardCoins} coins`,
      `⭐ Spooky Jungle: ${EVENTS[1]!.challenges[1]!.name} · +500 coins`,
    ]);
  });

  it('shows an id it does not know rather than dropping it, and nothing when nothing unlocked', () => {
    expect(unlockedLines({ coins: 0, xp: 0, achievements: ['from_the_future'] })).toEqual(['🏆 Achievement: from_the_future']);
    expect(unlockedLines({ coins: 10, xp: 10, achievements: [] })).toEqual([]);
    expect(unlockedLines(undefined)).toEqual([]);
  });
});
