import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "./client";
import { likes, profiles, referralRewards, referrals, users } from "./schema";
import { createTestUser, resetDatabase } from "./test-helpers";
import {
  attachReferral,
  codeFor,
  evaluateReferral,
  referralOverview,
  referrerForCode,
  spendReward,
  walletFor
} from "./referral";
import { MAX_REWARDED_REFERRALS_PER_MONTH } from "@/lib/referral/rewards";

beforeEach(async () => {
  await resetDatabase();
});

const DAY_MS = 86_400_000;

/**
 * A referral is only decided once it is old enough to have qualified, so tests
 * that expect an outcome evaluate from a week after signup rather than from the
 * instant of it.
 */
const A_WEEK_LATER = new Date(Date.now() + 7 * DAY_MS);

/** Everything qualification asks for: both verifications, a finished profile, activity. */
async function makeQualified(userId: string, activeDays = 3) {
  await db
    .update(users)
    .set({ emailVerifiedAt: new Date(), phoneVerifiedAt: new Date() })
    .where(eq(users.id, userId));

  await db.update(profiles).set({ completedAt: new Date() }).where(eq(profiles.userId, userId));

  // Activity is counted as distinct UTC days on which they acted, so the likes
  // land on separate days rather than merely being numerous.
  for (let day = 0; day < activeDays; day++) {
    const target = await createTestUser();
    await db.insert(likes).values({
      fromUserId: userId,
      toUserId: target,
      kind: "like",
      createdAt: new Date(Date.now() - (day + 1) * DAY_MS)
    });
  }
}

describe("codes", () => {
  it("mints one code per member and returns the same one afterwards", async () => {
    const user = await createTestUser();

    const first = await codeFor(user);
    const second = await codeFor(user);

    expect(first).toHaveLength(8);
    expect(second).toBe(first);
  });

  it("gives different members different codes", async () => {
    const [a, b] = [await createTestUser(), await createTestUser()];
    expect(await codeFor(a)).not.toBe(await codeFor(b));
  });

  it("resolves a code typed with confusable characters", async () => {
    const user = await createTestUser();
    const code = await codeFor(user);

    // Someone reading a code aloud says "oh" for zero and "ell" for one.
    const mistyped = code.replace(/0/g, "O").replace(/1/g, "l").toLowerCase();

    expect(await referrerForCode(mistyped)).toBe(user);
  });

  it("resolves nothing for a code nobody owns", async () => {
    expect(await referrerForCode("ZZZZZZZZ")).toBeNull();
    expect(await referrerForCode("nonsense")).toBeNull();
  });
});

describe("attaching a referral", () => {
  it("records who referred a new member", async () => {
    const referrer = await createTestUser();
    const referee = await createTestUser();

    expect(await attachReferral(referee, await codeFor(referrer))).toBe("recorded");

    const rows = await db.select().from(referrals).where(eq(referrals.refereeId, referee));
    expect(rows[0]?.referrerId).toBe(referrer);
    expect(rows[0]?.outcome).toBe("pending_qualification");
  });

  it("refuses a member's own code without burning their one referral", async () => {
    const user = await createTestUser();
    const friend = await createTestUser();

    expect(await attachReferral(user, await codeFor(user))).toBe("self_referral");
    // The mistake must not block a genuine referral afterwards.
    expect(await attachReferral(user, await codeFor(friend))).toBe("recorded");
  });

  it("refuses a second referral for the same member", async () => {
    const first = await createTestUser();
    const second = await createTestUser();
    const referee = await createTestUser();

    expect(await attachReferral(referee, await codeFor(first))).toBe("recorded");
    expect(await attachReferral(referee, await codeFor(second))).toBe("already_referred");

    const rows = await db.select().from(referrals).where(eq(referrals.refereeId, referee));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.referrerId).toBe(first);
  });

  it("survives two tabs racing the same signup", async () => {
    const referrer = await createTestUser();
    const referee = await createTestUser();
    const code = await codeFor(referrer);

    const outcomes = await Promise.all([
      attachReferral(referee, code),
      attachReferral(referee, code)
    ]);

    expect(outcomes.filter((outcome) => outcome === "recorded")).toHaveLength(1);
    expect(await db.select().from(referrals).where(eq(referrals.refereeId, referee))).toHaveLength(1);
  });

  it("tells apart a malformed code and an unclaimed one", async () => {
    const referee = await createTestUser();
    expect(await attachReferral(referee, "nope")).toBe("invalid_code");
    expect(await attachReferral(referee, "ZZZZZZZZ")).toBe("unknown_code");
  });
});

describe("qualification", () => {
  it("pays nothing at signup", async () => {
    const referrer = await createTestUser();
    const referee = await createTestUser();
    await attachReferral(referee, await codeFor(referrer));

    const decision = await evaluateReferral(referee, A_WEEK_LATER);

    expect(decision?.outcome).toBe("pending_qualification");
    expect(await walletFor(referrer)).toEqual([]);
  });

  it("grants once the referee verifies, completes and actually uses the product", async () => {
    const referrer = await createTestUser();
    const referee = await createTestUser();
    await attachReferral(referee, await codeFor(referrer));

    await makeQualified(referee);
    const decision = await evaluateReferral(referee, A_WEEK_LATER);

    expect(decision?.outcome).toBe("granted");
    expect(await walletFor(referrer)).toEqual([
      { rewardId: "super_like", quantity: 1, trialDays: null }
    ]);
  });

  it("holds back a referee who verified but never used the product", async () => {
    const referrer = await createTestUser();
    const referee = await createTestUser();
    await attachReferral(referee, await codeFor(referrer));

    await makeQualified(referee, 0);
    expect((await evaluateReferral(referee, A_WEEK_LATER))?.outcome).toBe("pending_qualification");
    expect(await walletFor(referrer)).toEqual([]);
  });

  it("counts active days, not actions — ten likes in one day is one day", async () => {
    const referrer = await createTestUser();
    const referee = await createTestUser();
    await attachReferral(referee, await codeFor(referrer));

    await db.update(users).set({ emailVerifiedAt: new Date(), phoneVerifiedAt: new Date() }).where(eq(users.id, referee));
    await db.update(profiles).set({ completedAt: new Date() }).where(eq(profiles.userId, referee));

    for (let i = 0; i < 10; i++) {
      const target = await createTestUser();
      await db.insert(likes).values({
        fromUserId: referee,
        toUserId: target,
        kind: "like",
        createdAt: new Date(Date.UTC(2026, 6, 1, 8 + i))
      });
    }

    expect((await evaluateReferral(referee, A_WEEK_LATER))?.outcome).toBe("pending_qualification");
  });

  it("never pays twice for the same referral", async () => {
    const referrer = await createTestUser();
    const referee = await createTestUser();
    await attachReferral(referee, await codeFor(referrer));
    await makeQualified(referee);

    await evaluateReferral(referee, A_WEEK_LATER);
    await evaluateReferral(referee, A_WEEK_LATER);
    await evaluateReferral(referee, A_WEEK_LATER);

    expect(await walletFor(referrer)).toEqual([
      { rewardId: "super_like", quantity: 1, trialDays: null }
    ]);
  });

  it("pays once when two evaluations race", async () => {
    const referrer = await createTestUser();
    const referee = await createTestUser();
    await attachReferral(referee, await codeFor(referrer));
    await makeQualified(referee);

    await Promise.all([evaluateReferral(referee, A_WEEK_LATER), evaluateReferral(referee, A_WEEK_LATER)]);

    const rows = await db.select().from(referralRewards).where(eq(referralRewards.userId, referrer));
    expect(rows).toHaveLength(1);
  });

  it("walks the reward ladder across successive referrals", async () => {
    const referrer = await createTestUser();
    const code = await codeFor(referrer);

    for (let i = 0; i < 3; i++) {
      const referee = await createTestUser();
      await attachReferral(referee, code);
      await makeQualified(referee);
      await evaluateReferral(referee, A_WEEK_LATER);
    }

    const wallet = await walletFor(referrer);
    const byId = Object.fromEntries(wallet.map((entry) => [entry.rewardId, entry]));

    expect(byId.super_like?.quantity).toBe(1);
    expect(byId.boost?.quantity).toBe(1);
    expect(byId.premium_trial?.trialDays).toBe(14);
  });
});

describe("being new is not suspicious", () => {
  /**
   * Regression. A referee who signed up moments ago has zero active days, which
   * is a fraud signal worth 0.4 — enough, alongside any ordinary second signal,
   * to clear the reject threshold. Deciding at signup therefore rejected honest
   * referrals outright, and a rejection is never revisited.
   */
  it("does not reject a referral for being minutes old", async () => {
    const referrer = await createTestUser();
    const code = await codeFor(referrer);

    // A referrer whose link did well today: enough signups in the hour to raise
    // the burst signal, which is exactly when the old bug fired.
    const referees: string[] = [];
    for (let i = 0; i < 12; i++) {
      const referee = await createTestUser();
      await attachReferral(referee, code);
      referees.push(referee);
    }

    const newest = referees[referees.length - 1]!;
    const rows = await db.select().from(referrals).where(eq(referrals.refereeId, newest));
    expect(rows[0]?.outcome).toBe("pending_qualification");

    // And a referrer refreshing their screen must not decide it either.
    await referralOverview(referrer, { baseUrl: "https://fiorematch.test", locale: "en" });

    const after = await db.select().from(referrals).where(eq(referrals.refereeId, newest));
    expect(after[0]?.outcome).toBe("pending_qualification");
    expect(after[0]?.decidedAt).toBeNull();
  });

  it("decides it once it is old enough to have qualified", async () => {
    const referrer = await createTestUser();
    const referee = await createTestUser();
    await attachReferral(referee, await codeFor(referrer));
    await makeQualified(referee);

    expect((await evaluateReferral(referee))?.outcome).toBe("pending_qualification");
    expect((await evaluateReferral(referee, A_WEEK_LATER))?.outcome).toBe("granted");
  });
});

describe("fraud handling", () => {
  it("holds a circular pair for review rather than paying it", async () => {
    const a = await createTestUser();
    const b = await createTestUser();

    await attachReferral(b, await codeFor(a));
    await attachReferral(a, await codeFor(b));

    await makeQualified(b);
    const decision = await evaluateReferral(b, A_WEEK_LATER);

    expect(decision?.outcome).toBe("held_for_review");
    expect(decision?.signals.map((signal) => signal.id)).toContain("circular_referral");
    expect(await walletFor(a)).toEqual([]);
  });

  it("holds a burst of signups from one referrer", async () => {
    const referrer = await createTestUser();
    const code = await codeFor(referrer);
    const at = new Date(Date.UTC(2026, 7, 1, 12));

    // Twelve inside one hour. The burst weight climbs with the count, and it
    // takes about a dozen to reach the review threshold on its own — five is
    // where the signal starts, not where it becomes damning.
    const referees: string[] = [];
    for (let i = 0; i < 12; i++) {
      const referee = await createTestUser();
      await attachReferral(referee, code);
      await db
        .update(referrals)
        .set({ signedUpAt: new Date(at.getTime() + i * 60_000) })
        .where(eq(referrals.refereeId, referee));
      referees.push(referee);
    }

    const last = referees[referees.length - 1];
    await makeQualified(last);

    const decision = await evaluateReferral(last, A_WEEK_LATER);
    expect(decision?.outcome).toBe("held_for_review");
    expect(decision?.signals.map((signal) => signal.id)).toContain("signup_burst");
  });

  it("still sees a burst months later, because the signal is recomputed", async () => {
    const referrer = await createTestUser();
    const code = await codeFor(referrer);
    const longAgo = new Date(Date.now() - 200 * DAY_MS);

    const referees: string[] = [];
    for (let i = 0; i < 12; i++) {
      const referee = await createTestUser();
      await attachReferral(referee, code);
      await db
        .update(referrals)
        .set({ signedUpAt: new Date(longAgo.getTime() + i * 60_000) })
        .where(eq(referrals.refereeId, referee));
      referees.push(referee);
    }

    const last = referees[referees.length - 1];
    await makeQualified(last);

    // "Now" is half a year after the burst; a snapshot taken at signup would
    // have been the only way to see it, and there is no snapshot.
    const decision = await evaluateReferral(last);
    expect(decision?.signals.map((signal) => signal.id)).toContain("signup_burst");
  });

  it("holds a referee on a disposable address", async () => {
    const referrer = await createTestUser();
    const referee = await createTestUser();
    await attachReferral(referee, await codeFor(referrer));
    await makeQualified(referee);

    await db
      .update(users)
      .set({ email: `throwaway-${Date.now()}@mail.guerrillamail.com` })
      .where(eq(users.id, referee));

    const decision = await evaluateReferral(referee, A_WEEK_LATER);
    expect(decision?.signals.map((signal) => signal.id)).toContain("disposable_email");
  });

  it("records what the decision saw, for whoever reviews it", async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    await attachReferral(b, await codeFor(a));
    await attachReferral(a, await codeFor(b));
    await makeQualified(b);
    await evaluateReferral(b, A_WEEK_LATER);

    const rows = await db.select().from(referrals).where(eq(referrals.refereeId, b));
    expect(JSON.parse(rows[0]!.signals)).toContainEqual(
      expect.objectContaining({ id: "circular_referral" })
    );
  });

  it("never reopens a decision a human owns", async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    await attachReferral(b, await codeFor(a));
    await attachReferral(a, await codeFor(b));
    await makeQualified(b);
    expect((await evaluateReferral(b, A_WEEK_LATER))?.outcome).toBe("held_for_review");

    // Remove the reason it was held. The outcome must not silently flip to paid.
    await db.delete(referrals).where(eq(referrals.refereeId, a));

    expect((await evaluateReferral(b, A_WEEK_LATER))?.outcome).toBe("held_for_review");
    expect(await walletFor(a)).toEqual([]);
  });
});

describe("the monthly cap", () => {
  it("holds referrals past the cap instead of paying them", async () => {
    const referrer = await createTestUser();
    const code = await codeFor(referrer);

    // Fill the month with already-granted referrals, spread a day apart so this
    // reads as a busy month rather than as a burst.
    for (let i = 0; i < MAX_REWARDED_REFERRALS_PER_MONTH; i++) {
      const filler = await createTestUser();
      await db.insert(referrals).values({
        refereeId: filler,
        referrerId: referrer,
        code,
        outcome: "granted",
        signedUpAt: new Date(A_WEEK_LATER.getTime() - (i + 1) * 3_600_000 * 2),
        // Dated from the same clock the evaluation uses, so the calendar month
        // lines up whatever day of the month the suite happens to run on.
        decidedAt: A_WEEK_LATER
      });
    }

    const referee = await createTestUser();
    await attachReferral(referee, code);
    await makeQualified(referee);

    const decision = await evaluateReferral(referee, A_WEEK_LATER);
    expect(decision?.outcome).toBe("held_for_review");
    expect(decision?.reasonKey).toBe("referral.outcome.monthlyCapReached");
  });
});

describe("the wallet", () => {
  it("sums unspent rewards of the same kind", async () => {
    const user = await createTestUser();
    await db.insert(referralRewards).values([
      { userId: user, rewardId: "boost", quantity: 1 },
      { userId: user, rewardId: "boost", quantity: 2 }
    ]);

    expect(await walletFor(user)).toEqual([{ rewardId: "boost", quantity: 3, trialDays: null }]);
  });

  it("spends the oldest reward first and stops at empty", async () => {
    const user = await createTestUser();
    await db.insert(referralRewards).values([
      { userId: user, rewardId: "boost", quantity: 1, grantedAt: new Date(Date.UTC(2026, 0, 1)) },
      { userId: user, rewardId: "boost", quantity: 1, grantedAt: new Date(Date.UTC(2026, 5, 1)) }
    ]);

    expect(await spendReward(user, "boost")).toBe(true);
    expect(await spendReward(user, "boost")).toBe(true);
    expect(await spendReward(user, "boost")).toBe(false);

    const remaining = await db
      .select({ granted: referralRewards.grantedAt, consumed: referralRewards.consumedAt })
      .from(referralRewards)
      .where(eq(referralRewards.userId, user));

    expect(remaining.every((row) => row.consumed !== null)).toBe(true);
  });

  it("spends exactly one unit when two requests race", async () => {
    const user = await createTestUser();
    await db.insert(referralRewards).values({ userId: user, rewardId: "boost", quantity: 1 });

    const results = await Promise.all([spendReward(user, "boost"), spendReward(user, "boost")]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("does not let one member spend another's rewards", async () => {
    const owner = await createTestUser();
    const stranger = await createTestUser();
    await db.insert(referralRewards).values({ userId: owner, rewardId: "boost", quantity: 1 });

    expect(await spendReward(stranger, "boost")).toBe(false);
    expect(await walletFor(owner)).toEqual([{ rewardId: "boost", quantity: 1, trialDays: null }]);
  });
});

describe("erasure", () => {
  it("keeps an earned reward when the referee deletes their account", async () => {
    const referrer = await createTestUser();
    const referee = await createTestUser();
    await attachReferral(referee, await codeFor(referrer));
    await makeQualified(referee);
    await evaluateReferral(referee, A_WEEK_LATER);

    await db.delete(users).where(eq(users.id, referee));

    // The link to them is gone; the boost the referrer earned is not.
    expect(await walletFor(referrer)).toEqual([
      { rewardId: "super_like", quantity: 1, trialDays: null }
    ]);
    const rows = await db.select().from(referralRewards).where(eq(referralRewards.userId, referrer));
    expect(rows[0]?.refereeId).toBeNull();
    expect(await db.select().from(referrals).where(eq(referrals.refereeId, referee))).toHaveLength(0);
  });
});

describe("the referral screen", () => {
  it("re-decides pending referrals on read", async () => {
    const referrer = await createTestUser();
    const referee = await createTestUser();
    await attachReferral(referee, await codeFor(referrer));

    // The referee qualifies later, with nobody running a background job.
    await makeQualified(referee);

    const overview = await referralOverview(
      referrer,
      { baseUrl: "https://fiorematch.test", locale: "tr" },
      A_WEEK_LATER
    );

    expect(overview.entries[0]?.outcome).toBe("granted");
    expect(overview.wallet).toEqual([{ rewardId: "super_like", quantity: 1, trialDays: null }]);
    expect(overview.rewardedThisMonth).toBe(1);
    expect(overview.link).toBe(
      `https://fiorematch.test/tr/register?ref=${overview.code}`
    );
  });

  it("never names the people who were referred", async () => {
    const referrer = await createTestUser();
    const referee = await createTestUser();
    await attachReferral(referee, await codeFor(referrer));

    const overview = await referralOverview(referrer, {
      baseUrl: "https://fiorematch.test",
      locale: "en"
    });

    expect(JSON.stringify(overview)).not.toContain(referee);
    expect(JSON.stringify(overview)).not.toContain("Test Member");
  });
});
