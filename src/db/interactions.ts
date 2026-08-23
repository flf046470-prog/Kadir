import { eq, and, sql } from "drizzle-orm";
import { db } from "./client";
import { likes, matches, blocks } from "./schema";
import type { PassReasonId } from "@/lib/domain/taxonomies";
import { recordPassFeedback } from "./signal-weights";
import { advisoryLockKey } from "./advisory-lock";

/**
 * Like / Pass / Super Like, and the match they can create.
 *
 * The hard problem here is the race when two members like each other at the
 * same instant. Under READ COMMITTED, neither transaction can see the other's
 * uncommitted like row, so both conclude "they haven't liked me back" and *no
 * match is created at all* — two people who liked each other never match. That
 * is worse than a duplicate, and invisible without a concurrency test.
 *
 * The fix is a transaction-scoped advisory lock keyed on the ordered pair, so
 * the two calls serialise: the second one waits, then reads the first one's
 * committed like and creates the match. The ordered `(user_a_id, user_b_id)`
 * unique index plus `onConflictDoNothing` remain as a second line of defence.
 */

export type LikeKind = "like" | "pass" | "super_like";

export type LikeResult = {
  /** True when this action created a new match. */
  matched: boolean;
  matchId: string | null;
};

/** Pair ordering, so a pair maps to exactly one row regardless of who acted. */
function orderPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/**
 * A stable signed 64-bit key for a pair, for `pg_advisory_xact_lock`.
 *
 * Derived from the *ordered* pair so both directions take the same lock. A
 * collision between unrelated pairs is harmless here — it would only make two
 * unrelated likes wait briefly on each other, never produce a wrong result.
 */
function pairLockKey(userAId: string, userBId: string): bigint {
  return advisoryLockKey(`${userAId}:${userBId}`);
}

export async function recordLike(
  fromUserId: string,
  toUserId: string,
  kind: LikeKind,
  passReason?: PassReasonId
): Promise<LikeResult> {
  if (fromUserId === toUserId) {
    throw new Error("A member cannot like their own profile");
  }

  // A block in either direction ends the interaction before it is stored.
  if (await eitherBlocked(fromUserId, toUserId)) {
    return { matched: false, matchId: null };
  }

  const [userAId, userBId] = orderPair(fromUserId, toUserId);

  return db.transaction(async (tx) => {
    // Serialise both directions of this pair for the rest of the transaction.
    await tx.execute(sql`select pg_advisory_xact_lock(${pairLockKey(userAId, userBId)})`);

    await tx
      .insert(likes)
      .values({
        fromUserId,
        toUserId,
        kind,
        passReason: kind === "pass" ? (passReason ?? null) : null
      })
      // Re-judging the same profile keeps the first decision rather than erroring.
      .onConflictDoNothing();

    if (kind === "pass") {
      // Smart Match learns only from a reason the member chose to give. This
      // rides the same transaction as the pass, so the feed can never reflect
      // feedback for a pass that was rolled back.
      if (passReason) await recordPassFeedback(fromUserId, passReason, tx);
      return { matched: false, matchId: null };
    }

    const reciprocal = await tx
      .select({ kind: likes.kind })
      .from(likes)
      .where(and(eq(likes.fromUserId, toUserId), eq(likes.toUserId, fromUserId)))
      .limit(1);

    const theyLikedBack = reciprocal[0] && reciprocal[0].kind !== "pass";
    if (!theyLikedBack) return { matched: false, matchId: null };

    const inserted = await tx
      .insert(matches)
      .values({ userAId, userBId })
      .onConflictDoNothing()
      .returning({ id: matches.id });

    if (inserted[0]) return { matched: true, matchId: inserted[0].id };

    // The other side won the race and already created the match. It exists, but
    // this call did not create it — so don't report a fresh match twice.
    const existing = await tx
      .select({ id: matches.id })
      .from(matches)
      .where(and(eq(matches.userAId, userAId), eq(matches.userBId, userBId)))
      .limit(1);

    return { matched: false, matchId: existing[0]?.id ?? null };
  });
}

export async function eitherBlocked(userA: string, userB: string): Promise<boolean> {
  const rows = await db
    .select({ blockerId: blocks.blockerId })
    .from(blocks)
    .where(
      and(
        eq(blocks.blockerId, userA),
        eq(blocks.blockedId, userB)
      )
    )
    .limit(1);

  if (rows.length > 0) return true;

  const reverse = await db
    .select({ blockerId: blocks.blockerId })
    .from(blocks)
    .where(and(eq(blocks.blockerId, userB), eq(blocks.blockedId, userA)))
    .limit(1);

  return reverse.length > 0;
}

/**
 * Blocking is immediate and mutual in effect: it removes any match between the
 * two, so neither can reach the other afterwards.
 */
export async function blockUser(blockerId: string, blockedId: string): Promise<void> {
  if (blockerId === blockedId) return;

  const [userAId, userBId] = orderPair(blockerId, blockedId);

  await db.transaction(async (tx) => {
    await tx.insert(blocks).values({ blockerId, blockedId }).onConflictDoNothing();
    await tx
      .delete(matches)
      .where(and(eq(matches.userAId, userAId), eq(matches.userBId, userBId)));
  });
}
