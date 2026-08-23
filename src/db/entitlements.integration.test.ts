import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { boosts, likes, referralRewards, subscriptions } from "./schema";
import { createTestUser, resetDatabase } from "./test-helpers";
import {
  boostedUserIds,
  currentBoost,
  entitlementsOf,
  likeAllowance,
  startBoost,
  tierOf,
  tiersOf
} from "./entitlements";
import { walletFor } from "./referral";
import { ENTITLEMENTS } from "@/lib/billing/tiers";

const DAY_MS = 86_400_000;

beforeEach(async () => {
  await resetDatabase();
});

async function subscribe(
  userId: string,
  tier: "plus" | "vip",
  options: { status?: string; endsInDays?: number } = {}
) {
  await db.insert(subscriptions).values({
    userId,
    tier,
    status: options.status ?? "active",
    currentPeriodEnd: new Date(Date.now() + (options.endsInDays ?? 30) * DAY_MS)
  });
}

describe("resolving a tier", () => {
  it("treats a member with no subscription as free", async () => {
    const user = await createTestUser();
    expect(await tierOf(user)).toBe("free");
    expect((await entitlementsOf(user)).entitlements.advancedFilters).toBe(false);
  });

  it("grants the paid tier's entitlements", async () => {
    const user = await createTestUser();
    await subscribe(user, "vip");

    const access = await entitlementsOf(user);
    expect(access.tier).toBe("vip");
    expect(access.entitlements).toEqual(ENTITLEMENTS.vip);
  });

  it("falls back to free once the paid period has passed, whatever the row says", async () => {
    const user = await createTestUser();
    // The webhook that should have expired this never arrived.
    await subscribe(user, "vip", { status: "active", endsInDays: -1 });

    expect(await tierOf(user)).toBe("free");
  });

  it("keeps access after cancelling until the period ends", async () => {
    const user = await createTestUser();
    await subscribe(user, "plus", { status: "canceled", endsInDays: 10 });

    expect(await tierOf(user)).toBe("plus");
  });

  it("resolves a whole feed in one query", async () => {
    const free = await createTestUser();
    const plus = await createTestUser();
    const vip = await createTestUser();
    await subscribe(plus, "plus");
    await subscribe(vip, "vip");

    const tiers = await tiersOf([free, plus, vip]);

    expect(tiers.get(free)).toBe("free");
    expect(tiers.get(plus)).toBe("plus");
    expect(tiers.get(vip)).toBe("vip");
  });

  it("defaults unknown members to free rather than dropping them", async () => {
    const user = await createTestUser();
    const tiers = await tiersOf([user]);
    expect(tiers.get(user)).toBe("free");
  });
});

describe("the daily like allowance", () => {
  async function spendLikes(userId: string, howMany: number, kind = "like") {
    for (let i = 0; i < howMany; i++) {
      const target = await createTestUser();
      await db.insert(likes).values({ fromUserId: userId, toUserId: target, kind });
    }
  }

  it("allows a free member up to their limit", async () => {
    const user = await createTestUser();
    await spendLikes(user, ENTITLEMENTS.free.dailyLikes! - 1);

    const allowance = await likeAllowance(user);
    expect(allowance.allowed).toBe(true);
    expect(allowance.limit).toBe(ENTITLEMENTS.free.dailyLikes);
  });

  it("stops them at it", async () => {
    const user = await createTestUser();
    await spendLikes(user, ENTITLEMENTS.free.dailyLikes!);

    expect((await likeAllowance(user)).allowed).toBe(false);
  });

  it("never counts a pass against it", async () => {
    const user = await createTestUser();
    await spendLikes(user, ENTITLEMENTS.free.dailyLikes!, "pass");

    const allowance = await likeAllowance(user);
    expect(allowance.allowed).toBe(true);
    expect(allowance.used).toBe(0);
  });

  it("counts super likes, which are likes", async () => {
    const user = await createTestUser();
    await spendLikes(user, 3, "super_like");

    expect((await likeAllowance(user)).used).toBe(3);
  });

  it("rolls off after twenty-four hours rather than at a calendar boundary", async () => {
    const user = await createTestUser();
    await spendLikes(user, ENTITLEMENTS.free.dailyLikes!);

    const target = await createTestUser();
    await db.insert(likes).values({ fromUserId: user, toUserId: target, kind: "like" });
    // Age everything past the window.
    await db
      .update(likes)
      .set({ createdAt: new Date(Date.now() - DAY_MS - 60_000) })
      .where(eq(likes.fromUserId, user));

    const allowance = await likeAllowance(user);
    expect(allowance.used).toBe(0);
    expect(allowance.allowed).toBe(true);
  });

  it("gives a paid member more, and VIP no limit at all", async () => {
    const plus = await createTestUser();
    const vip = await createTestUser();
    await subscribe(plus, "plus");
    await subscribe(vip, "vip");

    expect((await likeAllowance(plus)).limit).toBe(ENTITLEMENTS.plus.dailyLikes);
    expect(await likeAllowance(vip)).toEqual({ allowed: true, used: 0, limit: null });
  });
});

describe("boost", () => {
  async function giveBoost(userId: string, howMany = 1) {
    await db.insert(referralRewards).values(
      Array.from({ length: howMany }, () => ({ userId, rewardId: "boost", quantity: 1 }))
    );
  }

  it("refuses when there is nothing to spend", async () => {
    const user = await createTestUser();
    expect(await startBoost(user)).toEqual({ ok: false, reason: "none_available" });
    expect(await currentBoost(user)).toBeNull();
  });

  it("spends one boost from the reward ledger and starts running", async () => {
    const user = await createTestUser();
    await giveBoost(user);

    const result = await startBoost(user);

    expect(result.ok).toBe(true);
    expect(await walletFor(user)).toEqual([]);
    expect(await currentBoost(user)).not.toBeNull();
  });

  it("runs for the tier's duration", async () => {
    const free = await createTestUser();
    const vip = await createTestUser();
    await subscribe(vip, "vip");
    await giveBoost(free);
    await giveBoost(vip);

    const now = new Date();
    const freeResult = await startBoost(free, now);
    const vipResult = await startBoost(vip, now);

    if (!freeResult.ok || !vipResult.ok) throw new Error("expected both to start");
    expect(freeResult.expiresAt.getTime() - now.getTime()).toBe(
      ENTITLEMENTS.free.boostMinutes * 60_000
    );
    expect(vipResult.expiresAt.getTime()).toBeGreaterThan(freeResult.expiresAt.getTime());
  });

  it("refuses a second boost while one is running, and charges nothing for the attempt", async () => {
    const user = await createTestUser();
    await giveBoost(user, 2);
    await startBoost(user);

    expect(await startBoost(user)).toEqual({ ok: false, reason: "already_running" });
    // The second boost is still in the wallet, not silently burned.
    expect(await walletFor(user)).toEqual([
      { rewardId: "boost", quantity: 1, trialDays: null }
    ]);
  });

  it("lets another one start once the first has expired", async () => {
    const user = await createTestUser();
    await giveBoost(user, 2);
    await startBoost(user);

    await db
      .update(boosts)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(boosts.userId, user));

    expect((await startBoost(user)).ok).toBe(true);
  });

  it("keeps the expired row, so 'did my boost run?' is answerable", async () => {
    const user = await createTestUser();
    await giveBoost(user);
    await startBoost(user);
    await db
      .update(boosts)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(boosts.userId, user));

    expect(await currentBoost(user)).toBeNull();
    expect(await db.select().from(boosts).where(eq(boosts.userId, user))).toHaveLength(1);
  });

  it("reports only the members whose boost is live", async () => {
    const running = await createTestUser();
    const lapsed = await createTestUser();
    const never = await createTestUser();
    await giveBoost(running);
    await giveBoost(lapsed);
    await startBoost(running);
    await startBoost(lapsed);
    await db
      .update(boosts)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(boosts.userId, lapsed));

    const boosted = await boostedUserIds([running, lapsed, never]);

    expect(boosted.has(running)).toBe(true);
    expect(boosted.has(lapsed)).toBe(false);
    expect(boosted.has(never)).toBe(false);
  });

  it("starts exactly one boost when two requests race, and charges once", async () => {
    const user = await createTestUser();
    await giveBoost(user, 2);

    // A double-click. Without a lock both calls find nothing running, take
    // different reward rows, and both insert — two boosts spent on one window.
    const results = await Promise.all([startBoost(user), startBoost(user)]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await db.select().from(boosts).where(eq(boosts.userId, user))).toHaveLength(1);
    expect(await walletFor(user)).toEqual([
      { rewardId: "boost", quantity: 1, trialDays: null }
    ]);
  });

  it("survives four at once", async () => {
    const user = await createTestUser();
    await giveBoost(user, 4);

    const results = await Promise.all([
      startBoost(user),
      startBoost(user),
      startBoost(user),
      startBoost(user)
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await walletFor(user)).toEqual([
      { rewardId: "boost", quantity: 3, trialDays: null }
    ]);
  });
});
