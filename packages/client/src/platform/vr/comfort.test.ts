import { describe, expect, it } from 'vitest';

import { approach, handScaleFrom, hapticFor, pinchStrength, vignetteIntensity } from './comfort.js';

const at = (x: number, y = 0, z = 0) => ({ x, y, z });

describe('pinch detection', () => {
  it('reads a closed pinch as a full grip', () => {
    expect(pinchStrength(at(0), at(0.015))).toBe(1);
    expect(pinchStrength(at(0), at(0))).toBe(1);
  });

  it('reads an open hand as no grip', () => {
    expect(pinchStrength(at(0), at(0.08))).toBe(0);
  });

  it('ramps between, so a partial grab is possible', () => {
    const mid = pinchStrength(at(0), at(0.0375));
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
  });

  it('measures in 3D, not along one axis', () => {
    expect(pinchStrength({ x: 0, y: 0, z: 0 }, { x: 0.01, y: 0.01, z: 0.01 })).toBe(1);
  });

  it('is scale-invariant: the same gesture reads the same on any hand size', () => {
    // A small hand pinching "half open" spans less absolute distance than a large one doing
    // the same thing, so the thresholds have to move with the hand rather than stay in metres.
    const adult = pinchStrength(at(0), at(0.0375), 1);
    const child = pinchStrength(at(0), at(0.0375 * 0.65), 0.65);
    expect(child).toBeCloseTo(adult, 5);
  });

  it('treats a fixed gap as more open on a smaller hand', () => {
    // 3 cm is a larger share of a child's range than of an adult's.
    expect(pinchStrength(at(0), at(0.03), 0.65)).toBeLessThan(pinchStrength(at(0), at(0.03), 1));
  });

  it('ignores a nonsensical scale rather than making grabbing impossible', () => {
    expect(pinchStrength(at(0), at(0.015), 0)).toBe(1);
    expect(pinchStrength(at(0), at(0.015), -3)).toBe(1);
  });
});

describe('hand scale', () => {
  it('is 1 for a reference adult palm', () => {
    expect(handScaleFrom(at(0), at(0.09))).toBeCloseTo(1, 5);
  });

  it('is smaller for a child-sized palm', () => {
    expect(handScaleFrom(at(0), at(0.06))).toBeCloseTo(0.667, 2);
  });

  it('clamps tracking glitches instead of trusting them', () => {
    expect(handScaleFrom(at(0), at(0.5))).toBe(1.6);
    expect(handScaleFrom(at(0), at(0.02))).toBe(0.6);
    expect(handScaleFrom(at(0), at(0))).toBe(1);
  });
});

describe('comfort vignette', () => {
  const base = { speed: 0, turning: false, airborne: false, strength: 1 };

  it('stays fully open when the player disabled it, whatever they are doing', () => {
    expect(vignetteIntensity({ speed: 20, turning: true, airborne: false, strength: 0 })).toBe(0);
  });

  it('stays open at walking pace', () => {
    expect(vignetteIntensity({ ...base, speed: 2 })).toBe(0);
  });

  it('closes progressively with speed', () => {
    const slow = vignetteIntensity({ ...base, speed: 4 });
    const fast = vignetteIntensity({ ...base, speed: 7 });
    expect(slow).toBeGreaterThan(0);
    expect(fast).toBeGreaterThan(slow);
    expect(vignetteIntensity({ ...base, speed: 30 })).toBe(1);
  });

  it('does not close during a hop, which is expected motion', () => {
    expect(vignetteIntensity({ ...base, speed: 8, airborne: true })).toBe(0);
  });

  it('closes while turning even when standing still', () => {
    expect(vignetteIntensity({ ...base, turning: true })).toBeCloseTo(0.75, 5);
  });

  it('scales by the comfort setting', () => {
    const full = vignetteIntensity({ ...base, speed: 30, strength: 1 });
    const half = vignetteIntensity({ ...base, speed: 30, strength: 0.5 });
    expect(half).toBeCloseTo(full * 0.5, 5);
  });
});

describe('vignette smoothing', () => {
  it('moves toward the target rather than snapping', () => {
    const next = approach(0, 1, 1 / 60);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(1);
  });

  it('converges', () => {
    let v = 0;
    for (let i = 0; i < 240; i += 1) v = approach(v, 1, 1 / 60);
    expect(v).toBeCloseTo(1, 3);
  });

  it('is a no-op on a zero or negative timestep', () => {
    expect(approach(0.4, 1, 0)).toBe(0.4);
    expect(approach(0.4, 1, -1)).toBe(0.4);
  });
});

describe('haptics', () => {
  it('hits hardest on being tagged, the moment that most needs to be felt', () => {
    expect(hapticFor('tagged').intensity).toBe(1);
    expect(hapticFor('tagged').intensity).toBeGreaterThan(hapticFor('land').intensity);
  });

  it('keeps frequent events short, so they do not become a continuous buzz', () => {
    // Landing happens on every hop.
    expect(hapticFor('land').durationMs).toBeLessThanOrEqual(25);
    expect(hapticFor('ui').durationMs).toBeLessThanOrEqual(15);
  });

  it('scales without ever exceeding full strength', () => {
    expect(hapticFor('punch', 0.5).intensity).toBeCloseTo(0.45, 5);
    expect(hapticFor('tagged', 5).intensity).toBe(1);
    expect(hapticFor('punch', -1).intensity).toBe(0);
  });
});
