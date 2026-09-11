import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "./client";
import { dailySuggestions } from "./schema";
import { createTestUser, resetDatabase } from "./test-helpers";
import { chooseForDay, todaysFive, utcDay } from "./daily-suggestions";
import { TODAYS_FIVE_LIMIT } from "@/lib/matching/todays-five";

beforeEach(async () => {
  await resetDatabase();
});

/** A viewer and enough plausible candidates to fill a day and then some. */
async function population(candidates = 10) {
  const viewer = await createTestUser({ interests: ["travel", "music"] });
  const others: string[] = [];
  for (let i = 0; i < candidates; i++) {
    others.push(await createTestUser({ interests: ["travel", "music"] }));
  }
  return { viewer, others };
}

async function storedFor(userId: string, day: string) {
  return db
    .select()
    .from(dailySuggestions)
    .where(and(eq(dailySuggestions.userId, userId), eq(dailySuggestions.forDate, day)));
}

describe("the day's list", () => {
  it("is at most five, and the same on a second read", async () => {
    const { viewer } = await population();
    const day = utcDay();

    const first = await todaysFive(viewer, day);
    const second = await todaysFive(viewer, day);

    expect(first.length).toBeLessThanOrEqual(TODAYS_FIVE_LIMIT);
    expect(second.map((row) => row.profileId)).toEqual(first.map((row) => row.profileId));
  });

  it("stores it once rather than on every read", async () => {
    const { viewer } = await population();
    const day = utcDay();

    await todaysFive(viewer, day);
    const afterFirst = await storedFor(viewer, day);
    await todaysFive(viewer, day);
    const afterSecond = await storedFor(viewer, day);

    expect(afterSecond).toHaveLength(afterFirst.length);
  });

  /**
   * The defect this replaces.
   *
   * The write was `onConflictDoNothing`, and the primary key is (member, date,
   * *suggested member*) rather than (member, date, rank). Two tabs opening the
   * page at the same instant both compute a list, and those lists need not
   * agree — `findCandidateIds` drops anyone the viewer has judged, so a pass in
   * one tab changes what the other picks, and a new signup does it too. The
   * overlap conflicted and was skipped while the differences inserted, so the
   * day ended up with more than five rows carrying duplicate ranks: Today's 5
   * became Today's 8, in an order that depended on which row came back first.
   *
   * Reached through `chooseForDay` because `todaysFive` reads the stored list
   * first and only selects when it is empty, so the racing selection cannot be
   * provoked through it.
   */
  it("adopts a list another request already stored, rather than adding to it", async () => {
    const { viewer, others } = await population();
    const day = utcDay();

    // What this member's selection would pick on its own.
    const mine = await chooseForDay(viewer, day);
    expect(mine.length).toBeGreaterThan(0);

    // Now pretend a concurrent request won the race with a *different* list:
    // people this selection did not pick.
    await db.delete(dailySuggestions).where(eq(dailySuggestions.userId, viewer));

    const theirs = others
      .filter((id) => !mine.some((row) => row.suggestedUserId === id))
      .slice(0, TODAYS_FIVE_LIMIT);
    expect(theirs.length).toBeGreaterThan(0);

    await db.insert(dailySuggestions).values(
      theirs.map((suggestedUserId, rank) => ({
        userId: viewer,
        forDate: day,
        suggestedUserId,
        score: 90,
        reasons: "[]",
        rank
      }))
    );

    // The losing selection must take the stored list as the day's list.
    const adopted = await chooseForDay(viewer, day);

    expect(adopted.map((row) => row.suggestedUserId).sort()).toEqual([...theirs].sort());

    const rows = await storedFor(viewer, day);
    expect(rows).toHaveLength(theirs.length);

    // The corrupted state the merge produced: more than five rows, and two of
    // them claiming the same position in the list.
    const ranks = rows.map((row) => row.rank);
    expect(new Set(ranks).size).toBe(ranks.length);
    expect(rows.length).toBeLessThanOrEqual(TODAYS_FIVE_LIMIT);
  });

  it("keeps one list per day when several reads arrive at once", async () => {
    const { viewer } = await population();
    const day = utcDay();

    const lists = await Promise.all(
      Array.from({ length: 6 }, () => todaysFive(viewer, day))
    );

    const rows = await storedFor(viewer, day);
    expect(rows.length).toBeLessThanOrEqual(TODAYS_FIVE_LIMIT);
    expect(new Set(rows.map((row) => row.rank)).size).toBe(rows.length);

    // Every reader saw the same day, in the same order.
    const ids = lists.map((list) => list.map((row) => row.profileId).join(","));
    expect(new Set(ids).size).toBe(1);
  });
});
