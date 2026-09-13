import type { DiscoveryModeId } from "../domain/taxonomies";
import type { LocationContext } from "./signals";

/**
 * Distance context for one candidate.
 *
 * We do not store coordinates, so there is no true distance to compute. Until a
 * geocoding service is wired in, "same city" is the only distance fact we
 * actually hold — and the engine is told distance is unknown rather than being
 * handed a fabricated number, which would silently corrupt every LOCAL score.
 *
 * Shared by Discover and Today's 5 so the two cannot drift: a suggestion that
 * scored differently from the same profile in Discover would read as a bug to
 * the member, because it is one.
 */
export function locationContext(
  viewerCityId: string | null,
  candidateCityId: string | null,
  mode: DiscoveryModeId
): LocationContext {
  const maxDistanceKm = mode === "local" ? 50 : mode === "country" ? 500 : 20_000;

  if (viewerCityId && candidateCityId && viewerCityId === candidateCityId) {
    return { approximateDistanceKm: 0, maxDistanceKm };
  }

  return { approximateDistanceKm: null, maxDistanceKm };
}
