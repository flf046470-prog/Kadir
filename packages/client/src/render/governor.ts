import type { QualityTier } from '@kc/core';

/**
 * The adaptive quality decision, as arithmetic.
 *
 * Pulled out of `Renderer` because the interesting part has nothing to do with WebGL: it is a
 * question about frame times and thresholds, and a threshold that oscillates is invisible in a
 * screenshot and obvious in a test.
 */

/**
 * Frame-time target per tier **on a flat screen**. The low tier deliberately aims at 30, not 60.
 *
 * Exported because `profileFor` puts the same number in the performance profile: two copies of
 * this table would be two places to change it and one place to forget.
 *
 * A headset overrides it from below — see `floorFps`. Aiming a tier at 30 is a reasonable trade on
 * a phone and is not one in VR at any tier, because anything under the display rate is reprojected
 * and reprojection is what makes people take the headset off.
 */
export const TARGET_FPS: Record<QualityTier, number> = { low: 30, medium: 60, high: 60 };

const ORDER: QualityTier[] = ['low', 'medium', 'high'];

/** Frames of history before any decision. Roughly two seconds at 60fps. */
export const MIN_SAMPLES = 120;
/** Quiet period after any change, so a tier gets a chance to settle before it is judged. */
export const SETTLE_MS = 10_000;
/**
 * How long a demotion suppresses the promotion back.
 *
 * Without it, a device that is fast on the tier it was dropped to will climb straight back to
 * the tier it could not hold, and the player watches the quality pulse.
 */
export const PROMOTION_LOCKOUT_MS = 60_000;

/** Sustained frame time above this multiple of the current tier's budget drops a tier. */
export const DEMOTE_FACTOR = 1.35;
/** Headroom required against the *next* tier's budget before climbing into it. */
export const PROMOTE_FACTOR = 0.7;

export interface GovernorInput {
  tier: QualityTier;
  /** 90th-percentile frame time over the sample window, in milliseconds. */
  p90Ms: number;
  samples: number;
  /** Milliseconds since the last tier change of any kind. */
  sinceChangeMs: number;
  /** Milliseconds since the last *demotion*; `Infinity` when there has not been one. */
  sinceDemotionMs: number;
  /**
   * The frame rate the device and the player between them demand, whatever the tier aims at.
   *
   * `PerformanceProfile.targetFps`: the player's setting, floored by the platform. It raises a
   * tier's target and never lowers it, so the table below stays the floor of the ambition and
   * this is the ceiling of the tolerance.
   *
   * Required rather than defaulted: a caller that forgets it gets the flat-screen budget, and a
   * headset judged against a flat-screen budget is precisely the defect this exists to stop.
   */
  floorFps: number;
}

export function budgetMs(tier: QualityTier, floorFps = 0): number {
  return 1000 / Math.max(TARGET_FPS[tier], floorFps);
}

function neighbour(tier: QualityTier, step: 1 | -1): QualityTier | null {
  return ORDER[ORDER.indexOf(tier) + step] ?? null;
}

/**
 * The tier to move to, or null to stay.
 *
 * Demotion is judged against the tier being left, which is the right question: "is this tier too
 * expensive for this device?" Promotion is judged against the budget of the tier being entered,
 * which is a different question — "would the next tier hold?" — and the original code asked the
 * first one for both.
 *
 * That mismatch was not academic, because the tiers do not share a target. Leaving low meant
 * clearing 70% of a 33ms budget (23.3ms), while staying on medium meant holding under 135% of a
 * 16.7ms one (22.5ms). Every device whose 90th-percentile frame time landed between those two
 * numbers was told to climb and then told to drop, forever, ten seconds apart — and the climb
 * itself raises the render scale, turns shadows on and nearly doubles the draw distance, so the
 * measurement that justified it stopped being true the moment it was acted on.
 *
 * Both budgets are floored by `input.floorFps`, which is what makes this usable in a headset. A
 * Quest runs its display at 72Hz and every tier has to hold it; judged against the flat-screen
 * table a headset had to fall to 44fps before anything happened, and 44fps in VR is not "slightly
 * worse", it is the state players describe as making them ill.
 */
export function nextTier(input: GovernorInput): QualityTier | null {
  if (input.samples < MIN_SAMPLES) return null;
  if (input.sinceChangeMs < SETTLE_MS) return null;

  if (input.p90Ms > budgetMs(input.tier, input.floorFps) * DEMOTE_FACTOR) return neighbour(input.tier, -1);

  const up = neighbour(input.tier, 1);
  if (!up) return null;
  if (input.sinceDemotionMs < PROMOTION_LOCKOUT_MS) return null;
  return input.p90Ms < budgetMs(up, input.floorFps) * PROMOTE_FACTOR ? up : null;
}

/** True when `to` is a step down from `from`. Used to start the promotion lockout. */
export function isDemotion(from: QualityTier, to: QualityTier): boolean {
  return ORDER.indexOf(to) < ORDER.indexOf(from);
}
