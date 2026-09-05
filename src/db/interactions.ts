import { eq, and, inArray, isNull, sql } from "drizzle-orm";
import { db } from "./client";
import { likes, matches, blocks, virtualDateInvites } from "./schema";
import type { PassReasonId } from "@/lib/domain/taxonomies";
import { recordPassFeedback } from "./signal-weights";
import { likeAllowance } from "./entitlements";
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
 *
 * **Everything that decides the outcome runs inside that transaction.** Block
 * checks and the daily allowance were both read on the pool beforehand, which
 * made each of them a check-then-act across two connections: a block committed
 * in the gap did not stop the like that recreated the match, and fifty parallel
 * requests all read the same "one left". Both now run under the locks below,
 * where what they read is what the write sees.
 */

export type LikeKind = "like" | "pass" | "super_like";

export type LikeResult = {
  /** True when this action created a new match. */
  matched: boolean;
  matchId: string | null;
  /**
   * Set when the daily like allowance refused the action, in which case nothing
   * was written at all. Null on every path that recorded a decision — including
   * the ones that recorded it without matching, so `matched: false` alone never
   * has to carry two different meanings.
   */
  refusal: { reason: "like_limit_reached"; used: number; limit: number | null } | null;
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

/**
 * The per-member lock the daily allowance is counted under.
 *
 * Separate from the pair lock because the allowance is a property of the
 * *actor*, not of the pair: two likes from one member to two different people
 * take two different pair locks and would otherwise both read the same count.
 *
 * Taken before the pair lock, always and everywhere, so the acquisition order
 * is total and no two transactions can hold what the other is waiting for.
 */
function actorLockKey(userId: string): bigint {
  return advisoryLockKey(`like:${userId}`);
}

export async function recordLike(
  fromUserId: string,
  toUserId: string,
  kind: LikeKind,
  passReason?: PassReasonId,
  now: Date = new Date()
): Promise<LikeResult> {
  if (fromUserId === toUserId) {
    throw new Error("A member cannot like their own profile");
  }

  const [userAId, userBId] = orderPair(fromUserId, toUserId);

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${actorLockKey(fromUserId)})`);
    // Serialise both directions of this pair for the rest of the transaction.
    await tx.execute(sql`select pg_advisory_xact_lock(${pairLockKey(userAId, userBId)})`);

    // A block in either direction ends the interaction before it is stored.
    // Inside the lock, so a block that commits while this runs is either seen
    // here or waits for this to finish and then closes the match it made.
    if (await eitherBlocked(fromUserId, toUserId, tx)) {
      return { matched: false, matchId: null, refusal: null };
    }

    /**
     * The previous decision on this profile, if there is one.
     *
     * Read first because it answers two questions at once: whether the member
     * is *changing* their mind (which decides whether the pass feedback is new
     * information) and whether this action adds a row the allowance counts.
     */
    const prior = await tx
      .select({ kind: likes.kind })
      .from(likes)
      .where(and(eq(likes.fromUserId, fromUserId), eq(likes.toUserId, toUserId)))
      .limit(1);

    const priorKind = prior[0]?.kind ?? null;

    /**
     * The daily allowance, counted here rather than in the route.
     *
     * Passes never count — the limit exists to slow bulk liking, and charging
     * someone for saying no pushes them towards liking everything. Nor does
     * re-liking someone already liked: the row is already counted, so charging
     * again would bill twice for one person.
     */
    const spendsAllowance = kind !== "pass" && (priorKind === null || priorKind === "pass");
    if (spendsAllowance) {
      const allowance = await likeAllowance(fromUserId, now, tx);
      if (!allowance.allowed) {
        return {
          matched: false,
          matchId: null,
          refusal: {
            reason: "like_limit_reached" as const,
            used: allowance.used,
            limit: allowance.limit
          }
        };
      }
    }

    /**
     * A second look at a profile replaces the first decision rather than being
     * discarded.
     *
     * `onConflictDoNothing` reported success and kept the old row, so someone
     * who liked a profile and then passed on it stayed recorded as a like — and
     * when the other person liked them back, the two were matched on a decision
     * the member had already withdrawn. On a dating product that is the system
     * putting someone in front of a person they said no to, while telling them
     * their no was accepted.
     */
    await tx
      .insert(likes)
      .values({
        fromUserId,
        toUserId,
        kind,
        passReason: kind === "pass" ? (passReason ?? null) : null,
        createdAt: now
      })
      .onConflictDoUpdate({
        target: [likes.fromUserId, likes.toUserId],
        set: {
          kind,
          passReason: kind === "pass" ? (passReason ?? null) : null,
          // A new decision is a new act, and the allowance window measures acts.
          createdAt: now
        }
      });

    if (kind === "pass") {
      // Smart Match learns only from a reason the member chose to give. This
      // rides the same transaction as the pass, so the feed can never reflect
      // feedback for a pass that was rolled back.
      //
      // Only once per profile: re-passing someone already passed is the same
      // judgement stated twice, and counting it twice would let a member move
      // their own weights by tapping the same card repeatedly.
      if (passReason && priorKind !== "pass") {
        await recordPassFeedback(fromUserId, passReason, tx);
      }
      return { matched: false, matchId: null, refusal: null };
    }

    const reciprocal = await tx
      .select({ kind: likes.kind })
      .from(likes)
      .where(and(eq(likes.fromUserId, toUserId), eq(likes.toUserId, fromUserId)))
      .limit(1);

    const theyLikedBack = reciprocal[0] && reciprocal[0].kind !== "pass";
    if (!theyLikedBack) return { matched: false, matchId: null, refusal: null };

    const inserted = await tx
      .insert(matches)
      .values({ userAId, userBId })
      .onConflictDoNothing()
      .returning({ id: matches.id });

    if (inserted[0]) return { matched: true, matchId: inserted[0].id, refusal: null };

    /**
     * Either the other side won the race and already created the match, or the
     * pair matched before and a block closed it. A closed match is not reported
     * as a conversation the caller can open — it is unreachable by design, and
     * handing back its id would point the client at a thread that answers 404.
     */
    const existing = await tx
      .select({ id: matches.id })
      .from(matches)
      .where(
        and(
          eq(matches.userAId, userAId),
          eq(matches.userBId, userBId),
          isNull(matches.closedAt)
        )
      )
      .limit(1);

    return { matched: false, matchId: existing[0]?.id ?? null, refusal: null };
  });
}

export async function eitherBlocked(
  userA: string,
  userB: string,
  /**
   * The transaction to read inside, when the caller has one open. A block
   * committed by another connection is visible either way; what this buys is
   * that the caller's *own* lock is already held when the read happens.
   */
  executor: Pick<typeof db, "select"> = db
): Promise<boolean> {
  const rows = await executor
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

  const reverse = await executor
    .select({ blockerId: blocks.blockerId })
    .from(blocks)
    .where(and(eq(blocks.blockerId, userB), eq(blocks.blockedId, userA)))
    .limit(1);

  return reverse.length > 0;
}

/**
 * Blocking is immediate and mutual in effect: the match between the two is
 * closed, so neither can reach the other afterwards.
 *
 * **Closed, not deleted.** Deleting the match cascaded to its messages, and
 * report-then-block is the ordinary sequence — a member reports the message
 * that frightened them and blocks the sender in the next tap. The delete
 * destroyed the reported message and nulled the report's link to it, so what
 * reached the moderation queue was a reason code with no evidence behind it,
 * for exactly the reports most likely to matter. Closing keeps the record for
 * the people whose job is to read it while making the conversation unreachable
 * for both members, which is what blocking is actually for.
 *
 * Every read of `matches` filters on `closed_at is null`, so "unreachable" is
 * enforced where matches are resolved rather than by remembering to check.
 */
export async function blockUser(
  blockerId: string,
  blockedId: string,
  now: Date = new Date()
): Promise<void> {
  if (blockerId === blockedId) return;

  const [userAId, userBId] = orderPair(blockerId, blockedId);

  await db.transaction(async (tx) => {
    /**
     * The same pair lock `recordLike` takes, so the two serialise.
     *
     * Without it a like already past its block check could commit a match
     * *after* this closed the one it found, leaving an open match between two
     * people one of whom had just blocked the other.
     */
    await tx.execute(sql`select pg_advisory_xact_lock(${pairLockKey(userAId, userBId)})`);

    await tx.insert(blocks).values({ blockerId, blockedId }).onConflictDoNothing();

    const closed = await tx
      .update(matches)
      .set({ closedAt: now })
      .where(
        and(
          eq(matches.userAId, userAId),
          eq(matches.userBId, userBId),
          isNull(matches.closedAt)
        )
      )
      .returning({ id: matches.id });

    if (!closed[0]) return;

    /**
     * Invitations used to disappear with the match row. They survive a close,
     * so they are cancelled explicitly — an unanswered invitation from someone
     * you have blocked must not stay in your inbox, and an accepted date must
     * not stay on either calendar.
     */
    await tx
      .update(virtualDateInvites)
      .set({ status: "cancelled", respondedAt: now })
      .where(
        and(
          eq(virtualDateInvites.matchId, closed[0].id),
          inArray(virtualDateInvites.status, ["pending", "accepted"])
        )
      );
  });
}
