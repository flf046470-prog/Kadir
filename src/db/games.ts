import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "./client";
import { gameSessions, matches } from "./schema";
import {
  canTransition,
  pickPrompts,
  submitAnswer,
  viewFor,
  type GameSession,
  type GameStatus,
  type PlayerSlot,
  type Round,
  type RoundView
} from "@/lib/games/session";
import { gameIds, type GameId } from "@/lib/games/prompts";

/**
 * Match Games — persistence and access control.
 *
 * The engine is a pure function over a session, so everything that could leak
 * an answer or let a stranger play lives here:
 *
 *  - **Only the two matched members may touch a session.** Membership is
 *    resolved from the match row on every call, never taken from the request.
 *  - **Fair reveal survives the database.** Rows are read back through
 *    `viewFor`, so a partner's answer is redacted on the way out. A UI bug
 *    cannot show what the server never sent.
 *  - **Slots come from the match's ordered pair**, so "a" means the same
 *    member on every read, in every session, forever.
 */

/** Rounds per session. Short enough to finish in one sitting. */
export const DEFAULT_TARGET_ROUNDS = 5;

export type SessionAccess = {
  session: GameSession;
  matchId: string;
  /** Which slot the requesting member occupies. */
  slot: PlayerSlot;
  partnerId: string;
  status: GameStatus;
};

function parseRounds(raw: string): Round[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Round[]) : [];
  } catch {
    // A corrupt row must not take the whole match's game list down.
    return [];
  }
}

function isGameId(value: string): value is GameId {
  return (gameIds as string[]).includes(value);
}

/**
 * Resolves a session together with the caller's place in it.
 *
 * Returns null both when the session does not exist and when the caller is not
 * one of the two members — an outsider learns nothing about which it was.
 */
export async function loadSessionFor(
  sessionId: string,
  userId: string
): Promise<SessionAccess | null> {
  const rows = await db
    .select({
      id: gameSessions.id,
      matchId: gameSessions.matchId,
      game: gameSessions.game,
      status: gameSessions.status,
      targetRounds: gameSessions.targetRounds,
      rounds: gameSessions.rounds,
      userAId: matches.userAId,
      userBId: matches.userBId
    })
    .from(gameSessions)
    .innerJoin(matches, eq(matches.id, gameSessions.matchId))
    .where(eq(gameSessions.id, sessionId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.userAId !== userId && row.userBId !== userId) return null;
  if (!isGameId(row.game)) return null;

  const slot: PlayerSlot = row.userAId === userId ? "a" : "b";

  return {
    session: {
      id: row.id,
      game: row.game,
      status: row.status as GameStatus,
      rounds: parseRounds(row.rounds),
      targetRounds: row.targetRounds
    },
    matchId: row.matchId,
    slot,
    partnerId: slot === "a" ? row.userBId : row.userAId,
    status: row.status as GameStatus
  };
}

/** The prompts this pair has already seen, so a rematch does not repeat. */
async function playedPrompts(matchId: string): Promise<Set<string>> {
  const rows = await db
    .select({ rounds: gameSessions.rounds })
    .from(gameSessions)
    .where(eq(gameSessions.matchId, matchId));

  const seen = new Set<string>();
  for (const row of rows) {
    for (const round of parseRounds(row.rounds)) {
      if (round.promptId) seen.add(round.promptId);
    }
  }
  return seen;
}

export type InviteResult =
  | { ok: true; sessionId: string }
  | { ok: false; reason: "not_matched" | "already_open" | "no_prompts_left" };

/**
 * Opens an invite on a match.
 *
 * One open session per match at a time: two games running side by side would
 * make "your turn" meaningless, and the UI has nowhere sensible to put them.
 */
export async function inviteToGame(
  userId: string,
  matchId: string,
  game: GameId
): Promise<InviteResult> {
  const matchRows = await db
    .select({ userAId: matches.userAId, userBId: matches.userBId })
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);

  const match = matchRows[0];
  if (!match) return { ok: false, reason: "not_matched" };
  if (match.userAId !== userId && match.userBId !== userId) {
    return { ok: false, reason: "not_matched" };
  }

  const open = await db
    .select({ id: gameSessions.id })
    .from(gameSessions)
    .where(
      and(eq(gameSessions.matchId, matchId), inArray(gameSessions.status, ["invited", "active"]))
    )
    .limit(1);
  if (open[0]) return { ok: false, reason: "already_open" };

  // Two Truths rounds are authored by the players, so there is no prompt bank
  // to draw from — the session starts empty and rounds arrive as they write.
  const rounds: Round[] =
    game === "two_truths"
      ? []
      : pickPrompts(game, DEFAULT_TARGET_ROUNDS, await playedPrompts(matchId), Date.now()).map(
          (promptId) => ({ promptId, answers: {} })
        );

  if (game !== "two_truths" && rounds.length === 0) {
    return { ok: false, reason: "no_prompts_left" };
  }

  const inserted = await db
    .insert(gameSessions)
    .values({
      matchId,
      invitedBy: userId,
      game,
      status: "invited",
      targetRounds: DEFAULT_TARGET_ROUNDS,
      rounds: JSON.stringify(rounds)
    })
    .returning({ id: gameSessions.id });

  return { ok: true, sessionId: inserted[0].id };
}

export type TransitionResult = { ok: true } | { ok: false; reason: "not_found" | "illegal" };

/**
 * Moves a session's status.
 *
 * The legal moves come from the engine, so "declined can be reopened" cannot
 * become true here without becoming true there — one place decides.
 */
export async function setSessionStatus(
  sessionId: string,
  userId: string,
  next: GameStatus
): Promise<TransitionResult> {
  const access = await loadSessionFor(sessionId, userId);
  if (!access) return { ok: false, reason: "not_found" };
  if (!canTransition(access.status, next)) return { ok: false, reason: "illegal" };

  await db
    .update(gameSessions)
    .set({ status: next, updatedAt: new Date() })
    .where(eq(gameSessions.id, sessionId));

  return { ok: true };
}

export type AnswerOutcome =
  | { ok: true; status: GameStatus }
  | { ok: false; reason: string };

/** Records one answer, through the engine, and persists the result. */
export async function answerRound(
  sessionId: string,
  userId: string,
  roundIndex: number,
  value: string
): Promise<AnswerOutcome> {
  const access = await loadSessionFor(sessionId, userId);
  if (!access) return { ok: false, reason: "not_found" };

  const result = submitAnswer(access.session, roundIndex, access.slot, value);
  if (!result.ok) return { ok: false, reason: result.reason };

  await db
    .update(gameSessions)
    .set({
      rounds: JSON.stringify(result.session.rounds),
      status: result.session.status,
      updatedAt: new Date()
    })
    .where(eq(gameSessions.id, sessionId));

  return { ok: true, status: result.session.status };
}

export type SessionView = {
  id: string;
  game: GameId;
  status: GameStatus;
  targetRounds: number;
  /** Redacted per viewer — a partner's answer is absent until reveal. */
  rounds: RoundView[];
  /** True when it is this member's move on at least one round. */
  yourTurn: boolean;
};

/** A session as one member is allowed to see it. */
export function viewSession(access: SessionAccess): SessionView {
  const rounds = access.session.rounds.map((round) => viewFor(round, access.slot));

  return {
    id: access.session.id,
    game: access.session.game,
    status: access.session.status,
    targetRounds: access.session.targetRounds,
    rounds,
    yourTurn: access.status === "active" && rounds.some((round) => round.ownAnswer === null)
  };
}

/** Every session on a match, newest first, redacted for this viewer. */
export async function sessionsForMatch(matchId: string, userId: string): Promise<SessionView[]> {
  const rows = await db
    .select({ id: gameSessions.id })
    .from(gameSessions)
    .where(eq(gameSessions.matchId, matchId))
    .orderBy(desc(gameSessions.createdAt));

  const views: SessionView[] = [];
  for (const row of rows) {
    const access = await loadSessionFor(row.id, userId);
    if (access) views.push(viewSession(access));
  }
  return views;
}
