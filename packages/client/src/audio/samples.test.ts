import { describe, expect, it } from 'vitest';

import { HARD_LANDING_SPEED, landingFamily, loopFor, measure } from './samples.js';

describe('recorded sound', () => {
  it('gives each surface its own landing and keeps synthesis where no recording fits', () => {
    expect(landingFamily('redEarth', 4)).toBe('dirt');
    expect(landingFamily('foliage', 4)).toBe('leaves');
    expect(landingFamily('ice', 4)).toBe('snow');
    expect(landingFamily('dirt', HARD_LANDING_SPEED + 1)).toBe('hard');
    expect(landingFamily('water', 4)).toBeNull();
  });

  it('plays the map\'s own bed for a zone kind, not the kind\'s', () => {
    // The outback's open flat is declared `jungle`; it must not play rainforest.
    expect(loopFor('outback-station', 'jungle')).toBe('outback');
    expect(loopFor('outback-station', 'canyon')).toBe('gorge');
    expect(loopFor('glacier-world', 'canyon')).toBe('glacier');
    expect(loopFor('jungle-world', 'jungle')).toBe('jungle');
    expect(loopFor('jungle-world', 'cave')).toBe('cave');
    expect(loopFor('jungle-world', null)).toBeNull();
  });

  it('skips the silence in front of a one-shot and levels quiet files up', () => {
    const rate = 1000;
    const ch = new Float32Array(2000);
    for (let i = 400; i < 500; i++) ch[i] = 0.2;
    const { offset, gain } = measure([ch], rate, false);
    expect(offset).toBeGreaterThan(0.39);
    expect(offset).toBeLessThan(0.4);
    expect(gain).toBeCloseTo(4, 5);
  });
});
