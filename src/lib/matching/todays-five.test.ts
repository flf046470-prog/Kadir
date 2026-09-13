import { describe, expect, it } from "vitest";
import { selectTodaysFive, TODAYS_FIVE_LIMIT } from "./todays-five";
import { parseCriteria, isEmpty } from "./matchmaker";
import { applyFeedback, decayTowardNeutral, MAX_MULTIPLIER } from "./learning";
import { makeProfile } from "./test-fixtures";
import type { LocationContext } from "./signals";

const near: LocationContext = { approximateDistanceKm: 8, maxDistanceKm: 50 };

function candidates(count: number) {
  return Array.from({ length: count }, (_, i) =>
    makeProfile({ id: `candidate-${i}`, interests: ["travel", "music"] })
  );
}

function locationsFor(ids: string[]) {
  return Object.fromEntries(ids.map((id) => [id, near]));
}

describe("selectTodaysFive", () => {
  it("returns at most five suggestions", () => {
    const list = candidates(40);
    const result = selectTodaysFive({
      viewer: makeProfile({ id: "viewer" }),
      candidates: list,
      mode: "local",
      locations: locationsFor(list.map((c) => c.id))
    });

    expect(result.length).toBeLessThanOrEqual(TODAYS_FIVE_LIMIT);
  });

  it("returns fewer than five rather than padding with weak matches", () => {
    const weak = Array.from({ length: 20 }, (_, i) =>
      makeProfile({
        id: `weak-${i}`,
        relationshipGoal: "friendship",
        matchIntents: ["friendship"],
        interests: [],
        idealDates: [],
        communicationStyles: [],
        languagesSpoken: [],
        cityId: null,
        countryId: "japan"
      })
    );

    const result = selectTodaysFive({
      viewer: makeProfile({ id: "viewer" }),
      candidates: weak,
      mode: "local",
      locations: {}
    });

    expect(result.length).toBeLessThan(TODAYS_FIVE_LIMIT);
  });

  it("is stable across repeated runs", () => {
    const list = candidates(30);
    const input = {
      viewer: makeProfile({ id: "viewer" }),
      candidates: list,
      mode: "local" as const,
      locations: locationsFor(list.map((c) => c.id))
    };

    const first = selectTodaysFive(input).map((s) => s.profileId);
    const second = selectTodaysFive(input).map((s) => s.profileId);
    expect(first).toEqual(second);
  });

  it("never suggests the viewer or excluded profiles", () => {
    const list = candidates(10);
    const viewer = makeProfile({ id: "candidate-0", interests: ["travel", "music"] });

    const result = selectTodaysFive({
      viewer,
      candidates: list,
      mode: "local",
      locations: locationsFor(list.map((c) => c.id)),
      excludeIds: new Set(["candidate-1", "candidate-2"])
    });

    const ids = result.map((s) => s.profileId);
    expect(ids).not.toContain("candidate-0");
    expect(ids).not.toContain("candidate-1");
    expect(ids).not.toContain("candidate-2");
  });

  it("attaches reasons to every suggestion it makes", () => {
    const list = candidates(10);
    const result = selectTodaysFive({
      viewer: makeProfile({ id: "viewer" }),
      candidates: list,
      mode: "local",
      locations: locationsFor(list.map((c) => c.id))
    });

    expect(result.length).toBeGreaterThan(0);
    for (const suggestion of result) {
      expect(suggestion.reasons.length).toBeGreaterThan(0);
    }
  });
});

describe("parseCriteria", () => {
  it("keeps only values from the known taxonomies", () => {
    const criteria = parseCriteria({
      relationshipGoals: ["long_term", "made_up_goal"],
      cultures: ["japanese", "atlantean"],
      travelStyles: ["food", "teleporting"],
      languages: ["en", "klingon", "tr"]
    });

    expect(criteria.relationshipGoals).toEqual(["long_term"]);
    expect(criteria.cultures).toEqual(["japanese"]);
    expect(criteria.travelStyles).toEqual(["food"]);
    expect(criteria.languages).toEqual(["en", "tr"]);
  });

  it("drops non-string and malformed input instead of guessing", () => {
    const criteria = parseCriteria({
      relationshipGoals: "long_term",
      interests: [42, null, "travel"],
      languages: [{ code: "en" }]
    });

    expect(criteria.relationshipGoals).toEqual([]);
    expect(criteria.interests).toEqual(["travel"]);
    expect(criteria.languages).toEqual([]);
  });

  it("caps field sizes so one request cannot broaden a search indefinitely", () => {
    const criteria = parseCriteria({
      interests: Array.from({ length: 50 }, (_, i) => `interest-${i}`)
    });
    expect(criteria.interests.length).toBeLessThanOrEqual(8);
  });

  it("reports when nothing usable survived", () => {
    expect(isEmpty(parseCriteria({ relationshipGoals: ["nonsense"] }))).toBe(true);
    expect(isEmpty(parseCriteria({ interests: ["travel"] }))).toBe(false);
  });
});

describe("learning loop", () => {
  it("raises the weight of the signal a member keeps complaining about", () => {
    const adjusted = applyFeedback({}, [
      { reason: "too_far" },
      { reason: "too_far" },
      { reason: "too_far" }
    ]);
    expect(adjusted.location).toBeGreaterThan(1);
  });

  it("caps adjustments so one signal cannot dominate", () => {
    const many = Array.from({ length: 100 }, () => ({ reason: "too_far" as const }));
    const adjusted = applyFeedback({}, many);
    expect(adjusted.location).toBeLessThanOrEqual(MAX_MULTIPLIER);
  });

  it("ignores vague reasons rather than inferring a preference", () => {
    const adjusted = applyFeedback({}, [
      { reason: "not_my_type" },
      { reason: "not_interested" },
      { reason: "other" }
    ]);
    expect(adjusted).toEqual({});
  });

  it("decays back toward neutral so preferences do not calcify", () => {
    let weights = applyFeedback({}, Array.from({ length: 20 }, () => ({ reason: "too_far" as const })));
    for (let i = 0; i < 50; i++) weights = decayTowardNeutral(weights);
    expect(weights.location).toBeCloseTo(1, 5);
  });
});
