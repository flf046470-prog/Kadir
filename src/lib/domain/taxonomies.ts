/**
 * Shared vocabulary for matching, profiles, discovery filters, and the admin
 * panel. Everything the matching engine reasons about is defined here so the
 * site, the future API, and moderation tooling agree on one set of ids.
 *
 * Ids are stable and language-neutral; display labels are translated through
 * the i18n catalogs (key pattern: `taxonomy.<group>.<id>`).
 */

export type RelationshipGoalId =
  | "long_term"
  | "marriage"
  | "dating"
  | "casual"
  | "friendship"
  | "international"
  | "unsure";

export const relationshipGoals: { id: RelationshipGoalId; serious: boolean }[] = [
  { id: "long_term", serious: true },
  { id: "marriage", serious: true },
  { id: "dating", serious: false },
  { id: "casual", serious: false },
  { id: "friendship", serious: false },
  { id: "international", serious: false },
  { id: "unsure", serious: false }
];

/**
 * Goal pairs that are compatible enough to surface to each other. Matching is
 * symmetric: `areGoalsCompatible(a, b) === areGoalsCompatible(b, a)`.
 *
 * "unsure" is deliberately compatible with everything except marriage — someone
 * still deciding shouldn't be pushed at people with the most specific intent.
 */
const goalAffinity: Record<RelationshipGoalId, RelationshipGoalId[]> = {
  long_term: ["long_term", "marriage", "dating", "international", "unsure"],
  marriage: ["marriage", "long_term"],
  dating: ["dating", "long_term", "casual", "international", "unsure"],
  casual: ["casual", "dating", "unsure"],
  friendship: ["friendship", "unsure"],
  international: ["international", "long_term", "dating", "friendship", "unsure"],
  unsure: ["unsure", "long_term", "dating", "casual", "friendship", "international"]
};

export function areGoalsCompatible(a: RelationshipGoalId, b: RelationshipGoalId): boolean {
  return goalAffinity[a].includes(b) && goalAffinity[b].includes(a);
}

export type MatchIntentId =
  | "serious_relationship"
  | "getting_to_know"
  | "international_dating"
  | "friendship"
  | "language_exchange";

export const matchIntents: { id: MatchIntentId; emoji: string }[] = [
  { id: "serious_relationship", emoji: "❤️" },
  { id: "getting_to_know", emoji: "💬" },
  { id: "international_dating", emoji: "🌎" },
  { id: "friendship", emoji: "🤝" },
  { id: "language_exchange", emoji: "🗣️" }
];

/**
 * Cultural *interest* — what a member wants to learn about or connect with.
 * This is never inferred from a member's nationality, and never treated as a
 * personality trait. See `docs/AI_SAFETY.md`.
 */
export type CultureId =
  | "japanese"
  | "korean"
  | "turkish"
  | "italian"
  | "spanish"
  | "french"
  | "german"
  | "brazilian"
  | "indian"
  | "arabic"
  | "chinese"
  | "nordic";

export const cultures: CultureId[] = [
  "japanese",
  "korean",
  "turkish",
  "italian",
  "spanish",
  "french",
  "german",
  "brazilian",
  "indian",
  "arabic",
  "chinese",
  "nordic"
];

export type TravelStyleId =
  | "food"
  | "culture"
  | "photography"
  | "nature"
  | "nightlife"
  | "history"
  | "beach"
  | "adventure";

export const travelStyles: TravelStyleId[] = [
  "food",
  "culture",
  "photography",
  "nature",
  "nightlife",
  "history",
  "beach",
  "adventure"
];

export type IdealDateId =
  | "coffee"
  | "dinner"
  | "movie"
  | "walk"
  | "museum"
  | "beach"
  | "travel"
  | "gaming"
  | "concert"
  | "nature";

export const idealDates: { id: IdealDateId; emoji: string }[] = [
  { id: "coffee", emoji: "☕" },
  { id: "dinner", emoji: "🍝" },
  { id: "movie", emoji: "🎬" },
  { id: "walk", emoji: "🚶" },
  { id: "museum", emoji: "🎨" },
  { id: "beach", emoji: "🏖️" },
  { id: "travel", emoji: "✈️" },
  { id: "gaming", emoji: "🎮" },
  { id: "concert", emoji: "🎵" },
  { id: "nature", emoji: "🌳" }
];

export type FuturePlanId = "travel" | "move" | "study" | "work_abroad" | "learn_language";

export const futurePlans: FuturePlanId[] = [
  "travel",
  "move",
  "study",
  "work_abroad",
  "learn_language"
];

/** How a member wants to use FioreMatch. Drives which discovery modes appear. */
export type ConnectionModeId = "dating" | "language_exchange" | "both";

export type DiscoveryModeId =
  | "local"
  | "country"
  | "global"
  | "culture"
  | "language"
  | "travel";

export const discoveryModes: DiscoveryModeId[] = [
  "local",
  "country",
  "global",
  "culture",
  "language",
  "travel"
];

/** Global Match reach setting, from tightest to widest. */
export type ReachId = "my_city" | "my_country" | "nearby_countries" | "worldwide" | "specific";

export const reaches: ReachId[] = [
  "my_city",
  "my_country",
  "nearby_countries",
  "worldwide",
  "specific"
];

export type CommunicationStyleId = "texter" | "caller" | "voice_notes" | "video" | "slow_burn";

export const communicationStyles: CommunicationStyleId[] = [
  "texter",
  "caller",
  "voice_notes",
  "video",
  "slow_burn"
];

/** Reasons a member can give when passing on a suggestion. Always optional. */
export type PassReasonId =
  | "not_my_type"
  | "different_goal"
  | "too_far"
  | "different_interests"
  | "language_barrier"
  | "not_interested"
  | "other";

export const passReasons: PassReasonId[] = [
  "not_my_type",
  "different_goal",
  "too_far",
  "different_interests",
  "language_barrier",
  "not_interested",
  "other"
];

/** Verifications a member can complete. Absence of a badge is never a penalty. */
export type VerificationId = "email" | "phone" | "photo" | "liveness" | "identity";

export const verifications: VerificationId[] = [
  "email",
  "phone",
  "photo",
  "liveness",
  "identity"
];
