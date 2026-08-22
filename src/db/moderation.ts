import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "./client";
import {
  moderationActions,
  photos,
  reports,
  messages,
  messageRiskAssessments,
  users
} from "./schema";
import { storage } from "@/lib/storage/local";
import { canTransition, type ModerationStage } from "@/lib/safety/scam-shield";

/**
 * Moderation queues and actions.
 *
 * Every action writes an audit row in the same transaction as the change it
 * makes, so the record and the effect cannot diverge. Dismissals are logged
 * too: "nothing was done, deliberately, by this person, at this time" is
 * exactly what an appeal or an internal review needs to see.
 */

export type QueueCounts = {
  photos: number;
  reports: number;
  riskCases: number;
};

export async function queueCounts(): Promise<QueueCounts> {
  const [photoRows, reportRows, riskRows] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(photos)
      .where(eq(photos.moderationStatus, "pending")),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(reports)
      .where(inArray(reports.stage, ["reported", "human_review"])),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(messageRiskAssessments)
      .where(
        and(eq(messageRiskAssessments.stage, "human_review"), eq(messageRiskAssessments.band, "high"))
      )
  ]);

  return {
    photos: photoRows[0]?.count ?? 0,
    reports: reportRows[0]?.count ?? 0,
    riskCases: riskRows[0]?.count ?? 0
  };
}

export type PhotoQueueItem = {
  id: string;
  userId: string;
  displayName: string;
  url: string;
  width: number;
  height: number;
  createdAt: Date;
};

export async function photoQueue(limit = 30): Promise<PhotoQueueItem[]> {
  const rows = await db
    .select({
      id: photos.id,
      userId: photos.userId,
      storageKey: photos.storageKey,
      width: photos.width,
      height: photos.height,
      createdAt: photos.createdAt,
      displayName: users.displayName
    })
    .from(photos)
    .innerJoin(users, eq(users.id, photos.userId))
    .where(eq(photos.moderationStatus, "pending"))
    .orderBy(photos.createdAt)
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    displayName: row.displayName,
    url: storage().urlFor(row.storageKey),
    width: row.width,
    height: row.height,
    createdAt: row.createdAt
  }));
}

export type ReportQueueItem = {
  id: string;
  reporterId: string;
  reportedId: string;
  reportedName: string;
  reason: string;
  details: string | null;
  messageBody: string | null;
  stage: string;
  createdAt: Date;
};

export async function reportQueue(limit = 30): Promise<ReportQueueItem[]> {
  const rows = await db
    .select({
      id: reports.id,
      reporterId: reports.reporterId,
      reportedId: reports.reportedId,
      reason: reports.reason,
      details: reports.details,
      stage: reports.stage,
      createdAt: reports.createdAt,
      reportedName: users.displayName,
      messageBody: messages.body
    })
    .from(reports)
    .innerJoin(users, eq(users.id, reports.reportedId))
    .leftJoin(messages, eq(messages.id, reports.messageId))
    .where(inArray(reports.stage, ["reported", "human_review"]))
    .orderBy(reports.createdAt)
    .limit(limit);

  return rows;
}

export type ModerationAction = "approve" | "reject" | "dismiss" | "suspend" | "reinstate";

/** Actions that need a stated reason. Punishing someone silently is not an option. */
const REQUIRES_NOTE: ModerationAction[] = ["reject", "suspend"];

export type ActionInput = {
  moderatorId: string;
  targetType: "photo" | "report" | "risk_assessment" | "account";
  targetId?: string;
  subjectUserId?: string;
  action: ModerationAction;
  note?: string;
};

export type ActionResult = { ok: true } | { ok: false; reason: "note_required" | "not_found" | "invalid_transition" };

/**
 * Either the pool or an open transaction. Audit rows are written inside the
 * same transaction as the change they record, so the two cannot diverge — this
 * type is what lets one helper serve both callers without a cast.
 */
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

async function writeAudit(tx: Executor, input: ActionInput): Promise<void> {
  await tx.insert(moderationActions).values({
    moderatorId: input.moderatorId,
    subjectUserId: input.subjectUserId ?? null,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    action: input.action,
    note: input.note ?? null
  });
}

export async function actOnPhoto(input: ActionInput): Promise<ActionResult> {
  if (REQUIRES_NOTE.includes(input.action) && !input.note?.trim()) {
    return { ok: false, reason: "note_required" };
  }
  if (!input.targetId) return { ok: false, reason: "not_found" };

  const status = input.action === "approve" ? "approved" : "rejected";

  return db.transaction(async (tx) => {
    const updated = await tx
      .update(photos)
      .set({ moderationStatus: status, moderationNote: input.note ?? null, reviewedAt: new Date() })
      .where(and(eq(photos.id, input.targetId!), eq(photos.moderationStatus, "pending")))
      .returning({ userId: photos.userId });

    if (!updated[0]) return { ok: false as const, reason: "not_found" as const };

    await writeAudit(tx, { ...input, subjectUserId: updated[0].userId });
    return { ok: true as const };
  });
}

export async function actOnReport(input: ActionInput): Promise<ActionResult> {
  if (REQUIRES_NOTE.includes(input.action) && !input.note?.trim()) {
    return { ok: false, reason: "note_required" };
  }
  if (!input.targetId) return { ok: false, reason: "not_found" };

  const rows = await db
    .select({ stage: reports.stage, reportedId: reports.reportedId })
    .from(reports)
    .where(eq(reports.id, input.targetId))
    .limit(1);

  const current = rows[0];
  if (!current) return { ok: false, reason: "not_found" };

  const nextStage: ModerationStage =
    input.action === "dismiss" ? "dismissed" : input.action === "suspend" ? "action" : "human_review";

  // The state machine is the authority: enforcement is only reachable from
  // human_review, so a report cannot jump straight from "reported" to "action".
  if (!canTransition(current.stage as ModerationStage, nextStage)) {
    return { ok: false, reason: "invalid_transition" };
  }

  return db.transaction(async (tx) => {
    await tx.update(reports).set({ stage: nextStage }).where(eq(reports.id, input.targetId!));

    if (input.action === "suspend") {
      await tx
        .update(users)
        .set({ suspendedAt: new Date() })
        .where(eq(users.id, current.reportedId));
    }

    await writeAudit(tx, { ...input, subjectUserId: current.reportedId });
    return { ok: true as const };
  });
}

/** Account-level action, used from a member's moderation view. */
export async function actOnAccount(input: ActionInput): Promise<ActionResult> {
  if (REQUIRES_NOTE.includes(input.action) && !input.note?.trim()) {
    return { ok: false, reason: "note_required" };
  }
  if (!input.subjectUserId) return { ok: false, reason: "not_found" };

  return db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ suspendedAt: input.action === "suspend" ? new Date() : null })
      .where(eq(users.id, input.subjectUserId!));

    await writeAudit(tx, input);
    return { ok: true as const };
  });
}

/** Action history for a member, for appeals and internal review. */
export async function auditTrailFor(subjectUserId: string, limit = 50) {
  return db
    .select()
    .from(moderationActions)
    .where(eq(moderationActions.subjectUserId, subjectUserId))
    .orderBy(desc(moderationActions.createdAt))
    .limit(limit);
}

/** Recent actions across the platform, for oversight of the moderators. */
export async function recentActions(limit = 50) {
  return db
    .select()
    .from(moderationActions)
    .orderBy(desc(moderationActions.createdAt))
    .limit(limit);
}
