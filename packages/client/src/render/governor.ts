import type { QualityTier } from '@kc/core';

/**
 * The adaptive quality decision, as arithmetic.
 *
 * Pulled out of `Renderer` because the interesting part has nothing to do with WebGL: it is a
 * question about frame times and thresholds, and a threshold that oscillates is invisible in a
 * screenshot and obvious in a test.
 */

/**
 * Frame-time target per tier. The low tier deliberately aims at 30, not 60.
 *
 * Exported because `profileFor` puts the same number in the performance profile: two copies of
 * this table would be two places to change it and one place to forget.
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
}

export function budgetMs(tier: QualityTier): number {
  return 1000 / TARGET_FPS[tier];
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
 */
export function nextTier(input: GovernorInput): QualityTier | null {
  if (input.samples < MIN_SAMPLES) return null;
  if (input.sinceChangeMs < SETTLE_MS) return null;

  if (input.p90Ms > budgetMs(input.tier) * DEMOTE_FACTOR) return neighbour(input.tier, -1);

  const up = neighbour(input.tier, 1);
  if (!up) return null;
  if (input.sinceDemotionMs < PROMOTION_LOCKOUT_MS) return null;
  return input.p90Ms < budgetMs(up) * PROMOTE_FACTOR ? up : null;
}

/** True when `to` is a step down from `from`. Used to start the promotion lockout. */
export function isDemotion(from: QualityTier, to: QualityTier): boolean {
  return ORDER.indexOf(to) < ORDER.indexOf(from);
}
