import { describe, expect, it } from "vitest";
import { subscriptionFor, tierForProduct, PRODUCT_IDS, type VerifiedPurchase } from "./purchase";
import { activeTier } from "./tiers";

const now = new Date("2026-09-01T12:00:00Z");
const DAY = 86_400_000;

function purchase(overrides: Partial<VerifiedPurchase> = {}): VerifiedPurchase {
  return {
    provider: "google_play",
    providerRef: "token-abc",
    tier: "plus",
    expiresAt: new Date(now.getTime() + 30 * DAY),
    cancelled: false,
    refunded: false,
    ...overrides
  };
}

describe("turning a purchase into a subscription", () => {
  it("grants the tier the product was sold as", () => {
    expect(subscriptionFor(purchase({ tier: "vip" }), now)).toMatchObject({
      tier: "vip",
      status: "active"
    });
  });

  it("keeps access after cancellation, until the paid period ends", () => {
    const state = subscriptionFor(purchase({ cancelled: true }), now);

    expect(state.status).toBe("canceled");
    // The row is only half the answer; what matters is what it grants.
    expect(activeTier({ ...state, tier: state.tier }, now)).toBe("plus");
  });

  it("ends access immediately on a refund, even mid-period", () => {
    const state = subscriptionFor(purchase({ refunded: true }), now);

    expect(state.status).toBe("expired");
    expect(activeTier({ ...state, tier: state.tier }, now)).toBe("free");
  });

  /**
   * The refund case that would be easy to get wrong.
   *
   * A refunded purchase still has a future period end — the store reports what
   * was sold, not what was kept. Reading the date alone would leave a refunded
   * member on VIP for the rest of the year.
   */
  it("does not let a future period end outrank a refund", () => {
    const refunded = purchase({ refunded: true, expiresAt: new Date(now.getTime() + 300 * DAY) });
    const state = subscriptionFor(refunded, now);

    expect(state.currentPeriodEnd.getTime()).toBeGreaterThan(now.getTime());
    expect(activeTier({ ...state, tier: state.tier }, now)).toBe("free");
  });

  it("preserves the period end on a refund rather than rewriting it", () => {
    const sold = new Date(now.getTime() + 300 * DAY);
    const state = subscriptionFor(purchase({ refunded: true, expiresAt: sold }), now);

    // The record of what was sold survives, because a dispute needs it and
    // `expired` already denies access without touching the date.
    expect(state.currentPeriodEnd).toEqual(sold);
  });

  it("expires a purchase whose period has already run out", () => {
    const lapsed = purchase({ expiresAt: new Date(now.getTime() - DAY) });

    expect(subscriptionFor(lapsed, now).status).toBe("expired");
  });

  it("carries the provider and its reference through", () => {
    const state = subscriptionFor(
      purchase({ provider: "app_store", providerRef: "original-txn-99" }),
      now
    );

    expect(state).toMatchObject({ provider: "app_store", providerRef: "original-txn-99" });
  });

  /**
   * A renewal must land on the same row.
   *
   * Both stores keep one identifier stable across renewals and mint a new one
   * per transaction. Keying on the transaction would create a new subscription
   * row every month and leave the member with several — which `subscriptions`,
   * keyed on the user, cannot even represent.
   */
  it("keeps the same reference across a renewal", () => {
    const first = subscriptionFor(purchase(), now);
    const renewed = subscriptionFor(
      purchase({ expiresAt: new Date(now.getTime() + 395 * DAY) }),
      now
    );

    expect(renewed.providerRef).toBe(first.providerRef);
    expect(renewed.currentPeriodEnd.getTime()).toBeGreaterThan(first.currentPeriodEnd.getTime());
  });
});

describe("mapping store products to tiers", () => {
  it("maps the configured products", () => {
    expect(tierForProduct("com.fiorematch.app.plus.annual")).toBe("plus");
    expect(tierForProduct("com.fiorematch.app.vip.annual")).toBe("vip");
  });

  /**
   * An unknown product is refused, not defaulted.
   *
   * Defaulting either way is a real failure: to the cheaper tier and someone
   * who paid for VIP gets PLUS; to the dearer one and a typo in a product id
   * gives VIP away.
   */
  it("refuses a product it does not know", () => {
    expect(tierForProduct("com.fiorematch.app.gold.annual")).toBeNull();
    expect(tierForProduct("")).toBeNull();
  });

  it("exposes exactly the ids that have to be configured in both stores", () => {
    expect(PRODUCT_IDS.sort()).toEqual([
      "com.fiorematch.app.plus.annual",
      "com.fiorematch.app.vip.annual"
    ]);
  });
});
