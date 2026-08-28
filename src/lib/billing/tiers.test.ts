import { describe, expect, it } from "vitest";
import {
  activeTier,
  ENTITLEMENTS,
  entitlementsFor,
  isTier,
  TIERS,
  YEARLY_PRICE_CENTS
} from "./tiers";

const HOUR = 3_600_000;
const now = new Date("2026-08-23T12:00:00Z");
const future = new Date(now.getTime() + 24 * HOUR);
const past = new Date(now.getTime() - HOUR);

describe("the entitlement table", () => {
  it("covers every tier", () => {
    for (const tier of TIERS) expect(ENTITLEMENTS[tier]).toBeDefined();
  });

  it("never takes something away as the tier goes up", () => {
    const booleanKeys = [
      "advancedFilters",
      "seeWhoLikedYou",
      "undoPass",
      "messageTranslation",
      "profileVisitors",
      "priorityVisibility",
      "vipBadge"
    ] as const;

    for (const key of booleanKeys) {
      const [free, plus, vip] = TIERS.map((tier) => ENTITLEMENTS[tier][key]);
      expect(Number(free)).toBeLessThanOrEqual(Number(plus));
      expect(Number(plus)).toBeLessThanOrEqual(Number(vip));
    }
  });

  it("gives more likes at every step, with VIP unlimited", () => {
    expect(ENTITLEMENTS.free.dailyLikes).toBeLessThan(ENTITLEMENTS.plus.dailyLikes!);
    expect(ENTITLEMENTS.vip.dailyLikes).toBeNull();
  });

  it("matches the published pricing page on the features it names", () => {
    // PLUS sells control over who you see.
    expect(entitlementsFor("plus")).toMatchObject({
      advancedFilters: true,
      seeWhoLikedYou: true,
      undoPass: true,
      messageTranslation: true
    });
    // VIP sells control over who sees you.
    expect(entitlementsFor("vip")).toMatchObject({
      profileVisitors: true,
      priorityVisibility: true,
      vipBadge: true
    });
    expect(entitlementsFor("vip").boostMinutes).toBeGreaterThan(
      entitlementsFor("plus").boostMinutes
    );
    // Free gets none of the paid ones.
    expect(entitlementsFor("free")).toMatchObject({
      advancedFilters: false,
      messageTranslation: false,
      seeWhoLikedYou: false,
      profileVisitors: false
    });
  });

  /**
   * The regression this file exists to prevent.
   *
   * PLUS and VIP once cost the same, and every entitlement that was supposed
   * to separate them was a flag nothing read — so VIP was the same product at
   * the same price. Either half of that alone is survivable; together they
   * make the more expensive tier indefensible.
   */
  it("charges more for VIP, and gives something for it", () => {
    expect(YEARLY_PRICE_CENTS.free).toBe(0);
    expect(YEARLY_PRICE_CENTS.plus).toBeGreaterThan(YEARLY_PRICE_CENTS.free);
    expect(YEARLY_PRICE_CENTS.vip).toBeGreaterThan(YEARLY_PRICE_CENTS.plus);

    const plus = entitlementsFor("plus");
    const vip = entitlementsFor("vip");
    const different = (Object.keys(vip) as (keyof typeof vip)[]).filter(
      (key) => plus[key] !== vip[key]
    );

    expect(different.length).toBeGreaterThanOrEqual(4);
  });

  /**
   * Every entitlement has to be read by something. A flag nobody reads is a
   * promise on the pricing page with no code behind it, which is how `adFree`
   * came to sell an absence of ads in a product that has never had any.
   */
  it("declares no entitlement the product does not implement", () => {
    expect(Object.keys(entitlementsFor("vip")).sort()).toEqual(
      [
        "advancedFilters",
        "boostMinutes",
        "dailyGifts",
        "dailyLikes",
        "messageTranslation",
        "monthlyBoostCredits",
        "priorityVisibility",
        "profileVisitors",
        "seeWhoLikedYou",
        "undoPass",
        "vipBadge"
      ].sort()
    );
  });

  it("recognises only real tiers", () => {
    expect(isTier("vip")).toBe(true);
    expect(isTier("gold")).toBe(false);
  });
});

describe("which tier is live", () => {
  it("is free with no subscription at all", () => {
    expect(activeTier(null, now)).toBe("free");
  });

  it("grants the tier while the subscription is active", () => {
    expect(
      activeTier({ tier: "vip", status: "active", currentPeriodEnd: future }, now)
    ).toBe("vip");
  });

  it("keeps access while a payment is being retried", () => {
    expect(
      activeTier({ tier: "plus", status: "past_due", currentPeriodEnd: future }, now)
    ).toBe("plus");
  });

  it("keeps access after cancelling, until the paid period runs out", () => {
    expect(
      activeTier({ tier: "plus", status: "canceled", currentPeriodEnd: future }, now)
    ).toBe("plus");
  });

  it("drops to free once the period has ended, whatever the status says", () => {
    // The webhook that should have marked this expired never arrived.
    expect(
      activeTier({ tier: "vip", status: "active", currentPeriodEnd: past }, now)
    ).toBe("free");
  });

  it("drops to free at the exact moment the period ends", () => {
    expect(activeTier({ tier: "vip", status: "active", currentPeriodEnd: now }, now)).toBe("free");
  });

  it("is free once expired", () => {
    expect(
      activeTier({ tier: "vip", status: "expired", currentPeriodEnd: future }, now)
    ).toBe("free");
  });
});
