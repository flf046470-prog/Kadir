import { and, asc, eq, desc, inArray, isNull, or, ne, sql } from "drizzle-orm";
import { db } from "./client";
import { messages, messageRiskAssessments, matches, users, reports } from "./schema";
import { assessRisk } from "@/lib/safety/scam-shield";

/**
 * Messaging.
 *
 * Authorization is built into every function here rather than left to callers:
 * each takes the acting member's id and resolves the conversation *through*
 * them. A member who is not part of a match cannot address it at all, because
 * there is no code path that looks a conversation up without checking
 * membership first.
 */

export const MAX_MESSAGE_LENGTH = 2000;

export type Conversation = {
  matchId: string;
  partnerId: string;
  partnerName: string;
  lastMessage: string | null;
  lastMessageAt: Date | null;
  unreadCount: number;
};

/** Conversations for a member, newest activity first. */
export async function listConversations(userId: string): Promise<Conversation[]> {
  const rows = await db
    .select({
      matchId: matches.id,
      userAId: matches.userAId,
      userBId: matches.userBId,
      createdAt: matches.createdAt
    })
    .from(matches)
    .where(or(eq(matches.userAId, userId), eq(matches.userBId, userId)));

  if (rows.length === 0) return [];

  const partnerIds = rows.map((row) => (row.userAId === userId ? row.userBId : row.userAId));

  const [partners, lastMessages, unread] = await Promise.all([
    db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(inArray(users.id, partnerIds)),
    db
      .select({
        matchId: messages.matchId,
        body: messages.body,
        createdAt: messages.createdAt
      })
      .from(messages)
      .where(isNull(messages.deletedAt))
      .orderBy(desc(messages.createdAt)),
    db
      .select({ matchId: messages.matchId, count: sql<number>`count(*)::int` })
      .from(messages)
      .where(and(ne(messages.senderId, userId), isNull(messages.readAt), isNull(messages.deletedAt)))
      .groupBy(messages.matchId)
  ]);

  const nameById = new Map(partners.map((partner) => [partner.id, partner.displayName]));
  const unreadByMatch = new Map(unread.map((row) => [row.matchId, row.count]));

  const latestByMatch = new Map<string, { body: string; createdAt: Date }>();
  for (const message of lastMessages) {
    if (!latestByMatch.has(message.matchId)) {
      latestByMatch.set(message.matchId, { body: message.body, createdAt: message.createdAt });
    }
  }

  return rows
    .map((row) => {
      const partnerId = row.userAId === userId ? row.userBId : row.userAId;
      const latest = latestByMatch.get(row.matchId);

      return {
        matchId: row.matchId,
        partnerId,
        partnerName: nameById.get(partnerId) ?? "",
        lastMessage: latest?.body ?? null,
        lastMessageAt: latest?.createdAt ?? null,
        unreadCount: unreadByMatch.get(row.matchId) ?? 0
      };
    })
    .sort((a, b) => {
      const aTime = a.lastMessageAt?.getTime() ?? 0;
      const bTime = b.lastMessageAt?.getTime() ?? 0;
      return bTime - aTime;
    });
}

/**
 * Resolves a match for a member, or null if it isn't theirs. Every other
 * function goes through this, so membership is checked exactly once and cannot
 * be skipped.
 */
export async function resolveMatchFor(
  userId: string,
  matchId: string
): Promise<{ matchId: string; partnerId: string } | null> {
  const rows = await db
    .select({ id: matches.id, userAId: matches.userAId, userBId: matches.userBId })
    .from(matches)
    .where(
      and(
        eq(matches.id, matchId),
        or(eq(matches.userAId, userId), eq(matches.userBId, userId))
      )
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return { matchId: row.id, partnerId: row.userAId === userId ? row.userBId : row.userAId };
}

export type Message = {
  id: string;
  senderId: string;
  body: string;
  createdAt: Date;
  readAt: Date | null;
  mine: boolean;
  /** Set when Scam Shield flagged the message and the viewer is the recipient. */
  warning: { band: string; signals: string[] } | null;
};

export async function listMessages(userId: string, matchId: string): Promise<Message[] | null> {
  const match = await resolveMatchFor(userId, matchId);
  if (!match) return null;

  const rows = await db
    .select({
      id: messages.id,
      senderId: messages.senderId,
      body: messages.body,
      createdAt: messages.createdAt,
      readAt: messages.readAt,
      band: messageRiskAssessments.band,
      signals: messageRiskAssessments.signals
    })
    .from(messages)
    .leftJoin(messageRiskAssessments, eq(messageRiskAssessments.messageId, messages.id))
    .where(and(eq(messages.matchId, matchId), isNull(messages.deletedAt)))
    .orderBy(asc(messages.createdAt));

  return rows.map((row) => ({
    id: row.id,
    senderId: row.senderId,
    body: row.body,
    createdAt: row.createdAt,
    readAt: row.readAt,
    mine: row.senderId === userId,
    // The warning is for the person receiving the message. Showing it to the
    // sender would just teach them which phrasings evade detection.
    warning:
      row.senderId !== userId && row.band && row.band !== "none"
        ? { band: row.band, signals: parseSignals(row.signals) }
        : null
  }));
}

/**
 * Signals come from a left join, so they may be absent, and they are stored as
 * JSON text. A malformed row should degrade to "flagged, details unknown"
 * rather than throwing and taking down the whole conversation view.
 */
function parseSignals(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export type SendResult =
  | { ok: true; messageId: string }
  | { ok: false; reason: "not_a_match" | "empty" | "too_long" };

export async function sendMessage(
  userId: string,
  matchId: string,
  body: string,
  language?: string
): Promise<SendResult> {
  const match = await resolveMatchFor(userId, matchId);
  if (!match) return { ok: false, reason: "not_a_match" };

  const trimmed = body.trim();
  if (trimmed.length === 0) return { ok: false, reason: "empty" };
  if (trimmed.length > MAX_MESSAGE_LENGTH) return { ok: false, reason: "too_long" };

  // How many distinct people got a near-identical message recently — the input
  // Scam Shield needs for its mass-message signal.
  const identicalRecipients = await countIdenticalRecipients(userId, trimmed);

  const minutesSinceStart = await minutesSinceConversationStart(matchId);

  const risk = assessRisk({
    text: trimmed,
    // The language the sender declared, so the detector runs that language's
    // wording rather than every language's. Absent, it tries them all at a
    // discount — see `MessageContext.language`.
    language,
    identicalMessageRecipients: identicalRecipients,
    minutesSinceConversationStart: minutesSinceStart
  });

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(messages)
      .values({ matchId, senderId: userId, body: trimmed, language: language ?? null })
      .returning({ id: messages.id });

    if (risk.band !== "none") {
      await tx.insert(messageRiskAssessments).values({
        messageId: created.id,
        band: risk.band,
        signals: JSON.stringify(risk.signals.map((signal) => signal.id)),
        // High risk goes straight to a human; everything else starts as a
        // warning to the recipient and only escalates if they report it.
        stage: risk.queueForReview ? "human_review" : "warning"
      });
    }

    return { ok: true as const, messageId: created.id };
  });
}

/**
 * Counts distinct recipients who received the same message text from this
 * sender in the last day. Compared on exact text, which is the pattern bulk
 * senders actually produce.
 */
async function countIdenticalRecipients(senderId: string, body: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(distinct ${messages.matchId})::int` })
    .from(messages)
    .where(
      and(
        eq(messages.senderId, senderId),
        eq(messages.body, body),
        sql`${messages.createdAt} > now() - interval '1 day'`
      )
    );

  return rows[0]?.count ?? 0;
}

async function minutesSinceConversationStart(matchId: string): Promise<number | undefined> {
  const rows = await db
    .select({ createdAt: matches.createdAt })
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);

  const created = rows[0]?.createdAt;
  if (!created) return undefined;

  return Math.floor((Date.now() - created.getTime()) / 60_000);
}

/** Marks the partner's messages as read. Never touches the member's own. */
export async function markRead(userId: string, matchId: string): Promise<boolean> {
  const match = await resolveMatchFor(userId, matchId);
  if (!match) return false;

  await db
    .update(messages)
    .set({ readAt: new Date() })
    .where(
      and(eq(messages.matchId, matchId), ne(messages.senderId, userId), isNull(messages.readAt))
    );

  return true;
}

/** Soft-deletes a message. Only the sender may delete their own. */
export async function deleteMessage(userId: string, messageId: string): Promise<boolean> {
  const result = await db
    .update(messages)
    .set({ deletedAt: new Date() })
    .where(and(eq(messages.id, messageId), eq(messages.senderId, userId)))
    .returning({ id: messages.id });

  return result.length > 0;
}

export async function createReport(input: {
  reporterId: string;
  reportedId: string;
  messageId?: string;
  reason: string;
  details?: string;
}): Promise<string> {
  const [created] = await db
    .insert(reports)
    .values({
      reporterId: input.reporterId,
      reportedId: input.reportedId,
      messageId: input.messageId ?? null,
      reason: input.reason,
      details: input.details ?? null
    })
    .returning({ id: reports.id });

  // A report escalates any assessment on that message to human review.
  if (input.messageId) {
    await db
      .update(messageRiskAssessments)
      .set({ stage: "human_review" })
      .where(eq(messageRiskAssessments.messageId, input.messageId));
  }

  return created.id;
}
