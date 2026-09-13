import {
  cultures,
  relationshipGoals,
  travelStyles,
  type CultureId,
  type RelationshipGoalId,
  type TravelStyleId
} from "../domain/taxonomies";

/**
 * AI Matchmaker — turns a free-text wish ("someone who wants a long-term
 * relationship, loves travelling and speaks English") into structured criteria.
 *
 * The contract with the model is narrow on purpose: it may only choose from the
 * taxonomies below, and every field it returns is validated here before it can
 * influence matching. An unparseable or out-of-vocabulary value is dropped, not
 * guessed at. That keeps a prompt-injected or hallucinated criterion from ever
 * reaching the matching engine.
 *
 * The model call itself lands with the API layer (roadmap Phase 5); this module
 * defines and enforces the boundary, and is fully testable without a model.
 */

export type MatchCriteria = {
  relationshipGoals: RelationshipGoalId[];
  interests: string[];
  languages: string[];
  cultures: CultureId[];
  travelStyles: TravelStyleId[];
  /** Free-text remainder we could not map — shown to the member, never scored. */
  unmapped: string[];
};

export const emptyCriteria: MatchCriteria = {
  relationshipGoals: [],
  interests: [],
  languages: [],
  cultures: [],
  travelStyles: [],
  unmapped: []
};

/** Caps keep one request from broadening a search until it means nothing. */
const MAX_PER_FIELD = 8;
const MAX_INTEREST_LENGTH = 40;

const validGoalIds = new Set<string>(relationshipGoals.map((goal) => goal.id));
const validCultureIds = new Set<string>(cultures);
const validTravelStyleIds = new Set<string>(travelStyles);

/** ISO 639-1 primary subtags we accept; anything else is dropped. */
const LANGUAGE_TAG = /^[a-z]{2}$/;

export type RawCriteria = {
  relationshipGoals?: unknown;
  interests?: unknown;
  languages?: unknown;
  cultures?: unknown;
  travelStyles?: unknown;
  unmapped?: unknown;
};

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
}

/**
 * Validates a model's proposed criteria against the taxonomies. Everything that
 * survives is known-good; everything else is discarded.
 */
export function parseCriteria(raw: RawCriteria): MatchCriteria {
  const goals = stringList(raw.relationshipGoals)
    .filter((id) => validGoalIds.has(id))
    .slice(0, MAX_PER_FIELD) as RelationshipGoalId[];

  const cultureIds = stringList(raw.cultures)
    .filter((id) => validCultureIds.has(id))
    .slice(0, MAX_PER_FIELD) as CultureId[];

  const styles = stringList(raw.travelStyles)
    .filter((id) => validTravelStyleIds.has(id))
    .slice(0, MAX_PER_FIELD) as TravelStyleId[];

  const languages = stringList(raw.languages)
    .filter((tag) => LANGUAGE_TAG.test(tag))
    .slice(0, MAX_PER_FIELD);

  // Interests are free-form by nature, so they are length-capped and
  // de-duplicated rather than checked against a closed list.
  const interests = [...new Set(stringList(raw.interests))]
    .filter((interest) => interest.length <= MAX_INTEREST_LENGTH)
    .slice(0, MAX_PER_FIELD);

  const unmapped = stringList(raw.unmapped).slice(0, MAX_PER_FIELD);

  return {
    relationshipGoals: [...new Set(goals)],
    interests,
    languages: [...new Set(languages)],
    cultures: [...new Set(cultureIds)],
    travelStyles: [...new Set(styles)],
    unmapped
  };
}

/** True when nothing usable survived validation — the UI should ask again. */
export function isEmpty(criteria: MatchCriteria): boolean {
  return (
    criteria.relationshipGoals.length === 0 &&
    criteria.interests.length === 0 &&
    criteria.languages.length === 0 &&
    criteria.cultures.length === 0 &&
    criteria.travelStyles.length === 0
  );
}
