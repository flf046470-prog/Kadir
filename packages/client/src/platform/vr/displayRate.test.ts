import { describe, expect, it } from 'vitest';
import { FrameRateMeter, displayRateOf, snapToDisplayRate } from './displayRate.js';
import { VR_DISPLAY_HZ } from '../Platform.js';
import { MIN_SAMPLES, SETTLE_MS, nextTier } from '../../render/governor.js';

function meterOf(intervalsMs: number[]): FrameRateMeter {
  const meter = new FrameRateMeter();
  for (const ms of intervalsMs) meter.push(ms);
  return meter;
}

const repeat = (ms: number, n: number) => Array.from({ length: n }, () => ms);

describe('display rate', () => {
  it('holds the rate the session reports', () => {
    expect(displayRateOf(90, null)).toBe(90);
    expect(displayRateOf(120, null)).toBe(120);
    // ...over whatever the frames suggest: the session knows its display.
    expect(displayRateOf(90, 72)).toBe(90);
  });

  it('never goes under the comfort floor, whatever anything says', () => {
    expect(displayRateOf(60, null)).toBe(VR_DISPLAY_HZ);
    expect(displayRateOf(Number.NaN, null)).toBe(VR_DISPLAY_HZ);
    expect(displayRateOf(undefined, null)).toBe(VR_DISPLAY_HZ);
  });

  it('reads the display from the frames when the session does not say', () => {
    expect(meterOf(repeat(1000 / 90, 120)).rate()).toBe(90);
    expect(meterOf(repeat(1000 / 120, 120)).rate()).toBe(120);
    expect(meterOf(repeat(1000 / 72, 120)).rate()).toBe(72);
  });

  it('reads the display, not the game, when the game misses frames', () => {
    // A 90 Hz display, the game making every other frame: the average says 60, the display 90.
    const missing = Array.from({ length: 120 }, (_, i) => (i % 2 ? 2000 / 90 : 1000 / 90));
    expect(meterOf(missing).rate()).toBe(90);
  });

  it('believes nothing that is not a rate a headset runs at', () => {
    // A game that never keeps up on a 90 Hz display reprojects at 45: no frame shows the display.
    const reprojecting = meterOf(repeat(2000 / 90, 120));
    expect(reprojecting.rate()).toBeNull();
    // ...so it holds the floor rather than treating 45 as the display.
    expect(displayRateOf(undefined, reprojecting.rate())).toBe(VR_DISPLAY_HZ);
    expect(snapToDisplayRate(60)).toBeNull();
    expect(snapToDisplayRate(89)).toBe(90);
  });

  it('waits for enough frames, and ignores stalls', () => {
    expect(meterOf(repeat(1000 / 90, 30)).rate()).toBeNull();
    // A hitch is not a 5 Hz display.
    expect(meterOf([...repeat(1000 / 90, 100), ...repeat(200, 40)]).rate()).toBe(90);
  });

  /**
   * The point of all this. A 90 Hz headset holding 60 fps reprojects every third frame. Judged
   * against the 72 Hz floor that every headset used to get, 16.7 ms passed (the threshold is
   * 13.9 × 1.35 = 18.75); judged against its own 90 Hz it is a tier drop (11.1 × 1.35 = 15.0).
   */
  it('makes the governor drop a tier a 90 Hz headset cannot hold', () => {
    const input = {
      tier: 'medium' as const,
      p90Ms: 1000 / 60,
      samples: MIN_SAMPLES,
      sinceChangeMs: SETTLE_MS,
      sinceDemotionMs: Infinity,
    };
    expect(nextTier({ ...input, floorFps: VR_DISPLAY_HZ })).toBeNull();
    expect(nextTier({ ...input, floorFps: displayRateOf(90, null) })).toBe('low');
  });
});
