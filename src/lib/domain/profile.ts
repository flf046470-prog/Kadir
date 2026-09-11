import type {
  CommunicationStyleId,
  ConnectionModeId,
  CultureId,
  FuturePlanId,
  IdealDateId,
  MatchIntentId,
  RelationshipGoalId,
  TravelStyleId,
  VerificationId
} from "./taxonomies";

/**
 * The matching-relevant shape of a member. This is deliberately a *view* over
 * whatever the database eventually stores: the matching engine only ever sees
 * these fields, which keeps sensitive attributes out of scoring by construction.
 *
 * Fields the engine must never receive: exact coordinates, ethnicity, religion,
 * health, sexual orientation beyond the member's own stated preference filter,
 * political views, income. See `docs/AI_SAFETY.md`.
 */
export type MatchProfile = {
  id: string;

  /** Coarse location only — city/country ids, never a precise address. */
  cityId: string | null;
  countryId: string;
  /** Approximate distance is supplied by the caller, already rounded. */

  relationshipGoal: RelationshipGoalId;
  matchIntents: MatchIntentId[];
  connectionMode: ConnectionModeId;

  interests: string[];
  idealDates: IdealDateId[];
  communicationStyles: CommunicationStyleId[];

  /** Languages the member speaks, as BCP-47-ish primary subtags ("tr", "en"). */
  languagesSpoken: string[];
  /** Languages the member wants to learn — powers Language Exchange. */
  languagesLearning: string[];

  cultureInterests: CultureId[];
  openToOtherCultures: boolean;

  travelPlans: TravelPlan[];
  futureLocation: FutureLocation | null;
  futurePlans: FuturePlanId[];

  /** Answers to the compatibility quiz, keyed by question id. */
  quizAnswers: Record<string, string>;

  verifications: VerificationId[];

  /** Per-field visibility, set by the member. Enforced before scoring. */
  visibility: ProfileVisibility;
};

export type TravelPlan = {
  destinationCityId: string;
  destinationCountryId: string;
  /** ISO dates (YYYY-MM-DD). */
  startDate: string;
  endDate: string;
  travelStyles: TravelStyleId[];
};

export type FutureLocation = {
  cityId: string;
  countryId: string;
  /** Rounded to a month; we never ask for or store an exact move date. */
  approximateMonth: string;
};

/**
 * Who may see each optional field. `matches` means only mutual matches.
 * Defaults are the most private option that still lets a feature work.
 */
export type ProfileVisibility = {
  location: "everyone" | "matches" | "hidden";
  travelPlans: "everyone" | "matches" | "hidden";
  futureLocation: "everyone" | "matches" | "hidden";
  languages: "everyone" | "matches" | "hidden";
  cultureInterests: "everyone" | "matches" | "hidden";
  relationshipGoal: "everyone" | "matches" | "hidden";
};

export const defaultVisibility: ProfileVisibility = {
  location: "everyone",
  travelPlans: "matches",
  futureLocation: "matches",
  languages: "everyone",
  cultureInterests: "everyone",
  relationshipGoal: "everyone"
};

/**
 * Whether `viewer` may see `field` on `subject`.
 *
 * Takes anything carrying visibility settings, not a full `MatchProfile`: the
 * display loader answers the same question about the same settings, and one
 * implementation is the only way the two stay consistent.
 */
export function canSee(
  subject: { visibility: ProfileVisibility },
  field: keyof ProfileVisibility,
  isMutualMatch: boolean
): boolean {
  const setting = subject.visibility[field];
  if (setting === "hidden") return false;
  if (setting === "matches") return isMutualMatch;
  return true;
}

/**
 * Strips fields the viewer isn't allowed to see, so downstream scoring and
 * reason generation physically cannot use them. Filtering at the boundary
 * rather than at render time means a UI bug can't leak a hidden field.
 */
export function applyVisibility(subject: MatchProfile, isMutualMatch: boolean): MatchProfile {
  return {
    ...subject,
    cityId: canSee(subject, "location", isMutualMatch) ? subject.cityId : null,
    travelPlans: canSee(subject, "travelPlans", isMutualMatch) ? subject.travelPlans : [],
    futureLocation: canSee(subject, "futureLocation", isMutualMatch)
      ? subject.futureLocation
      : null,
    languagesSpoken: canSee(subject, "languages", isMutualMatch) ? subject.languagesSpoken : [],
    languagesLearning: canSee(subject, "languages", isMutualMatch)
      ? subject.languagesLearning
      : [],
    cultureInterests: canSee(subject, "cultureInterests", isMutualMatch)
      ? subject.cultureInterests
      : []
  };
}
