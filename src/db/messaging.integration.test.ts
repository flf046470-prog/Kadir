import { describe, expect, it, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { messages, messageRiskAssessments, reports } from "./schema";
import { createTestUser, resetDatabase } from "./test-helpers";
import { recordLike, blockUser } from "./interactions";
import {
  createReport,
  deleteMessage,
  listConversations,
  listMessages,
  markRead,
  resolveMatchFor,
  sendMessage,
  MAX_MESSAGE_LENGTH
} from "./messaging";

beforeEach(async () => {
  await resetDatabase();
});

/** Two members who have matched. */
async function matchedPair(): Promise<{ alice: string; bob: string; matchId: string }> {
  const alice = await createTestUser();
  const bob = await createTestUser();

  await recordLike(alice, bob, "like");
  const result = await recordLike(bob, alice, "like");

  if (!result.matchId) throw new Error("expected a match");
  return { alice, bob, matchId: result.matchId };
}

describe("conversation authorization", () => {
  it("lets a member read their own conversation", async () => {
    const { alice, matchId } = await matchedPair();
    expect(await listMessages(alice, matchId)).toEqual([]);
  });

  it("refuses a member who is not part of the match", async () => {
    const { matchId } = await matchedPair();
    const stranger = await createTestUser();

    expect(await listMessages(stranger, matchId)).toBeNull();
    expect(await resolveMatchFor(stranger, matchId)).toBeNull();
  });

  it("refuses a stranger sending into someone else's conversation", async () => {
    const { matchId } = await matchedPair();
    const stranger = await createTestUser();

    const result = await sendMessage(stranger, matchId, "hello");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_a_match");
    expect(await db.select().from(messages)).toHaveLength(0);
  });

  it("refuses a stranger marking someone else's messages read", async () => {
    const { alice, matchId } = await matchedPair();
    const stranger = await createTestUser();

    await sendMessage(alice, matchId, "hello there");
    expect(await markRead(stranger, matchId)).toBe(false);

    const rows = await db.select().from(messages);
    expect(rows[0].readAt).toBeNull();
  });

  it("does not list a conversation the member is not in", async () => {
    await matchedPair();
    const stranger = await createTestUser();

    expect(await listConversations(stranger)).toEqual([]);
  });
});

describe("sending and reading", () => {
  it("stores and returns messages in order", async () => {
    const { alice, bob, matchId } = await matchedPair();

    await sendMessage(alice, matchId, "First");
    await sendMessage(bob, matchId, "Second");
    await sendMessage(alice, matchId, "Third");

    const thread = await listMessages(bob, matchId);
    expect(thread!.map((message) => message.body)).toEqual(["First", "Second", "Third"]);
  });

  it("marks which messages belong to the viewer", async () => {
    const { alice, bob, matchId } = await matchedPair();
    await sendMessage(alice, matchId, "From Alice");

    const forAlice = await listMessages(alice, matchId);
    const forBob = await listMessages(bob, matchId);

    expect(forAlice![0].mine).toBe(true);
    expect(forBob![0].mine).toBe(false);
  });

  it("rejects empty and oversized messages", async () => {
    const { alice, matchId } = await matchedPair();

    expect((await sendMessage(alice, matchId, "   ")).ok).toBe(false);
    expect((await sendMessage(alice, matchId, "x".repeat(MAX_MESSAGE_LENGTH + 1))).ok).toBe(false);
    expect((await sendMessage(alice, matchId, "ok")).ok).toBe(true);
  });

  it("only marks the partner's messages as read", async () => {
    const { alice, bob, matchId } = await matchedPair();

    await sendMessage(alice, matchId, "From Alice");
    await sendMessage(bob, matchId, "From Bob");

    await markRead(alice, matchId);

    const rows = await db.select().from(messages);
    const fromAlice = rows.find((row) => row.senderId === alice);
    const fromBob = rows.find((row) => row.senderId === bob);

    // Alice reading the thread marks Bob's message read, not her own.
    expect(fromBob!.readAt).not.toBeNull();
    expect(fromAlice!.readAt).toBeNull();
  });

  it("counts unread messages per conversation", async () => {
    const { alice, bob, matchId } = await matchedPair();

    await sendMessage(alice, matchId, "one");
    await sendMessage(alice, matchId, "two");

    const forBob = await listConversations(bob);
    expect(forBob[0].unreadCount).toBe(2);

    await markRead(bob, matchId);
    expect((await listConversations(bob))[0].unreadCount).toBe(0);
  });

  it("stores the language for later translation", async () => {
    const { alice, matchId } = await matchedPair();
    await sendMessage(alice, matchId, "Merhaba", "tr");

    const rows = await db.select().from(messages);
    expect(rows[0].language).toBe("tr");
  });
});

describe("deleting", () => {
  it("hides a deleted message from both sides", async () => {
    const { alice, bob, matchId } = await matchedPair();
    const sent = await sendMessage(alice, matchId, "Oops");
    if (!sent.ok) throw new Error("expected ok");

    expect(await deleteMessage(alice, sent.messageId)).toBe(true);

    expect(await listMessages(alice, matchId)).toEqual([]);
    expect(await listMessages(bob, matchId)).toEqual([]);
  });

  it("will not let someone delete another member's message", async () => {
    const { alice, bob, matchId } = await matchedPair();
    const sent = await sendMessage(alice, matchId, "Mine");
    if (!sent.ok) throw new Error("expected ok");

    expect(await deleteMessage(bob, sent.messageId)).toBe(false);
    expect(await listMessages(bob, matchId)).toHaveLength(1);
  });

  it("keeps the row so a later report still has evidence", async () => {
    const { alice, matchId } = await matchedPair();
    const sent = await sendMessage(alice, matchId, "Something bad");
    if (!sent.ok) throw new Error("expected ok");

    await deleteMessage(alice, sent.messageId);

    const rows = await db.select().from(messages).where(eq(messages.id, sent.messageId));
    expect(rows).toHaveLength(1);
    expect(rows[0].deletedAt).not.toBeNull();
  });
});

describe("Scam Shield on messages", () => {
  it("flags a money request and warns the recipient", async () => {
    const { alice, bob, matchId } = await matchedPair();

    await sendMessage(
      alice,
      matchId,
      "Please send money urgently via Western Union, I am stuck at customs and need the visa fee"
    );

    const forBob = await listMessages(bob, matchId);
    expect(forBob![0].warning).not.toBeNull();
    expect(["elevated", "high"]).toContain(forBob![0].warning!.band);
  });

  it("does not show the warning to the sender", async () => {
    const { alice, matchId } = await matchedPair();

    await sendMessage(alice, matchId, "send me bitcoin for a guaranteed returns investment");

    const forAlice = await listMessages(alice, matchId);
    expect(forAlice![0].warning).toBeNull();
  });

  it("leaves an ordinary message unflagged", async () => {
    const { alice, bob, matchId } = await matchedPair();
    await sendMessage(alice, matchId, "Hey! How was your weekend?");

    const forBob = await listMessages(bob, matchId);
    expect(forBob![0].warning).toBeNull();
    expect(await db.select().from(messageRiskAssessments)).toHaveLength(0);
  });

  it("never blocks the sender or deletes the message", async () => {
    const { alice, bob, matchId } = await matchedPair();

    const sent = await sendMessage(
      alice,
      matchId,
      "Urgent! Send money via gift cards, bitcoin works too, I am stuck at customs and need the visa fee"
    );
    expect(sent.ok).toBe(true);

    // The message is delivered; detection warns, it does not censor.
    const forBob = await listMessages(bob, matchId);
    expect(forBob).toHaveLength(1);

    // And the sender is still able to use the conversation.
    expect((await sendMessage(alice, matchId, "hello again")).ok).toBe(true);
  });

  it("routes high risk to human review, not to an automatic action", async () => {
    const { alice, matchId } = await matchedPair();

    await sendMessage(
      alice,
      matchId,
      "Urgent! Send money via gift cards, I am stuck at customs and need the visa fee, bitcoin works too"
    );

    const assessments = await db.select().from(messageRiskAssessments);
    expect(assessments[0].stage).toBe("human_review");
    expect(assessments[0].stage).not.toBe("action");
  });
});

describe("reports", () => {
  it("escalates the flagged message to human review", async () => {
    const { alice, bob, matchId } = await matchedPair();

    const sent = await sendMessage(alice, matchId, "add me on whatsapp now");
    if (!sent.ok) throw new Error("expected ok");

    await createReport({
      reporterId: bob,
      reportedId: alice,
      messageId: sent.messageId,
      reason: "scam_or_fraud"
    });

    const [report] = await db.select().from(reports);
    expect(report.stage).toBe("reported");

    const assessments = await db.select().from(messageRiskAssessments);
    if (assessments.length > 0) {
      expect(assessments[0].stage).toBe("human_review");
    }
  });
});

describe("blocking and conversations", () => {
  it("removes the conversation for both members", async () => {
    const { alice, bob, matchId } = await matchedPair();
    await sendMessage(alice, matchId, "hello");

    await blockUser(bob, alice);

    expect(await listConversations(alice)).toEqual([]);
    expect(await listConversations(bob)).toEqual([]);
    expect(await listMessages(alice, matchId)).toBeNull();
  });
});
