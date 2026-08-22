import { describe, expect, it, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { users } from "./schema";
import { createTestUser, resetDatabase } from "./test-helpers";
import { findCandidateIds } from "./profile-repository";
import { recordLike, blockUser } from "./interactions";
import { parseFilters } from "@/lib/matching/filters";

/**
 * Discovery filters, against a real database.
 *
 * Two questions these answer that a unit test cannot: does each filter actually
 * narrow the SQL result, and do the exclusions that protect members — blocked,
 * suspended, already judged — still hold once a filter is applied? A filter
 * that quietly re-admitted a blocked member would be a safety bug, not a
 * search bug.
 */

beforeEach(async () => {
  await resetDatabase();
});

/** Runs the query the way the API does: through the parser, never around it. */
function filters(query: string) {
  return parseFilters(new URLSearchParams(query));
}

function candidates(viewerId: string, query = "") {
  return findCandidateIds(viewerId, { filters: filters(query) });
}

/** A birthdate that makes someone exactly `age` years old today. */
function birthdateForAge(age: number): string {
  const today = new Date();
  const date = new Date(
    Date.UTC(today.getUTCFullYear() - age, today.getUTCMonth(), today.getUTCDate())
  );
  return date.toISOString().slice(0, 10);
}

describe("no filters", () => {
  it("returns every eligible candidate", async () => {
    const viewer = await createTestUser();
    const other = await createTestUser();

    expect(await candidates(viewer)).toContain(other);
  });

  it("does not exclude members by age when no age was asked for", async () => {
    const viewer = await createTestUser();
    const young = await createTestUser({ birthdate: birthdateForAge(19) });
    const old = await createTestUser({ birthdate: birthdateForAge(71) });

    const results = await candidates(viewer);
    expect(results).toContain(young);
    expect(results).toContain(old);
  });
});

describe("place filters", () => {
  it("narrows to a country", async () => {
    const viewer = await createTestUser({ countryId: "turkey" });
    const local = await createTestUser({ countryId: "turkey" });
    const abroad = await createTestUser({ countryId: "germany" });

    const results = await candidates(viewer, "countryId=turkey");
    expect(results).toContain(local);
    expect(results).not.toContain(abroad);
  });

  it("matches a country however the member typed it", async () => {
    const viewer = await createTestUser();
    // Registration slugifies, so this profile is stored as "united-states".
    const american = await createTestUser({ countryId: "United States" });

    expect(await candidates(viewer, "countryId=United+States")).toContain(american);
    expect(await candidates(viewer, "countryId=united-states")).toContain(american);
  });

  it("narrows to a city", async () => {
    const viewer = await createTestUser();
    const here = await createTestUser({ cityId: "istanbul" });
    const elsewhere = await createTestUser({ cityId: "izmir" });

    const results = await candidates(viewer, "cityId=istanbul");
    expect(results).toContain(here);
    expect(results).not.toContain(elsewhere);
  });

  it("lets an explicit country filter override the discovery mode's country", async () => {
    const viewer = await createTestUser({ countryId: "turkey" });
    const german = await createTestUser({ countryId: "germany" });

    // LOCAL mode pins the viewer's own country; the filter is the member's
    // stated intent and wins.
    const results = await findCandidateIds(viewer, {
      countryId: "turkey",
      filters: filters("countryId=germany")
    });

    expect(results).toContain(german);
  });
});

describe("attribute filters", () => {
  it("narrows by relationship goal", async () => {
    const viewer = await createTestUser();
    const marriage = await createTestUser({ relationshipGoal: "marriage" });
    const casual = await createTestUser({ relationshipGoal: "casual" });

    const results = await candidates(viewer, "goals=marriage");
    expect(results).toContain(marriage);
    expect(results).not.toContain(casual);
  });

  it("keeps a candidate who has any one of the requested languages", async () => {
    const viewer = await createTestUser();
    const speaksGerman = await createTestUser({ languagesSpoken: ["de"] });
    const speaksJapanese = await createTestUser({ languagesSpoken: ["ja"] });

    const results = await candidates(viewer, "languages=de,fr");
    expect(results).toContain(speaksGerman);
    expect(results).not.toContain(speaksJapanese);
  });

  it("narrows by match intent", async () => {
    const viewer = await createTestUser();
    const exchange = await createTestUser({ matchIntents: ["language_exchange"] });
    const serious = await createTestUser({ matchIntents: ["serious_relationship"] });

    const results = await candidates(viewer, "intents=language_exchange");
    expect(results).toContain(exchange);
    expect(results).not.toContain(serious);
  });

  it("narrows by culture interest", async () => {
    const viewer = await createTestUser();
    const interested = await createTestUser({ cultureInterests: ["japanese"] });
    const other = await createTestUser({ cultureInterests: ["italian"] });

    const results = await candidates(viewer, "cultures=japanese");
    expect(results).toContain(interested);
    expect(results).not.toContain(other);
  });

  it("requires a candidate to satisfy every category asked for, not just one", async () => {
    const viewer = await createTestUser();
    const both = await createTestUser({
      languagesSpoken: ["de"],
      matchIntents: ["language_exchange"]
    });
    const languageOnly = await createTestUser({
      languagesSpoken: ["de"],
      matchIntents: ["serious_relationship"]
    });

    const results = await candidates(viewer, "languages=de&intents=language_exchange");
    expect(results).toContain(both);
    expect(results).not.toContain(languageOnly);
  });
});

describe("age filter", () => {
  it("excludes members outside the window", async () => {
    const viewer = await createTestUser();
    const tooYoung = await createTestUser({ birthdate: birthdateForAge(22) });
    const inRange = await createTestUser({ birthdate: birthdateForAge(32) });
    const tooOld = await createTestUser({ birthdate: birthdateForAge(45) });

    const results = await candidates(viewer, "minAge=30&maxAge=40");
    expect(results).toContain(inRange);
    expect(results).not.toContain(tooYoung);
    expect(results).not.toContain(tooOld);
  });

  it("includes members exactly at both ends of the window", async () => {
    const viewer = await createTestUser();
    const atMin = await createTestUser({ birthdate: birthdateForAge(30) });
    const atMax = await createTestUser({ birthdate: birthdateForAge(40) });

    const results = await candidates(viewer, "minAge=30&maxAge=40");
    expect(results).toContain(atMin);
    expect(results).toContain(atMax);
  });

  it("reads age from the birthdate, so it cannot go stale", async () => {
    const viewer = await createTestUser();
    // Someone whose birthday is tomorrow is still the younger age today.
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const almost30 = await createTestUser({
      birthdate: `${tomorrow.getUTCFullYear() - 30}-${String(tomorrow.getUTCMonth() + 1).padStart(2, "0")}-${String(tomorrow.getUTCDate()).padStart(2, "0")}`
    });

    expect(await candidates(viewer, "minAge=30")).not.toContain(almost30);
    expect(await candidates(viewer, "minAge=29")).toContain(almost30);
  });
});

describe("hostile input", () => {
  it("drops values that are not in the taxonomy instead of querying with them", async () => {
    const viewer = await createTestUser();
    const other = await createTestUser();

    // The parser drops every one of these, so the query runs unfiltered rather
    // than with attacker-supplied text in it.
    const results = await candidates(
      viewer,
      "goals=%27%29%20or%20true--&intents=%3Cscript%3E&cultures=..%2F..%2Fetc%2Fpasswd&languages=%27%3B%20drop%20table%20users%3B--"
    );

    expect(results).toContain(other);

    const remaining = await db.select({ id: users.id }).from(users);
    expect(remaining.length).toBe(2);
  });

  it("treats a filter value as data even when it looks like SQL", async () => {
    const viewer = await createTestUser();
    await createTestUser({ cityId: "istanbul" });

    // A place slugifies rather than being rejected, so this one reaches the
    // query — as a literal value that simply matches nobody.
    const results = await candidates(viewer, "cityId=istanbul%27%3B%20drop%20table%20users%3B--");
    expect(results).toEqual([]);

    const remaining = await db.select({ id: users.id }).from(users);
    expect(remaining.length).toBe(2);
  });
});

describe("exclusions still apply with filters on", () => {
  const query = "minAge=18&maxAge=99&goals=long_term&languages=tr";

  it("never returns the viewer", async () => {
    const viewer = await createTestUser();
    expect(await candidates(viewer, query)).not.toContain(viewer);
  });

  it("never returns someone the viewer already judged", async () => {
    const viewer = await createTestUser();
    const other = await createTestUser();

    await recordLike(viewer, other, "pass");
    expect(await candidates(viewer, query)).not.toContain(other);
  });

  it("never returns a blocked member, in either direction", async () => {
    const viewer = await createTestUser();
    const blockedByViewer = await createTestUser();
    const blockedViewer = await createTestUser();

    await blockUser(viewer, blockedByViewer);
    await blockUser(blockedViewer, viewer);

    const results = await candidates(viewer, query);
    expect(results).not.toContain(blockedByViewer);
    expect(results).not.toContain(blockedViewer);
  });

  it("never returns an incomplete profile", async () => {
    const viewer = await createTestUser();
    const incomplete = await createTestUser({ complete: false });

    expect(await candidates(viewer, query)).not.toContain(incomplete);
  });

  it("never returns a suspended or deleted member", async () => {
    const viewer = await createTestUser();
    const suspended = await createTestUser();
    const deleted = await createTestUser();

    await db.update(users).set({ suspendedAt: new Date() }).where(eq(users.id, suspended));
    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, deleted));

    const results = await candidates(viewer, query);
    expect(results).not.toContain(suspended);
    expect(results).not.toContain(deleted);
  });
});
