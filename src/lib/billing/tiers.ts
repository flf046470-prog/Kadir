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
  /** The names behind "someone liked you", rather than just the count. */
  seeWhoLikedYou: boolean;
  /** Take back the last pass, once, while it is still the last one. */
  undoPass: boolean;
  /**
   * Messages translated per rolling day. `null` means no limit.
   *
   * A count rather than the boolean this used to be, because the boolean made
   * the product's central promise a paid feature. "Meet people you have no
   * language in common with" is what the listing leads on, and a free member
   * who matched across a language gap could not exchange a single sentence —
   * so the app's one distinguishing claim was false for everyone who had not
   * paid, which is both dishonest and, as a store description, a policy
   * problem.
   *
   * Free gets enough to have a real conversation and find out whether it is
   * worth paying for. PLUS removes the ceiling. The thing being sold is the
   * limit, not the feature.
   */
  dailyTranslations: number | null;
  /** Who opened your profile, and when. */
  profileVisitors: boolean;
  /** Ranked above equivalent profiles in Discover. */
  priorityVisibility: boolean;
  /** Shown on the Discover card and in the conversation header. */
  vipBadge: boolean;
  /** Boost runs longer for VIP than the base thirty minutes. */
  boostMinutes: number;
  /** Boosts granted per calendar month, so the longer Boost is reachable. */
  monthlyBoostCredits: number;
  /** Gifts per rolling day. `null` means no limit. */
  dailyGifts: number | null;
};

/**
 * Price per month, in whole cents of the base currency.
 *
 * Monthly, and priced against the market rather than under it. The previous
 * numbers — $1.99 and $5.99 *per year* — could not fund the product they sold.
 * A member costs real money to serve: photo storage and delivery, the database,
 * translation calls charged per character, and moderation, which is a person's
 * time rather than a line item that scales down. At $5.09 a year net of the
 * store's cut, the arithmetic ran the wrong way at every size — more members
 * meant a larger loss, so growth made things worse rather than better. That is
 * a pricing fault, not a scaling one, and no amount of engineering fixes it.
 *
 * Monthly also matches how the product is actually used. People subscribe to a
 * dating app while they are actively dating and stop when they are not, and an
 * annual charge asks for a year's commitment at the moment someone trusts the
 * product least — the first week.
 *
 * Still well under the majors, which sit around $20–30 a month. The claim on
 * the pricing page is that the price is fair and legible, not that it is the
 * lowest number anyone has ever printed.
 *
 * VIP is roughly twice PLUS because it sells a different thing. PLUS buys
 * control over who *you* see; VIP buys control over who sees *you*, plus the
 * two surfaces that cost real infrastructure — visitor records and a monthly
 * Boost.
 *
 * The store is the source of truth at purchase time. These are the numbers the
 * App Store and Play price tiers must be configured to match, and what the
 * pricing page renders when no store price is available. Both stores convert
 * to local currency from this base, so a member in Istanbul is charged a
 * regional equivalent rather than these dollars.
 */
export const MONTHLY_PRICE_CENTS: Record<Tier, number> = {
  free: 0,
  plus: 499,
  vip: 999
};

export const ENTITLEMENTS: Record<Tier, Entitlements> = {
  free: {
    advancedFilters: false,
    dailyLikes: 50,
    seeWhoLikedYou: false,
    undoPass: false,
    // Enough for a real first conversation across a language gap — roughly a
    // dozen messages — so the promise the listing makes is true before anyone
    // has paid anything.
    dailyTranslations: 15,
    profileVisitors: false,
    priorityVisibility: false,
    vipBadge: false,
    boostMinutes: 30,
    monthlyBoostCredits: 0,
    dailyGifts: 3
  },
  plus: {
    advancedFilters: true,
    dailyLikes: 200,
    seeWhoLikedYou: true,
    undoPass: true,
    dailyTranslations: null,
    profileVisitors: false,
    priorityVisibility: false,
    vipBadge: false,
    boostMinutes: 30,
    monthlyBoostCredits: 0,
    dailyGifts: 10
  },
  vip: {
    advancedFilters: true,
    dailyLikes: null,
    seeWhoLikedYou: true,
    undoPass: true,
    dailyTranslations: null,
    profileVisitors: true,
    priorityVisibility: true,
    vipBadge: true,
    boostMinutes: 60,
    monthlyBoostCredits: 1,
    dailyGifts: null
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
