import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "./client";
import { likes, profileViews, subscriptions, boostGrants } from "./schema";
import { createTestUser, resetDatabase } from "./test-helpers";
import { recordLike, blockUser } from "./interactions";
import { likesReceived, undoLastPass } from "./likes-received";
import { recordProfileView, visitorsOf } from "./profile-views";
import { startBoost } from "./entitlements";
import { ENTITLEMENTS, type Tier } from "@/lib/billing/tiers";

const DAY_MS = 86_400_000;

beforeEach(async () => {
  await resetDatabase();
});

async function subscribe(userId: string, tier: Tier) {
  await db.insert(subscriptions).values({
    userId,
    tier,
    status: "active",
    currentPeriodEnd: new Date(Date.now() + 30 * DAY_MS)
  });
}

describe("who liked you", () => {
  it("gives free members the count but never a name", async () => {
    const me = await createTestUser();
    const [a, b] = [await createTestUser(), await createTestUser()];
    await recordLike(a, me, "like");
    await recordLike(b, me, "super_like");

    const result = await likesReceived(me);

    expect(result.locked).toBe(true);
    expect(result.total).toBe(2);
    // The gate has to hold on the data, not in the rendering: anything
    // returned here is readable from the network tab.
    expect(result.likes).toEqual([]);
  });

  it("names them for PLUS, newest first, marking super likes", async () => {
    const me = await createTestUser();
    const admirer = await createTestUser();
    await subscribe(me, "plus");
    await recordLike(admirer, me, "super_like");

    const result = await likesReceived(me);

    expect(result.locked).toBe(false);
    expect(result.likes).toHaveLength(1);
    expect(result.likes[0]).toMatchObject({ userId: admirer, superLike: true });
  });

  it("drops someone once the viewer has answered them", async () => {
    const me = await createTestUser();
    const admirer = await createTestUser();
    await subscribe(me, "plus");
    await recordLike(admirer, me, "like");

    expect((await likesReceived(me)).total).toBe(1);

    // Answering — either way — is the decision. A mutual like is a match and
    // belongs in the conversation list, not in a queue of unanswered interest.
    await recordLike(me, admirer, "like");
    expect((await likesReceived(me)).total).toBe(0);
  });

  it("never lists a pass as interest", async () => {
    const me = await createTestUser();
    const other = await createTestUser();
    await subscribe(me, "plus");
    await recordLike(other, me, "pass");

    expect((await likesReceived(me)).total).toBe(0);
  });

  it("hides a blocked admirer in both directions", async () => {
    const me = await createTestUser();
    const admirer = await createTestUser();
    await subscribe(me, "plus");
    await recordLike(admirer, me, "like");

    await blockUser(me, admirer);
    expect((await likesReceived(me)).total).toBe(0);
  });
});

describe("undoing a pass", () => {
  it("refuses a free member, and leaves the pass in place", async () => {
    const me = await createTestUser();
    const other = await createTestUser();
    await recordLike(me, other, "pass");

    expect(await undoLastPass(me)).toEqual({ ok: false, reason: "not_entitled" });
    expect(await db.select().from(likes)).toHaveLength(1);
  });

  it("takes back only the most recent pass", async () => {
    const me = await createTestUser();
    const first = await createTestUser();
    const second = await createTestUser();
    await subscribe(me, "plus");

    await recordLike(me, first, "pass");
    await new Promise((resolve) => setTimeout(resolve, 5));
    await recordLike(me, second, "pass");

    expect(await undoLastPass(me)).toEqual({ ok: true, userId: second });

    const left = await db.select().from(likes).where(eq(likes.fromUserId, me));
    expect(left.map((row) => row.toUserId)).toEqual([first]);
  });

  it("says so when there is nothing to undo", async () => {
    const me = await createTestUser();
    await subscribe(me, "plus");

    expect(await undoLastPass(me)).toEqual({ ok: false, reason: "nothing_to_undo" });
  });

  it("does not reach back past a like", async () => {
    const me = await createTestUser();
    const passed = await createTestUser();
    const liked = await createTestUser();
    await subscribe(me, "plus");

    await recordLike(me, passed, "pass");
    await recordLike(me, liked, "like");

    // The pass is still the most recent *pass*, so it is the one undone — a
    // like is a different decision and is not undone by this control.
    expect(await undoLastPass(me)).toEqual({ ok: true, userId: passed });
    const left = await db.select().from(likes).where(eq(likes.fromUserId, me));
    expect(left.map((row) => row.toUserId)).toEqual([liked]);
  });

  /**
   * Simultaneous taps must never claim the same pass twice.
   *
   * Without the advisory lock the calls all read the same "most recent pass",
   * all delete it — every one after the first matching zero rows — and all
   * report success for the *same* profile. The member sees eight undos, gets
   * one, and the seven behind it are stranded.
   *
   * Eight rather than two, because at two the interleaving that exposes it is
   * rare enough that the test passes with the lock removed, which makes it a
   * test of nothing. The assertion is on the identities returned: a count
   * check is satisfied either way.
   */
  it("never reports the same undo twice under concurrent taps", async () => {
    const me = await createTestUser();
    await subscribe(me, "plus");

    const passed: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      const other = await createTestUser();
      await recordLike(me, other, "pass");
      passed.push(other);
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    const results = await Promise.all(Array.from({ length: 8 }, () => undoLastPass(me)));
    const undone = results.flatMap((result) => (result.ok ? [result.userId] : []));

    expect(undone).toHaveLength(8);
    expect(new Set(undone).size).toBe(8);
    expect(new Set(undone)).toEqual(new Set(passed));
    expect(await db.select().from(likes).where(eq(likes.fromUserId, me))).toHaveLength(0);
  });
});

describe("profile visitors", () => {
  it("records every viewer, whatever they pay", async () => {
    const me = await createTestUser();
    const freeViewer = await createTestUser();
    await recordProfileView(me, freeViewer);

    // Recording is unconditional on purpose: a log that only captured paying
    // viewers would let someone browse invisibly by not subscribing.
    const rows = await db.select().from(profileViews).where(eq(profileViews.subjectUserId, me));
    expect(rows).toHaveLength(1);
    expect(rows[0].viewerUserId).toBe(freeViewer);
  });

  it("counts repeat visits on one row rather than appending", async () => {
    const me = await createTestUser();
    const viewer = await createTestUser();

    await recordProfileView(me, viewer);
    await recordProfileView(me, viewer);
    await recordProfileView(me, viewer);

    const rows = await db.select().from(profileViews).where(eq(profileViews.subjectUserId, me));
    expect(rows).toHaveLength(1);
    expect(rows[0].viewCount).toBe(3);
  });

  it("ignores a member looking at their own profile", async () => {
    const me = await createTestUser();
    await recordProfileView(me, me);

    expect(await db.select().from(profileViews)).toHaveLength(0);
  });

  it("gives PLUS the count and VIP the names", async () => {
    const plus = await createTestUser();
    const vip = await createTestUser();
    const viewer = await createTestUser();
    await subscribe(plus, "plus");
    await subscribe(vip, "vip");

    await recordProfileView(plus, viewer);
    await recordProfileView(vip, viewer);

    const forPlus = await visitorsOf(plus);
    expect(forPlus).toMatchObject({ locked: true, total: 1, visitors: [] });

    const forVip = await visitorsOf(vip);
    expect(forVip.locked).toBe(false);
    expect(forVip.visitors.map((v) => v.userId)).toEqual([viewer]);
  });

  it("filters a blocked visitor out of the list, without deleting the visit", async () => {
    const me = await createTestUser();
    const viewer = await createTestUser();
    await subscribe(me, "vip");
    await recordProfileView(me, viewer);
    await blockUser(me, viewer);

    expect((await visitorsOf(me)).total).toBe(0);
    // A block is not a claim that the visit never happened, so the row stays.
    expect(await db.select().from(profileViews)).toHaveLength(1);
  });
});

describe("the VIP monthly Boost", () => {
  it("lets a VIP with no referral rewards start one", async () => {
    const vip = await createTestUser();
    await subscribe(vip, "vip");

    // Before this existed `startBoost` paid only from the referral ledger, so
    // VIP's sixty minutes described something that could not happen.
    const result = await startBoost(vip);
    expect(result.ok).toBe(true);
  });

  it("gives one per calendar month, not one per attempt", async () => {
    const vip = await createTestUser();
    await subscribe(vip, "vip");

    const first = new Date("2026-03-04T10:00:00Z");
    expect((await startBoost(vip, first)).ok).toBe(true);

    // After the first Boost has expired, still inside the same month.
    const later = new Date("2026-03-20T10:00:00Z");
    expect(await startBoost(vip, later)).toEqual({ ok: false, reason: "none_available" });

    const next = new Date("2026-04-01T10:00:00Z");
    expect((await startBoost(vip, next)).ok).toBe(true);

    const grants = await db.select().from(boostGrants).where(eq(boostGrants.userId, vip));
    expect(grants.map((row) => row.period).sort()).toEqual(["2026-03", "2026-04"]);
  });

  it("gives free and PLUS members no monthly credit", async () => {
    const free = await createTestUser();
    const plus = await createTestUser();
    await subscribe(plus, "plus");

    expect(await startBoost(free)).toEqual({ ok: false, reason: "none_available" });
    expect(await startBoost(plus)).toEqual({ ok: false, reason: "none_available" });
    expect(await db.select().from(boostGrants)).toHaveLength(0);
  });

  it("runs the VIP Boost for sixty minutes, not thirty", async () => {
    const vip = await createTestUser();
    await subscribe(vip, "vip");

    const now = new Date("2026-05-02T08:00:00Z");
    const result = await startBoost(vip, now);
    if (!result.ok) throw new Error("expected the Boost to start");

    expect(result.expiresAt.getTime() - now.getTime()).toBe(60 * 60_000);
  });

  /**
   * A double-click must not claim the month twice. The month's credits are
   * counted under an advisory lock and the grant is keyed on (user, month,
   * seq), so the second call sees the first's row and falls through to the
   * referral ledger — which is empty here.
   */
  it("claims the month once when pressed twice at the same instant", async () => {
    const vip = await createTestUser();
    await subscribe(vip, "vip");

    const results = await Promise.all([startBoost(vip), startBoost(vip)]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await db.select().from(boostGrants)).toHaveLength(1);
  });

  /**
   * `monthlyBoostCredits` is a count and has to be spent as one.
   *
   * The claim used to be a single (member, month) row taken with
   * `onConflictDoNothing`, which read the number as a boolean: whatever a tier
   * was configured to grant, exactly one arrived and the rest were reported as
   * "none available". Every tier happens to be configured for 0 or 1 today, so
   * the defect is invisible from the table alone — this raises the number to
   * prove the code reads it.
   */
  it("grants as many credits a month as the tier is configured for", async () => {
    const vip = await createTestUser();
    await subscribe(vip, "vip");

    const configured = ENTITLEMENTS.vip.monthlyBoostCredits;
    ENTITLEMENTS.vip.monthlyBoostCredits = 3;

    try {
      // Spaced so each Boost has expired before the next starts — the ceiling
      // under test is the monthly credit, not the one-at-a-time rule.
      const march = ["2026-03-01", "2026-03-10", "2026-03-20", "2026-03-28"];
      const results = [];
      for (const day of march) {
        results.push(await startBoost(vip, new Date(`${day}T10:00:00Z`)));
      }

      expect(results.filter((result) => result.ok)).toHaveLength(3);
      expect(results[3]).toEqual({ ok: false, reason: "none_available" });

      const grants = await db.select().from(boostGrants).where(eq(boostGrants.userId, vip));
      expect(grants).toHaveLength(3);
      expect(grants.map((row) => row.seq).sort()).toEqual([0, 1, 2]);
    } finally {
      ENTITLEMENTS.vip.monthlyBoostCredits = configured;
    }
  });
});

describe("the daily like allowance", () => {
  /**
   * The cap was read in the route and spent in `recordLike`, on two different
   * connections — a check-then-act that every parallel request won. The likes
   * route permits two hundred a minute, so the ceiling PLUS is sold to remove
   * could be stepped over by anyone willing to open two hundred sockets.
   */
  it("cannot be exceeded by firing likes in parallel", async () => {
    const me = await createTestUser();
    const targets = await Promise.all(
      Array.from({ length: 8 }, () => createTestUser())
    );

    const configured = ENTITLEMENTS.free.dailyLikes;
    ENTITLEMENTS.free.dailyLikes = 3;

    try {
      const results = await Promise.all(
        targets.map((target) => recordLike(me, target, "like"))
      );

      expect(results.filter((result) => result.refusal === null)).toHaveLength(3);
      expect(await db.select().from(likes).where(eq(likes.fromUserId, me))).toHaveLength(3);
    } finally {
      ENTITLEMENTS.free.dailyLikes = configured;
    }
  });

  it("does not charge for a pass", async () => {
    const me = await createTestUser();
    const targets = await Promise.all(
      Array.from({ length: 4 }, () => createTestUser())
    );

    const configured = ENTITLEMENTS.free.dailyLikes;
    ENTITLEMENTS.free.dailyLikes = 1;

    try {
      for (const target of targets) {
        expect((await recordLike(me, target, "pass")).refusal).toBeNull();
      }
    } finally {
      ENTITLEMENTS.free.dailyLikes = configured;
    }
  });

  it("does not charge twice for the same profile", async () => {
    const me = await createTestUser();
    const one = await createTestUser();
    const two = await createTestUser();

    const configured = ENTITLEMENTS.free.dailyLikes;
    ENTITLEMENTS.free.dailyLikes = 2;

    try {
      expect((await recordLike(me, one, "like")).refusal).toBeNull();
      // The same person again: the row is already counted, so re-deciding on
      // them must not spend a second of the two.
      expect((await recordLike(me, one, "super_like")).refusal).toBeNull();
      expect((await recordLike(me, two, "like")).refusal).toBeNull();
    } finally {
      ENTITLEMENTS.free.dailyLikes = configured;
    }
  });

  it("reports the ceiling it refused against", async () => {
    const me = await createTestUser();
    const one = await createTestUser();
    const two = await createTestUser();

    const configured = ENTITLEMENTS.free.dailyLikes;
    ENTITLEMENTS.free.dailyLikes = 1;

    try {
      await recordLike(me, one, "like");
      const refused = await recordLike(me, two, "like");

      expect(refused.refusal).toEqual({ reason: "like_limit_reached", used: 1, limit: 1 });
      expect(await db.select().from(likes).where(eq(likes.fromUserId, me))).toHaveLength(1);
    } finally {
      ENTITLEMENTS.free.dailyLikes = configured;
    }
  });
});
