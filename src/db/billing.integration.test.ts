import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { subscriptions } from "./schema";
import { createTestUser, resetDatabase } from "./test-helpers";
import { recordPurchase, subscriptionByRef } from "./billing";
import { entitlementsOf, tierOf } from "./entitlements";
import type { VerifiedPurchase } from "@/lib/billing/purchase";

const DAY = 86_400_000;
const now = new Date("2026-09-01T12:00:00Z");

beforeEach(async () => {
  await resetDatabase();
});

function purchase(overrides: Partial<VerifiedPurchase> = {}): VerifiedPurchase {
  return {
    provider: "google_play",
    providerRef: "token-abc",
    tier: "plus",
    expiresAt: new Date(now.getTime() + 365 * DAY),
    cancelled: false,
    refunded: false,
    ...overrides
  };
}

describe("recording a purchase", () => {
  it("grants the tier it was sold as", async () => {
    const user = await createTestUser();

    const result = await recordPurchase(user, purchase({ tier: "vip" }), now);

    expect(result).toMatchObject({ ok: true, tier: "vip", status: "active" });
    expect(await tierOf(user, now)).toBe("vip");
  });

  it("turns the entitlements on, not just the row", async () => {
    const user = await createTestUser();
    expect((await entitlementsOf(user, now)).entitlements.profileVisitors).toBe(false);

    await recordPurchase(user, purchase({ tier: "vip" }), now);

    const { entitlements } = await entitlementsOf(user, now);
    expect(entitlements.profileVisitors).toBe(true);
    expect(entitlements.dailyLikes).toBeNull();
  });

  /**
   * The case both stores guarantee will happen.
   *
   * Google retries a developer notification until it is acknowledged, Apple
   * resends on its own schedule, and the client reconciles on every launch. A
   * write that accumulated instead of converging would multiply subscriptions
   * or double-count a period.
   */
  it("converges when the same purchase arrives repeatedly", async () => {
    const user = await createTestUser();
    const same = purchase();

    for (let i = 0; i < 5; i += 1) {
      expect((await recordPurchase(user, same, now)).ok).toBe(true);
    }

    const rows = await db.select().from(subscriptions).where(eq(subscriptions.userId, user));
    expect(rows).toHaveLength(1);
    expect(rows[0].currentPeriodEnd).toEqual(same.expiresAt);
  });

  it("extends the period on a renewal, on the same row", async () => {
    const user = await createTestUser();
    await recordPurchase(user, purchase(), now);

    const later = new Date(now.getTime() + 360 * DAY);
    const renewed = purchase({ expiresAt: new Date(now.getTime() + 730 * DAY) });
    await recordPurchase(user, renewed, later);

    const rows = await db.select().from(subscriptions).where(eq(subscriptions.userId, user));
    expect(rows).toHaveLength(1);
    expect(rows[0].currentPeriodEnd).toEqual(renewed.expiresAt);
    expect(await tierOf(user, later)).toBe("plus");
  });

  it("carries an upgrade from PLUS to VIP onto the same subscription", async () => {
    const user = await createTestUser();
    await recordPurchase(user, purchase({ tier: "plus" }), now);

    await recordPurchase(user, purchase({ tier: "vip" }), now);

    const rows = await db.select().from(subscriptions).where(eq(subscriptions.userId, user));
    expect(rows).toHaveLength(1);
    expect(await tierOf(user, now)).toBe("vip");
  });

  it("keeps access after a cancellation until the period ends", async () => {
    const user = await createTestUser();
    const cancelled = purchase({ cancelled: true });

    await recordPurchase(user, cancelled, now);

    expect(await tierOf(user, now)).toBe("plus");
    // And stops on its own once the paid period runs out, with no second
    // message required from the store.
    expect(await tierOf(user, new Date(cancelled.expiresAt.getTime() + DAY))).toBe("free");
  });

  it("ends access on a refund even though the period has not ended", async () => {
    const user = await createTestUser();
    await recordPurchase(user, purchase(), now);
    expect(await tierOf(user, now)).toBe("plus");

    await recordPurchase(user, purchase({ refunded: true }), now);

    expect(await tierOf(user, now)).toBe("free");
  });

  /**
   * One payment must not entitle two accounts.
   *
   * The unique index on `provider_ref` would reject the second write anyway,
   * but as a constraint violation the caller cannot tell apart from a
   * transient database failure — and one of those is worth retrying forever
   * while the other never is.
   */
  it("refuses a purchase already redeemed by someone else", async () => {
    const first = await createTestUser();
    const second = await createTestUser();
    await recordPurchase(first, purchase(), now);

    expect(await recordPurchase(second, purchase(), now)).toEqual({
      ok: false,
      reason: "already_redeemed"
    });

    // The original keeps it, and the second account gets nothing.
    expect(await tierOf(first, now)).toBe("plus");
    expect(await tierOf(second, now)).toBe("free");
  });

  it("finds a subscription from the reference a store notification carries", async () => {
    const user = await createTestUser();
    await recordPurchase(user, purchase({ providerRef: "notif-ref-1" }), now);

    expect(await subscriptionByRef("notif-ref-1")).toMatchObject({
      userId: user,
      tier: "plus",
      status: "active"
    });
    expect(await subscriptionByRef("nothing-like-this")).toBeNull();
  });

  it("records which store the purchase came from", async () => {
    const user = await createTestUser();
    await recordPurchase(user, purchase({ provider: "app_store", providerRef: "apple-1" }), now);

    const rows = await db.select().from(subscriptions).where(eq(subscriptions.userId, user));
    expect(rows[0].provider).toBe("app_store");
  });
});
