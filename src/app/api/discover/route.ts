import { NextResponse, type NextRequest } from "next/server";
import { requireUser, isUnauthorized, apiError } from "@/auth/guard";
import {
  findCandidateIds,
  loadMatchProfile,
  loadMatchProfiles,
  matchedUserIds
} from "@/db/profile-repository";
import { loadProfileCards } from "@/db/profile-cards";
import { scoreMatch } from "@/lib/matching/score";
import { listVisiblePhotos } from "@/db/photos";
import { buildReasons, describeCompatibility } from "@/lib/matching/reasons";
import { discoveryModes, type DiscoveryModeId } from "@/lib/domain/taxonomies";
import type { LocationContext } from "@/lib/matching/signals";
import { parseFilters } from "@/lib/matching/filters";
import { locationContext } from "@/lib/matching/location-context";

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
  const filters = parseFilters(params);

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
    return NextResponse.json({ mode, results: [] });
  }

  const [candidates, matchedIds] = await Promise.all([
    loadMatchProfiles(candidateIds),
    matchedUserIds(auth.user.id)
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
      isMutualMatch: matched.has(candidate.id)
    });

    return {
      profileId: candidate.id,
      profile: cards.get(candidate.id) ?? null,
      score: result.score,
      compatibility: describeCompatibility(result),
      reasons: buildReasons(result),
      photos: photosByUser.get(candidate.id) ?? []
    };
  });

  scored.sort((a, b) => b.score - a.score || a.profileId.localeCompare(b.profileId));

  return NextResponse.json({ mode, results: scored.slice(0, limit) });
}
