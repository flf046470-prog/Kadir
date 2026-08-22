import { describe, expect, it, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { users, photos, reports, moderationActions } from "./schema";
import { createTestUser, resetDatabase } from "./test-helpers";
import { uploadPhoto } from "./photos";
import { actOnPhoto, actOnReport, auditTrailFor, queueCounts, photoQueue } from "./moderation";
import { authenticate } from "@/auth/accounts";
import sharp from "sharp";

beforeEach(async () => {
  await resetDatabase();
});

async function photoBytes(size = 700): Promise<Buffer> {
  return sharp({
    create: { width: size, height: size, channels: 3, background: { r: 90, g: 140, b: 210 } }
  })
    .jpeg()
    .toBuffer();
}

async function makeModerator(): Promise<string> {
  const id = await createTestUser();
  await db.update(users).set({ role: "moderator" }).where(eq(users.id, id));
  return id;
}

describe("photo moderation", () => {
  it("approves a photo and records who did it", async () => {
    const moderator = await makeModerator();
    const member = await createTestUser();

    const uploaded = await uploadPhoto(member, await photoBytes());
    if (!uploaded.ok) throw new Error("expected ok");

    const result = await actOnPhoto({
      moderatorId: moderator,
      targetType: "photo",
      targetId: uploaded.photo.id,
      action: "approve"
    });
    expect(result.ok).toBe(true);

    const [photo] = await db.select().from(photos).where(eq(photos.id, uploaded.photo.id));
    expect(photo.moderationStatus).toBe("approved");

    const trail = await auditTrailFor(member);
    expect(trail).toHaveLength(1);
    expect(trail[0].moderatorId).toBe(moderator);
    expect(trail[0].action).toBe("approve");
    expect(trail[0].targetType).toBe("photo");
  });

  it("refuses to reject without a stated reason", async () => {
    const moderator = await makeModerator();
    const member = await createTestUser();
    const uploaded = await uploadPhoto(member, await photoBytes());
    if (!uploaded.ok) throw new Error("expected ok");

    const result = await actOnPhoto({
      moderatorId: moderator,
      targetType: "photo",
      targetId: uploaded.photo.id,
      action: "reject"
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("note_required");

    // Nothing changed, and nothing was logged.
    const [photo] = await db.select().from(photos).where(eq(photos.id, uploaded.photo.id));
    expect(photo.moderationStatus).toBe("pending");
    expect(await db.select().from(moderationActions)).toHaveLength(0);
  });

  it("records a rejection with its reason", async () => {
    const moderator = await makeModerator();
    const member = await createTestUser();
    const uploaded = await uploadPhoto(member, await photoBytes());
    if (!uploaded.ok) throw new Error("expected ok");

    await actOnPhoto({
      moderatorId: moderator,
      targetType: "photo",
      targetId: uploaded.photo.id,
      action: "reject",
      note: "Not a photo of a person"
    });

    const trail = await auditTrailFor(member);
    expect(trail[0].note).toBe("Not a photo of a person");
  });

  it("will not act twice on the same photo", async () => {
    const moderator = await makeModerator();
    const member = await createTestUser();
    const uploaded = await uploadPhoto(member, await photoBytes());
    if (!uploaded.ok) throw new Error("expected ok");

    const first = await actOnPhoto({
      moderatorId: moderator,
      targetType: "photo",
      targetId: uploaded.photo.id,
      action: "approve"
    });
    const second = await actOnPhoto({
      moderatorId: moderator,
      targetType: "photo",
      targetId: uploaded.photo.id,
      action: "approve"
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    // One decision, one audit row.
    expect(await db.select().from(moderationActions)).toHaveLength(1);
  });

  it("shows pending photos in the queue and removes them once decided", async () => {
    const moderator = await makeModerator();
    const member = await createTestUser();
    const uploaded = await uploadPhoto(member, await photoBytes());
    if (!uploaded.ok) throw new Error("expected ok");

    expect(await photoQueue()).toHaveLength(1);
    expect((await queueCounts()).photos).toBe(1);

    await actOnPhoto({
      moderatorId: moderator,
      targetType: "photo",
      targetId: uploaded.photo.id,
      action: "approve"
    });

    expect(await photoQueue()).toHaveLength(0);
  });
});

describe("report moderation", () => {
  async function makeReport(reporterId: string, reportedId: string): Promise<string> {
    const [row] = await db
      .insert(reports)
      .values({ reporterId, reportedId, reason: "harassment" })
      .returning({ id: reports.id });
    return row.id;
  }

  it("cannot suspend straight from a fresh report", async () => {
    const moderator = await makeModerator();
    const reporter = await createTestUser();
    const reported = await createTestUser();
    const reportId = await makeReport(reporter, reported);

    // The state machine only permits enforcement from human_review.
    const result = await actOnReport({
      moderatorId: moderator,
      targetType: "report",
      targetId: reportId,
      action: "suspend",
      note: "Repeated harassment"
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_transition");

    const [user] = await db.select().from(users).where(eq(users.id, reported));
    expect(user.suspendedAt).toBeNull();
  });

  it("suspends only after the case reaches review", async () => {
    const moderator = await makeModerator();
    const reporter = await createTestUser();
    const reported = await createTestUser();
    const reportId = await makeReport(reporter, reported);

    await actOnReport({
      moderatorId: moderator,
      targetType: "report",
      targetId: reportId,
      action: "approve"
    });

    const result = await actOnReport({
      moderatorId: moderator,
      targetType: "report",
      targetId: reportId,
      action: "suspend",
      note: "Repeated harassment, confirmed"
    });

    expect(result.ok).toBe(true);

    const [user] = await db.select().from(users).where(eq(users.id, reported));
    expect(user.suspendedAt).not.toBeNull();
  });

  it("logs a dismissal too", async () => {
    const moderator = await makeModerator();
    const reporter = await createTestUser();
    const reported = await createTestUser();
    const reportId = await makeReport(reporter, reported);

    await actOnReport({
      moderatorId: moderator,
      targetType: "report",
      targetId: reportId,
      action: "dismiss"
    });

    const trail = await auditTrailFor(reported);
    expect(trail).toHaveLength(1);
    expect(trail[0].action).toBe("dismiss");
  });

  it("requires a reason to suspend", async () => {
    const moderator = await makeModerator();
    const reporter = await createTestUser();
    const reported = await createTestUser();
    const reportId = await makeReport(reporter, reported);

    await actOnReport({
      moderatorId: moderator,
      targetType: "report",
      targetId: reportId,
      action: "approve"
    });

    const result = await actOnReport({
      moderatorId: moderator,
      targetType: "report",
      targetId: reportId,
      action: "suspend"
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("note_required");
  });
});

describe("suspension effects", () => {
  it("stops a suspended member from logging in", async () => {
    const moderator = await makeModerator();
    const reporter = await createTestUser();
    const reported = await createTestUser();

    const [row] = await db
      .insert(reports)
      .values({ reporterId: reporter, reportedId: reported, reason: "scam" })
      .returning({ id: reports.id });

    const [before] = await db.select().from(users).where(eq(users.id, reported));
    expect(await authenticate(before.email, "correct-horse-battery")).not.toBeNull();

    await actOnReport({
      moderatorId: moderator,
      targetType: "report",
      targetId: row.id,
      action: "approve"
    });
    await actOnReport({
      moderatorId: moderator,
      targetType: "report",
      targetId: row.id,
      action: "suspend",
      note: "Confirmed scam account"
    });

    expect(await authenticate(before.email, "correct-horse-battery")).toBeNull();
  });
});

describe("audit trail durability", () => {
  it("keeps the decision on record after the subject's account is deleted", async () => {
    const moderator = await makeModerator();
    const member = await createTestUser();
    const uploaded = await uploadPhoto(member, await photoBytes());
    if (!uploaded.ok) throw new Error("expected ok");

    await actOnPhoto({
      moderatorId: moderator,
      targetType: "photo",
      targetId: uploaded.photo.id,
      action: "reject",
      note: "Guideline violation"
    });

    await db.delete(users).where(eq(users.id, member));

    // The row survives with the subject nulled: the decision is still auditable,
    // but no longer points at a person who has exercised their right to erasure.
    const remaining = await db.select().from(moderationActions);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].subjectUserId).toBeNull();
    expect(remaining[0].note).toBe("Guideline violation");
  });
});
