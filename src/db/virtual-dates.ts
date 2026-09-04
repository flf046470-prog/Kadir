import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "./client";
import { users, virtualDateInvites, virtualDateUsage } from "./schema";
import { resolveMatchFor } from "./messaging";
import { tierOf, virtualDateAllowance } from "./entitlements";
import { environmentFor } from "@/lib/virtual-dates/environments";
import { INVITE_TTL_DAYS, UNSCHEDULED_DATE_HOURS } from "@/lib/virtual-dates/rules";

/**
 * Inviting someone to a virtual date, and answering.
 *
 * The whole flow lives here and needs no VR client: an invitation is rows and
 * rules, and the headset only ever joins a room that this has already decided
 * should exist. Building it this way round means the web and mobile apps get
 * scheduling and answering today, and the VR client — when there is one — has a
 * surface to connect to rather than a design to invent.
 *
 * **Where the allowance is spent, and why it is spent twice.**
 *
 * A virtual date is the first thing in this product that costs money *while it
 * runs*: two people in a voice-and-network session, billed by the minute. So
 * the ceiling is not a fairness device like the like limit, it is a cost
 * control, and it has to be spent by everyone the cost is incurred for.
 *
 * The inviter's allowance is checked when they invite — sending an invitation
 * you cannot honour wastes the other person's answer. Both allowances are
 * checked *and spent* on acceptance, which is the moment a room would be
 * created. Charging only the inviter would make the limit trivially avoidable:
 * a member out of dates would simply ask to be invited.
 */

export { INVITE_TTL_DAYS, UNSCHEDULED_DATE_HOURS } from "@/lib/virtual-dates/rules";

export type InviteStatus = "pending" | "accepted" | "declined" | "expired" | "cancelled";

export type VirtualDateInvite = {
  id: string;
  matchId: string;
  fromUserId: string;
  toUserId: string;
  /** True when this member sent it, so a client can render the right side. */
  mine: boolean;
  partnerName: string;
  status: InviteStatus;
  environment: string | null;
  scheduledFor: Date | null;
  createdAt: Date;
  expiresAt: Date;
};

export type InviteResult =
  | { ok: true; inviteId: string; environment: string }
  | {
      ok: false;
      reason:
        | "not_a_match"
        | "already_pending"
        | "no_dates_left"
        | "unknown_environment"
        | "environment_locked"
        | "scheduled_in_the_past"
        | "scheduled_too_far";
      /** For `no_dates_left`, the ceiling — so the client can name it. */
      limit?: number;
    };

/**
 * Marks pending invitations past their expiry as expired.
 *
 * Called before anything that depends on what is pending, rather than run on a
 * schedule, because this codebase has no scheduler and inventing one for this
 * would be a lot of infrastructure for a row that only matters when somebody
 * looks at it. Scoped to one match when a match is in hand, so the common path
 * writes almost nothing.
 */
async function expireStale(matchId?: string): Promise<void> {
  await db
    .update(virtualDateInvites)
    .set({ status: "expired" })
    .where(
      and(
        eq(virtualDateInvites.status, "pending"),
        sql`${virtualDateInvites.expiresAt} <= now()`,
        ...(matchId ? [eq(virtualDateInvites.matchId, matchId)] : [])
      )
    );
}

export async function inviteToVirtualDate(
  userId: string,
  matchId: string,
  options: { environment?: string | null; scheduledFor?: Date | null } = {},
  now: Date = new Date()
): Promise<InviteResult> {
  // Resolved through the member, like every other conversation surface: a match
  // that is not theirs is indistinguishable from one that does not exist. This
  // also covers blocking, because `blockUser` deletes the match.
  const match = await resolveMatchFor(userId, matchId);
  if (!match) return { ok: false, reason: "not_a_match" };

  const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 3_600_000);

  if (options.scheduledFor) {
    if (options.scheduledFor.getTime() <= now.getTime()) {
      return { ok: false, reason: "scheduled_in_the_past" };
    }
    /**
     * A date cannot outlive the invitation that proposes it.
     *
     * An invitation expires after a week, so one scheduled for the week after
     * would sit on both their screens until it quietly expired — the date
     * never cancelled, never declined, simply gone. The other end of the same
     * rule as `scheduled_in_the_past`.
     */
    if (options.scheduledFor.getTime() > expiresAt.getTime()) {
      return { ok: false, reason: "scheduled_too_far" };
    }
  }

  const tier = await tierOf(userId, now);
  const environment = environmentFor(options.environment, tier);
  if (!environment.ok) return { ok: false, reason: environment.reason };

  /**
   * The inviter's allowance, checked but not spent.
   *
   * Spending here would charge for an invitation that is declined, and a
   * declined invitation costs nothing to run. Refusing here is still right: an
   * invitation the sender could not honour would waste the recipient's answer.
   */
  const allowance = await virtualDateAllowance(userId, now);
  if (!allowance.allowed) {
    return { ok: false, reason: "no_dates_left", limit: allowance.limit ?? undefined };
  }

  await expireStale(matchId);

  /**
   * The unique partial index is what enforces one open invitation per match.
   *
   * Checking first and inserting after loses to a double tap on a slow
   * connection — two requests both find nothing pending and both insert. The
   * conflict is caught here instead, which cannot race.
   */
  const inserted = await db
    .insert(virtualDateInvites)
    .values({
      matchId,
      fromUserId: userId,
      toUserId: match.partnerId,
      environment: environment.id,
      scheduledFor: options.scheduledFor ?? null,
      expiresAt
    })
    .onConflictDoNothing()
    .returning({ id: virtualDateInvites.id });

  if (!inserted[0]) return { ok: false, reason: "already_pending" };

  return { ok: true, inviteId: inserted[0].id, environment: environment.id };
}

export type RespondResult =
  | { ok: true; status: "accepted" | "declined" }
  | {
      ok: false;
      reason: "not_found" | "not_yours" | "already_answered" | "expired" | "no_dates_left";
      /** Whose allowance ran out, when that is the reason. */
      who?: "you" | "them";
      limit?: number;
    };

/**
 * Accepting or declining.
 *
 * Only the recipient may answer — the sender cancels instead, which is a
 * different verb with a different meaning to the other person.
 */
export async function respondToInvite(
  userId: string,
  inviteId: string,
  response: "accept" | "decline",
  now: Date = new Date()
): Promise<RespondResult> {
  const [invite] = await db
    .select()
    .from(virtualDateInvites)
    .where(eq(virtualDateInvites.id, inviteId))
    .limit(1);

  if (!invite) return { ok: false, reason: "not_found" };

  /**
   * An invitation addressed to someone else is "not found", not "not yours".
   *
   * Telling a stranger that an id exists but is not theirs confirms the id.
   * Only the sender gets the more specific answer, because they already know
   * the invitation exists.
   */
  if (invite.toUserId !== userId) {
    return { ok: false, reason: invite.fromUserId === userId ? "not_yours" : "not_found" };
  }

  if (invite.status !== "pending") return { ok: false, reason: "already_answered" };
  if (invite.expiresAt.getTime() <= now.getTime()) {
    await expireStale(invite.matchId);
    return { ok: false, reason: "expired" };
  }

  if (response === "decline") {
    await db
      .update(virtualDateInvites)
      .set({ status: "declined", respondedAt: now })
      .where(eq(virtualDateInvites.id, inviteId));

    return { ok: true, status: "declined" };
  }

  /**
   * Both allowances, checked at the moment the room would exist.
   *
   * The inviter's is re-checked rather than trusted from invite time: an
   * invitation can sit for a week, and they may have spent their month in the
   * meantime. Accepting an invitation the sender can no longer honour would
   * charge the recipient for a date that cannot happen.
   */
  const [mine, theirs] = await Promise.all([
    virtualDateAllowance(userId, now),
    virtualDateAllowance(invite.fromUserId, now)
  ]);

  if (!mine.allowed) {
    return { ok: false, reason: "no_dates_left", who: "you", limit: mine.limit ?? undefined };
  }
  if (!theirs.allowed) {
    return { ok: false, reason: "no_dates_left", who: "them", limit: theirs.limit ?? undefined };
  }

  /**
   * The answer and the two charges land together or not at all.
   *
   * A crash between them would either give away a date nobody paid for or
   * charge for one that never got accepted, and both are the kind of thing
   * nobody notices until a month's numbers are wrong.
   */
  await db.transaction(async (tx) => {
    await tx
      .update(virtualDateInvites)
      .set({ status: "accepted", respondedAt: now })
      .where(eq(virtualDateInvites.id, inviteId));

    await tx.insert(virtualDateUsage).values([
      {
        userId: invite.toUserId,
        matchId: invite.matchId,
        environment: invite.environment,
        startedAt: now
      },
      {
        userId: invite.fromUserId,
        matchId: invite.matchId,
        environment: invite.environment,
        startedAt: now
      }
    ]);
  });

  return { ok: true, status: "accepted" };
}

/** Withdrawing an invitation you sent. */
export async function cancelInvite(
  userId: string,
  inviteId: string,
  now: Date = new Date()
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "already_answered" }> {
  const updated = await db
    .update(virtualDateInvites)
    .set({ status: "cancelled", respondedAt: now })
    .where(
      and(
        eq(virtualDateInvites.id, inviteId),
        eq(virtualDateInvites.fromUserId, userId),
        eq(virtualDateInvites.status, "pending")
      )
    )
    .returning({ id: virtualDateInvites.id });

  if (updated[0]) return { ok: true };

  // Either it is not theirs, or it has already been answered. Distinguished
  // only for an invitation they own, for the reason `respondToInvite` gives.
  const [existing] = await db
    .select({ fromUserId: virtualDateInvites.fromUserId })
    .from(virtualDateInvites)
    .where(eq(virtualDateInvites.id, inviteId))
    .limit(1);

  if (existing?.fromUserId === userId) return { ok: false, reason: "already_answered" };
  return { ok: false, reason: "not_found" };
}

/**
 * The member's open invitations, both directions.
 *
 * Both directions in one list because the client shows them together — "waiting
 * for them" and "waiting for you" are the same screen — and `mine` is what
 * separates them.
 */
export async function listOpenInvites(
  userId: string,
  now: Date = new Date()
): Promise<VirtualDateInvite[]> {
  await expireStale();

  const rows = await db
    .select()
    .from(virtualDateInvites)
    .where(
      and(
        eq(virtualDateInvites.status, "pending"),
        or(eq(virtualDateInvites.fromUserId, userId), eq(virtualDateInvites.toUserId, userId))
      )
    );

  const invites = await withPartnerNames(userId, rows);
  return invites.filter((invite) => invite.expiresAt.getTime() > now.getTime());
}

/**
 * Dates that were accepted and have not happened yet.
 *
 * Without this the person who *sent* an invitation never finds out it was
 * accepted: the row stops being pending, drops out of `listOpenInvites`, and
 * the only trace on their screen is their monthly allowance quietly going down
 * by one. Somebody said yes, which is the single most important thing this
 * feature has to communicate.
 *
 * A date with a time stays until that time passes. A date without one — "let's
 * meet, we'll sort out when" — stays for a day, because that is roughly how
 * long the sentence stays true.
 */
export async function listUpcomingDates(
  userId: string,
  now: Date = new Date()
): Promise<VirtualDateInvite[]> {
  const unscheduledSince = new Date(now.getTime() - UNSCHEDULED_DATE_HOURS * 3_600_000);

  const rows = await db
    .select()
    .from(virtualDateInvites)
    .where(
      and(
        eq(virtualDateInvites.status, "accepted"),
        or(eq(virtualDateInvites.fromUserId, userId), eq(virtualDateInvites.toUserId, userId)),
        or(
          gt(virtualDateInvites.scheduledFor, now),
          and(
            isNull(virtualDateInvites.scheduledFor),
            gt(virtualDateInvites.respondedAt, unscheduledSince)
          )
        )
      )
    );

  return withPartnerNames(userId, rows);
}

type InviteRow = typeof virtualDateInvites.$inferSelect;

/**
 * Rows to something a screen can render, from this member's point of view.
 *
 * The partner's *name* rather than their id is what both lists need, and doing
 * it in one place is what keeps "who is the other person here" from being
 * worked out differently in two of them.
 */
async function withPartnerNames(
  userId: string,
  rows: InviteRow[]
): Promise<VirtualDateInvite[]> {
  if (rows.length === 0) return [];

  const partnerIds = rows.map((row) => (row.fromUserId === userId ? row.toUserId : row.fromUserId));
  const partners = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, partnerIds));

  const nameById = new Map(partners.map((partner) => [partner.id, partner.displayName]));

  return rows
    .map((row) => {
      const partnerId = row.fromUserId === userId ? row.toUserId : row.fromUserId;
      return {
        id: row.id,
        matchId: row.matchId,
        fromUserId: row.fromUserId,
        toUserId: row.toUserId,
        mine: row.fromUserId === userId,
        partnerName: nameById.get(partnerId) ?? "",
        status: row.status as InviteStatus,
        environment: row.environment,
        scheduledFor: row.scheduledFor,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt
      };
    })
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}
