import { areGoalsCompatible } from "../domain/taxonomies";
import { compareQuizAnswers } from "../domain/quiz";
import type { MatchProfile, TravelPlan } from "../domain/profile";

/**
 * Individual matching signals. Each returns a 0–1 strength plus the concrete
 * evidence behind it, so the Match Reason Engine can explain a suggestion using
 * only facts the system actually holds — never a generated claim.
 *
 * A signal returns `null` when there is not enough data to judge. Unknown is
 * never treated as agreement.
 */

export type SignalId =
  | "relationship_goal"
  | "match_intent"
  | "interests"
  | "lifestyle"
  | "communication"
  | "language"
  | "language_exchange"
  | "location"
  | "travel"
  | "culture"
  | "ideal_date";

export type SignalResult = {
  id: SignalId;
  /** 0–1. Higher is a stronger match on this dimension. */
  strength: number;
  /** Concrete shared values behind the score, for explanations. */
  evidence: string[];
};

function overlap<T>(a: readonly T[], b: readonly T[]): T[] {
  const inB = new Set(b);
  return a.filter((item) => inB.has(item));
}

/** Jaccard-style overlap ratio, guarding against empty inputs. */
function overlapRatio<T>(a: readonly T[], b: readonly T[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const shared = overlap(a, b).length;
  return shared / Math.min(a.length, b.length);
}

export function goalSignal(viewer: MatchProfile, candidate: MatchProfile): SignalResult | null {
  if (!viewer.relationshipGoal || !candidate.relationshipGoal) return null;

  const same = viewer.relationshipGoal === candidate.relationshipGoal;
  const compatible = areGoalsCompatible(viewer.relationshipGoal, candidate.relationshipGoal);

  return {
    id: "relationship_goal",
    strength: same ? 1 : compatible ? 0.6 : 0,
    evidence: same ? [viewer.relationshipGoal] : []
  };
}

export function intentSignal(viewer: MatchProfile, candidate: MatchProfile): SignalResult | null {
  if (viewer.matchIntents.length === 0 || candidate.matchIntents.length === 0) return null;

  const shared = overlap(viewer.matchIntents, candidate.matchIntents);
  return {
    id: "match_intent",
    strength: overlapRatio(viewer.matchIntents, candidate.matchIntents),
    evidence: shared
  };
}

export function interestSignal(viewer: MatchProfile, candidate: MatchProfile): SignalResult | null {
  if (viewer.interests.length === 0 || candidate.interests.length === 0) return null;

  const shared = overlap(viewer.interests, candidate.interests);
  return {
    id: "interests",
    strength: overlapRatio(viewer.interests, candidate.interests),
    evidence: shared
  };
}

export function idealDateSignal(
  viewer: MatchProfile,
  candidate: MatchProfile
): SignalResult | null {
  if (viewer.idealDates.length === 0 || candidate.idealDates.length === 0) return null;

  const shared = overlap(viewer.idealDates, candidate.idealDates);
  return {
    id: "ideal_date",
    strength: overlapRatio(viewer.idealDates, candidate.idealDates),
    evidence: shared
  };
}

export function communicationSignal(
  viewer: MatchProfile,
  candidate: MatchProfile
): SignalResult | null {
  const quiz = compareQuizAnswers(viewer.quizAnswers, candidate.quizAnswers);
  const styleShared = overlap(viewer.communicationStyles, candidate.communicationStyles);

  const hasQuiz = quiz.answeredCounts.communication > 0;
  const hasStyles = viewer.communicationStyles.length > 0 && candidate.communicationStyles.length > 0;
  if (!hasQuiz && !hasStyles) return null;

  // Average whichever sources exist, rather than assuming zero for the missing one.
  const parts: number[] = [];
  if (hasQuiz) parts.push(quiz.scores.communication);
  if (hasStyles) parts.push(overlapRatio(viewer.communicationStyles, candidate.communicationStyles));

  return {
    id: "communication",
    strength: parts.reduce((sum, value) => sum + value, 0) / parts.length,
    evidence: styleShared
  };
}

export function lifestyleSignal(viewer: MatchProfile, candidate: MatchProfile): SignalResult | null {
  const quiz = compareQuizAnswers(viewer.quizAnswers, candidate.quizAnswers);
  if (quiz.answeredCounts.lifestyle === 0) return null;

  return {
    id: "lifestyle",
    strength: quiz.scores.lifestyle,
    evidence: []
  };
}

export function languageSignal(viewer: MatchProfile, candidate: MatchProfile): SignalResult | null {
  if (viewer.languagesSpoken.length === 0 || candidate.languagesSpoken.length === 0) return null;

  const shared = overlap(viewer.languagesSpoken, candidate.languagesSpoken);
  return {
    id: "language",
    // Sharing any language at all is the thing that matters; more is mild bonus.
    strength: shared.length === 0 ? 0 : Math.min(1, 0.7 + 0.15 * shared.length),
    evidence: shared
  };
}

/**
 * Language Exchange is a *complementary* match, not an overlap one: the viewer
 * speaks what the candidate wants to learn, or vice versa. Scores highest when
 * the exchange runs both ways.
 */
export function languageExchangeSignal(
  viewer: MatchProfile,
  candidate: MatchProfile
): SignalResult | null {
  const viewerWantsExchange =
    viewer.connectionMode === "language_exchange" || viewer.connectionMode === "both";
  const candidateWantsExchange =
    candidate.connectionMode === "language_exchange" || candidate.connectionMode === "both";
  if (!viewerWantsExchange || !candidateWantsExchange) return null;

  const viewerCanTeach = overlap(viewer.languagesSpoken, candidate.languagesLearning);
  const candidateCanTeach = overlap(candidate.languagesSpoken, viewer.languagesLearning);

  if (viewerCanTeach.length === 0 && candidateCanTeach.length === 0) {
    return { id: "language_exchange", strength: 0, evidence: [] };
  }

  const mutual = viewerCanTeach.length > 0 && candidateCanTeach.length > 0;
  return {
    id: "language_exchange",
    strength: mutual ? 1 : 0.5,
    evidence: [...new Set([...viewerCanTeach, ...candidateCanTeach])]
  };
}

export function cultureSignal(viewer: MatchProfile, candidate: MatchProfile): SignalResult | null {
  const bothOpen = viewer.openToOtherCultures && candidate.openToOtherCultures;
  const shared = overlap(viewer.cultureInterests, candidate.cultureInterests);

  if (viewer.cultureInterests.length === 0 && !bothOpen) return null;

  let strength = overlapRatio(viewer.cultureInterests, candidate.cultureInterests);
  // Mutual openness to other cultures is itself a mild positive signal.
  if (bothOpen) strength = Math.max(strength, 0.4);

  return { id: "culture", strength, evidence: shared };
}

export type LocationContext = {
  /** Pre-rounded distance in km, or null when either side hides location. */
  approximateDistanceKm: number | null;
  /** Widest reach the viewer opted into, used to scale the distance penalty. */
  maxDistanceKm: number;
};

export function locationSignal(
  viewer: MatchProfile,
  candidate: MatchProfile,
  context: LocationContext
): SignalResult | null {
  const sameCountry = viewer.countryId === candidate.countryId;
  const sameCity =
    viewer.cityId !== null && candidate.cityId !== null && viewer.cityId === candidate.cityId;

  if (context.approximateDistanceKm === null) {
    // No usable distance — fall back to the coarse signals we do have.
    if (!sameCountry) return null;
    return { id: "location", strength: sameCity ? 1 : 0.5, evidence: [candidate.countryId] };
  }

  const ratio = Math.min(1, context.approximateDistanceKm / Math.max(1, context.maxDistanceKm));
  return {
    id: "location",
    strength: 1 - ratio,
    evidence: sameCity && candidate.cityId ? [candidate.cityId] : sameCountry ? [candidate.countryId] : []
  };
}

function plansOverlap(a: TravelPlan, b: TravelPlan): boolean {
  return (
    a.destinationCityId === b.destinationCityId &&
    a.startDate <= b.endDate &&
    b.startDate <= a.endDate
  );
}

/**
 * Travel Match: either both members plan to be in the same place at the same
 * time, or one is travelling to where the other lives.
 */
export function travelSignal(viewer: MatchProfile, candidate: MatchProfile): SignalResult | null {
  if (viewer.travelPlans.length === 0 && candidate.travelPlans.length === 0) return null;

  const evidence: string[] = [];
  let strength = 0;

  for (const viewerPlan of viewer.travelPlans) {
    for (const candidatePlan of candidate.travelPlans) {
      if (plansOverlap(viewerPlan, candidatePlan)) {
        strength = 1;
        evidence.push(viewerPlan.destinationCityId);
      }
    }
    if (candidate.cityId && viewerPlan.destinationCityId === candidate.cityId) {
      strength = Math.max(strength, 0.8);
      evidence.push(viewerPlan.destinationCityId);
    }
  }

  for (const candidatePlan of candidate.travelPlans) {
    if (viewer.cityId && candidatePlan.destinationCityId === viewer.cityId) {
      strength = Math.max(strength, 0.8);
      evidence.push(candidatePlan.destinationCityId);
    }
  }

  return { id: "travel", strength, evidence: [...new Set(evidence)] };
}

/**
 * Future Location: one member plans to move where the other already is, or both
 * are heading to the same city.
 */
export function futureLocationSignal(
  viewer: MatchProfile,
  candidate: MatchProfile
): SignalResult | null {
  const viewerFuture = viewer.futureLocation;
  const candidateFuture = candidate.futureLocation;
  if (!viewerFuture && !candidateFuture) return null;

  const evidence: string[] = [];
  let strength = 0;

  if (viewerFuture && candidate.cityId === viewerFuture.cityId) {
    strength = 1;
    evidence.push(viewerFuture.cityId);
  }
  if (candidateFuture && viewer.cityId === candidateFuture.cityId) {
    strength = Math.max(strength, 1);
    evidence.push(candidateFuture.cityId);
  }
  if (viewerFuture && candidateFuture && viewerFuture.cityId === candidateFuture.cityId) {
    strength = Math.max(strength, 0.9);
    evidence.push(viewerFuture.cityId);
  }

  // Reuse the location signal id so explanations stay in one vocabulary.
  return { id: "location", strength, evidence: [...new Set(evidence)] };
}
