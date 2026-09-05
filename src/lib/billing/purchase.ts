import type { Tier } from "./tiers";
import { isTier } from "./tiers";

/**
 * What a store tells us about a purchase, once verified.
 *
 * Both stores are asked the same question — "is this purchase real, and until
 * when does it entitle this person?" — and both answer with more than that.
 * This is the part the rest of the app needs; everything provider-specific
 * (Google's `orderId` vs Apple's `originalTransactionId`, acknowledgement
 * state, promotional offers) stays inside the driver that produced it.
 *
 * `expiresAt` rather than a duration, because that is what the stores actually
 * return and it is what survives clock skew, grace periods and the retries the
 * store performs on a failed card without telling us.
 */
/**
 * The stores a purchase can come from.
 *
 * The client says which one it is holding a token for, because the token
 * formats are not distinguishable and asking the wrong store is not a
 * recoverable mistake — it is a refusal that looks exactly like a forged
 * purchase.
 */
export const STORES = ["google_play", "app_store", "microsoft_store"] as const;

export type StoreId = (typeof STORES)[number];

export function isStore(value: string): value is StoreId {
  return (STORES as readonly string[]).includes(value);
}

export type VerifiedPurchase = {
  /** Which store said so — recorded so a switch stays traceable. */
  provider: string;
  /**
   * The stable identifier for this *subscription*, not this transaction.
   *
   * Renewals produce new transactions against the same subscription, and a
   * row keyed on the transaction would multiply once a month. Google's
   * purchase token and Apple's original transaction id are both stable across
   * renewal; that is what belongs here.
   */
  providerRef: string;
  tier: Tier;
  expiresAt: Date;
  /**
   * True once the store says the member asked to stop.
   *
   * Not the same as expired: a cancelled subscription keeps its entitlement
   * until the period it was paid for runs out, which is the behaviour
   * `activeTier` already implements.
   */
  cancelled: boolean;
  /**
   * True when the store took the money back.
   *
   * Kept apart from cancellation because it means the opposite thing about
   * access: a refund ends entitlement immediately, whatever the period end
   * says, since the member is no longer paying for the time they were sold.
   */
  refunded: boolean;
};

/**
 * The subscription row a verified purchase should produce.
 *
 * Separated from the database write so the decision is a pure function of the
 * store's answer, and can be tested without a database or a store. Getting
 * this wrong in either direction is expensive — one way gives VIP away, the
 * other charges someone for nothing — and it is the kind of logic that is
 * usually only exercised in production.
 */
export type SubscriptionState = {
  tier: Tier;
  status: "active" | "past_due" | "canceled" | "expired";
  currentPeriodEnd: Date;
  provider: string;
  providerRef: string;
};

/**
 * Turns a verified purchase into the row that grants access.
 *
 * The status vocabulary is the one already in the schema, chosen for what it
 * means for access rather than for any one provider's wording — see
 * `activeTier`, which treats `currentPeriodEnd` as authoritative and the
 * status as a hint. That division is what makes a missed store notification
 * survivable: the date still expires on its own.
 */
export function subscriptionFor(
  purchase: VerifiedPurchase,
  now: Date = new Date()
): SubscriptionState {
  const base = {
    tier: purchase.tier,
    currentPeriodEnd: purchase.expiresAt,
    provider: purchase.provider,
    providerRef: purchase.providerRef
  };

  /**
   * A refund ends access now, not at the period end.
   *
   * The period end is left as the store reported it rather than being moved
   * to `now`: it is a record of what was sold, and `expired` already denies
   * access regardless of the date. Rewriting the date would destroy the only
   * evidence of what the member had paid for when a dispute arrives.
   */
  if (purchase.refunded) {
    return { ...base, status: "expired" };
  }

  if (purchase.expiresAt.getTime() <= now.getTime()) {
    return { ...base, status: "expired" };
  }

  // Still inside the paid period, but the member has asked to stop. They keep
  // what they bought until it runs out; `canceled` is what stops the renewal
  // from being assumed, not what stops access.
  if (purchase.cancelled) {
    return { ...base, status: "canceled" };
  }

  return { ...base, status: "active" };
}

/**
 * Maps a store product id to a tier.
 *
 * The ids are configured in Play Console and App Store Connect, and they are
 * the one string the stores and this codebase have to agree on exactly. An id
 * that does not map is refused rather than defaulted: silently granting the
 * cheaper tier for an unrecognised product would charge someone for VIP and
 * hand them PLUS, and silently granting the more expensive one is a bug that
 * pays for itself in support tickets.
 */
const PRODUCT_TIERS: Record<string, Tier> = {
  "com.fiorematch.app.plus.annual": "plus",
  "com.fiorematch.app.vip.annual": "vip"
};

export function tierForProduct(productId: string): Tier | null {
  const tier = PRODUCT_TIERS[productId];
  return tier && isTier(tier) ? tier : null;
}

/** The product ids to configure in both stores, so the list has one home. */
export const PRODUCT_IDS = Object.keys(PRODUCT_TIERS);

/**
 * A store that can verify a purchase.
 *
 * Narrow on purpose, like the translation driver: a token in, an entitlement
 * out. The two stores disagree about almost everything else — Google wants an
 * OAuth service account and a package name, Apple wants a signed JWT and
 * returns a chain of transactions — and none of that belongs above this line.
 */
export type PurchaseVerifier = {
  readonly name: string;

  /**
   * Verifies a purchase with the store.
   *
   * Returns `null` when the store says the purchase is not valid — an unknown
   * token, a different app, a forged receipt. Throws only when the store could
   * not be reached, because those two cases must not be confused: an
   * unreachable store is a reason to retry, and an invalid purchase is a
   * reason to refuse.
   */
  verify(token: string, productId: string): Promise<VerifiedPurchase | null>;
};

/** The default: no store is configured, so nothing can be bought. */
export class NoPurchaseVerifier implements PurchaseVerifier {
  readonly name = "none";

  async verify(): Promise<VerifiedPurchase | null> {
    throw new Error("No purchase verifier is configured");
  }
}
