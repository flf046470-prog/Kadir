import { describe, expect, it } from "vitest";
import {
  canTransition,
  createTwoTruthsRound,
  isRevealed,
  pickPrompts,
  submitAnswer,
  viewFor,
  type GameSession,
  type Round
} from "./session";
import { promptsFor, gameIds, MAX_ANSWER_LENGTH } from "./prompts";

function session(overrides: Partial<GameSession> = {}): GameSession {
  return {
    id: "s1",
    game: "this_or_that",
    status: "active",
    rounds: [{ promptId: "coffee_tea", answers: {} }],
    targetRounds: 1,
    ...overrides
  };
}

describe("fair reveal", () => {
  it("hides a partner's answer until both have answered", () => {
    let current = session();

    const first = submitAnswer(current, 0, "a", "a");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    current = first.session;

    // B has not answered yet, so A must not see anything of theirs.
    const aView = viewFor(current.rounds[0], "a");
    expect(aView.revealed).toBe(false);
    expect(aView.partnerAnswer).toBeNull();
    expect(aView.ownAnswer?.value).toBe("a");

    // And B must not be able to peek at A's committed answer.
    const bView = viewFor(current.rounds[0], "b");
    expect(bView.revealed).toBe(false);
    expect(bView.partnerAnswer).toBeNull();
  });

  it("reveals both answers once the second lands", () => {
    let current = session();
    const first = submitAnswer(current, 0, "a", "a");
    if (!first.ok) throw new Error("expected ok");
    const second = submitAnswer(first.session, 0, "b", "b");
    if (!second.ok) throw new Error("expected ok");
    current = second.session;

    const view = viewFor(current.rounds[0], "a");
    expect(view.revealed).toBe(true);
    expect(view.partnerAnswer?.value).toBe("b");
    expect(current.status).toBe("completed");
  });

  it("rejects answering the same round twice", () => {
    const first = submitAnswer(session(), 0, "a", "a");
    if (!first.ok) throw new Error("expected ok");

    const again = submitAnswer(first.session, 0, "a", "b");
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe("already_answered");
  });

  it("does not mutate the session it was given", () => {
    const original = session();
    submitAnswer(original, 0, "a", "a");
    expect(original.rounds[0].answers.a).toBeUndefined();
  });
});

describe("two truths and a lie", () => {
  function twoTruthsSession(): GameSession {
    const created = createTwoTruthsRound(
      ["I have been to Japan", "I speak four languages", "I once met a bear"],
      2,
      "a"
    );
    if (!created.ok) throw new Error("expected ok");

    return session({ game: "two_truths", rounds: [created.round], targetRounds: 1 });
  }

  it("hides the lie from the guesser but not the author", () => {
    const current = twoTruthsSession();
    const round = current.rounds[0];

    expect(viewFor(round, "b").lieIndex).toBeUndefined();
    expect(viewFor(round, "a").lieIndex).toBe(2);
  });

  it("reveals the lie to the guesser only after they guess", () => {
    const current = twoTruthsSession();
    const guessed = submitAnswer(current, 0, "b", "1");
    if (!guessed.ok) throw new Error("expected ok");

    const view = viewFor(guessed.session.rounds[0], "b");
    expect(view.revealed).toBe(true);
    expect(view.lieIndex).toBe(2);
    expect(view.ownAnswer?.value).toBe("1");
  });

  it("will not let the author guess their own round", () => {
    const result = submitAnswer(twoTruthsSession(), 0, "a", "0");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("author_cannot_guess");
  });

  it("rejects a guess outside the statement range", () => {
    const result = submitAnswer(twoTruthsSession(), 0, "b", "7");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_answer");
  });

  it("validates the author's submission", () => {
    expect(createTwoTruthsRound(["one", "two"], 0, "a").ok).toBe(false);
    expect(createTwoTruthsRound(["a", "b", "c"], 5, "a").ok).toBe(false);
    expect(createTwoTruthsRound(["a", "  ", "c"], 0, "a").ok).toBe(false);
  });
});

describe("answer validation", () => {
  it("only accepts a or b for two-option games", () => {
    const bad = submitAnswer(session(), 0, "a", "maybe");
    expect(bad.ok).toBe(false);

    const good = submitAnswer(session(), 0, "a", "b");
    expect(good.ok).toBe(true);
  });

  it("caps free-text answers", () => {
    const open = session({
      game: "quick_questions",
      rounds: [{ promptId: "best_trip", answers: {} }]
    });

    const tooLong = submitAnswer(open, 0, "a", "x".repeat(MAX_ANSWER_LENGTH + 1));
    expect(tooLong.ok).toBe(false);

    const fine = submitAnswer(open, 0, "a", "Kyoto in autumn");
    expect(fine.ok).toBe(true);
  });

  it("rejects blank answers", () => {
    const open = session({
      game: "quick_questions",
      rounds: [{ promptId: "best_trip", answers: {} }]
    });
    expect(submitAnswer(open, 0, "a", "   ").ok).toBe(false);
  });

  it("refuses answers on a session that is not active", () => {
    const invited = session({ status: "invited" });
    const result = submitAnswer(invited, 0, "a", "a");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_active");
  });
});

describe("session lifecycle", () => {
  it("allows declining an invite but not an active game", () => {
    expect(canTransition("invited", "declined")).toBe(true);
    expect(canTransition("active", "declined")).toBe(false);
  });

  it("lets either side end an active game", () => {
    expect(canTransition("active", "ended")).toBe(true);
  });

  it("treats finished states as terminal", () => {
    expect(canTransition("completed", "active")).toBe(false);
    expect(canTransition("declined", "active")).toBe(false);
    expect(canTransition("ended", "active")).toBe(false);
  });
});

describe("prompt selection", () => {
  it("never repeats a prompt the pair already played", () => {
    const played = new Set(["coffee_tea", "beach_mountains"]);
    const picked = pickPrompts("this_or_that", 5, played, 42);

    expect(picked).not.toContain("coffee_tea");
    expect(picked).not.toContain("beach_mountains");
  });

  it("returns no duplicates within one session", () => {
    const picked = pickPrompts("this_or_that", 8, new Set(), 7);
    expect(new Set(picked).size).toBe(picked.length);
  });

  it("is stable for the same seed so a retry is idempotent", () => {
    const first = pickPrompts("would_you_rather", 3, new Set(), 99);
    const second = pickPrompts("would_you_rather", 3, new Set(), 99);
    expect(first).toEqual(second);
  });

  it("returns fewer prompts rather than repeating when the bank runs low", () => {
    const bank = promptsFor("would_you_rather");
    const almostAll = new Set(bank.slice(0, bank.length - 2));
    const picked = pickPrompts("would_you_rather", 5, almostAll, 3);

    expect(picked.length).toBe(2);
    expect(new Set(picked).size).toBe(2);
  });

  it("gives every prompt-based game a non-empty bank", () => {
    for (const game of gameIds) {
      if (game === "two_truths") continue;
      expect(promptsFor(game).length).toBeGreaterThan(0);
    }
  });

  it("keeps prompt ids unique within each bank", () => {
    for (const game of gameIds) {
      const bank = promptsFor(game);
      expect(new Set(bank).size).toBe(bank.length);
    }
  });
});

describe("isRevealed", () => {
  it("needs both players for a symmetric round", () => {
    const round: Round = { promptId: "coffee_tea", answers: { a: { value: "a", answeredAt: "" } } };
    expect(isRevealed(round)).toBe(false);
  });

  it("needs only the guesser for an authored round", () => {
    const round: Round = {
      promptId: null,
      statements: ["x", "y", "z"],
      lieIndex: 0,
      authoredBy: "a",
      answers: { b: { value: "1", answeredAt: "" } }
    };
    expect(isRevealed(round)).toBe(true);
  });
});
