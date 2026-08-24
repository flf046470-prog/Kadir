import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { gifts, subscriptions } from "./schema";
import { createTestUser, resetDatabase } from "./test-helpers";
import { recordLike } from "./interactions";
import { giftAllowance, listGifts, sendGift } from "./gifts";
import { ENTITLEMENTS } from "@/lib/billing/tiers";

const DAY_MS = 86_400_000;

beforeEach(async () => {
  await resetDatabase();
});

async function matchedPair() {
  const a = await createTestUser();
  const b = await createTestUser();
  await recordLike(a, b, "like");
  const result = await recordLike(b, a, "like");
  if (!result.matchId) throw new Error("expected a match");
  return { a, b, matchId: result.matchId };
}

describe("access control", () => {
  it("refuses a gift into a conversation that is not the sender's", async () => {
    const { matchId } = await matchedPair();
    const stranger = await createTestUser();

    expect(await sendGift(stranger, matchId, "rose")).toEqual({
      ok: false,
      reason: "not_a_match"
    });
    expect(await db.select().from(gifts)).toHaveLength(0);
  });

  it("refuses to list a conversation's gifts to a stranger", async () => {
    const { a, matchId } = await matchedPair();
    const stranger = await createTestUser();
    await sendGift(a, matchId, "rose");

    expect(await listGifts(stranger, matchId)).toBeNull();
  });
});

describe("sending", () => {
  it("delivers a gift to both sides of the conversation", async () => {
    const { a, b, matchId } = await matchedPair();

    expect((await sendGift(a, matchId, "rose")).ok).toBe(true);

    const forSender = await listGifts(a, matchId);
    const forRecipient = await listGifts(b, matchId);

    expect(forSender).toHaveLength(1);
    expect(forSender![0]!.mine).toBe(true);
    expect(forRecipient![0]!.mine).toBe(false);
    expect(forRecipient![0]!.giftId).toBe("rose");
  });

  it("refuses anything outside the catalogue, before it reaches a row", async () => {
    const { a, matchId } = await matchedPair();

    expect(await sendGift(a, matchId, "yacht")).toEqual({ ok: false, reason: "unknown_gift" });
    expect(await sendGift(a, matchId, "<script>")).toEqual({ ok: false, reason: "unknown_gift" });
    expect(await db.select().from(gifts)).toHaveLength(0);
  });

  it("keeps the conversation in timeline order", async () => {
    const { a, b, matchId } = await matchedPair();
    const base = Date.now() - 3 * 3_600_000;

    await sendGift(a, matchId, "coffee", new Date(base));
    await sendGift(b, matchId, "cake", new Date(base + 60_000));
    await sendGift(a, matchId, "star", new Date(base + 120_000));

    expect((await listGifts(a, matchId))!.map((gift) => gift.giftId)).toEqual([
      "coffee",
      "cake",
      "star"
    ]);
  });

  it("drops a retired gift rather than rendering a blank, and keeps the row", async () => {
    const { a, matchId } = await matchedPair();
    await sendGift(a, matchId, "rose");
    // A gift removed from the catalogue in a later release.
    await db.update(gifts).set({ giftId: "retired_gift" }).where(eq(gifts.matchId, matchId));

    expect(await listGifts(a, matchId)).toEqual([]);
    expect(await db.select().from(gifts)).toHaveLength(1);
  });
});

describe("the daily allowance", () => {
  it("lets a free member send up to their limit", async () => {
    const { a, matchId } = await matchedPair();
    const limit = ENTITLEMENTS.free.dailyGifts!;

    for (let i = 0; i < limit; i++) {
      expect((await sendGift(a, matchId, "rose")).ok).toBe(true);
    }

    expect(await sendGift(a, matchId, "rose")).toEqual({
      ok: false,
      reason: "allowance_reached"
    });
    expect(await db.select().from(gifts)).toHaveLength(limit);
  });

  it("rolls off after twenty-four hours", async () => {
    const { a, matchId } = await matchedPair();
    const limit = ENTITLEMENTS.free.dailyGifts!;
    for (let i = 0; i < limit; i++) await sendGift(a, matchId, "rose");

    await db
      .update(gifts)
      .set({ createdAt: new Date(Date.now() - DAY_MS - 60_000) })
      .where(eq(gifts.senderId, a));

    expect((await giftAllowance(a)).used).toBe(0);
    expect((await sendGift(a, matchId, "rose")).ok).toBe(true);
  });

  it("counts the sender's gifts across every conversation, not per match", async () => {
    const a = await createTestUser();
    const first = await createTestUser();
    const second = await createTestUser();

    await recordLike(a, first, "like");
    const matchOne = (await recordLike(first, a, "like")).matchId!;
    await recordLike(a, second, "like");
    const matchTwo = (await recordLike(second, a, "like")).matchId!;

    const limit = ENTITLEMENTS.free.dailyGifts!;
    for (let i = 0; i < limit; i++) await sendGift(a, matchOne, "rose");

    // The allowance is the member's, so a fresh conversation does not reset it.
    expect(await sendGift(a, matchTwo, "rose")).toEqual({
      ok: false,
      reason: "allowance_reached"
    });
  });

  it("gives a paid member more, and VIP no limit at all", async () => {
    const plus = await createTestUser();
    const vip = await createTestUser();
    for (const [userId, tier] of [
      [plus, "plus"],
      [vip, "vip"]
    ] as const) {
      await db.insert(subscriptions).values({
        userId,
        tier,
        status: "active",
        currentPeriodEnd: new Date(Date.now() + 30 * DAY_MS)
      });
    }

    expect((await giftAllowance(plus)).limit).toBe(ENTITLEMENTS.plus.dailyGifts);
    expect(await giftAllowance(vip)).toEqual({ allowed: true, used: 0, limit: null });
  });

  it("does not count gifts a partner sent against the member", async () => {
    const { a, b, matchId } = await matchedPair();
    const limit = ENTITLEMENTS.free.dailyGifts!;
    for (let i = 0; i < limit; i++) await sendGift(b, matchId, "rose");

    expect((await giftAllowance(a)).used).toBe(0);
    expect((await sendGift(a, matchId, "rose")).ok).toBe(true);
  });
});
