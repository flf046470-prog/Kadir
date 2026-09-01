import { and, count, desc, eq, gt, gte, inArray, sql } from "drizzle-orm";
import { db } from "./client";
import { boostGrants, boosts, likes, subscriptions, translationUsage } from "./schema";
import { advisoryLockKey } from "./advisory-lock";
import { spendReward } from "./referral";
import {
  activeTier,
  entitlementsFor,
  type Entitlements,
  type SubscriptionStatus,
  type Tier
} from "@/lib/billing/tiers";

/**
 * What a member may do, resolved from what they have paid for.
 *
 * Every gate in the app goes through `entitlementsOf`. Reading the
 * subscription row directly from a route would be how one feature ends up
 * checking `tier === "vip"` while another checks the entitlement, and they
 * drift the first time pricing changes.
 *
 * Boost deliberately spends from the referral reward ledger rather than from a
 * second wallet of its own. A boost is a boost regardless of whether it was
 * earned by inviting a friend or bought outright, and two parallel balances
 * would eventually disagree about how many someone has.
 */

export type MemberAccess = {
  tier: Tier;
  entitlements: Entitlements;
};

export async function tierOf(userId: string, now: Date = new Date()): Promise<Tier> {
  const rows = await db
    .select({
      tier: subscriptions.tier,
      status: subscriptions.status,
      currentPeriodEnd: subscriptions.currentPeriodEnd
    })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);

  const row = rows[0];
  if (!row) return "free";

  return activeTier(
    {
      tier: row.tier as Tier,
      status: row.status as SubscriptionStatus,
      currentPeriodEnd: row.currentPeriodEnd
    },
    now
  );
}

export async function entitlementsOf(userId: string, now?: Date): Promise<MemberAccess> {
  const tier = await tierOf(userId, now);
  return { tier, entitlements: entitlementsFor(tier) };
}

/** Tiers for several members at once, for ranking a whole feed. */
export async function tiersOf(
  userIds: string[],
  now: Date = new Date()
): Promise<Map<string, Tier>> {
  const result = new Map<string, Tier>(userIds.map((id) => [id, "free"]));
  if (userIds.length === 0) return result;

  const rows = await db
    .select({
      userId: subscriptions.userId,
      tier: subscriptions.tier,
      status: subscriptions.status,
      currentPeriodEnd: subscriptions.currentPeriodEnd
    })
    .from(subscriptions)
    .where(inArray(subscriptions.userId, userIds));

  for (const row of rows) {
    result.set(
      row.userId,
      activeTier(
        {
          tier: row.tier as Tier,
          status: row.status as SubscriptionStatus,
          currentPeriodEnd: row.currentPeriodEnd
        },
        now
      )
    );
  }

  return result;
}

export type LikeAllowance = {
  allowed: boolean;
  used: number;
  /** null when the tier has no limit. */
  limit: number | null;
};

/**
 * How many likes are left today.
 *
 * A rolling 24 hours rather than a calendar day, because a calendar day means
 * a member in Auckland and a member in Los Angeles get their allowance back at
 * different local times, and whichever timezone the server picks is wrong for
 * most of the world.
 *
 * Passes do not count. The limit exists to slow bulk liking, and penalising
 * someone for saying no would push them towards liking everything, which is
 * the behaviour it is meant to discourage.
 */
export async function likeAllowance(
  userId: string,
  now: Date = new Date()
): Promise<LikeAllowance> {
  const { entitlements } = await entitlementsOf(userId, now);
  const limit = entitlements.dailyLikes;
  if (limit === null) return { allowed: true, used: 0, limit: null };

  const since = new Date(now.getTime() - 24 * 3_600_000);

  const rows = await db
    .select({ total: count() })
    .from(likes)
    .where(
      and(
        eq(likes.fromUserId, userId),
        gte(likes.createdAt, since),
        sql`${likes.kind} <> 'pass'`
      )
    );

  const used = rows[0]?.total ?? 0;
  return { allowed: used < limit, used, limit };
}

/**
 * How many translations are left today.
 *
 * The same rolling window as likes, for the same reason: a calendar day resets
 * at a different local hour for every member, and whichever timezone the server
 * picks is wrong for most of the world.
 *
 * What is counted is translations *bought from the provider*, recorded by
 * `translateConversation` when it writes a new cache row. Re-reading a
 * conversation costs nothing and so costs nothing here — a member who scrolls
 * back through yesterday's messages is not spending today's allowance.
 */
export async function translationAllowance(
  userId: string,
  now: Date = new Date()
): Promise<LikeAllowance> {
  const { entitlements } = await entitlementsOf(userId, now);
  const limit = entitlements.dailyTranslations;
  if (limit === null) return { allowed: true, used: 0, limit: null };

  const since = new Date(now.getTime() - 24 * 3_600_000);

  const rows = await db
    .select({ total: count() })
    .from(translationUsage)
    .where(and(eq(translationUsage.userId, userId), gte(translationUsage.createdAt, since)));

  const used = rows[0]?.total ?? 0;
  return { allowed: used < limit, used, limit };
}

/** Members whose Boost is running right now. */
export async function boostedUserIds(
  candidateIds: string[],
  now: Date = new Date()
): Promise<Set<string>> {
  if (candidateIds.length === 0) return new Set();

  const rows = await db
    .select({ userId: boosts.userId })
    .from(boosts)
    .where(and(inArray(boosts.userId, candidateIds), gt(boosts.expiresAt, now)));

  return new Set(rows.map((row) => row.userId));
}

/**
 * The calendar month a grant belongs to, as `YYYY-MM` in UTC.
 *
 * UTC rather than the member's local month so the key is stable: deriving it
 * from a device clock would let someone in one timezone claim December's
 * credit twice by crossing a boundary.
 */
function monthKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type BoostResult =
  | { ok: true; expiresAt: Date }
  | { ok: false; reason: "already_running" | "none_available" };

/**
 * Starts a Boost, paid for out of the member's reward ledger.
 *
 * Refuses while one is already running rather than queueing or stacking.
 * Stacking would let someone spend three boosts for ninety minutes of the same
 * thirty-minute advantage, and silently consuming the second one to extend the
 * first is not what "buy a boost" means to the person pressing the button.
 */
export async function startBoost(userId: string, now: Date = new Date()): Promise<BoostResult> {
  const { entitlements } = await entitlementsOf(userId, now);

  return db.transaction(async (tx) => {
    /**
     * Serialise this member's boosts for the rest of the transaction.
     *
     * Without it a double-click is two calls that both find no boost running,
     * both take a *different* reward row (the spend uses `skip locked`, so
     * they do not contend), and both insert — charging twice for one
     * thirty-minute window. The "already running" check is only a guard if
     * nothing can start one between the check and the insert.
     */
    await tx.execute(sql`select pg_advisory_xact_lock(${advisoryLockKey(`boost:${userId}`)})`);

    const running = await tx
      .select({ id: boosts.id })
      .from(boosts)
      .where(and(eq(boosts.userId, userId), gt(boosts.expiresAt, now)))
      .limit(1);

    if (running[0]) return { ok: false as const, reason: "already_running" as const };

    /**
     * Pay from the subscription's monthly credit first, then the referral
     * ledger.
     *
     * That order matters: the monthly credit expires at the end of the month
     * and a referral reward does not, so spending the perishable one first is
     * the only ordering that never destroys value the member earned. VIP's
     * sixty-minute Boost was unreachable before this — `startBoost` paid only
     * from referral rewards, so a VIP who had never referred anyone could not
     * start one at all, and `boostMinutes: 60` described something that could
     * not happen.
     *
     * The insert is the claim. `boost_grants` is keyed on (user, month), so a
     * second attempt in the same month inserts nothing and returns no rows —
     * idempotent without a read-then-write, and safe under the advisory lock
     * above even if it were not.
     */
    let paid = false;

    if (entitlements.monthlyBoostCredits > 0) {
      const claimed = await tx
        .insert(boostGrants)
        .values({ userId, period: monthKey(now) })
        .onConflictDoNothing()
        .returning({ period: boostGrants.period });

      paid = claimed.length > 0;
    }

    // Spend, then grant, in that order and in one transaction: if the insert
    // failed after a spend outside a transaction the member would have paid
    // for nothing, and granting first would hand out free boosts on any error.
    if (!paid) paid = await spendReward(userId, "boost", tx);
    if (!paid) return { ok: false as const, reason: "none_available" as const };

    const expiresAt = new Date(now.getTime() + entitlements.boostMinutes * 60_000);
    await tx.insert(boosts).values({ userId, startedAt: now, expiresAt });

    return { ok: true as const, expiresAt };
  });
}

/** The member's running Boost, if any. */
export async function currentBoost(
  userId: string,
  now: Date = new Date()
): Promise<{ expiresAt: Date } | null> {
  const rows = await db
    .select({ expiresAt: boosts.expiresAt })
    .from(boosts)
    .where(and(eq(boosts.userId, userId), gt(boosts.expiresAt, now)))
    .orderBy(desc(boosts.expiresAt))
    .limit(1);

  return rows[0] ?? null;
}
