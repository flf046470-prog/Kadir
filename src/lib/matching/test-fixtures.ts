import { defaultVisibility, type MatchProfile } from "../domain/profile";

/** Minimal valid profile; tests override only the fields they care about. */
export function makeProfile(overrides: Partial<MatchProfile> = {}): MatchProfile {
  return {
    id: "p1",
    cityId: "istanbul",
    countryId: "turkey",
    relationshipGoal: "long_term",
    matchIntents: ["serious_relationship"],
    connectionMode: "dating",
    interests: ["travel", "music"],
    idealDates: ["coffee"],
    communicationStyles: ["texter"],
    languagesSpoken: ["tr", "en"],
    languagesLearning: [],
    cultureInterests: [],
    openToOtherCultures: false,
    travelPlans: [],
    futureLocation: null,
    futurePlans: [],
    quizAnswers: {},
    verifications: ["email"],
    visibility: { ...defaultVisibility },
    ...overrides
  };
}
