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
  floorFps: 0,
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

/**
 * The headset's budget, which the governor did not have.
 *
 * `profileFor` set `targetFps = 72` for VR with a comment saying dropped frames are nauseating,
 * and four lines later overwrote it with the player's setting — and nothing read the field
 * anyway. The governor judged a 72Hz display against the flat-screen table, so a Quest had to
 * fall to 44fps before it demoted a tier. These pin the number the headset is actually held to.
 */
describe('the frame-rate floor a display imposes', () => {
  const HZ = 72;

  it('raises every tier to the display rate and lowers none', () => {
    expect(budgetMs('low', HZ)).toBeCloseTo(1000 / HZ);
    expect(budgetMs('medium', HZ)).toBeCloseTo(1000 / HZ);
    // A floor under the tier's own ambition changes nothing: this only ever asks for more.
    expect(budgetMs('medium', 30)).toBeCloseTo(1000 / 60);
  });

  it('gives one frame time two answers, depending on what the display asks for', () => {
    // 50fps: tolerable on a monitor, and in a headset it is one frame in three arriving late.
    const p90Ms = 20;
    expect(nextTier(settled({ tier: 'medium', p90Ms, floorFps: HZ }))).toBe('low');
    expect(nextTier(settled({ tier: 'medium', p90Ms, floorFps: 0 }))).toBeNull();
  });

  it('demotes a headset at 53fps rather than at 44', () => {
    /**
     * The whole size of the fix, stated as the number it moves. `DEMOTE_FACTOR` is shared with
     * the flat-screen path and is not retuned here: 1.35 of a 72Hz budget still tolerates a
     * sustained 60fps in a headset, which is not good, and narrowing it is a decision to make
     * against a real device rather than against an assumption. This part is arithmetic.
     */
    const flat = 1000 / (budgetMs('medium') * DEMOTE_FACTOR);
    const vr = 1000 / (budgetMs('medium', HZ) * DEMOTE_FACTOR);
    expect(flat).toBeCloseTo(44.4, 1);
    expect(vr).toBeCloseTo(53.3, 1);
  });

  it('will not climb into a tier that could not hold the display rate', () => {
    // 11ms clears the flat-screen promotion bar and not the headset's, and a tier that cannot
    // hold 72 is a tier that makes the player ill for the ten seconds before it is dropped again.
    expect(nextTier(settled({ tier: 'low', p90Ms: 11, floorFps: 0 }))).toBe('medium');
    expect(nextTier(settled({ tier: 'low', p90Ms: 11, floorFps: HZ }))).toBeNull();
  });
});
