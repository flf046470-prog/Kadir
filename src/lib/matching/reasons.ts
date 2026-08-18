import type { SignalId, SignalResult } from "./signals";
import type { MatchScore } from "./score";

/**
 * Match Reason Engine — turns computed signals into the "Why you may match"
 * list.
 *
 * Hard rule: a reason may only be emitted when the underlying signal actually
 * fired with real evidence. Reasons are structured data (an id plus the exact
 * values involved), not prose — the UI renders them through i18n, so no model
 * is ever in a position to invent a fact about a member.
 */

export type MatchReason = {
  /** i18n key suffix: `matchReason.<id>` */
  id: SignalId;
  /** Concrete shared values, rendered into the translated string. */
  values: string[];
  /** Reasons with no listable values still carry a generic translated line. */
  strength: number;
};

/** Signals strong enough to be worth showing, per signal id. */
const REASON_THRESHOLDS: Record<SignalId, number> = {
  relationship_goal: 0.99, // only an exact goal match is worth claiming
  match_intent: 0.5,
  interests: 0.34,
  lifestyle: 0.6,
  communication: 0.6,
  language: 0.7,
  language_exchange: 0.5,
  location: 0.6,
  culture: 0.34,
  ideal_date: 0.34,
  travel: 0.8
};

/** Reasons that read as meaningful only when we can name the shared values. */
const REQUIRES_EVIDENCE: SignalId[] = [
  "interests",
  "culture",
  "language",
  "language_exchange",
  "ideal_date",
  "match_intent",
  "travel"
];

/** Display order — most decision-relevant first. */
const REASON_ORDER: SignalId[] = [
  "relationship_goal",
  "match_intent",
  "interests",
  "language",
  "language_exchange",
  "culture",
  "travel",
  "location",
  "lifestyle",
  "communication",
  "ideal_date"
];

export const MAX_REASONS = 5;

export function buildReasons(score: MatchScore, limit = MAX_REASONS): MatchReason[] {
  const byId = new Map<SignalId, SignalResult>();
  for (const signal of score.signals) byId.set(signal.id, signal);

  const reasons: MatchReason[] = [];

  for (const id of REASON_ORDER) {
    const signal = byId.get(id);
    if (!signal) continue;
    if (signal.strength < REASON_THRESHOLDS[id]) continue;
    if (REQUIRES_EVIDENCE.includes(id) && signal.evidence.length === 0) continue;

    reasons.push({ id, values: signal.evidence, strength: signal.strength });
  }

  return reasons.slice(0, limit);
}

/**
 * How a potential-compatibility figure may be presented. We never show a bare
 * percentage: low-confidence scores show no number at all, and the rest are
 * banded and always labelled "potential".
 */
export type CompatibilityDisplay =
  | { kind: "unavailable" }
  | { kind: "band"; band: "exploring" | "promising" | "strong"; percent: number };

export function describeCompatibility(score: MatchScore): CompatibilityDisplay {
  if (score.lowConfidence) return { kind: "unavailable" };

  const percent = Math.round(score.score * 100);
  const band = percent >= 75 ? "strong" : percent >= 50 ? "promising" : "exploring";
  return { kind: "band", band, percent };
}
