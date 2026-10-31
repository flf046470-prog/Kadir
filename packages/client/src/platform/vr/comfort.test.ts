import { describe, expect, it } from 'vitest';

import { DEFAULT_MOVEMENT } from '@kc/core';

import {
  approach,
  grabThresholdFor,
  fistStrength,
  handScaleFrom,
  hapticFor,
  pinchStrength,
  shapeGrip,
  vignetteIntensity, easeRigHeight, isTeleport, STEP_EASE_LIMIT } from './comfort.js';

const at = (x: number, y = 0, z = 0) => ({ x, y, z });

/**
 * `grabSensitivity` shipped as `sensitivity`, read only as `grip > sensitivity * 0.4` — so turning
 * the number up raised the threshold and made a grab *harder*, the opposite of what "sensitivity"
 * means, and there was no slider anywhere to notice it with. `grabThresholdFor` fixed the direction
 * — and then the threshold turned out to reach no hand, only the Grab bits the assisted climb reads
 * (see `VRInput.grab.test.ts`). It is the squeeze that closes the hand now, through `shapeGrip`.
 */
describe('grabThresholdFor', () => {
  it('is the simulation\'s own grip threshold when sensitivity is untouched', () => {
    expect(grabThresholdFor(1)).toBeCloseTo(DEFAULT_MOVEMENT.gripThreshold, 5);
  });

  it('lowers the threshold as sensitivity rises, not raises it', () => {
    const low = grabThresholdFor(0.5);
    const high = grabThresholdFor(2);
    expect(high).toBeLessThan(low);
  });

  it('moves with every step of the slider, end to end', () => {
    // The slider runs 0.2 to 3 in steps of 0.1. As `0.55 / s`, everything below 0.55 asked for
    // more than a full squeeze and was clamped to one value: a third of the slider moved nothing.
    let previous = Infinity;
    for (let tenths = 2; tenths <= 30; tenths++) {
      const threshold = grabThresholdFor(tenths / 10);
      expect(threshold, `sensitivity ${tenths / 10}`).toBeLessThan(previous - 0.004);
      previous = threshold;
    }
  });

  it('never demands more grip than the input signal can ever report', () => {
    // grip is 0..1; a threshold at or above that would make the lowest setting silently disable
    // grabbing rather than merely stiffen it.
    for (const s of [0.2, 0.5, 1, 2, 3]) {
      expect(grabThresholdFor(s)).toBeLessThan(0.96);
    }
  });

  it('never lets a high sensitivity make an accidental brush of the fingers count as a grab', () => {
    expect(grabThresholdFor(3)).toBeGreaterThan(0.12);
  });

  it('falls back to the default rather than a zero or negative threshold on bad input', () => {
    for (const bad of [0, -2, Number.NaN]) {
      expect(grabThresholdFor(bad)).toBeCloseTo(DEFAULT_MOVEMENT.gripThreshold, 5);
    }
  });
});

describe('shapeGrip', () => {
  const sim = DEFAULT_MOVEMENT.gripThreshold;

  it('reports the player\'s threshold as exactly the simulation\'s', () => {
    for (const threshold of [0.17, 0.3, 0.55, 0.75, 0.89]) {
      expect(shapeGrip(threshold, threshold)).toBeCloseTo(sim, 9);
      expect(shapeGrip(threshold - 0.01, threshold)).toBeLessThan(sim);
      expect(shapeGrip(threshold + 0.01, threshold)).toBeGreaterThan(sim);
    }
  });

  it('is the identity at the default sensitivity', () => {
    for (const raw of [0, 0.2, 0.55, 0.7, 1]) expect(shapeGrip(raw, grabThresholdFor(1))).toBeCloseTo(raw, 9);
  });

  it('keeps an open hand open and a full squeeze full, and never changes their order', () => {
    for (const threshold of [0.17, 0.89]) {
      expect(shapeGrip(0, threshold)).toBe(0);
      expect(shapeGrip(1, threshold)).toBeCloseTo(1, 9);
      let previous = -1;
      for (let raw = 0; raw <= 1.0001; raw += 0.05) {
        const grip = shapeGrip(raw, threshold);
        expect(grip).toBeGreaterThan(previous);
        previous = grip;
      }
    }
  });

  it('treats garbage from a runtime as an open hand', () => {
    expect(shapeGrip(Number.NaN, 0.55)).toBe(0);
    expect(shapeGrip(-1, 0.55)).toBe(0);
    expect(shapeGrip(4, 0.55)).toBeCloseTo(1, 9);
  });
});

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

describe('VR rig height', () => {
  const DT = 1 / 60;

  it('follows a hop exactly: velocity is shown, never eased', () => {
    const state = { y: 0, ready: false };
    let y = 0;
    let vy = 7;
    let worst = 0;
    easeRigHeight(state, y, vy, DT);
    for (let i = 0; i < 40; i++) {
      vy -= 24 * DT;
      y += vy * DT;
      worst = Math.max(worst, Math.abs(easeRigHeight(state, y, vy, DT) - y));
    }
    expect(worst).toBeLessThan(0.001);
  });

  it('eases a step-up over several frames instead of one', () => {
    const state = { y: 0, ready: false };
    easeRigHeight(state, 0, 0, DT);
    const first = easeRigHeight(state, 0.45, 0, DT);
    // The first frame shows a small part of the 45 cm, not all of it.
    expect(first).toBeGreaterThan(0.02);
    expect(first).toBeLessThan(0.08);
    let y = first;
    for (let i = 0; i < 60; i++) y = easeRigHeight(state, 0.45, 0, DT);
    expect(y).toBeCloseTo(0.45, 3);
  });

  it('never trails the body by more than the ease limit', () => {
    const state = { y: 0, ready: false };
    easeRigHeight(state, 0, 0, DT);
    let body = 0;
    for (let i = 0; i < 20; i++) {
      body += 0.45;
      expect(Math.abs(easeRigHeight(state, body, 0, DT) - body)).toBeLessThanOrEqual(STEP_EASE_LIMIT + 1e-9);
    }
  });

  it('takes a teleport at once rather than flying the view across it', () => {
    const state = { y: 0, ready: false };
    easeRigHeight(state, 0, 0, DT);
    expect(easeRigHeight(state, 12, 0, DT)).toBe(12);
  });

  it('tells a teleport from fast movement', () => {
    expect(isTeleport(0, 0, 40, 0, DT)).toBe(true);
    expect(isTeleport(3, 0, 0, 5, DT)).toBe(true);
    // 20 m/s for a frame is a third of a metre, not a teleport.
    expect(isTeleport(0.33, 0, 0, 20, DT)).toBe(false);
    // Nor is a very fast launch that genuinely covered the distance.
    expect(isTeleport(1.2, 0, 0, 60, DT)).toBe(false);
  });
});

describe('a fist', () => {
  const at = (y: number) => ({ x: 0, y, z: 0 });
  const wrist = at(0);
  it('is closed with every finger tip curled to the wrist, and open with them out', () => {
    expect(fistStrength(wrist, [at(0.07), at(0.07), at(0.07), at(0.07)])).toBe(1);
    expect(fistStrength(wrist, [at(0.18), at(0.18), at(0.18), at(0.18)])).toBe(0);
  });
  it('is half closed with two fingers in', () => {
    expect(fistStrength(wrist, [at(0.07), at(0.07), at(0.18), at(0.18)])).toBeCloseTo(0.5);
  });
  it('is judged against the size of the hand', () => {
    // A child's hand at 0.7 of an adult's: its open fingers reach only 0.12 m.
    expect(fistStrength(wrist, [at(0.12), at(0.12), at(0.12), at(0.12)], 0.7)).toBe(0);
  });
});
