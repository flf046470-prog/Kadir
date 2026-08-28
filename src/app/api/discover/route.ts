import { NextResponse, type NextRequest } from "next/server";
import { requireUser, isUnauthorized, apiError } from "@/auth/guard";
import {
  findCandidateIds,
  loadMatchProfile,
  loadMatchProfiles,
  matchedUserIds
} from "@/db/profile-repository";
import { loadProfileCards } from "@/db/profile-cards";
import { loadLearnedWeights } from "@/db/signal-weights";
import { scoreMatch } from "@/lib/matching/score";
import { listVisiblePhotos } from "@/db/photos";
import { buildReasons, describeCompatibility } from "@/lib/matching/reasons";
import { discoveryModes, type DiscoveryModeId } from "@/lib/domain/taxonomies";
import type { LocationContext } from "@/lib/matching/signals";
import { parseFilters } from "@/lib/matching/filters";
import { locationContext } from "@/lib/matching/location-context";
import { boostedUserIds, entitlementsOf, tiersOf } from "@/db/entitlements";
import { entitlementsFor } from "@/lib/billing/tiers";
import { standardFiltersOnly, usesAdvancedFilters } from "@/lib/matching/filters";

/**
 * Discover — the matching engine running against real data.
 *
 * The engine is a pure function, so everything interesting happens at this
 * boundary: loading profiles, deciding what the viewer is allowed to see, and
 * turning scores into a response. The engine itself never touches the database
 * or the request.
 */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/**
 * How much paid visibility is worth, on the engine's 0–1 scale.
 *
 * Chosen to be smaller than the gap between a good match and a mediocre one,
 * so a boost reorders within a band rather than across the whole feed. VIP
 * priority is deliberately a third of a boost: it is a standing perk, and a
 * standing perk the size of a one-off purchase would make the purchase
 * pointless.
 */
const BOOST_RANK_BONUS = 0.12;
const VIP_RANK_BONUS = 0.04;

export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  const params = request.nextUrl.searchParams;
  const mode = params.get("mode") ?? "local";
  if (!discoveryModes.includes(mode as DiscoveryModeId)) {
    return apiError("invalid_mode", 400);
  }

  const limit = Math.min(MAX_LIMIT, Number(params.get("limit")) || DEFAULT_LIMIT);
  // Everything the member supplies is validated against the taxonomies before
  // any of it reaches a query.
  const requested = parseFilters(params);

  // Advanced filters are a PLUS feature. Enforced here rather than in the UI,
  // because a hidden control is not a gate — the query string is public.
  const { entitlements } = await entitlementsOf(auth.user.id);
  const filters = entitlements.advancedFilters ? requested : standardFiltersOnly(requested);
  const filtersDowngraded = !entitlements.advancedFilters && usesAdvancedFilters(requested);

  const viewer = await loadMatchProfile(auth.user.id);
  if (!viewer) return apiError("profile_not_found", 404);

  // LOCAL and COUNTRY restrict the candidate pool in SQL; the wider modes rank
  // on other signals instead, so they read the unrestricted pool.
  const restrictToCountry = mode === "local" || mode === "country";
  const candidateIds = await findCandidateIds(auth.user.id, {
    countryId: restrictToCountry ? viewer.countryId : undefined,
    filters,
    limit: 200
  });

  if (candidateIds.length === 0) {
    return NextResponse.json({ mode, results: [], filtersDowngraded });
  }

  // Smart Match: the viewer's learned multipliers ride along into scoring, so
  // a member who keeps passing for one reason sees that dimension weighted
  // harder — bounded by the engine, never enough to dominate.
  const [candidates, matchedIds, learnedAdjustments, boosted, candidateTiers] = await Promise.all([
    loadMatchProfiles(candidateIds),
    matchedUserIds(auth.user.id),
    loadLearnedWeights(auth.user.id),
    boostedUserIds(candidateIds),
    tiersOf(candidateIds)
  ]);
  const matched = new Set(matchedIds);

  // Only approved photos reach another member; `listVisiblePhotos` enforces it.
  const photosByUser = new Map(
    await Promise.all(
      [...candidates.keys()].map(
        async (id) => [id, await listVisiblePhotos(id, auth.user.id)] as const
      )
    )
  );

  // Display fields load separately from matching fields, and already have this
  // viewer's visibility applied — a hidden field never leaves the server.
  const cards = await loadProfileCards([...candidates.keys()], matched);

  const scored = [...candidates.values()].map((candidate) => {
    const result = scoreMatch({
      viewer,
      candidate,
      mode: mode as DiscoveryModeId,
      location: locationContext(viewer.cityId, candidate.cityId, mode as DiscoveryModeId),
      // Drives whether "matches only" fields are visible to this viewer.
      isMutualMatch: matched.has(candidate.id),
      learnedAdjustments
    });

    return {
      profileId: candidate.id,
      profile: cards.get(candidate.id) ?? null,
      score: result.score,
      compatibility: describeCompatibility(result),
      reasons: buildReasons(result),
      photos: photosByUser.get(candidate.id) ?? [],
      boosted: boosted.has(candidate.id),
      // Read through the entitlements table rather than comparing to "vip", so
      // re-pricing either perk stays the one-line edit that file promises.
      prioritised: entitlementsFor(candidateTiers.get(candidate.id) ?? "free").priorityVisibility,
      vip: entitlementsFor(candidateTiers.get(candidate.id) ?? "free").vipBadge
    };
  });

  /**
   * Paid visibility is a bounded bonus on the ranking, not an override of it.
   *
   * Sorting boosted profiles above everything would put a poor match in front
   * of a good one — selling reach by spending the viewer's patience, which
   * costs far more than the boost is worth. A bonus of this size reliably
   * lifts someone within their band and reliably loses to a much better match,
   * which is what a boost should buy.
   *
   * The bonus moves the *ordering* only. `score` stays the real compatibility,
   * because that number is shown to the viewer and inflating it would make the
   * product lie about how well two people match.
   */
  const ranked = scored
    .map((result) => ({
      ...result,
      rank:
        result.score +
        (result.boosted ? BOOST_RANK_BONUS : 0) +
        (result.prioritised ? VIP_RANK_BONUS : 0)
    }))
    .sort((a, b) => b.rank - a.rank || a.profileId.localeCompare(b.profileId))
    .map(({ rank: _rank, prioritised: _prioritised, ...result }) => result);

  return NextResponse.json({ mode, results: ranked.slice(0, limit), filtersDowngraded });
}
