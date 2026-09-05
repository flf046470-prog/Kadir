import { describe, expect, it, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { signalWeights } from "./schema";
import { createTestUser, resetDatabase } from "./test-helpers";
import { recordLike } from "./interactions";
import { loadLearnedWeights, recordPassFeedback } from "./signal-weights";
import { MAX_MULTIPLIER } from "@/lib/matching/learning";

beforeEach(async () => {
  await resetDatabase();
});

describe("Smart Match learning", () => {
  it("starts neutral — a new member has taught the engine nothing", async () => {
    const userId = await createTestUser();
    expect(await loadLearnedWeights(userId)).toEqual({});
  });

  it("raises the signal a member names when passing", async () => {
    const viewer = await createTestUser();
    const other = await createTestUser();

    await recordLike(viewer, other, "pass", "language_barrier");

    const weights = await loadLearnedWeights(viewer);
    expect(weights.language).toBeGreaterThan(1);
  });

  it("learns nothing from a pass with no reason given", async () => {
    const viewer = await createTestUser();
    const other = await createTestUser();

    await recordLike(viewer, other, "pass");

    expect(await loadLearnedWeights(viewer)).toEqual({});
  });

  it("learns nothing from a reason too vague to act on", async () => {
    const viewer = await createTestUser();
    const other = await createTestUser();

    // "not my type" is deliberately unmapped: acting on it would mean guessing
    // which dimension the member meant.
    await recordLike(viewer, other, "pass", "not_my_type");

    expect(await loadLearnedWeights(viewer)).toEqual({});
  });

  it("compounds repeated feedback but never past the ceiling", async () => {
    const viewer = await createTestUser();

    for (let i = 0; i < 40; i += 1) {
      await recordPassFeedback(viewer, "too_far");
    }

    const weights = await loadLearnedWeights(viewer);
    expect(weights.location).toBe(MAX_MULTIPLIER);
  });

  it("keeps one member's learning out of another's", async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    const other = await createTestUser();

    await recordLike(a, other, "pass", "different_goal");

    expect((await loadLearnedWeights(a)).relationship_goal).toBeGreaterThan(1);
    expect(await loadLearnedWeights(b)).toEqual({});
  });

  it("clamps a multiplier edited directly in the database", async () => {
    const viewer = await createTestUser();
    await db.insert(signalWeights).values({
      userId: viewer,
      signalId: "language",
      // Far past the ceiling: one signal must not be able to dominate scoring.
      multiplier: 900
    });

    expect((await loadLearnedWeights(viewer)).language).toBe(MAX_MULTIPLIER);
  });

  it("rolls learning back with the pass that caused it", async () => {
    const viewer = await createTestUser();

    // A pass at oneself is rejected before anything is written.
    await expect(recordLike(viewer, viewer, "pass", "too_far")).rejects.toThrow();

    const rows = await db.select().from(signalWeights).where(eq(signalWeights.userId, viewer));
    expect(rows).toHaveLength(0);
  });
});
