import { describe, expect, it } from 'vitest';

import { RUN_FULL, WALK_FULL, WALK_START, locomotionBlend, strideRate } from './Avatar.js';

/**
 * The gait blend.
 *
 * `clipFor` switches from walk to run at 4.2 m/s, so a player accelerating past that number
 * changed stride length between one frame and the next. The crossfade hid the seam and not the
 * jump in rate, which is the thing you actually see.
 */
describe('blending a gait by speed', () => {
  it('stands still when standing still', () => {
    expect(locomotionBlend(0)).toEqual({ idle: 1, walk: 0, run: 0 });
  });

  it('always sums to exactly one', () => {
    // Weights are handed straight to the mixer. Anything under one is a body that fades out
    // mid-stride; anything over is two poses added together.
    for (let v = 0; v <= 14; v += 0.05) {
      const { idle, walk, run } = locomotionBlend(v);
      expect(idle + walk + run, `at ${v.toFixed(2)} m/s`).toBeCloseTo(1, 10);
    }
  });

  it('never jumps between one speed and the next', () => {
    /**
     * The whole point. Sampled at 1 cm/s — far finer than a frame of acceleration — and no weight
     * may move more than a hair, which is exactly the assertion the old threshold fails: at 4.2 it
     * moved walk from 1 to 0 and run from 0 to 1 in one step.
     */
    let previous = locomotionBlend(0);
    for (let v = 0.01; v <= 14; v += 0.01) {
      const next = locomotionBlend(v);
      for (const key of ['idle', 'walk', 'run'] as const) {
        expect(Math.abs(next[key] - previous[key]), `${key} at ${v.toFixed(2)} m/s`).toBeLessThan(0.01);
      }
      previous = next;
    }
  });

  it('gets to each gait in the right order', () => {
    expect(locomotionBlend(WALK_START).walk).toBe(0);
    expect(locomotionBlend(WALK_FULL)).toEqual({ idle: 0, walk: 1, run: 0 });
    expect(locomotionBlend(RUN_FULL)).toEqual({ idle: 0, walk: 0, run: 1 });
    // A walking speed must not contain any run at all: a trace of run in a walk is a stride that
    // is too long for how fast the body is actually travelling, which reads as skating.
    expect(locomotionBlend((WALK_START + WALK_FULL) / 2).run).toBe(0);
  });

  it('never runs backwards through the gaits', () => {
    // Monotonic: more speed is never less run and never more idle.
    let lastRun = -1;
    let lastIdle = 2;
    for (let v = 0; v <= 14; v += 0.05) {
      const { idle, run } = locomotionBlend(v);
      expect(run).toBeGreaterThanOrEqual(lastRun - 1e-9);
      expect(idle).toBeLessThanOrEqual(lastIdle + 1e-9);
      lastRun = run;
      lastIdle = idle;
    }
  });

  it('holds the top gait however fast the player is going', () => {
    // Jump pads and a downhill sprint both put the speed well past the run anchor.
    expect(locomotionBlend(40)).toEqual({ idle: 0, walk: 0, run: 1 });
  });

  it('survives a speed that is not a number', () => {
    // `speed` is derived from a snapshot's velocity, which arrives over the wire.
    expect(locomotionBlend(Number.NaN)).toEqual({ idle: 1, walk: 0, run: 0 });
    expect(locomotionBlend(-5)).toEqual({ idle: 1, walk: 0, run: 0 });
  });
});

describe('stride rate', () => {
  it('speeds the cycle up with the body', () => {
    expect(strideRate(6)).toBeGreaterThan(strideRate(3));
  });

  it('never stops and never blurs', () => {
    /**
     * Both clamps are load-bearing. Without the floor, a player creeping at 0.05 m/s plays one
     * stride every hundred seconds and reads as frozen; without the ceiling, anything launched by
     * a jump pad flickers.
     */
    for (const v of [0, 0.01, 1e-9, 500, Number.NaN, -3]) {
      expect(strideRate(v), `at ${v}`).toBeGreaterThanOrEqual(0.55);
      expect(strideRate(v), `at ${v}`).toBeLessThanOrEqual(1.8);
    }
  });

  it('runs both gaits off one number', () => {
    // The walk and the run are authored at different lengths, so the only thing that keeps their
    // feet together is being driven from a single rate rather than from their own.
    expect(strideRate(5)).toBe(strideRate(5));
  });
});
