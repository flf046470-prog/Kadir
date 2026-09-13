import {
  MAX_ANSWER_LENGTH,
  TWO_TRUTHS_STATEMENT_COUNT,
  promptsFor,
  type GameId
} from "./prompts";

/**
 * Match Games — optional, lightweight games two matched members can play to get
 * a first conversation started.
 *
 * The property that matters most here is **fair reveal**: a member must not be
 * able to see their partner's answer before committing their own. That is
 * enforced by `viewFor`, which redacts the other side until both have answered,
 * rather than by the UI choosing not to render it. A client bug therefore
 * cannot leak an answer early.
 *
 * Games are always optional: either member can end a session at any point, and
 * declining is a normal outcome, not a penalty.
 */

export type PlayerSlot = "a" | "b";

export type RoundAnswer = {
  /** "a"/"b" for two-option games; free text for open ones. */
  value: string;
  answeredAt: string;
};

export type Round = {
  /** Prompt id from the bank, or a player-authored round for Two Truths. */
  promptId: string | null;
  /** Two Truths only: the statements the author wrote. */
  statements?: string[];
  /** Two Truths only: index of the lie. Never exposed before the guess. */
  lieIndex?: number;
  /** Two Truths only: which player authored this round. */
  authoredBy?: PlayerSlot;
  answers: Partial<Record<PlayerSlot, RoundAnswer>>;
};

export type GameStatus = "invited" | "active" | "completed" | "declined" | "ended";

export type GameSession = {
  id: string;
  game: GameId;
  status: GameStatus;
  rounds: Round[];
  /** Rounds to play before the session completes. */
  targetRounds: number;
};

const ALLOWED_TRANSITIONS: Record<GameStatus, GameStatus[]> = {
  invited: ["active", "declined"],
  active: ["completed", "ended"],
  completed: [],
  declined: [],
  ended: []
};

export function canTransition(from: GameStatus, to: GameStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

function otherSlot(slot: PlayerSlot): PlayerSlot {
  return slot === "a" ? "b" : "a";
}

/**
 * A round is revealed once every member who owes an answer has given one.
 *
 * For most games that means both. Two Truths is asymmetric: the author writes
 * the statements and only the *other* member guesses, so the round reveals as
 * soon as that guess lands.
 */
export function isRevealed(round: Round): boolean {
  if (round.authoredBy) return Boolean(round.answers[otherSlot(round.authoredBy)]);
  return Boolean(round.answers.a && round.answers.b);
}

/**
 * What `viewer` is allowed to see of a round right now. The partner's answer —
 * and, for Two Truths, which statement is the lie — is withheld until the
 * round is revealed.
 */
export type RoundView = {
  promptId: string | null;
  statements?: string[];
  /** Present only after reveal. */
  lieIndex?: number;
  ownAnswer: RoundAnswer | null;
  partnerAnswer: RoundAnswer | null;
  revealed: boolean;
};

export function viewFor(round: Round, viewer: PlayerSlot): RoundView {
  const revealed = isRevealed(round);
  const view: RoundView = {
    promptId: round.promptId,
    ownAnswer: round.answers[viewer] ?? null,
    partnerAnswer: revealed ? (round.answers[otherSlot(viewer)] ?? null) : null,
    revealed
  };

  if (round.statements) view.statements = round.statements;
  // The lie is the whole game — hidden from the guesser until reveal. The
  // author wrote it, so withholding it from them would be pointless.
  const viewerIsAuthor = round.authoredBy === viewer;
  if ((revealed || viewerIsAuthor) && round.lieIndex !== undefined) {
    view.lieIndex = round.lieIndex;
  }

  return view;
}

export type AnswerResult =
  | { ok: true; session: GameSession }
  | {
      ok: false;
      reason:
        | "not_active"
        | "no_such_round"
        | "already_answered"
        | "invalid_answer"
        | "author_cannot_guess";
    };

/**
 * Records an answer. Returns a new session rather than mutating, so callers
 * can't accidentally share state between requests.
 */
export function submitAnswer(
  session: GameSession,
  roundIndex: number,
  player: PlayerSlot,
  value: string
): AnswerResult {
  if (session.status !== "active") return { ok: false, reason: "not_active" };

  const round = session.rounds[roundIndex];
  if (!round) return { ok: false, reason: "no_such_round" };
  if (round.answers[player]) return { ok: false, reason: "already_answered" };
  // The author already knows the lie; letting them "guess" would fake a reveal.
  if (round.authoredBy === player) return { ok: false, reason: "author_cannot_guess" };
  if (!isValidAnswer(session.game, round, value)) return { ok: false, reason: "invalid_answer" };

  const rounds = session.rounds.map((existing, index) =>
    index === roundIndex
      ? {
          ...existing,
          answers: {
            ...existing.answers,
            [player]: { value, answeredAt: new Date().toISOString() }
          }
        }
      : existing
  );

  const allDone =
    rounds.length >= session.targetRounds && rounds.every((candidate) => isRevealed(candidate));

  return {
    ok: true,
    session: { ...session, rounds, status: allDone ? "completed" : session.status }
  };
}

function isValidAnswer(game: GameId, round: Round, value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;

  if (game === "this_or_that" || game === "would_you_rather") {
    return trimmed === "a" || trimmed === "b";
  }

  if (game === "two_truths") {
    // The guess is a statement index.
    const index = Number(trimmed);
    return (
      Number.isInteger(index) &&
      index >= 0 &&
      index < (round.statements?.length ?? TWO_TRUTHS_STATEMENT_COUNT)
    );
  }

  return trimmed.length <= MAX_ANSWER_LENGTH;
}

/**
 * Picks prompts for a new session, skipping any the pair has already played so
 * a rematch doesn't repeat itself. Selection is seeded so a session is stable
 * if the request is retried.
 */
export function pickPrompts(
  game: GameId,
  count: number,
  alreadyPlayed: ReadonlySet<string>,
  seed: number
): string[] {
  const bank = promptsFor(game).filter((id) => !alreadyPlayed.has(id));
  if (bank.length === 0) return [];

  const picked: string[] = [];
  const remaining = [...bank];
  let cursor = Math.abs(seed);

  while (picked.length < count && remaining.length > 0) {
    cursor = (cursor * 1103515245 + 12345) >>> 0;
    const [id] = remaining.splice(cursor % remaining.length, 1);
    picked.push(id);
  }

  return picked;
}

export type TwoTruthsResult =
  | { ok: true; round: Round }
  | { ok: false; reason: "wrong_statement_count" | "invalid_lie_index" | "empty_statement" };

/** Builds a Two Truths round, validating the author's submission. */
export function createTwoTruthsRound(
  statements: string[],
  lieIndex: number,
  authoredBy: PlayerSlot
): TwoTruthsResult {
  if (statements.length !== TWO_TRUTHS_STATEMENT_COUNT) {
    return { ok: false, reason: "wrong_statement_count" };
  }
  if (statements.some((statement) => statement.trim().length === 0)) {
    return { ok: false, reason: "empty_statement" };
  }
  if (!Number.isInteger(lieIndex) || lieIndex < 0 || lieIndex >= statements.length) {
    return { ok: false, reason: "invalid_lie_index" };
  }

  return {
    ok: true,
    round: {
      promptId: null,
      statements: statements.map((statement) => statement.trim().slice(0, MAX_ANSWER_LENGTH)),
      lieIndex,
      authoredBy,
      answers: {}
    }
  };
}
