import type { DiscoveryModeId } from "../domain/taxonomies";
import type { MatchProfile } from "../domain/profile";
import { scoreMatch, type MatchScore } from "./score";
import { buildReasons, describeCompatibility, type MatchReason } from "./reasons";
import type { LocationContext } from "./signals";

/**
 * Today's 5 — at most five strong suggestions per day, chosen for quality
 * rather than volume. This is the product's core promise ("don't swipe
 * forever"), so the selection deliberately returns *fewer* than five when
 * fewer genuinely good candidates exist.
 */

export const TODAYS_FIVE_LIMIT = 5;

/** A suggestion has to clear this bar to be shown at all. */
export const MIN_SCORE_FOR_SUGGESTION = 0.45;

export type Suggestion = {
  profileId: string;
  score: number;
  reasons: MatchReason[];
  compatibility: ReturnType<typeof describeCompatibility>;
};

export type SelectionInput = {
  viewer: MatchProfile;
  candidates: MatchProfile[];
  mode: DiscoveryModeId;
  /** Distance context per candidate id; missing entries mean unknown distance. */
  locations: Record<string, LocationContext>;
  /** Ids already suggested, liked, passed, or blocked — never resurfaced today. */
  excludeIds?: Set<string>;
  limit?: number;
};

export function selectTodaysFive(input: SelectionInput): Suggestion[] {
  const exclude = input.excludeIds ?? new Set<string>();
  const limit = input.limit ?? TODAYS_FIVE_LIMIT;

  const scored: { profileId: string; result: MatchScore }[] = [];

  for (const candidate of input.candidates) {
    if (candidate.id === input.viewer.id) continue;
    if (exclude.has(candidate.id)) continue;

    const result = scoreMatch({
      viewer: input.viewer,
      candidate,
      mode: input.mode,
      location: input.locations[candidate.id] ?? {
        approximateDistanceKm: null,
        maxDistanceKm: 1
      }
    });

    if (result.lowConfidence) continue;
    if (result.score < MIN_SCORE_FOR_SUGGESTION) continue;

    scored.push({ profileId: candidate.id, result });
  }

  scored.sort((a, b) => {
    if (b.result.score !== a.result.score) return b.result.score - a.result.score;
    // Deterministic tiebreak so the same day's list is stable across requests.
    return a.profileId.localeCompare(b.profileId);
  });

  return scored.slice(0, limit).map(({ profileId, result }) => ({
    profileId,
    score: result.score,
    reasons: buildReasons(result),
    compatibility: describeCompatibility(result)
  }));
}
