import type { DiscoveryModeId } from "../domain/taxonomies";
import { applyVisibility, type MatchProfile } from "../domain/profile";
import {
  communicationSignal,
  cultureSignal,
  futureLocationSignal,
  goalSignal,
  idealDateSignal,
  intentSignal,
  interestSignal,
  languageExchangeSignal,
  languageSignal,
  lifestyleSignal,
  locationSignal,
  travelSignal,
  type LocationContext,
  type SignalId,
  type SignalResult
} from "./signals";

/**
 * Smart Match Score — a weighted blend of the individual signals.
 *
 * Weights vary by discovery mode so each mode surfaces what it promises: LOCAL
 * leans on distance, CULTURE on shared cultural interest, LANGUAGE on exchange
 * complementarity, and so on. Weights are data, not code branches, so the admin
 * panel can tune them without a deploy.
 */

export type SignalWeights = Partial<Record<SignalId, number>>;

const baseWeights: SignalWeights = {
  relationship_goal: 3,
  match_intent: 2,
  interests: 2,
  lifestyle: 1.5,
  communication: 1.5,
  language: 1.5,
  location: 2,
  culture: 1,
  ideal_date: 1,
  travel: 0.5,
  language_exchange: 0.5
};

export const modeWeights: Record<DiscoveryModeId, SignalWeights> = {
  local: { ...baseWeights, location: 4 },
  country: { ...baseWeights, location: 2.5 },
  global: { ...baseWeights, location: 0.25, language: 2.5, culture: 1.5 },
  culture: { ...baseWeights, culture: 4, location: 0.5 },
  language: { ...baseWeights, language_exchange: 4, language: 2, location: 0.5 },
  travel: { ...baseWeights, travel: 4, location: 0.5 }
};

export type ScoreInput = {
  viewer: MatchProfile;
  candidate: MatchProfile;
  mode: DiscoveryModeId;
  location: LocationContext;
  isMutualMatch?: boolean;
  /** Signal weight multipliers learned from the viewer's pass feedback. */
  learnedAdjustments?: SignalWeights;
};

export type MatchScore = {
  /** 0–1. Presented to members only as "potential compatibility", never as a fact. */
  score: number;
  signals: SignalResult[];
  /** Signals that had too little data to judge. Surfaced as unknown, not zero. */
  unknownSignals: SignalId[];
  /** True when too few signals had data for the score to mean anything. */
  lowConfidence: boolean;
};

const ALL_SIGNAL_IDS: SignalId[] = [
  "relationship_goal",
  "match_intent",
  "interests",
  "lifestyle",
  "communication",
  "language",
  "language_exchange",
  "location",
  "culture",
  "ideal_date",
  "travel"
];

/** Below this many usable signals, we don't claim a meaningful score. */
export const MIN_SIGNALS_FOR_CONFIDENCE = 3;

export function scoreMatch(input: ScoreInput): MatchScore {
  const isMutualMatch = input.isMutualMatch ?? false;

  // Enforce the candidate's privacy settings before anything reads their fields.
  const candidate = applyVisibility(input.candidate, isMutualMatch);
  const viewer = input.viewer;

  const computed: (SignalResult | null)[] = [
    goalSignal(viewer, candidate),
    intentSignal(viewer, candidate),
    interestSignal(viewer, candidate),
    lifestyleSignal(viewer, candidate),
    communicationSignal(viewer, candidate),
    languageSignal(viewer, candidate),
    languageExchangeSignal(viewer, candidate),
    bestLocationSignal(viewer, candidate, input.location),
    cultureSignal(viewer, candidate),
    idealDateSignal(viewer, candidate),
    travelSignal(viewer, candidate)
  ];

  const signals = computed.filter((signal): signal is SignalResult => signal !== null);
  const presentIds = new Set(signals.map((signal) => signal.id));
  const unknownSignals = ALL_SIGNAL_IDS.filter((id) => !presentIds.has(id));

  const weights = { ...modeWeights[input.mode] };
  for (const [id, multiplier] of Object.entries(input.learnedAdjustments ?? {})) {
    const key = id as SignalId;
    weights[key] = (weights[key] ?? 0) * (multiplier ?? 1);
  }

  let weightedSum = 0;
  let totalWeight = 0;
  for (const signal of signals) {
    const weight = weights[signal.id] ?? 0;
    if (weight === 0) continue;
    weightedSum += signal.strength * weight;
    totalWeight += weight;
  }

  return {
    // Normalising by the weight of *present* signals only means a sparse profile
    // isn't punished for fields it hasn't filled in — it just scores less certainly.
    score: totalWeight === 0 ? 0 : weightedSum / totalWeight,
    signals,
    unknownSignals,
    lowConfidence: signals.length < MIN_SIGNALS_FOR_CONFIDENCE
  };
}

/**
 * Location and Future Location share the `location` signal id. Take whichever
 * is stronger so a planned move can outweigh present-day distance.
 */
function bestLocationSignal(
  viewer: MatchProfile,
  candidate: MatchProfile,
  context: LocationContext
): SignalResult | null {
  const now = locationSignal(viewer, candidate, context);
  const future = futureLocationSignal(viewer, candidate);
  if (!now) return future;
  if (!future) return now;
  return future.strength > now.strength ? future : now;
}
