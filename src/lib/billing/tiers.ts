/**
 * What each tier actually gets.
 *
 * One table, read by every gate. The alternative — scattering `if (tier ===
 * "vip")` through the routes — is how a paid feature ends up enforced in three
 * places and forgotten in a fourth, which is both a revenue leak and, when the
 * forgotten place is the generous direction, a support problem.
 *
 * Entitlements are named for what a member can *do*, not for the tier that
 * grants them. A gate asks "may this member use advanced filters?", never "are
 * they VIP?", so re-pricing a feature is an edit here rather than a search
 * across the codebase.
 *
 * The contents mirror the published pricing page. That page is a promise, and
 * it is the specification this file implements.
 */

export type Tier = "free" | "plus" | "vip";

export const TIERS: Tier[] = ["free", "plus", "vip"];

export type Entitlements = {
  /** Filters beyond age and country: languages, intents, culture. */
  advancedFilters: boolean;
  /** Likes per rolling day. `null` means no limit. */
  dailyLikes: number | null;
  adFree: boolean;
  /** Who looked at your profile. */
  seeVisitors: boolean;
  /** In-chat message translation. */
  messageTranslation: boolean;
  /** Today's 5 and the learned ranking, rather than plain proximity order. */
  aiRecommendations: boolean;
  /** Ranked above equivalent free profiles in Discover. */
  priorityVisibility: boolean;
  vipBadge: boolean;
  /** Boost runs longer for VIP than the base thirty minutes. */
  boostMinutes: number;
};

export const ENTITLEMENTS: Record<Tier, Entitlements> = {
  free: {
    advancedFilters: false,
    dailyLikes: 50,
    adFree: false,
    seeVisitors: false,
    messageTranslation: false,
    aiRecommendations: false,
    priorityVisibility: false,
    vipBadge: false,
    boostMinutes: 30
  },
  plus: {
    advancedFilters: true,
    dailyLikes: 200,
    adFree: true,
    seeVisitors: true,
    messageTranslation: true,
    aiRecommendations: false,
    priorityVisibility: false,
    vipBadge: false,
    boostMinutes: 30
  },
  vip: {
    advancedFilters: true,
    dailyLikes: null,
    adFree: true,
    seeVisitors: true,
    messageTranslation: true,
    aiRecommendations: true,
    priorityVisibility: true,
    vipBadge: true,
    boostMinutes: 60
  }
};

export function entitlementsFor(tier: Tier): Entitlements {
  return ENTITLEMENTS[tier];
}

export function isTier(value: string): value is Tier {
  return (TIERS as string[]).includes(value);
}

/**
 * Subscription states, named after what they mean for access rather than after
 * any one provider's vocabulary.
 *
 * `past_due` deliberately keeps access. A card that expired between renewals is
 * overwhelmingly a card problem, not a decision to leave, and cutting someone
 * off mid-conversation to chase a payment the provider is still retrying costs
 * more than the few days of service it saves.
 */
export type SubscriptionStatus = "active" | "past_due" | "canceled" | "expired";

const STATUSES_WITH_ACCESS: SubscriptionStatus[] = ["active", "past_due"];

/**
 * The tier a subscription grants right now.
 *
 * Access survives cancellation until the paid period actually ends — someone
 * who cancels in month one has bought the year, and taking it away immediately
 * would be keeping money for a service withdrawn. It does not survive the
 * period end, whatever the stored status says: a webhook that never arrived
 * must not leave a lapsed subscription running forever, so the date is
 * authoritative and the status is a hint.
 */
export function activeTier(
  subscription: { tier: Tier; status: SubscriptionStatus; currentPeriodEnd: Date } | null,
  now: Date = new Date()
): Tier {
  if (!subscription) return "free";
  if (subscription.currentPeriodEnd.getTime() <= now.getTime()) return "free";
  if (!STATUSES_WITH_ACCESS.includes(subscription.status) && subscription.status !== "canceled") {
    return "free";
  }
  return subscription.tier;
}
