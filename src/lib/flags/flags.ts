/**
 * Feature flags with deterministic percentage rollout.
 *
 * Bucketing is a pure function of (flag name, stable member id), so a member
 * who is in the 5% cohort stays in it as the rollout widens to 10%, 25%, 100% —
 * the cohort only ever grows. That property is what makes a staged rollout
 * measurable: nobody flips in and out between requests.
 *
 * Every flag also has a kill switch (`OFF`) that overrides everything.
 */

export type RolloutPercent = 0 | 1 | 5 | 10 | 25 | 50 | 100;

export const ROLLOUT_STEPS: RolloutPercent[] = [0, 1, 5, 10, 25, 50, 100];

export type FeatureName =
  // V2
  | "ai_matchmaker"
  | "compatibility_dna"
  | "todays_five"
  | "global_match"
  | "ai_translation"
  | "conversation_coach"
  | "match_games"
  | "scam_shield"
  | "trust_profile"
  | "date_safety"
  | "ai_date_planner"
  | "discovery_modes"
  | "success_stories"
  | "referral"
  // V3
  | "culture_connect"
  | "language_exchange"
  | "travel_match"
  | "future_location"
  | "match_intent"
  | "ai_icebreaker"
  | "smart_match"
  | "match_quality_feedback";

export type FlagConfig = {
  rollout: RolloutPercent;
  /** Hard off regardless of rollout — the incident kill switch. */
  killed?: boolean;
  /** Member ids always included, for internal testing. */
  alwaysOn?: string[];
};

/**
 * Default rollout state. Unbuilt features ship dark: nothing is on until it has
 * passed its own test, security, and privacy review.
 *
 * A 0 here means one of two different things, and the difference matters. For
 * most of this list it means the feature does not exist and nothing reads the
 * flag — `WIRED_FLAGS` in `server.ts` names the few that are genuinely
 * connected, and a test keeps that list honest. For a wired flag it would mean
 * a built feature switched off.
 *
 * A wired flag defaults to 100 when the feature it gates already ships. Setting
 * it to 0 to be careful would not be careful: it would turn a working feature
 * off for everyone the moment the gate was added, which is a regression wearing
 * a rollout's clothes.
 */
export const defaultFlags: Record<FeatureName, FlagConfig> = {
  ai_matchmaker: { rollout: 0 },
  compatibility_dna: { rollout: 0 },
  todays_five: { rollout: 0 },
  global_match: { rollout: 0 },
  /**
   * On, because message translation ships today.
   *
   * Wired as a kill switch rather than a rollout: it is the one feature with a
   * per-call cost to a third party, so the operational need is stopping it
   * during a provider outage or a cost spike without waiting for a deploy.
   * `FEATURE_FLAGS={"ai_translation":{"killed":true}}` does that.
   */
  ai_translation: { rollout: 100 },
  conversation_coach: { rollout: 0 },
  match_games: { rollout: 0 },
  scam_shield: { rollout: 0 },
  trust_profile: { rollout: 0 },
  date_safety: { rollout: 0 },
  ai_date_planner: { rollout: 0 },
  discovery_modes: { rollout: 0 },
  success_stories: { rollout: 0 },
  referral: { rollout: 0 },
  culture_connect: { rollout: 0 },
  language_exchange: { rollout: 0 },
  travel_match: { rollout: 0 },
  future_location: { rollout: 0 },
  match_intent: { rollout: 0 },
  ai_icebreaker: { rollout: 0 },
  smart_match: { rollout: 0 },
  match_quality_feedback: { rollout: 0 }
};

/**
 * FNV-1a. Chosen for being small, dependency-free, and well distributed across
 * short string keys — not for any cryptographic property, which this doesn't
 * need since bucketing isn't a security boundary.
 */
function hash(input: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    value ^= input.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/** Stable 0–99 bucket for a member on a specific flag. */
export function bucketOf(feature: FeatureName, memberId: string): number {
  return hash(`${feature}:${memberId}`) % 100;
}

export type FlagContext = {
  memberId: string;
  flags?: Partial<Record<FeatureName, FlagConfig>>;
};

export function isEnabled(feature: FeatureName, context: FlagContext): boolean {
  const config = context.flags?.[feature] ?? defaultFlags[feature];
  if (!config) return false;
  if (config.killed) return false;
  if (config.alwaysOn?.includes(context.memberId)) return true;
  if (config.rollout === 0) return false;
  if (config.rollout === 100) return true;

  return bucketOf(feature, context.memberId) < config.rollout;
}

/** All features currently on for a member, for debugging and analytics. */
export function enabledFeatures(context: FlagContext): FeatureName[] {
  return (Object.keys(defaultFlags) as FeatureName[]).filter((feature) =>
    isEnabled(feature, context)
  );
}
