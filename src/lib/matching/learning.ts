import type { PassReasonId } from "../domain/taxonomies";
import type { SignalWeights } from "./score";
import type { SignalId } from "./signals";

/**
 * Match Learning Loop — nudges signal weights based on the feedback a member
 * volunteers when passing on a suggestion.
 *
 * Two deliberate limits keep this honest:
 *  - Only *explicit* pass reasons are used. We do not infer preferences from
 *    dwell time, scroll behaviour, or anything the member didn't choose to say.
 *  - Adjustments are bounded and decay toward neutral, so the feed can't
 *    collapse into a narrow filter bubble the member can't escape.
 *
 * Nothing here derives or stores a sensitive attribute. Feedback maps to a
 * matching *signal*, never to a demographic.
 */

/** Which signal a member is telling us mattered when they passed. */
const REASON_TO_SIGNAL: Record<PassReasonId, SignalId | null> = {
  not_my_type: null, // deliberately unmapped — too vague to act on safely
  different_goal: "relationship_goal",
  too_far: "location",
  different_interests: "interests",
  language_barrier: "language",
  not_interested: null,
  other: null
};

export const MAX_MULTIPLIER = 1.6;
export const MIN_MULTIPLIER = 0.6;
const STEP = 0.08;

export type FeedbackEvent = { reason: PassReasonId };

/**
 * Folds feedback into weight multipliers. A repeated complaint about one
 * dimension raises that signal's weight, so future suggestions are filtered
 * harder on it — capped, so one dimension can never dominate the score.
 */
export function applyFeedback(
  current: SignalWeights,
  events: readonly FeedbackEvent[]
): SignalWeights {
  const next: SignalWeights = { ...current };

  for (const event of events) {
    const signal = REASON_TO_SIGNAL[event.reason];
    if (!signal) continue;

    const value = next[signal] ?? 1;
    next[signal] = Math.min(MAX_MULTIPLIER, value + STEP);
  }

  return next;
}

/**
 * Pulls every multiplier a step back toward 1. Run periodically so a member's
 * feed keeps widening again when they stop giving a particular kind of
 * feedback — stale preferences shouldn't be permanent.
 */
export function decayTowardNeutral(current: SignalWeights, step = STEP / 2): SignalWeights {
  const next: SignalWeights = {};

  for (const [id, value] of Object.entries(current)) {
    const key = id as SignalId;
    const multiplier = value ?? 1;
    if (multiplier > 1) next[key] = Math.max(1, multiplier - step);
    else if (multiplier < 1) next[key] = Math.min(1, multiplier + step);
    else next[key] = 1;
  }

  return next;
}

/** Clamps externally supplied multipliers into the allowed band. */
export function clampWeights(weights: SignalWeights): SignalWeights {
  const next: SignalWeights = {};
  for (const [id, value] of Object.entries(weights)) {
    next[id as SignalId] = Math.min(MAX_MULTIPLIER, Math.max(MIN_MULTIPLIER, value ?? 1));
  }
  return next;
}
