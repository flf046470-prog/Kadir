import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { profileAttributes, profiles } from "./schema";
import { createTestUser, resetDatabase } from "./test-helpers";
import { findCandidateIds, genderPreferenceOf } from "./profile-repository";
import { discoverableBy } from "@/lib/matching/gender";
import type { GenderId } from "@/lib/domain/taxonomies";

/**
 * The mutual gender filter, checked in the database rather than in the rule.
 *
 * `discoverableBy` is the readable statement of the rule and `findCandidateIds`
 * is the same rule in SQL. Two expressions of one rule drift, so these tests
 * assert the SQL against the function rather than against a hand-written
 * expectation — a change to either that does not change the other fails here.
 */

beforeEach(async () => {
  await resetDatabase();
});

async function member(gender: GenderId | null, seeking: GenderId[] = []): Promise<string> {
  const id = await createTestUser({ complete: true });
  await db.update(profiles).set({ gender }).where(eq(profiles.userId, id));
  if (seeking.length > 0) {
    await db
      .insert(profileAttributes)
      .values(seeking.map((value) => ({ userId: id, kind: "seeking", value })));
  }
  return id;
}

describe("the mutual gender filter", () => {
  it("shows two people who are each seeking the other", async () => {
    const viewer = await member("woman", ["man"]);
    const candidate = await member("man", ["woman"]);

    expect(await findCandidateIds(viewer)).toContain(candidate);
  });

  it("hides someone the viewer is not seeking", async () => {
    const viewer = await member("woman", ["woman"]);
    const candidate = await member("man", ["woman"]);

    expect(await findCandidateIds(viewer)).not.toContain(candidate);
  });

  /**
   * The half a one-sided filter gets wrong: the viewer is interested, the
   * candidate could never be. Showing them produces likes that are dead on
   * arrival.
   */
  it("hides someone who is not seeking the viewer", async () => {
    const viewer = await member("man", ["man"]);
    const candidate = await member("man", ["woman"]);

    expect(await findCandidateIds(viewer)).not.toContain(candidate);
  });

  it("includes non-binary members in both directions", async () => {
    const viewer = await member("non_binary", ["woman", "non_binary"]);
    const woman = await member("woman", ["non_binary"]);
    const enby = await member("non_binary", ["non_binary"]);
    const man = await member("man", ["non_binary"]);

    const seen = await findCandidateIds(viewer);
    expect(seen).toContain(woman);
    expect(seen).toContain(enby);
    expect(seen).not.toContain(man);
  });
});

describe("members who have not answered", () => {
  /**
   * The property that makes this safe to deploy. Every existing member has a
   * null gender and no seeking rows on the migration that adds the column; if
   * that emptied their feed, the symptom would read as "the app has no users".
   */
  it("keeps working for a viewer who has answered nothing", async () => {
    const viewer = await member(null);
    const a = await member("woman", ["man"]);
    const b = await member("man", ["woman"]);
    const c = await member("non_binary", ["non_binary"]);

    const seen = await findCandidateIds(viewer);
    expect(seen).toEqual(expect.arrayContaining([a, b, c]));
  });

  it("keeps showing a candidate who has answered nothing", async () => {
    const viewer = await member("woman", ["man"]);
    const unanswered = await member(null);

    expect(await findCandidateIds(viewer)).toContain(unanswered);
  });

  it("treats a stated gender with no stated preference as no preference", async () => {
    const viewer = await member("woman", []);
    const man = await member("man", ["woman"]);
    const woman = await member("woman", ["woman"]);

    const seen = await findCandidateIds(viewer);
    expect(seen).toContain(man);
    expect(seen).toContain(woman);
  });
});

describe("the SQL and the rule agree", () => {
  /**
   * Every combination of stated and unstated, both sides, checked against
   * `discoverableBy`. This is the test that catches a change to one expression
   * of the rule and not the other.
   */
  it("matches discoverableBy for every combination", async () => {
    const shapes: { gender: GenderId | null; seeking: GenderId[] }[] = [
      { gender: null, seeking: [] },
      { gender: "woman", seeking: [] },
      { gender: "woman", seeking: ["man"] },
      { gender: "woman", seeking: ["woman", "non_binary"] },
      { gender: "man", seeking: ["woman"] },
      { gender: "man", seeking: ["man"] },
      { gender: "non_binary", seeking: ["non_binary"] },
      { gender: "non_binary", seeking: ["woman", "man", "non_binary"] }
    ];

    const ids: string[] = [];
    for (const shape of shapes) ids.push(await member(shape.gender, shape.seeking));

    for (let i = 0; i < shapes.length; i += 1) {
      const seen = await findCandidateIds(ids[i]);

      for (let j = 0; j < shapes.length; j += 1) {
        if (i === j) continue;
        const expected = discoverableBy(shapes[i], shapes[j]);
        expect(
          seen.includes(ids[j]),
          `viewer ${JSON.stringify(shapes[i])} → candidate ${JSON.stringify(shapes[j])}`
        ).toBe(expected);
      }
    }
  });
});

/**
 * A value the taxonomy has retired is read back as *unanswered*, so the SQL has
 * to treat it that way too. Testing only for null in the filter would hide such
 * a member while `discoverableBy` showed them to everyone — the two expressions
 * of one rule disagreeing, in opposite directions, on the rows nobody looks at.
 */
describe("values the taxonomy no longer knows", () => {
  async function retired(gender: string | null, seeking: string[] = []): Promise<string> {
    const id = await createTestUser({ complete: true });
    await db.update(profiles).set({ gender }).where(eq(profiles.userId, id));
    if (seeking.length > 0) {
      await db
        .insert(profileAttributes)
        .values(seeking.map((value) => ({ userId: id, kind: "seeking", value })));
    }
    return id;
  }

  it("shows a candidate whose gender is a retired value, like an unanswered one", async () => {
    const viewer = await member("woman", ["man"]);
    const stale = await retired("retired_value");
    const unanswered = await member(null);

    const seen = await findCandidateIds(viewer);
    expect(seen).toContain(stale);
    expect(seen).toContain(unanswered);
  });

  it("treats a candidate whose only preference is retired as having none", async () => {
    const viewer = await member("woman", ["man"]);
    const stale = await retired("man", ["retired_value"]);

    expect(await findCandidateIds(viewer)).toContain(stale);
  });

  it("agrees with discoverableBy on those rows", async () => {
    const viewerShape = { gender: "woman" as const, seeking: ["man" as const] };
    const viewer = await member(viewerShape.gender, viewerShape.seeking);
    const stale = await retired("retired_value", ["retired_value"]);

    // Read back the way everything else reads it: unanswered on both counts.
    expect(await genderPreferenceOf(stale)).toEqual({ gender: null, seeking: [] });
    expect(discoverableBy(viewerShape, { gender: null, seeking: [] })).toBe(true);
    expect(await findCandidateIds(viewer)).toContain(stale);
  });
});

describe("reading a member's preference back", () => {
  it("returns what was stored", async () => {
    const id = await member("non_binary", ["woman", "man"]);

    const preference = await genderPreferenceOf(id);
    expect(preference.gender).toBe("non_binary");
    expect(preference.seeking.sort()).toEqual(["man", "woman"]);
  });

  it("reports an unanswered member as unanswered rather than as a default", async () => {
    const id = await member(null);

    expect(await genderPreferenceOf(id)).toEqual({ gender: null, seeking: [] });
  });

  /**
   * A value the taxonomy no longer knows is treated as unanswered rather than
   * trusted into a filter — the same way every other closed vocabulary here is
   * read back.
   */
  it("ignores a value that is no longer in the taxonomy", async () => {
    const id = await createTestUser({ complete: true });
    await db.update(profiles).set({ gender: "retired_value" }).where(eq(profiles.userId, id));
    await db
      .insert(profileAttributes)
      .values({ userId: id, kind: "seeking", value: "retired_value" });

    expect(await genderPreferenceOf(id)).toEqual({ gender: null, seeking: [] });
  });
});
