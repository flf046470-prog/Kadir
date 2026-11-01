import { VR_DISPLAY_HZ } from '../Platform.js';

/**
 * The refresh rate a headset's display actually runs at, so the frame governor holds *that*.
 *
 * Every headset used to be judged against `VR_DISPLAY_HZ` (72): a Quest's default, and nothing
 * else's. PC headsets run at 80–144 Hz, and a Quest can be set to 90 or 120. On a 90 Hz display
 * the budget is 11.1 ms, not 13.9, so a session holding 72 fps was reprojecting every fifth frame
 * while the governor, satisfied with 72, never dropped a tier.
 *
 * The session says what it runs at (`XRSession.frameRate`, the WebXR frame-rate API) where the
 * browser supports it. Where it does not, the frames themselves are the evidence — but read with
 * care: the *average* frame interval is the game's rate, not the display's, and a game that cannot
 * keep up reads as a slow display, which is exactly the failure this exists to catch. So the rate
 * is taken from the fastest frames (`FrameRateMeter`), and only if they land on a rate headsets
 * actually run at.
 *
 * Never below `VR_DISPLAY_HZ`: that floor is a comfort constraint, not a description of a device.
 * Nothing here asks the headset to change its rate either; going from 72 to 90 on a Quest costs a
 * quarter more GPU time against a budget measured at 72, and that trade is for a real device to
 * decide, not a default to assume.
 */

/** Refresh rates headsets ship with. A measured rate is only believed if it lands on one. */
export const KNOWN_DISPLAY_RATES = [72, 80, 90, 120, 144] as const;

/** The known rate within 4 % of `hz`, or null. */
export function snapToDisplayRate(hz: number): number | null {
  for (const rate of KNOWN_DISPLAY_RATES) {
    if (Math.abs(hz - rate) / rate <= 0.04) return rate;
  }
  return null;
}

/** Frames needed before a measurement is trusted: under a second at any headset rate. */
const MIN_SAMPLES = 60;
const WINDOW = 120;

/** The display's rate as the fastest recent frames show it. */
export class FrameRateMeter {
  private intervals: number[] = [];

  push(intervalMs: number): void {
    // A stall (a hitch, a tab switch, the cap in the frame loop) says nothing about the display.
    if (!(intervalMs > 0) || intervalMs >= 100) return;
    this.intervals.push(intervalMs);
    if (this.intervals.length > WINDOW) this.intervals.shift();
  }

  /** Null until there is enough to go on, or when the fastest frames match no headset. */
  rate(): number | null {
    if (this.intervals.length < MIN_SAMPLES) return null;
    const sorted = [...this.intervals].sort((a, b) => a - b);
    // The tenth percentile: one frame in ten that kept up is enough to see the display's period.
    const fast = sorted[Math.floor(sorted.length * 0.1)] as number;
    return snapToDisplayRate(1000 / fast);
  }

  reset(): void {
    this.intervals.length = 0;
  }
}

/** The rate to hold: what the session reports, else what the frames show, never under 72. */
export function displayRateOf(sessionRate: number | null | undefined, measured: number | null): number {
  const reported = typeof sessionRate === 'number' && Number.isFinite(sessionRate) && sessionRate > 0 ? sessionRate : null;
  return Math.max(VR_DISPLAY_HZ, reported ?? measured ?? VR_DISPLAY_HZ);
}
