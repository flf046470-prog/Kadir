import { and, desc, eq, ne, sql, notExists } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "./client";
import { likes, blocks } from "./schema";
import { entitlementsOf } from "./entitlements";
import { advisoryLockKey } from "./advisory-lock";

/**
 * "Who liked you", and taking back a pass.
 *
 * Both read the same table from the opposite side to `interactions.ts`, and
 * both are paid surfaces, so they share a file and a set of rules:
 *
 *  - A like that has already been answered is not pending. Once the viewer has
 *    liked or passed on someone, the decision is made — a mutual like is
 *    already a match and belongs in Eşleşmeler, not in a list of people
 *    waiting for an answer.
 *  - A pass is never listed. Someone passing on you is not an invitation, and
 *    surfacing it would turn a private no into a notification.
 *  - The count is free; the names are not. Free and PLUS members are told how
 *    many people are waiting, because that is a true fact about their own
 *    account and an upsell that cannot show anything real reads as invented.
 */

const LIST_LIMIT = 50;

export type ReceivedLike = {
  userId: string;
  /** A super like is worth showing differently; the caller decides how. */
  superLike: boolean;
  likedAt: Date;
};

export type ReceivedLikes =
  | { locked: false; likes: ReceivedLike[]; total: number }
  | { locked: true; likes: []; total: number };

/**
 * Likes this member has received and not yet answered.
 *
 * The "not yet answered" and "not blocked" conditions are `not exists`
 * subqueries rather than post-filtering, so the limit applies to rows the
 * member can actually see. Filtering after the limit would return a short list
 * whenever the most recent fifty happened to be answered ones.
 */
export async function likesReceived(
  userId: string,
  now: Date = new Date()
): Promise<ReceivedLikes> {
  // The viewer's own row for the same pair, if they have already judged.
  const answered = alias(likes, "answered");

  const rows = await db
    .select({
      userId: likes.fromUserId,
      kind: likes.kind,
      likedAt: likes.createdAt
    })
    .from(likes)
    .where(
      and(
        eq(likes.toUserId, userId),
        // A pass is not a like, whatever the table is called.
        ne(likes.kind, "pass"),
        notExists(
          db
            .select({ one: sql`1` })
            .from(answered)
            .where(
              and(eq(answered.fromUserId, userId), eq(answered.toUserId, likes.fromUserId))
            )
        ),
        notExists(
          db
            .select({ one: sql`1` })
            .from(blocks)
            .where(
              sql`(${blocks.blockerId} = ${userId} and ${blocks.blockedId} = ${likes.fromUserId})
               or (${blocks.blockerId} = ${likes.fromUserId} and ${blocks.blockedId} = ${userId})`
            )
        )
      )
    )
    .orderBy(desc(likes.createdAt))
    .limit(LIST_LIMIT);

  const received: ReceivedLike[] = rows.map((row) => ({
    userId: row.userId,
    superLike: row.kind === "super_like",
    likedAt: row.likedAt
  }));

  const { entitlements } = await entitlementsOf(userId, now);
  if (!entitlements.seeWhoLikedYou) {
    return { locked: true, likes: [], total: received.length };
  }

  return { locked: false, likes: received, total: received.length };
}

export type UndoResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "not_entitled" | "nothing_to_undo" };

/**
 * Takes back the member's most recent pass.
 *
 * Only the most recent one, and only while it is still the most recent: undo
 * is a correction for the mis-tap that just happened, not a rewind through the
 * deck. Anything more would let someone re-judge a profile indefinitely, which
 * is the behaviour the daily like limit exists to bound.
 *
 * What undo does **not** do is un-learn. A pass with a reason nudges the
 * member's signal weights through a clamped, saturating function, so there is
 * no inverse that returns a state the account was ever actually in — computing
 * one would replace a real weight with a plausible-looking invented one. One
 * pass among many barely moves a clamped multiplier, so the honest behaviour
 * is to put the profile back in the deck and leave the learning alone.
 */
export async function undoLastPass(userId: string, now: Date = new Date()): Promise<UndoResult> {
  const { entitlements } = await entitlementsOf(userId, now);
  if (!entitlements.undoPass) return { ok: false, reason: "not_entitled" };

  return db.transaction(async (tx) => {
    /**
     * Serialise this member's undos. Without the lock a double-tap is two
     * calls that both read the same "most recent pass", and the second deletes
     * the one *behind* it — undoing two passes for one tap, silently.
     */
    await tx.execute(sql`select pg_advisory_xact_lock(${advisoryLockKey(`undo:${userId}`)})`);

    const latest = await tx
      .select({ toUserId: likes.toUserId })
      .from(likes)
      .where(and(eq(likes.fromUserId, userId), eq(likes.kind, "pass")))
      .orderBy(desc(likes.createdAt))
      .limit(1);

    const target = latest[0]?.toUserId;
    if (!target) return { ok: false as const, reason: "nothing_to_undo" as const };

    await tx
      .delete(likes)
      .where(and(eq(likes.fromUserId, userId), eq(likes.toUserId, target)));

    return { ok: true as const, userId: target };
  });
}
