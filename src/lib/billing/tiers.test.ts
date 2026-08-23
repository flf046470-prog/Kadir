import { describe, expect, it } from "vitest";
import { activeTier, ENTITLEMENTS, entitlementsFor, isTier, TIERS } from "./tiers";

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
      "adFree",
      "seeVisitors",
      "messageTranslation",
      "aiRecommendations",
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
    // PLUS: advanced filters, more likes, ad-free, visitors, translation.
    expect(entitlementsFor("plus")).toMatchObject({
      advancedFilters: true,
      adFree: true,
      seeVisitors: true,
      messageTranslation: true
    });
    // VIP adds recommendations, priority visibility, a badge, better boosts.
    expect(entitlementsFor("vip")).toMatchObject({
      aiRecommendations: true,
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
      aiRecommendations: false
    });
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
