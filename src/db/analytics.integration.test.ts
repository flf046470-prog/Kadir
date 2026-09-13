import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "./client";
import {
  gifts,
  likes,
  matches,
  messages,
  subscriptions,
  translationUsage,
  users,
  virtualDateInvites
} from "./schema";
import { createTestUser, resetDatabase } from "./test-helpers";
import { productMetrics, windowFor, isWindowName } from "./analytics";
import { MIN_BUCKET } from "@/lib/analytics/metrics";

/**
 * The metrics are aggregates over the product's own tables, so the thing worth
 * testing is that they aggregate the *right* rows: inside the window, of the
 * right kind, and never so finely that a bucket points at one person.
 */

const DAY = 86_400_000;
const now = new Date("2026-09-01T12:00:00Z");
const window = { from: new Date(now.getTime() - 30 * DAY), to: now };

/** A date this many days before the end of the window. */
const ago = (days: number) => new Date(now.getTime() - days * DAY);

beforeEach(async () => {
  await resetDatabase();
});

/** A member whose join date we control, which the window tests need. */
async function member(joinedAt: Date = ago(20)): Promise<string> {
  const id = await createTestUser();
  await db.update(users).set({ createdAt: joinedAt }).where(eq(users.id, id));
  return id;
}

async function pair(createdAt: Date = ago(10)): Promise<{ a: string; b: string; match: string }> {
  const a = await member();
  const b = await member();
  const rows = await db
    .insert(matches)
    .values({ userAId: a, userBId: b, createdAt })
    .returning({ id: matches.id });
  return { a, b, match: rows[0].id };
}

describe("product metrics", () => {
  it("counts only what happened inside the window", async () => {
    // A distinct pair each time: `likes` is keyed on (from, to), so one member
    // has at most one row about another.
    const [a, b, c] = [await member(), await member(), await member()];

    await db.insert(likes).values([
      { fromUserId: a, toUserId: b, kind: "like", createdAt: ago(5) },
      // The window is half-open, so its own start is in and its end is out.
      { fromUserId: b, toUserId: a, kind: "like", createdAt: window.from },
      { fromUserId: a, toUserId: c, kind: "pass", createdAt: ago(31) }
    ]);

    const metrics = await productMetrics(window);

    expect(metrics.engagement.likes).toBe(2);
  });

  it("counts a member who has left out of the total", async () => {
    await member();
    const leaving = await member();
    await db.update(users).set({ deletedAt: now }).where(eq(users.id, leaving));

    const metrics = await productMetrics(window);

    // `deletedAt` is set when they ask to go, before the purge job runs, so a
    // total that ignored it would keep counting people who had left.
    expect(metrics.members.total).toBe(1);
  });

  it("counts a deleted message, because it still happened", async () => {
    const { a, match } = await pair();
    await db.insert(messages).values({
      matchId: match,
      senderId: a,
      body: "hello",
      createdAt: ago(3),
      deletedAt: ago(2)
    });

    const metrics = await productMetrics(window);

    // Otherwise the number falls retroactively whenever someone tidies a
    // conversation, and last week's figure stops matching last week's report.
    expect(metrics.engagement.messages).toBe(1);
  });

  it("measures acceptance against answered invitations, not sent ones", async () => {
    const { a, b, match } = await pair();
    const invite = (status: string, environment: string | null) => ({
      matchId: match,
      fromUserId: a,
      toUserId: b,
      status,
      environment,
      createdAt: ago(4),
      expiresAt: new Date(now.getTime() + 7 * DAY)
    });

    await db
      .insert(virtualDateInvites)
      .values([
        invite("accepted", "basic_cafe"),
        invite("declined", "basic_cafe"),
        invite("pending", "basic_cafe")
      ]);

    const metrics = await productMetrics(window);

    expect(metrics.virtualDates).toMatchObject({ invited: 3, accepted: 1, declined: 1 });
    // An invitation still sitting in someone's inbox is not a refusal. Counting
    // it as one makes the rate fall every time usage grows.
    expect(metrics.virtualDates.acceptanceRate).toBe(0.5);
  });

  it("reads environment popularity from accepted invitations only", async () => {
    const { a, b, match } = await pair();
    const rows = Array.from({ length: MIN_BUCKET }, () => ({
      matchId: match,
      fromUserId: a,
      toUserId: b,
      status: "accepted",
      environment: "sunset_beach",
      createdAt: ago(4),
      expiresAt: new Date(now.getTime() + 7 * DAY)
    }));

    await db.insert(virtualDateInvites).values([
      ...rows,
      { ...rows[0], status: "declined", environment: "northern_lights" }
    ]);

    const metrics = await productMetrics(window);

    // Counting unanswered or refused invitations would measure what gets
    // offered, which is a different question wearing the same shape.
    expect(metrics.virtualDates.environments.buckets).toEqual([
      { key: "sunset_beach", count: MIN_BUCKET }
    ]);
  });

  /**
   * The privacy rule, end to end. One accepted date in one environment is a
   * fact about a person to anyone who knows a single member.
   */
  it("withholds a breakdown bucket too small to be anonymous", async () => {
    const { a, b, match } = await pair();
    await db.insert(virtualDateInvites).values({
      matchId: match,
      fromUserId: a,
      toUserId: b,
      status: "accepted",
      environment: "northern_lights",
      createdAt: ago(4),
      expiresAt: new Date(now.getTime() + 7 * DAY)
    });

    const metrics = await productMetrics(window);

    expect(metrics.virtualDates.environments).toEqual({ buckets: [], withheld: 1 });
  });

  it("totals gifts even when every bucket is withheld", async () => {
    const { a, match } = await pair();
    await db.insert(gifts).values([
      { matchId: match, senderId: a, giftId: "rose", createdAt: ago(2) },
      { matchId: match, senderId: a, giftId: "cake", createdAt: ago(2) }
    ]);

    const metrics = await productMetrics(window);

    // The total is safe where the breakdown is not: it says how much happened
    // without saying who did which.
    expect(metrics.gifts.sent).toBe(2);
    expect(metrics.gifts.byGift).toEqual({ buckets: [], withheld: 2 });
  });

  it("counts translations", async () => {
    const { a, match } = await pair();
    const message = await db
      .insert(messages)
      .values({ matchId: match, senderId: a, body: "merhaba", createdAt: ago(3) })
      .returning({ id: messages.id });

    await db.insert(translationUsage).values({
      userId: a,
      messageId: message[0].id,
      targetLanguage: "en",
      createdAt: ago(3)
    });

    expect((await productMetrics(window)).translations.requested).toBe(1);
  });

  it("reports conversion as a share of members, and of payers", async () => {
    const plusMember = await member();
    const vipMember = await member();
    await member();
    await member();

    await db.insert(subscriptions).values([
      {
        userId: plusMember,
        tier: "plus",
        status: "active",
        currentPeriodEnd: new Date(now.getTime() + 300 * DAY),
        provider: "microsoft_store",
        providerRef: "ref-plus"
      },
      {
        userId: vipMember,
        tier: "vip",
        status: "active",
        currentPeriodEnd: new Date(now.getTime() + 300 * DAY),
        provider: "microsoft_store",
        providerRef: "ref-vip"
      }
    ]);

    const metrics = await productMetrics(window);

    expect(metrics.subscriptions).toMatchObject({ plus: 1, vip: 1 });
    expect(metrics.subscriptions.plusShare).toBe(0.25);
    // Of the two people paying, one is on VIP.
    expect(metrics.subscriptions.vipShareOfPaying).toBe(0.5);
  });

  /**
   * `activeTier` grants access for `canceled` and `past_due` inside the paid
   * period, so both are paying customers as far as this report is concerned.
   * Counting only `active` under-reported PLUS, VIP and both conversion rates —
   * while the comment on the query claimed the date decided, not the status.
   */
  it("counts everyone who still has the product, not only status=active", async () => {
    const future = new Date(now.getTime() + 300 * DAY);
    const members = await Promise.all([member(), member(), member()]);

    await db.insert(subscriptions).values([
      // Asked to stop, still inside the period they bought.
      {
        userId: members[0],
        tier: "plus",
        status: "canceled",
        currentPeriodEnd: future,
        provider: "microsoft_store",
        providerRef: "ref-cancelled"
      },
      // Card failed, store still retrying; they have not asked to stop.
      {
        userId: members[1],
        tier: "vip",
        status: "past_due",
        currentPeriodEnd: future,
        provider: "microsoft_store",
        providerRef: "ref-past-due"
      },
      // Genuinely gone.
      {
        userId: members[2],
        tier: "vip",
        status: "expired",
        currentPeriodEnd: future,
        provider: "microsoft_store",
        providerRef: "ref-expired"
      }
    ]);

    const metrics = await productMetrics(window);

    expect(metrics.subscriptions).toMatchObject({ plus: 1, vip: 1 });
  });

  it("does not count a lapsed subscription as a paying member", async () => {
    const lapsed = await member();
    await db.insert(subscriptions).values({
      userId: lapsed,
      tier: "vip",
      status: "active",
      // Ran out inside the window. The date is authoritative, not the status.
      currentPeriodEnd: ago(3),
      provider: "microsoft_store",
      providerRef: "ref-lapsed"
    });

    const metrics = await productMetrics(window);

    expect(metrics.subscriptions).toMatchObject({ plus: 0, vip: 0 });
  });

  it("names the metrics it cannot measure instead of reporting zero", async () => {
    const metrics = await productMetrics(window);

    expect(metrics.notMeasured.map((entry) => entry.metric)).toContain("completedDates");
  });
});

describe("retention", () => {
  it("counts a member who came back after their first day", async () => {
    const joined = ago(20);
    const a = await member(joined);
    const b = await member(joined);

    await db.insert(likes).values({
      fromUserId: a,
      toUserId: b,
      kind: "like",
      createdAt: new Date(joined.getTime() + 3 * DAY)
    });

    const metrics = await productMetrics(window);

    expect(metrics.retention.cohort).toBe(2);
    expect(metrics.retention.returned).toBe(1);
    expect(metrics.retention.day7).toBe(0.5);
  });

  it("does not count activity on the day they joined", async () => {
    const joined = ago(20);
    const a = await member(joined);
    const b = await member(joined);

    await db.insert(likes).values({
      fromUserId: a,
      toUserId: b,
      kind: "like",
      // Still their first hour. Signing up and looking around is not returning.
      createdAt: new Date(joined.getTime() + 3_600_000)
    });

    expect((await productMetrics(window)).retention.returned).toBe(0);
  });

  it("does not count activity after the week is over", async () => {
    const joined = ago(20);
    const a = await member(joined);
    const b = await member(joined);

    await db.insert(likes).values({
      fromUserId: a,
      toUserId: b,
      kind: "like",
      createdAt: new Date(joined.getTime() + 9 * DAY)
    });

    expect((await productMetrics(window)).retention.returned).toBe(0);
  });

  /**
   * Someone who joined yesterday cannot yet have failed to come back. Including
   * them drags the rate down by exactly how recently the product grew, which is
   * how a retention number turns into a reason to panic about nothing.
   */
  it("leaves out members who have not had seven days yet", async () => {
    await member(ago(20));
    await member(ago(2));

    expect((await productMetrics(window)).retention.cohort).toBe(1);
  });

  it("is unknown rather than zero when no cohort has matured", async () => {
    await member(ago(1));

    const metrics = await productMetrics(window);

    expect(metrics.retention).toEqual({ cohort: 0, returned: 0, day7: null });
  });
});

describe("the windows on offer", () => {
  /**
   * A fixed set, not free-form dates: an arbitrary range could be narrowed
   * until only one person was inside it, and the suppression threshold protects
   * far less at that width.
   */
  it("accepts only the named windows", () => {
    expect(isWindowName("month")).toBe(true);
    expect(isWindowName("week")).toBe(true);
    expect(isWindowName("2026-09-01..2026-09-02")).toBe(false);
  });

  it("ends at now and reaches back the window's length", () => {
    const built = windowFor("week", now);

    expect(built.to).toEqual(now);
    expect(built.from).toEqual(ago(7));
  });
});
