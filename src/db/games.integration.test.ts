import { describe, expect, it, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { gameSessions } from "./schema";
import { createTestUser, resetDatabase } from "./test-helpers";
import { recordLike } from "./interactions";
import {
  answerRound,
  inviteToGame,
  loadSessionFor,
  sessionsForMatch,
  setSessionStatus,
  viewSession
} from "./games";

beforeEach(async () => {
  await resetDatabase();
});

/** Two members who have matched, plus a stranger who has not. */
async function matchedPair() {
  const a = await createTestUser();
  const b = await createTestUser();
  await recordLike(a, b, "like");
  const result = await recordLike(b, a, "like");
  if (!result.matchId) throw new Error("expected a match");
  return { a, b, matchId: result.matchId };
}

describe("access control", () => {
  it("lets either matched member open a game", async () => {
    const { a, matchId } = await matchedPair();
    const invite = await inviteToGame(a, matchId, "this_or_that");
    expect(invite.ok).toBe(true);
  });

  it("refuses a member who is not on the match", async () => {
    const { a, matchId } = await matchedPair();
    const stranger = await createTestUser();

    expect(await inviteToGame(stranger, matchId, "this_or_that")).toEqual({
      ok: false,
      reason: "not_matched"
    });

    const invite = await inviteToGame(a, matchId, "this_or_that");
    if (!invite.ok) throw new Error("setup failed");

    // Indistinguishable from "no such session" — an outsider learns nothing.
    expect(await loadSessionFor(invite.sessionId, stranger)).toBeNull();
  });

  it("allows only one open session per match", async () => {
    const { a, b, matchId } = await matchedPair();
    expect((await inviteToGame(a, matchId, "this_or_that")).ok).toBe(true);

    expect(await inviteToGame(b, matchId, "would_you_rather")).toEqual({
      ok: false,
      reason: "already_open"
    });
  });

  it("frees the match once a session is declined", async () => {
    const { a, b, matchId } = await matchedPair();
    const first = await inviteToGame(a, matchId, "this_or_that");
    if (!first.ok) throw new Error("setup failed");

    await setSessionStatus(first.sessionId, b, "declined");
    expect((await inviteToGame(b, matchId, "would_you_rather")).ok).toBe(true);
  });
});

describe("fair reveal", () => {
  it("hides a partner's answer until the viewer has answered too", async () => {
    const { a, b, matchId } = await matchedPair();
    const invite = await inviteToGame(a, matchId, "this_or_that");
    if (!invite.ok) throw new Error("setup failed");
    await setSessionStatus(invite.sessionId, b, "active");

    expect(await answerRound(invite.sessionId, a, 0, "a")).toMatchObject({ ok: true });

    // B has not answered: A's choice must not be in B's payload at all.
    const bAccess = await loadSessionFor(invite.sessionId, b);
    const bView = viewSession(bAccess!);
    expect(bView.rounds[0].partnerAnswer).toBeNull();
    expect(bView.rounds[0].revealed).toBe(false);
    expect(JSON.stringify(bView.rounds[0])).not.toContain("answeredAt");

    // Once B answers, both sides open.
    await answerRound(invite.sessionId, b, 0, "b");
    const revealed = viewSession((await loadSessionFor(invite.sessionId, b))!);
    expect(revealed.rounds[0].revealed).toBe(true);
    expect(revealed.rounds[0].partnerAnswer?.value).toBe("a");
  });

  it("refuses a second answer to the same round", async () => {
    const { a, b, matchId } = await matchedPair();
    const invite = await inviteToGame(a, matchId, "this_or_that");
    if (!invite.ok) throw new Error("setup failed");
    await setSessionStatus(invite.sessionId, b, "active");

    await answerRound(invite.sessionId, a, 0, "a");
    expect(await answerRound(invite.sessionId, a, 0, "b")).toEqual({
      ok: false,
      reason: "already_answered"
    });
  });

  it("rejects an answer outside the game's allowed values", async () => {
    const { a, b, matchId } = await matchedPair();
    const invite = await inviteToGame(a, matchId, "this_or_that");
    if (!invite.ok) throw new Error("setup failed");
    await setSessionStatus(invite.sessionId, b, "active");

    expect(await answerRound(invite.sessionId, a, 0, "c")).toEqual({
      ok: false,
      reason: "invalid_answer"
    });
  });

  it("will not take answers before the invite is accepted", async () => {
    const { a, matchId } = await matchedPair();
    const invite = await inviteToGame(a, matchId, "this_or_that");
    if (!invite.ok) throw new Error("setup failed");

    expect(await answerRound(invite.sessionId, a, 0, "a")).toEqual({
      ok: false,
      reason: "not_active"
    });
  });
});

describe("status transitions", () => {
  it("refuses a move the engine does not allow", async () => {
    const { a, b, matchId } = await matchedPair();
    const invite = await inviteToGame(a, matchId, "this_or_that");
    if (!invite.ok) throw new Error("setup failed");

    await setSessionStatus(invite.sessionId, b, "declined");
    // Declined is terminal — reopening would resurrect a game someone refused.
    expect(await setSessionStatus(invite.sessionId, b, "active")).toEqual({
      ok: false,
      reason: "illegal"
    });
  });

  it("completes once every round is revealed", async () => {
    const { a, b, matchId } = await matchedPair();
    const invite = await inviteToGame(a, matchId, "this_or_that");
    if (!invite.ok) throw new Error("setup failed");
    await setSessionStatus(invite.sessionId, b, "active");

    const access = await loadSessionFor(invite.sessionId, a);
    for (let i = 0; i < access!.session.rounds.length; i += 1) {
      await answerRound(invite.sessionId, a, i, "a");
      await answerRound(invite.sessionId, b, i, "b");
    }

    const rows = await db
      .select({ status: gameSessions.status })
      .from(gameSessions)
      .where(eq(gameSessions.id, invite.sessionId));
    expect(rows[0].status).toBe("completed");
  });
});

describe("prompt selection", () => {
  it("does not repeat prompts the pair has already played", async () => {
    const { a, b, matchId } = await matchedPair();

    const first = await inviteToGame(a, matchId, "this_or_that");
    if (!first.ok) throw new Error("setup failed");
    const firstPrompts = viewSession((await loadSessionFor(first.sessionId, a))!).rounds.map(
      (round) => round.promptId
    );

    await setSessionStatus(first.sessionId, b, "declined");

    const second = await inviteToGame(b, matchId, "this_or_that");
    if (!second.ok) throw new Error("setup failed");
    const secondPrompts = viewSession((await loadSessionFor(second.sessionId, b))!).rounds.map(
      (round) => round.promptId
    );

    expect(secondPrompts.filter((id) => firstPrompts.includes(id))).toEqual([]);
  });

  it("lists a match's sessions newest first, redacted per viewer", async () => {
    const { a, b, matchId } = await matchedPair();
    const invite = await inviteToGame(a, matchId, "this_or_that");
    if (!invite.ok) throw new Error("setup failed");
    await setSessionStatus(invite.sessionId, b, "active");
    await answerRound(invite.sessionId, a, 0, "a");

    const forB = await sessionsForMatch(matchId, b);
    expect(forB).toHaveLength(1);
    expect(forB[0].rounds[0].partnerAnswer).toBeNull();
    expect(forB[0].yourTurn).toBe(true);
  });
});
