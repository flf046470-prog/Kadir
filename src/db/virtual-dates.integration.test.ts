import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "./client";
import { matches, subscriptions, virtualDateInvites, virtualDateUsage } from "./schema";
import { createTestUser, resetDatabase } from "./test-helpers";
import { blockUser } from "./interactions";
import { virtualDateAllowance } from "./entitlements";
import {
  INVITE_TTL_DAYS,
  UNSCHEDULED_DATE_HOURS,
  cancelInvite,
  inviteToVirtualDate,
  listOpenInvites,
  listUpcomingDates,
  respondToInvite
} from "./virtual-dates";
import { ENTITLEMENTS } from "@/lib/billing/tiers";

const DAY_MS = 86_400_000;

beforeEach(async () => {
  await resetDatabase();
});

/** Two matched members, in the pair order the unique index expects. */
async function matchedPair() {
  const a = await createTestUser();
  const b = await createTestUser();
  const [userAId, userBId] = [a, b].sort();

  const [match] = await db
    .insert(matches)
    .values({ userAId, userBId })
    .returning({ id: matches.id });

  return { a, b, matchId: match.id };
}

async function subscribe(userId: string, tier: "plus" | "vip") {
  await db.insert(subscriptions).values({
    userId,
    tier,
    status: "active",
    currentPeriodEnd: new Date(Date.now() + 30 * DAY_MS),
    provider: "test",
    providerRef: `ref-${userId}`
  });
}

/** Spends a member's whole monthly allowance. */
async function spendAllDates(userId: string, count: number) {
  await db
    .insert(virtualDateUsage)
    .values(Array.from({ length: count }, () => ({ userId })));
}

describe("inviting", () => {
  it("creates a pending invitation for the other member of the match", async () => {
    const { a, b, matchId } = await matchedPair();

    const result = await inviteToVirtualDate(a, matchId);
    expect(result.ok).toBe(true);

    const [invite] = await db.select().from(virtualDateInvites);
    expect(invite.fromUserId).toBe(a);
    expect(invite.toUserId).toBe(b);
    expect(invite.status).toBe("pending");
  });

  it("defaults to the environment every tier can use", async () => {
    const { a, matchId } = await matchedPair();
    const result = await inviteToVirtualDate(a, matchId);

    expect(result.ok && result.environment).toBe("basic_cafe");
  });

  it("refuses a match that is not the member's", async () => {
    const { matchId } = await matchedPair();
    const stranger = await createTestUser();

    expect(await inviteToVirtualDate(stranger, matchId)).toEqual({
      ok: false,
      reason: "not_a_match"
    });
  });

  /**
   * Blocking deletes the match, and the invitation cascades from the match
   * rather than from either member — so a block takes pending invitations with
   * it without this code knowing blocking exists.
   */
  it("leaves no invitation behind when someone blocks", async () => {
    const { a, b, matchId } = await matchedPair();
    await inviteToVirtualDate(a, matchId);

    await blockUser(b, a);

    expect(await db.select().from(virtualDateInvites)).toHaveLength(0);
    expect(await listOpenInvites(b)).toEqual([]);
  });

  /**
   * Enforced by a partial unique index rather than a check-then-insert, which
   * a double tap on a slow connection would race past.
   */
  it("allows only one open invitation per conversation", async () => {
    const { a, matchId } = await matchedPair();

    expect((await inviteToVirtualDate(a, matchId)).ok).toBe(true);
    expect(await inviteToVirtualDate(a, matchId)).toEqual({
      ok: false,
      reason: "already_pending"
    });
  });

  it("survives two invitations racing", async () => {
    const { a, matchId } = await matchedPair();

    const results = await Promise.all([
      inviteToVirtualDate(a, matchId),
      inviteToVirtualDate(a, matchId)
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await db.select().from(virtualDateInvites)).toHaveLength(1);
  });

  it("lets them ask again after a decline", async () => {
    const { a, b, matchId } = await matchedPair();
    const first = await inviteToVirtualDate(a, matchId);

    await respondToInvite(b, (first as { inviteId: string }).inviteId, "decline");

    expect((await inviteToVirtualDate(a, matchId)).ok).toBe(true);
  });

  it("refuses a date scheduled in the past", async () => {
    const { a, matchId } = await matchedPair();

    const result = await inviteToVirtualDate(a, matchId, {
      scheduledFor: new Date(Date.now() - DAY_MS)
    });
    expect(result).toEqual({ ok: false, reason: "scheduled_in_the_past" });
  });

  /**
   * The other end of the same rule.
   *
   * An invitation is answerable for a week, so a date proposed for the week
   * after would have the invitation expire days before it — the date never
   * declined, never cancelled, just gone from both screens. Refusing it up
   * front is why the invitation's lifetime and the scheduling limit are one
   * number rather than two.
   */
  it("refuses a date set beyond the invitation's own lifetime", async () => {
    const { a, matchId } = await matchedPair();

    const result = await inviteToVirtualDate(a, matchId, {
      scheduledFor: new Date(Date.now() + (INVITE_TTL_DAYS + 1) * DAY_MS)
    });

    expect(result).toEqual({ ok: false, reason: "scheduled_too_far" });
  });

  it("allows a date right up to that edge", async () => {
    const { a, matchId } = await matchedPair();

    const result = await inviteToVirtualDate(a, matchId, {
      scheduledFor: new Date(Date.now() + INVITE_TTL_DAYS * DAY_MS - 60_000)
    });

    expect(result.ok).toBe(true);
  });
});

describe("environments", () => {
  it("refuses an environment above the member's tier", async () => {
    const { a, matchId } = await matchedPair();

    expect(await inviteToVirtualDate(a, matchId, { environment: "rooftop" })).toEqual({
      ok: false,
      reason: "environment_locked"
    });
  });

  it("allows it once the member has the tier", async () => {
    const { a, matchId } = await matchedPair();
    await subscribe(a, "vip");

    const result = await inviteToVirtualDate(a, matchId, { environment: "rooftop" });
    expect(result.ok && result.environment).toBe("rooftop");
  });

  /**
   * An unknown id is refused rather than quietly replaced with the free café —
   * which would put two people somewhere neither chose, and would make a locked
   * environment indistinguishable from a typo to anyone probing the API.
   */
  it("refuses an id that is not in the catalogue", async () => {
    const { a, matchId } = await matchedPair();

    expect(await inviteToVirtualDate(a, matchId, { environment: "moon_base" })).toEqual({
      ok: false,
      reason: "unknown_environment"
    });
  });
});

describe("the monthly allowance", () => {
  const FREE_LIMIT = ENTITLEMENTS.free.monthlyVirtualDates!;

  it("refuses to send when the inviter has none left", async () => {
    const { a, matchId } = await matchedPair();
    await spendAllDates(a, FREE_LIMIT);

    expect(await inviteToVirtualDate(a, matchId)).toEqual({
      ok: false,
      reason: "no_dates_left",
      limit: FREE_LIMIT
    });
  });

  /**
   * Both sides are charged, because the session costs infrastructure for two
   * people. Charging only the inviter would make the ceiling trivial to avoid:
   * a member out of dates would ask to be invited instead.
   */
  it("spends both members' allowance on acceptance", async () => {
    const { a, b, matchId } = await matchedPair();
    const invite = await inviteToVirtualDate(a, matchId);

    await respondToInvite(b, (invite as { inviteId: string }).inviteId, "accept");

    expect((await virtualDateAllowance(a)).used).toBe(1);
    expect((await virtualDateAllowance(b)).used).toBe(1);
  });

  it("spends nothing when the invitation is declined", async () => {
    const { a, b, matchId } = await matchedPair();
    const invite = await inviteToVirtualDate(a, matchId);

    await respondToInvite(b, (invite as { inviteId: string }).inviteId, "decline");

    expect((await virtualDateAllowance(a)).used).toBe(0);
    expect((await virtualDateAllowance(b)).used).toBe(0);
  });

  it("refuses acceptance when the accepter has none left", async () => {
    const { a, b, matchId } = await matchedPair();
    const invite = await inviteToVirtualDate(a, matchId);
    await spendAllDates(b, FREE_LIMIT);

    const result = await respondToInvite(b, (invite as { inviteId: string }).inviteId, "accept");
    expect(result).toEqual({ ok: false, reason: "no_dates_left", who: "you", limit: FREE_LIMIT });
  });

  /**
   * Re-checked rather than trusted from invite time: an invitation sits for a
   * week, and the sender may have spent their month meanwhile. Accepting one
   * they can no longer honour would charge the recipient for nothing.
   */
  it("refuses acceptance when the inviter has run out since sending", async () => {
    const { a, b, matchId } = await matchedPair();
    const invite = await inviteToVirtualDate(a, matchId);
    await spendAllDates(a, FREE_LIMIT);

    const result = await respondToInvite(b, (invite as { inviteId: string }).inviteId, "accept");
    expect(result).toEqual({ ok: false, reason: "no_dates_left", who: "them", limit: FREE_LIMIT });
  });

  it("does not charge a refused acceptance", async () => {
    const { a, b, matchId } = await matchedPair();
    const invite = await inviteToVirtualDate(a, matchId);
    await spendAllDates(b, FREE_LIMIT);

    await respondToInvite(b, (invite as { inviteId: string }).inviteId, "accept");

    // b was already at the ceiling; a must not have been charged for a room
    // that was never created.
    expect((await virtualDateAllowance(a)).used).toBe(0);
  });

  it("does not limit a VIP", async () => {
    const { a, b, matchId } = await matchedPair();
    await subscribe(a, "vip");
    await spendAllDates(a, 100);

    expect((await inviteToVirtualDate(a, matchId)).ok).toBe(true);
    const invite = await db.select().from(virtualDateInvites).limit(1);
    expect((await respondToInvite(b, invite[0].id, "accept")).ok).toBe(true);
  });
});

describe("answering", () => {
  it("lets only the recipient answer", async () => {
    const { a, b, matchId } = await matchedPair();
    const invite = await inviteToVirtualDate(a, matchId);
    const inviteId = (invite as { inviteId: string }).inviteId;

    expect(await respondToInvite(a, inviteId, "accept")).toEqual({
      ok: false,
      reason: "not_yours"
    });
    expect((await respondToInvite(b, inviteId, "accept")).ok).toBe(true);
  });

  /**
   * A stranger gets "not found" rather than "not yours". The more specific
   * answer would confirm that the id exists, which is only safe to tell someone
   * who already knows — the sender.
   */
  it("does not confirm an invitation to a stranger", async () => {
    const { a, matchId } = await matchedPair();
    const invite = await inviteToVirtualDate(a, matchId);
    const stranger = await createTestUser();

    expect(
      await respondToInvite(stranger, (invite as { inviteId: string }).inviteId, "accept")
    ).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses a second answer", async () => {
    const { a, b, matchId } = await matchedPair();
    const invite = await inviteToVirtualDate(a, matchId);
    const inviteId = (invite as { inviteId: string }).inviteId;

    await respondToInvite(b, inviteId, "decline");
    expect(await respondToInvite(b, inviteId, "accept")).toEqual({
      ok: false,
      reason: "already_answered"
    });
  });

  it("refuses an invitation that has expired", async () => {
    const { a, b, matchId } = await matchedPair();
    await inviteToVirtualDate(a, matchId);

    await db
      .update(virtualDateInvites)
      .set({ expiresAt: new Date(Date.now() - DAY_MS) })
      .where(eq(virtualDateInvites.matchId, matchId));

    const [invite] = await db.select().from(virtualDateInvites);
    expect(await respondToInvite(b, invite.id, "accept")).toEqual({
      ok: false,
      reason: "expired"
    });
  });
});

describe("cancelling", () => {
  it("lets the sender withdraw", async () => {
    const { a, matchId } = await matchedPair();
    const invite = await inviteToVirtualDate(a, matchId);

    expect(await cancelInvite(a, (invite as { inviteId: string }).inviteId)).toEqual({ ok: true });
    expect((await inviteToVirtualDate(a, matchId)).ok).toBe(true);
  });

  it("does not let the recipient cancel — they decline instead", async () => {
    const { a, b, matchId } = await matchedPair();
    const invite = await inviteToVirtualDate(a, matchId);

    expect(await cancelInvite(b, (invite as { inviteId: string }).inviteId)).toEqual({
      ok: false,
      reason: "not_found"
    });
  });
});

describe("listing", () => {
  it("shows both directions, marked by which is the member's", async () => {
    const { a, b, matchId } = await matchedPair();
    await inviteToVirtualDate(a, matchId);

    const [sent] = await listOpenInvites(a);
    const [received] = await listOpenInvites(b);

    expect(sent.mine).toBe(true);
    expect(received.mine).toBe(false);
    expect(received.partnerName).toBeTruthy();
  });

  /**
   * Expiry is written on read rather than by a scheduler this codebase does not
   * have. The row is corrected, not merely hidden, so the partial unique index
   * stops blocking a fresh invitation.
   */
  it("expires a stale invitation and frees the conversation", async () => {
    const { a, matchId } = await matchedPair();
    await inviteToVirtualDate(a, matchId);

    await db
      .update(virtualDateInvites)
      .set({ expiresAt: new Date(Date.now() - DAY_MS) })
      .where(eq(virtualDateInvites.matchId, matchId));

    expect(await listOpenInvites(a)).toEqual([]);

    const [row] = await db.select().from(virtualDateInvites);
    expect(row.status).toBe("expired");
    expect((await inviteToVirtualDate(a, matchId)).ok).toBe(true);
  });

  it("gives an invitation a week to be answered", async () => {
    const { a, matchId } = await matchedPair();
    await inviteToVirtualDate(a, matchId);

    const [invite] = await listOpenInvites(a);
    const days = (invite.expiresAt.getTime() - invite.createdAt.getTime()) / DAY_MS;
    expect(Math.round(days)).toBe(INVITE_TTL_DAYS);
  });

  it("does not leak another pair's invitation", async () => {
    const { a, matchId } = await matchedPair();
    await inviteToVirtualDate(a, matchId);

    const outsider = await createTestUser();
    expect(await listOpenInvites(outsider)).toEqual([]);
  });
});

/**
 * What happens after yes.
 *
 * An accepted invitation stops being pending, which is what made it invisible:
 * the member who sent it watched the row disappear and could not tell "she
 * accepted" from "it expired". Both of them need to see the date they agreed
 * to, and the sender needs it most — it is the only place they are told.
 */
describe("accepted dates", () => {
  it("shows the date to both of them", async () => {
    const { a, b, matchId } = await matchedPair();
    const scheduledFor = new Date(Date.now() + 2 * DAY_MS);
    const invited = await inviteToVirtualDate(a, matchId, { scheduledFor });
    if (!invited.ok) throw new Error("invite failed");
    await respondToInvite(b, invited.inviteId, "accept");

    const [forSender] = await listUpcomingDates(a);
    const [forAccepter] = await listUpcomingDates(b);

    expect(forSender.status).toBe("accepted");
    expect(forSender.mine).toBe(true);
    expect(forAccepter.mine).toBe(false);
    // Each of them is told who the *other* one is.
    expect(forSender.partnerName).toBeTruthy();
    expect(forAccepter.partnerName).toBeTruthy();
  });

  it("keeps a declined invitation out of it", async () => {
    const { a, b, matchId } = await matchedPair();
    const invited = await inviteToVirtualDate(a, matchId);
    if (!invited.ok) throw new Error("invite failed");
    await respondToInvite(b, invited.inviteId, "decline");

    expect(await listUpcomingDates(a)).toEqual([]);
  });

  it("keeps an unanswered invitation out of it", async () => {
    const { a, matchId } = await matchedPair();
    await inviteToVirtualDate(a, matchId);

    expect(await listUpcomingDates(a)).toEqual([]);
  });

  /** A time that has passed is a date that has happened, or has been missed. */
  it("drops a date once its time is behind us", async () => {
    const { a, b, matchId } = await matchedPair();
    const scheduledFor = new Date(Date.now() + 3_600_000);
    const invited = await inviteToVirtualDate(a, matchId, { scheduledFor });
    if (!invited.ok) throw new Error("invite failed");
    await respondToInvite(b, invited.inviteId, "accept");

    expect(await listUpcomingDates(a)).toHaveLength(1);
    expect(await listUpcomingDates(a, new Date(Date.now() + 2 * 3_600_000))).toEqual([]);
  });

  /**
   * A date with no agreed time cannot be observed to have happened, so it ages
   * out instead. A permanent "it's a date" is indistinguishable from a stuck
   * one.
   */
  it("ages out a date that never got a time", async () => {
    const { a, b, matchId } = await matchedPair();
    const invited = await inviteToVirtualDate(a, matchId);
    if (!invited.ok) throw new Error("invite failed");
    await respondToInvite(b, invited.inviteId, "accept");

    const withinTheDay = new Date(Date.now() + (UNSCHEDULED_DATE_HOURS - 1) * 3_600_000);
    const afterTheDay = new Date(Date.now() + (UNSCHEDULED_DATE_HOURS + 1) * 3_600_000);

    expect(await listUpcomingDates(a, withinTheDay)).toHaveLength(1);
    expect(await listUpcomingDates(a, afterTheDay)).toEqual([]);
  });

  it("does not leak another pair's date", async () => {
    const { a, b, matchId } = await matchedPair();
    const invited = await inviteToVirtualDate(a, matchId);
    if (!invited.ok) throw new Error("invite failed");
    await respondToInvite(b, invited.inviteId, "accept");

    const outsider = await createTestUser();
    expect(await listUpcomingDates(outsider)).toEqual([]);
  });
});

describe("the accounting", () => {
  /**
   * Usage rows carry the environment so popularity is measurable without a
   * second table, and the match so a date can be traced back — but they outlive
   * the match, which is what stops deleting a conversation from refunding a
   * month's quota.
   */
  it("records what was booked", async () => {
    const { a, b, matchId } = await matchedPair();
    await subscribe(a, "plus");
    const invite = await inviteToVirtualDate(a, matchId, { environment: "sunset_beach" });

    await respondToInvite(b, (invite as { inviteId: string }).inviteId, "accept");

    const rows = await db
      .select()
      .from(virtualDateUsage)
      .where(and(eq(virtualDateUsage.matchId, matchId)));

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.environment === "sunset_beach")).toBe(true);
  });
});
