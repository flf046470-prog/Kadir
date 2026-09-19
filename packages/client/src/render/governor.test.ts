import { describe, expect, it } from 'vitest';

import type { QualityTier } from '@kc/core';
import {
  DEMOTE_FACTOR,
  MIN_SAMPLES,
  PROMOTION_LOCKOUT_MS,
  SETTLE_MS,
  budgetMs,
  isDemotion,
  nextTier,
} from './governor.js';

/**
 * The adaptive quality governor.
 *
 * The bug these tests exist for is one nobody would see in a screenshot: on a mid-range phone the
 * quality pulsed, up and down, every ten seconds forever. Promotion was judged against the budget
 * of the tier being *left* rather than the one being entered, and because the low tier aims at
 * 30fps and the medium tier at 60, there was a band of frame times that satisfied "fast enough to
 * leave low" and "too slow to stay on medium" at the same time.
 */

const settled = (over: Partial<Parameters<typeof nextTier>[0]> & { tier: QualityTier; p90Ms: number }) => ({
  samples: MIN_SAMPLES,
  sinceChangeMs: SETTLE_MS,
  sinceDemotionMs: Infinity,
  ...over,
});

describe('quality governor', () => {
  it('waits for enough history before deciding anything', () => {
    expect(nextTier(settled({ tier: 'high', p90Ms: 999, samples: MIN_SAMPLES - 1 }))).toBeNull();
  });

  it('lets a new tier settle before judging it', () => {
    expect(nextTier(settled({ tier: 'high', p90Ms: 999, sinceChangeMs: SETTLE_MS - 1 }))).toBeNull();
  });

  it('drops a tier when frames run long', () => {
    expect(nextTier(settled({ tier: 'high', p90Ms: budgetMs('high') * DEMOTE_FACTOR + 1 }))).toBe('medium');
    expect(nextTier(settled({ tier: 'medium', p90Ms: budgetMs('medium') * DEMOTE_FACTOR + 1 }))).toBe('low');
  });

  it('has nothing below low to drop to', () => {
    expect(nextTier(settled({ tier: 'low', p90Ms: 9999 }))).toBeNull();
  });

  it('has nothing above high to climb to', () => {
    expect(nextTier(settled({ tier: 'high', p90Ms: 1 }))).toBeNull();
  });

  it('climbs when there is real headroom', () => {
    expect(nextTier(settled({ tier: 'low', p90Ms: 8 }))).toBe('medium');
    expect(nextTier(settled({ tier: 'medium', p90Ms: 8 }))).toBe('high');
  });

  /**
   * The band. 23ms on low is comfortably under 30fps's budget, so the old rule promoted; medium
   * demotes above 22.5ms, so it dropped straight back. Both of those are still true, which is
   * exactly why the decision cannot be made against the budget being left.
   */
  it('does not climb into a tier the device could not hold', () => {
    const p90Ms = 23;
    expect(p90Ms).toBeLessThan(budgetMs('low') * 0.7); // the old promote rule said yes
    expect(p90Ms).toBeGreaterThan(budgetMs('medium') * DEMOTE_FACTOR); // medium would drop it again
    expect(nextTier(settled({ tier: 'low', p90Ms }))).toBeNull();
  });

  it('sweeps the whole oscillating band, not one point in it', () => {
    for (let p90Ms = 22.6; p90Ms < budgetMs('low') * 0.7; p90Ms += 0.1) {
      expect(nextTier(settled({ tier: 'low', p90Ms })), `${p90Ms.toFixed(1)}ms`).toBeNull();
    }
  });

  it('will not climb straight back into a tier it was just dropped from', () => {
    expect(nextTier(settled({ tier: 'low', p90Ms: 8, sinceDemotionMs: PROMOTION_LOCKOUT_MS - 1 }))).toBeNull();
  });

  it('climbs again once the lockout expires', () => {
    expect(nextTier(settled({ tier: 'low', p90Ms: 8, sinceDemotionMs: PROMOTION_LOCKOUT_MS }))).toBe('medium');
  });

  it('never blocks a demotion on the lockout', () => {
    // A device that keeps getting slower must keep dropping, whatever it did a moment ago.
    expect(nextTier(settled({ tier: 'high', p90Ms: 999, sinceDemotionMs: 0 }))).toBe('medium');
  });

  it('knows which way it moved', () => {
    expect(isDemotion('high', 'medium')).toBe(true);
    expect(isDemotion('low', 'medium')).toBe(false);
    expect(isDemotion('medium', 'medium')).toBe(false);
  });

  it('gives the low tier a 30fps budget and the rest 60', () => {
    expect(budgetMs('low')).toBeCloseTo(1000 / 30);
    expect(budgetMs('medium')).toBeCloseTo(1000 / 60);
    expect(budgetMs('high')).toBeCloseTo(1000 / 60);
  });
});
