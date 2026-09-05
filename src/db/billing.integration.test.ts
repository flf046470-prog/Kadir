import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { subscriptions, storeNotifications } from "./schema";
import { createTestUser, resetDatabase } from "./test-helpers";
import {
  applyStoreNotification,
  recordPurchase,
  subscriptionByRef,
  NOTIFICATION_RETENTION_DAYS
} from "./billing";
import { entitlementsOf, tierOf } from "./entitlements";
import { deleteAccount } from "@/auth/accounts";
import type { VerifiedPurchase } from "@/lib/billing/purchase";
import type { StoreNotification } from "@/lib/billing/notifications";

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

describe("applying a store notification", () => {
  function notification(
    overrides: Partial<VerifiedPurchase> = {},
    meta: { notificationId?: string; signedAt?: Date } = {}
  ): StoreNotification {
    return {
      notificationId: meta.notificationId ?? "notif-1",
      signedAt: meta.signedAt ?? now,
      purchase: purchase(overrides)
    };
  }

  /**
   * The reason this path exists.
   *
   * A refunded member's entitlement is otherwise only re-checked when they next
   * open the app, and someone who has taken their money back has no reason to.
   * Without a notification arriving on its own, the tier outlives the payment
   * for the whole remaining period.
   */
  it("ends access when the store reports a refund", async () => {
    const user = await createTestUser();
    await recordPurchase(user, purchase(), now);
    expect(await tierOf(user, now)).toBe("plus");

    const result = await applyStoreNotification(
      notification({ refunded: true }, { signedAt: new Date(now.getTime() + 60_000) }),
      now
    );

    expect(result).toMatchObject({ applied: true, userId: user, status: "expired" });
    expect(await tierOf(user, now)).toBe("free");
  });

  it("extends access when the store reports a renewal", async () => {
    const user = await createTestUser();
    await recordPurchase(user, purchase(), now);
    const renewed = new Date(now.getTime() + 730 * DAY);

    await applyStoreNotification(
      notification({ expiresAt: renewed }, { signedAt: new Date(now.getTime() + 60_000) }),
      now
    );

    expect(await tierOf(user, new Date(now.getTime() + 400 * DAY))).toBe("plus");
  });

  it("keeps the paid period when the store reports a cancellation", async () => {
    const user = await createTestUser();
    await recordPurchase(user, purchase(), now);

    const result = await applyStoreNotification(
      notification({ cancelled: true }, { signedAt: new Date(now.getTime() + 60_000) }),
      now
    );

    expect(result).toMatchObject({ applied: true, status: "canceled" });
    // Cancelling is not a refund: they keep what they bought until it runs out.
    expect(await tierOf(user, now)).toBe("plus");
  });

  /**
   * Both stores deliver at least once and retry until acknowledged, so this is
   * the ordinary case rather than an edge one.
   */
  it("does nothing the second time the same notification arrives", async () => {
    const user = await createTestUser();
    await recordPurchase(user, purchase(), now);
    const same = notification({ refunded: true }, { signedAt: new Date(now.getTime() + 60_000) });

    expect(await applyStoreNotification(same, now)).toMatchObject({ applied: true });
    expect(await applyStoreNotification(same, now)).toEqual({
      applied: false,
      reason: "duplicate"
    });
  });

  /**
   * The case `signedAt` exists for.
   *
   * A renewal that spent an hour being retried lands *after* the refund that
   * followed it. Applied in arrival order it restores an entitlement the member
   * has already been paid back for — the exact failure that makes a refund
   * look optional.
   */
  it("ignores a notification signed before the one already applied", async () => {
    const user = await createTestUser();
    await recordPurchase(user, purchase(), now);

    const refundedAt = new Date(now.getTime() + 2 * DAY);
    await applyStoreNotification(
      notification({ refunded: true }, { notificationId: "refund", signedAt: refundedAt }),
      now
    );
    expect(await tierOf(user, now)).toBe("free");

    const late = notification(
      { expiresAt: new Date(now.getTime() + 730 * DAY) },
      { notificationId: "renewal", signedAt: new Date(refundedAt.getTime() - DAY) }
    );

    expect(await applyStoreNotification(late, now)).toEqual({
      applied: false,
      reason: "stale"
    });
    expect(await tierOf(user, now)).toBe("free");
  });

  /**
   * Two notifications carrying the same signing instant cannot be ordered by
   * that field, so the one already applied stands — re-applying is the only
   * choice of the two that could move a row backwards.
   */
  it("keeps the applied notification when a second shares its signing time", async () => {
    const user = await createTestUser();
    await recordPurchase(user, purchase(), now);
    const signedAt = new Date(now.getTime() + DAY);

    await applyStoreNotification(
      notification({ refunded: true }, { notificationId: "a", signedAt }),
      now
    );

    const rival = notification(
      { expiresAt: new Date(now.getTime() + 730 * DAY) },
      { notificationId: "b", signedAt }
    );

    expect(await applyStoreNotification(rival, now)).toEqual({
      applied: false,
      reason: "stale"
    });
    expect(await tierOf(user, now)).toBe("free");
  });

  /**
   * A notification about a purchase nobody here has redeemed is deliberately
   * *not* recorded as handled — so if the member redeems a moment later, a
   * retry can still land. Recording it would close that door for good.
   */
  it("does not remember a notification it could not attach to anyone", async () => {
    const orphan = notification({ providerRef: "never-redeemed" });

    expect(await applyStoreNotification(orphan, now)).toEqual({
      applied: false,
      reason: "unknown_subscription"
    });
    // Not recorded, so the door stays open — recording it would close it for
    // good, and that is the mistake here no retry could undo.
    expect(await db.select().from(storeNotifications)).toHaveLength(0);

    /**
     * Once the member redeems, a retry is *superseded* rather than lost.
     *
     * Redemption asked the store directly, so it holds newer truth than a
     * notification signed before it — which is exactly what `notifiedAt` now
     * records. The retry is answered "stale", which is a handled outcome, not a
     * dropped one, and a notification signed *after* the redemption still
     * applies (the test below).
     */
    const user = await createTestUser();
    await recordPurchase(user, purchase({ providerRef: "never-redeemed" }), now);

    expect(await applyStoreNotification(orphan, now)).toEqual({
      applied: false,
      reason: "stale"
    });
  });

  it("applies an orphaned notification whose retry is signed after the redemption", async () => {
    const providerRef = "redeemed-late";
    const orphan = notification(
      { providerRef, refunded: true },
      { signedAt: new Date(now.getTime() + 2 * DAY) }
    );

    expect(await applyStoreNotification(orphan, now)).toMatchObject({
      reason: "unknown_subscription"
    });

    const user = await createTestUser();
    await recordPurchase(user, purchase({ providerRef }), now);

    expect(await applyStoreNotification(orphan, now)).toMatchObject({ applied: true });
    expect(await tierOf(user, now)).toBe("free");
  });

  it("remembers a notification it decided was stale, so the store stops resending", async () => {
    const user = await createTestUser();
    await recordPurchase(user, purchase(), now);

    await applyStoreNotification(
      notification({}, { notificationId: "first", signedAt: new Date(now.getTime() + DAY) }),
      now
    );
    await applyStoreNotification(notification({}, { notificationId: "late", signedAt: now }), now);

    const seen = await db.select().from(storeNotifications);
    expect(seen.map((row) => row.notificationId).sort()).toEqual(["first", "late"]);
  });

  /**
   * Two deliveries of the same notification landing at once. One does the work
   * and the other has to notice that it did not, rather than both writing.
   */
  it("lets only one of two simultaneous deliveries apply", async () => {
    const user = await createTestUser();
    await recordPurchase(user, purchase(), now);
    const same = notification({ refunded: true }, { signedAt: new Date(now.getTime() + DAY) });

    const results = await Promise.all([
      applyStoreNotification(same, now),
      applyStoreNotification(same, now)
    ]);

    expect(results.filter((result) => result.applied)).toHaveLength(1);
    expect(results.filter((result) => !result.applied)).toMatchObject([{ reason: "duplicate" }]);
    expect(await tierOf(user, now)).toBe("free");
  });

  /**
   * The dedupe log is the one table that does not cascade from `users`, which
   * is only defensible for as long as it holds nothing that points at a member.
   *
   * Deletion here is complete by cascade, so a column added to this table later
   * would leave rows behind silently — and a `provider_ref` among them would
   * outlive the deletion and re-link the person the next time the same store
   * subscription appeared. This fails if that column is ever added.
   */
  it("keeps nothing about a deleted member in the notification log", async () => {
    const user = await createTestUser();
    await recordPurchase(user, purchase(), now);
    await applyStoreNotification(
      notification({}, { signedAt: new Date(now.getTime() + DAY) }),
      now
    );

    await deleteAccount(user);

    const rows = await db.select().from(storeNotifications);
    // The log survives the deletion, because it is not the member's data.
    expect(rows).toHaveLength(1);

    const stored = Object.values(rows[0]).map(String);
    expect(stored).not.toContain(user);
    expect(stored).not.toContain("token-abc");
  });

  /**
   * A client reconcile is fresher than any notification signed before it.
   *
   * The sequence that used to downgrade a paying member: they renew, the client
   * reconciles on launch and writes the new period, then a "cancelled"
   * notification signed *before* that reconcile arrives late and is applied over
   * it. `recordPurchase` now advances `notifiedAt`, so the late one is stale.
   */
  it("ignores a notification signed before the last client reconcile", async () => {
    const user = await createTestUser();
    const reconciledAt = new Date(now.getTime() + 2 * DAY);

    await recordPurchase(
      user,
      purchase({ expiresAt: new Date(now.getTime() + 730 * DAY) }),
      reconciledAt
    );
    expect(await tierOf(user, now)).toBe("plus");

    const late = notification(
      { cancelled: true, expiresAt: new Date(now.getTime() + DAY) },
      { notificationId: "late-cancel", signedAt: new Date(reconciledAt.getTime() - DAY) }
    );

    expect(await applyStoreNotification(late, now)).toEqual({
      applied: false,
      reason: "stale"
    });
    // Still paying, and still on the period the reconcile established.
    expect(await tierOf(user, new Date(now.getTime() + 400 * DAY))).toBe("plus");
  });

  it("still applies a notification signed after the last reconcile", async () => {
    const user = await createTestUser();
    const reconciledAt = new Date(now.getTime() + 2 * DAY);
    await recordPurchase(user, purchase(), reconciledAt);

    const refund = notification(
      { refunded: true },
      { notificationId: "later-refund", signedAt: new Date(reconciledAt.getTime() + 60_000) }
    );

    expect(await applyStoreNotification(refund, now)).toMatchObject({ applied: true });
    expect(await tierOf(user, now)).toBe("free");
  });

  it("forgets notifications older than any store would resend", async () => {
    const user = await createTestUser();
    await recordPurchase(user, purchase(), now);

    await db.insert(storeNotifications).values({
      provider: "google_play",
      notificationId: "ancient",
      receivedAt: new Date(now.getTime() - (NOTIFICATION_RETENTION_DAYS + 1) * DAY)
    });

    await applyStoreNotification(
      notification({}, { notificationId: "current", signedAt: new Date(now.getTime() + DAY) }),
      now
    );

    const remaining = await db.select().from(storeNotifications);
    expect(remaining.map((row) => row.notificationId)).toEqual(["current"]);
  });
});
