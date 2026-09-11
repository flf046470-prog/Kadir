import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "./client";
import { matchPresence } from "./schema";
import { createTestUser, resetDatabase } from "./test-helpers";
import { recordLike } from "./interactions";
import { presenceFor, touchPresence, TYPING_WINDOW_MS } from "./presence";

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
  it("refuses presence writes from someone not on the match", async () => {
    const { matchId } = await matchedPair();
    const stranger = await createTestUser();

    expect(await touchPresence(stranger, matchId, { typing: true })).toBe(false);
    expect(await db.select().from(matchPresence)).toHaveLength(0);
  });

  it("refuses presence reads from someone not on the match", async () => {
    const { a, matchId } = await matchedPair();
    const stranger = await createTestUser();

    await touchPresence(a, matchId, { typing: true });
    expect(await presenceFor(stranger, matchId)).toBeNull();
  });

  it("returns a quiet conversation rather than nothing when nobody has been present", async () => {
    const { a, matchId } = await matchedPair();

    expect(await presenceFor(a, matchId)).toEqual({
      partnerTyping: false,
      partnerLastSeenAt: null
    });
  });
});

describe("typing", () => {
  it("shows the partner typing, and never oneself", async () => {
    const { a, b, matchId } = await matchedPair();

    await touchPresence(a, matchId, { typing: true });

    expect((await presenceFor(b, matchId))?.partnerTyping).toBe(true);
    expect((await presenceFor(a, matchId))?.partnerTyping).toBe(false);
  });

  it("stops immediately when told to, rather than waiting out the window", async () => {
    const { a, b, matchId } = await matchedPair();

    await touchPresence(a, matchId, { typing: true });
    await touchPresence(a, matchId, { typing: false });

    expect((await presenceFor(b, matchId))?.partnerTyping).toBe(false);
  });

  it("expires on its own when the writer disappears mid-sentence", async () => {
    const { a, b, matchId } = await matchedPair();

    await touchPresence(a, matchId, { typing: true });
    // They closed the tab. Nothing runs to clean up after them.
    await db
      .update(matchPresence)
      .set({ typingAt: new Date(Date.now() - TYPING_WINDOW_MS - 1000) })
      .where(and(eq(matchPresence.matchId, matchId), eq(matchPresence.userId, a)));

    expect((await presenceFor(b, matchId))?.partnerTyping).toBe(false);
  });

  it("leaves the indicator alone on a plain heartbeat", async () => {
    const { a, b, matchId } = await matchedPair();

    await touchPresence(a, matchId, { typing: true });
    // A poll that says "still here" must not silently stop the indicator.
    await touchPresence(a, matchId);

    expect((await presenceFor(b, matchId))?.partnerTyping).toBe(true);
  });

  it("keeps a heartbeat from restarting an indicator that was stopped", async () => {
    const { a, b, matchId } = await matchedPair();

    await touchPresence(a, matchId, { typing: false });
    await touchPresence(a, matchId);

    expect((await presenceFor(b, matchId))?.partnerTyping).toBe(false);
  });
});

describe("last seen", () => {
  it("records when the partner last had the conversation open", async () => {
    const { a, b, matchId } = await matchedPair();

    const before = Date.now();
    await touchPresence(a, matchId);
    const presence = await presenceFor(b, matchId);

    expect(presence?.partnerLastSeenAt).not.toBeNull();
    expect(presence!.partnerLastSeenAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("keeps one row per member however often they ping", async () => {
    const { a, matchId } = await matchedPair();

    for (let i = 0; i < 5; i++) await touchPresence(a, matchId, { typing: true });

    const rows = await db.select().from(matchPresence).where(eq(matchPresence.matchId, matchId));
    expect(rows).toHaveLength(1);
  });

  it("tracks the two members separately", async () => {
    const { a, b, matchId } = await matchedPair();

    await touchPresence(a, matchId, { typing: true });
    await touchPresence(b, matchId, { typing: false });

    expect((await presenceFor(b, matchId))?.partnerTyping).toBe(true);
    expect((await presenceFor(a, matchId))?.partnerTyping).toBe(false);
    expect(await db.select().from(matchPresence)).toHaveLength(2);
  });
});
