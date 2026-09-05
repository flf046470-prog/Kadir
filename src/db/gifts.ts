import { and, asc, count, eq, gte } from "drizzle-orm";
import { db } from "./client";
import { gifts } from "./schema";
import { resolveMatchFor } from "./messaging";
import { entitlementsOf } from "./entitlements";
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
  now: Date = new Date()
): Promise<GiftAllowance> {
  const { entitlements } = await entitlementsOf(userId, now);
  const limit = entitlements.dailyGifts;
  if (limit === null) return { allowed: true, used: 0, limit: null };

  const rows = await db
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

  const allowance = await giftAllowance(userId, now);
  if (!allowance.allowed) return { ok: false, reason: "allowance_reached" };

  const [created] = await db
    .insert(gifts)
    .values({ matchId, senderId: userId, giftId, createdAt: now })
    .returning({ id: gifts.id });

  return { ok: true, giftRowId: created.id };
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
