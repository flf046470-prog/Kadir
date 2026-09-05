import { describe, expect, it } from "vitest";
import { TIERS, ageInHours, conversationAllowance, limitForAge } from "./new-account";

/**
 * The cheapest scam signal there is: how many strangers a young account is
 * reaching, and nothing about what it said to them.
 *
 * The tests below are mostly about the two ways this feature fails. Set too
 * tight, it punishes the honest majority who merely joined recently and
 * produces support tickets from people who did nothing wrong. Left permanent,
 * it does the same thing forever. Both are worse than the abuse it prevents,
 * so the ladder and its expiry are what is pinned here.
 */

describe("the cap for an account's age", () => {
  it("is tightest on the first day", () => {
    expect(limitForAge(0)).toBe(10);
    expect(limitForAge(23)).toBe(10);
  });

  it("loosens after a day", () => {
    expect(limitForAge(25)).toBe(25);
    expect(limitForAge(24 * 6)).toBe(25);
  });

  /**
   * The expiry is the point. A permanent throttle costs the honest majority
   * far more than it costs an operation that can simply wait a week.
   */
  it("stops applying once the account is a week old", () => {
    expect(limitForAge(24 * 7)).toBeNull();
    expect(limitForAge(24 * 30)).toBeNull();
  });

  /**
   * A clock skew or a seeded row dated in the future must not be the way
   * around the limit. Treating a negative age as brand new is the direction
   * that fails safe.
   */
  it("treats a future creation date as brand new, not as unlimited", () => {
    expect(limitForAge(-100)).toBe(10);
  });

  it("never tightens as the account gets older", () => {
    const caps = [0, 12, 24, 48, 24 * 6, 24 * 7, 24 * 60].map(limitForAge);
    for (let i = 1; i < caps.length; i++) {
      const previous = caps[i - 1];
      const current = caps[i];
      if (previous === null) expect(current).toBeNull();
      else if (current !== null) expect(current).toBeGreaterThanOrEqual(previous);
    }
  });

  /**
   * Ten conversations on a first day is already an unusual amount of dating,
   * and hundreds is what a bulk operation needs to be worth running. The whole
   * feature lives in that gap, so a cap set near the bottom of it would be the
   * change that starts costing real members.
   */
  it("leaves a first day roomy enough for an enthusiastic real person", () => {
    expect(TIERS[0].maxNewConversations).toBeGreaterThanOrEqual(10);
  });
});

describe("the allowance", () => {
  it("allows a new member who has started a few", () => {
    const allowance = conversationAllowance({ accountAgeHours: 2, startedLastDay: 3 });
    expect(allowance).toEqual({ limit: 10, used: 3, allowed: true });
  });

  it("refuses once the day's conversations are spent", () => {
    expect(conversationAllowance({ accountAgeHours: 2, startedLastDay: 10 }).allowed).toBe(false);
  });

  it("allows the tenth and refuses the eleventh", () => {
    expect(conversationAllowance({ accountAgeHours: 2, startedLastDay: 9 }).allowed).toBe(true);
    expect(conversationAllowance({ accountAgeHours: 2, startedLastDay: 10 }).allowed).toBe(false);
  });

  it("stops limiting an established account however many it starts", () => {
    const allowance = conversationAllowance({
      accountAgeHours: 24 * 40,
      startedLastDay: 500
    });
    expect(allowance.limit).toBeNull();
    expect(allowance.allowed).toBe(true);
  });
});

describe("account age", () => {
  it("is measured in hours from the creation date", () => {
    const now = new Date("2027-03-01T12:00:00.000Z");
    expect(ageInHours(new Date("2027-03-01T09:00:00.000Z"), now)).toBe(3);
    expect(ageInHours(new Date("2027-02-28T12:00:00.000Z"), now)).toBe(24);
  });
});
