import { describe, expect, it } from "vitest";
import { refusalFor, toLocalInputValue, REFUSAL_MESSAGE_KEYS } from "./client";
import { INVITE_TTL_DAYS } from "./rules";

/**
 * Turning a refused request into something a member can act on.
 *
 * The server is careful about *why* it refused — whose allowance ran out, which
 * ceiling was hit, whether the invitation was theirs to answer — and all of that
 * is thrown away by a screen that says "something went wrong". These tests are
 * about keeping the distinctions the API went to the trouble of making.
 */

describe("refusalFor", () => {
  it("keeps the two sides of an exhausted allowance apart", () => {
    expect(refusalFor(402, { error: "no_dates_left", who: "you", limit: 5 })).toEqual({
      key: "errors.noDatesLeftYou",
      values: { limit: 5 }
    });

    expect(refusalFor(402, { error: "no_dates_left", who: "them", limit: 5 })).toEqual({
      key: "errors.noDatesLeftThem",
      values: { limit: 5 }
    });
  });

  /**
   * Invite-time refusals carry no `who` — there is only one allowance being
   * checked — so the member's own is the right assumption.
   */
  it("reads a refusal without a side as the member's own", () => {
    expect(refusalFor(402, { error: "no_dates_left", limit: 30 })).toEqual({
      key: "errors.noDatesLeftYou",
      values: { limit: 30 }
    });
  });

  /**
   * An unlimited tier cannot run out, so a missing ceiling is not a number to
   * render as "0 of undefined" — it is a sentence without a number in it.
   */
  it("does not quote a ceiling the server did not send", () => {
    expect(refusalFor(402, { error: "no_dates_left", who: "you" })).toEqual({
      key: "errors.noDatesLeftYouPlain"
    });
    expect(refusalFor(402, { error: "no_dates_left", who: "them" })).toEqual({
      key: "errors.noDatesLeftThemPlain"
    });
  });

  it.each([
    ["not_found", "errors.notFound"],
    ["not_yours", "errors.notYours"],
    ["already_pending", "errors.alreadyPending"],
    ["already_answered", "errors.alreadyAnswered"],
    ["expired", "errors.expired"],
    ["unknown_environment", "errors.unknownEnvironment"],
    ["environment_locked", "errors.environmentLocked"],
    ["scheduled_in_the_past", "errors.scheduledInThePast"],
    ["rate_limited", "errors.rateLimited"]
  ])("explains %s", (error, key) => {
    expect(refusalFor(409, { error })).toEqual({ key });
  });

  /**
   * The one refusal that has to quote a rule. Taking the number from the rule
   * rather than writing it into two translations is what stops "at most 7 days"
   * surviving a change to `INVITE_TTL_DAYS`.
   */
  it("quotes the invitation's own lifetime when a date is set beyond it", () => {
    expect(refusalFor(400, { error: "scheduled_too_far" })).toEqual({
      key: "errors.scheduledTooFar",
      values: { days: INVITE_TTL_DAYS }
    });
  });

  /**
   * A 401 is answered from the status rather than the body: the session ended,
   * and telling someone their invitation failed would send them looking for a
   * problem with the invitation.
   */
  it("reads an expired session from the status alone", () => {
    expect(refusalFor(401, { error: "unauthorized" })).toEqual({ key: "errors.signedOut" });
    expect(refusalFor(401, null)).toEqual({ key: "errors.signedOut" });
  });

  it("falls back to something honest for anything unrecognised", () => {
    expect(refusalFor(500, null)).toEqual({ key: "errors.unexpected" });
    expect(refusalFor(500, { error: "kaboom" })).toEqual({ key: "errors.unexpected" });
    // A malformed body is a bug on our side, not a rule the member broke.
    expect(refusalFor(400, { error: "invalid_body" })).toEqual({ key: "errors.unexpected" });
  });

  /**
   * The bounds on the date picker are built from this, and the value the input
   * wants is local wall-clock time rather than UTC. Getting that wrong offsets
   * "the earliest time you may choose" by the reader's whole timezone.
   */
  it("formats a moment the way the date input reads it", () => {
    expect(toLocalInputValue(new Date(2026, 8, 12, 19, 30))).toBe("2026-09-12T19:30");
    // Single-digit months, days, hours and minutes all need padding.
    expect(toLocalInputValue(new Date(2026, 0, 5, 7, 4))).toBe("2026-01-05T07:04");
  });

  /** Every key the mapper can produce is one `copy.test.ts` then checks exists. */
  it("produces only keys it declares", () => {
    const produced = [
      refusalFor(404, { error: "not_found" }),
      refusalFor(402, { error: "no_dates_left", who: "them", limit: 5 }),
      refusalFor(402, { error: "no_dates_left" }),
      refusalFor(401, null),
      refusalFor(500, null)
    ];

    for (const message of produced) expect(REFUSAL_MESSAGE_KEYS).toContain(message.key);
  });
});
