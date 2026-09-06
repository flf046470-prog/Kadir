import { and, asc, count, eq, gte, sql } from "drizzle-orm";
import { db } from "./client";
import { gifts } from "./schema";
import { resolveMatchFor } from "./messaging";
import { entitlementsOf, type Executor } from "./entitlements";
import { advisoryLockKey } from "./advisory-lock";
import { isGiftId, type GiftId } from "@/lib/gifts/catalogue";

/**
 * Gifts in a conversation.
 *
 * Membership goes through `resolveMatchFor`, the same single gate messages and
 * presence use, so a gift cannot be sent into — or read out of — a conversation
 * that is not the caller's.
 *
 * The allowance is per rolling day rather than per calendar day, for the reason
 * the like limit is: a calendar day hands members in different timezones their
 * allowance back at different local times, and whichever one the server picks
 * is wrong for most of the world.
 */

export type SentGift = {
  id: string;
  giftId: GiftId;
  senderId: string;
  mine: boolean;
  createdAt: Date;
};

export type GiftAllowance = {
  allowed: boolean;
  used: number;
  /** null when the tier has no limit. */
  limit: number | null;
};

export async function giftAllowance(
  userId: string,
  now: Date = new Date(),
  /**
   * The transaction to count inside, when the caller has one open.
   *
   * `sendGift` passes its own `tx`. Counting on the pool from inside an open
   * transaction reads a different connection, which cannot see the row that
   * transaction has already written — so parallel sends each read the same
   * "one left" and each spent it. Reaches `entitlementsOf` too, so a charging
   * transaction never asks the pool for a second connection while holding its
   * first; see `db/pool.integration.test.ts`.
   */
  executor: Executor = db
): Promise<GiftAllowance> {
  const { entitlements } = await entitlementsOf(userId, now, executor);
  const limit = entitlements.dailyGifts;
  if (limit === null) return { allowed: true, used: 0, limit: null };

  const rows = await executor
    .select({ total: count() })
    .from(gifts)
    .where(
      and(
        eq(gifts.senderId, userId),
        gte(gifts.createdAt, new Date(now.getTime() - 24 * 3_600_000))
      )
    );

  const used = rows[0]?.total ?? 0;
  return { allowed: used < limit, used, limit };
}

export type SendGiftResult =
  | { ok: true; giftRowId: string }
  | { ok: false; reason: "not_a_match" | "unknown_gift" | "allowance_reached" };

export async function sendGift(
  userId: string,
  matchId: string,
  giftId: string,
  now: Date = new Date()
): Promise<SendGiftResult> {
  const match = await resolveMatchFor(userId, matchId);
  if (!match) return { ok: false, reason: "not_a_match" };

  // Validated against the catalogue before it reaches a row, so the column can
  // never hold something the UI has no way to render.
  if (!isGiftId(giftId)) return { ok: false, reason: "unknown_gift" };

  return db.transaction(async (tx) => {
    /**
     * The count and the insert are one step.
     *
     * They were two, on two connections: the allowance was read, then the row
     * was written, with nothing between them holding the answer still. The
     * route allows twenty sends a minute and the free tier allows three a day,
     * so twenty parallel requests each read "three left" and each sent one —
     * a limit a subscription is sold to raise, stepped over by anyone willing
     * to open twenty sockets. The same defect the like allowance had, in the
     * same shape, and it is worth naming rather than quietly fixing: this is
     * what a check-then-act across two connections always costs.
     */
    await tx.execute(sql`select pg_advisory_xact_lock(${advisoryLockKey(`gift:${userId}`)})`);

    const allowance = await giftAllowance(userId, now, tx);
    if (!allowance.allowed) return { ok: false as const, reason: "allowance_reached" as const };

    const [created] = await tx
      .insert(gifts)
      .values({ matchId, senderId: userId, giftId, createdAt: now })
      .returning({ id: gifts.id });

    return { ok: true as const, giftRowId: created.id };
  });
}

/** A conversation's gifts, oldest first. Null when the match is not the caller's. */
export async function listGifts(userId: string, matchId: string): Promise<SentGift[] | null> {
  const match = await resolveMatchFor(userId, matchId);
  if (!match) return null;

  const rows = await db
    .select({
      id: gifts.id,
      giftId: gifts.giftId,
      senderId: gifts.senderId,
      createdAt: gifts.createdAt
    })
    .from(gifts)
    .where(eq(gifts.matchId, matchId))
    .orderBy(asc(gifts.createdAt));

  return rows
    // A row whose id left the catalogue (a gift retired between releases) is
    // dropped rather than rendered blank. It stays in the database.
    .filter((row) => isGiftId(row.giftId))
    .map((row) => ({
      id: row.id,
      giftId: row.giftId as GiftId,
      senderId: row.senderId,
      mine: row.senderId === userId,
      createdAt: row.createdAt
    }));
}
