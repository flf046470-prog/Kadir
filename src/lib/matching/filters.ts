import { slugifyPlace } from "../domain/places";
import {
  cultures,
  matchIntents,
  relationshipGoals,
  type CultureId,
  type MatchIntentId,
  type RelationshipGoalId
} from "../domain/taxonomies";

/**
 * Discovery filters.
 *
 * Parsing lives here rather than in the route handler for the same reason the
 * AI Matchmaker's criteria parser does: everything a member (or a crafted
 * request) supplies is checked against a closed vocabulary before it reaches a
 * query. An unrecognised value is dropped, never passed through.
 */

export const MIN_AGE = 18;
export const MAX_AGE = 99;
export const MAX_FILTER_VALUES = 10;

export type DiscoveryFilters = {
  minAge: number;
  maxAge: number;
  countryId: string | null;
  cityId: string | null;
  languages: string[];
  relationshipGoals: RelationshipGoalId[];
  matchIntents: MatchIntentId[];
  cultureInterests: CultureId[];
};

export const defaultFilters: DiscoveryFilters = {
  minAge: MIN_AGE,
  maxAge: MAX_AGE,
  countryId: null,
  cityId: null,
  languages: [],
  relationshipGoals: [],
  matchIntents: [],
  cultureInterests: []
};

const VALID_GOALS = new Set<string>(relationshipGoals.map((goal) => goal.id));
const VALID_INTENTS = new Set<string>(matchIntents.map((intent) => intent.id));
const VALID_CULTURES = new Set<string>(cultures);
const LANGUAGE_TAG = /^[a-z]{2}$/;

function cleanList(raw: string | null, allowed: Set<string> | RegExp): string[] {
  if (!raw) return [];
  const test = (value: string) =>
    allowed instanceof RegExp ? allowed.test(value) : allowed.has(value);

  return [
    ...new Set(
      raw
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length > 0 && test(value))
    )
  ].slice(0, MAX_FILTER_VALUES);
}

/**
 * Place ids are slugified rather than pattern-matched, so a member who types
 * "United States" filters on the same id as one who types "united-states".
 * `slugifyPlace` is also what the profile write path uses, which is the only
 * reason the two sides compare equal.
 */
function cleanPlace(raw: string | null): string | null {
  return raw ? slugifyPlace(raw) : null;
}

/**
 * Ages are clamped into the legal range and ordered, so a reversed or
 * out-of-range pair yields a sane window instead of an empty result the member
 * cannot explain.
 */
function cleanAges(rawMin: string | null, rawMax: string | null): { minAge: number; maxAge: number } {
  const parse = (raw: string | null, fallback: number) => {
    // `Number(null)` and `Number("")` are both 0, which would clamp an absent
    // age to 18 and silently narrow a filter nobody set.
    if (raw === null || raw.trim() === "") return fallback;

    const value = Number(raw);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(MAX_AGE, Math.max(MIN_AGE, Math.floor(value)));
  };

  const a = parse(rawMin, MIN_AGE);
  const b = parse(rawMax, MAX_AGE);
  return { minAge: Math.min(a, b), maxAge: Math.max(a, b) };
}

export function parseFilters(params: URLSearchParams): DiscoveryFilters {
  const { minAge, maxAge } = cleanAges(params.get("minAge"), params.get("maxAge"));

  return {
    minAge,
    maxAge,
    countryId: cleanPlace(params.get("countryId")),
    cityId: cleanPlace(params.get("cityId")),
    languages: cleanList(params.get("languages"), LANGUAGE_TAG),
    relationshipGoals: cleanList(params.get("goals"), VALID_GOALS) as RelationshipGoalId[],
    matchIntents: cleanList(params.get("intents"), VALID_INTENTS) as MatchIntentId[],
    cultureInterests: cleanList(params.get("cultures"), VALID_CULTURES) as CultureId[]
  };
}

/** Serialises filters back to a query string, omitting anything at its default. */
export function filtersToParams(filters: DiscoveryFilters): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.minAge !== MIN_AGE) params.set("minAge", String(filters.minAge));
  if (filters.maxAge !== MAX_AGE) params.set("maxAge", String(filters.maxAge));
  if (filters.countryId) params.set("countryId", filters.countryId);
  if (filters.cityId) params.set("cityId", filters.cityId);
  if (filters.languages.length) params.set("languages", filters.languages.join(","));
  if (filters.relationshipGoals.length) params.set("goals", filters.relationshipGoals.join(","));
  if (filters.matchIntents.length) params.set("intents", filters.matchIntents.join(","));
  if (filters.cultureInterests.length) params.set("cultures", filters.cultureInterests.join(","));

  return params;
}

/** True when nothing is narrowed — used to label the UI honestly. */
export function isDefault(filters: DiscoveryFilters): boolean {
  return (
    filters.minAge === MIN_AGE &&
    filters.maxAge === MAX_AGE &&
    filters.countryId === null &&
    filters.cityId === null &&
    filters.languages.length === 0 &&
    filters.relationshipGoals.length === 0 &&
    filters.matchIntents.length === 0 &&
    filters.cultureInterests.length === 0
  );
}
