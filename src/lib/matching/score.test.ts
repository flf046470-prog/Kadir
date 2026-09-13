import { describe, expect, it } from "vitest";
import { scoreMatch, MIN_SIGNALS_FOR_CONFIDENCE } from "./score";
import { buildReasons, describeCompatibility } from "./reasons";
import { makeProfile } from "./test-fixtures";
import type { LocationContext } from "./signals";

const sameCity: LocationContext = { approximateDistanceKm: 5, maxDistanceKm: 50 };
const noDistance: LocationContext = { approximateDistanceKm: null, maxDistanceKm: 50 };

describe("scoreMatch", () => {
  it("scores an aligned pair higher than a mismatched one", () => {
    const viewer = makeProfile({ id: "viewer" });

    const aligned = makeProfile({
      id: "aligned",
      relationshipGoal: "long_term",
      interests: ["travel", "music"],
      languagesSpoken: ["tr", "en"]
    });

    const mismatched = makeProfile({
      id: "mismatched",
      relationshipGoal: "casual",
      matchIntents: ["friendship"],
      interests: ["gaming"],
      languagesSpoken: ["ja"],
      idealDates: ["gaming"],
      communicationStyles: ["caller"]
    });

    const alignedScore = scoreMatch({ viewer, candidate: aligned, mode: "local", location: sameCity });
    const mismatchedScore = scoreMatch({
      viewer,
      candidate: mismatched,
      mode: "local",
      location: sameCity
    });

    expect(alignedScore.score).toBeGreaterThan(mismatchedScore.score);
  });

  it("treats missing data as unknown rather than as agreement", () => {
    const viewer = makeProfile({ id: "viewer" });
    const sparse = makeProfile({
      id: "sparse",
      interests: [],
      idealDates: [],
      communicationStyles: [],
      languagesSpoken: [],
      matchIntents: []
    });

    const result = scoreMatch({ viewer, candidate: sparse, mode: "local", location: sameCity });

    expect(result.unknownSignals).toContain("interests");
    expect(result.unknownSignals).toContain("language");
    expect(result.signals.some((signal) => signal.id === "interests")).toBe(false);
  });

  it("flags low confidence when too few signals have data", () => {
    const viewer = makeProfile({ id: "viewer" });
    const empty = makeProfile({
      id: "empty",
      interests: [],
      idealDates: [],
      communicationStyles: [],
      languagesSpoken: [],
      matchIntents: [],
      cityId: null,
      countryId: "japan"
    });

    const result = scoreMatch({ viewer, candidate: empty, mode: "global", location: noDistance });

    expect(result.signals.length).toBeLessThan(MIN_SIGNALS_FOR_CONFIDENCE);
    expect(result.lowConfidence).toBe(true);
    expect(describeCompatibility(result)).toEqual({ kind: "unavailable" });
  });

  it("weights distance heavily in local mode and lightly in global mode", () => {
    const viewer = makeProfile({ id: "viewer" });
    const faraway = makeProfile({ id: "far", cityId: "tokyo", countryId: "japan" });
    const distant: LocationContext = { approximateDistanceKm: 9000, maxDistanceKm: 50 };

    const local = scoreMatch({ viewer, candidate: faraway, mode: "local", location: distant });
    const global = scoreMatch({ viewer, candidate: faraway, mode: "global", location: distant });

    expect(global.score).toBeGreaterThan(local.score);
  });

  it("respects hidden fields so they cannot influence the score", () => {
    const viewer = makeProfile({ id: "viewer", cultureInterests: ["japanese"] });

    const openCandidate = makeProfile({
      id: "open",
      cultureInterests: ["japanese"],
      visibility: { ...makeProfile().visibility, cultureInterests: "everyone" }
    });

    const hiddenCandidate = makeProfile({
      id: "hidden",
      cultureInterests: ["japanese"],
      visibility: { ...makeProfile().visibility, cultureInterests: "hidden" }
    });

    const openScore = scoreMatch({
      viewer,
      candidate: openCandidate,
      mode: "culture",
      location: sameCity
    });
    const hiddenScore = scoreMatch({
      viewer,
      candidate: hiddenCandidate,
      mode: "culture",
      location: sameCity
    });

    expect(openScore.score).toBeGreaterThan(hiddenScore.score);
    const hiddenCulture = hiddenScore.signals.find((signal) => signal.id === "culture");
    expect(hiddenCulture?.evidence ?? []).toEqual([]);
  });

  it("scores a mutual language exchange above a one-way one", () => {
    const viewer = makeProfile({
      id: "viewer",
      connectionMode: "language_exchange",
      languagesSpoken: ["tr"],
      languagesLearning: ["es"]
    });

    const mutual = makeProfile({
      id: "mutual",
      connectionMode: "language_exchange",
      languagesSpoken: ["es"],
      languagesLearning: ["tr"]
    });

    const oneWay = makeProfile({
      id: "one-way",
      connectionMode: "language_exchange",
      languagesSpoken: ["es"],
      languagesLearning: ["ja"]
    });

    const mutualScore = scoreMatch({
      viewer,
      candidate: mutual,
      mode: "language",
      location: sameCity
    });
    const oneWayScore = scoreMatch({
      viewer,
      candidate: oneWay,
      mode: "language",
      location: sameCity
    });

    expect(mutualScore.score).toBeGreaterThan(oneWayScore.score);
  });
});

describe("buildReasons", () => {
  it("only emits reasons backed by real evidence", () => {
    const viewer = makeProfile({ id: "viewer", interests: ["travel", "music"] });
    const candidate = makeProfile({ id: "candidate", interests: ["travel", "music"] });

    const result = scoreMatch({ viewer, candidate, mode: "local", location: sameCity });
    const reasons = buildReasons(result);

    const interestReason = reasons.find((reason) => reason.id === "interests");
    expect(interestReason).toBeDefined();
    expect(interestReason?.values).toContain("travel");

    // Every value cited must actually be shared by both profiles.
    for (const reason of reasons) {
      for (const value of reason.values) {
        const inViewer =
          viewer.interests.includes(value) ||
          viewer.languagesSpoken.includes(value) ||
          viewer.matchIntents.includes(value as never) ||
          viewer.idealDates.includes(value as never) ||
          value === viewer.cityId ||
          value === viewer.countryId ||
          value === viewer.relationshipGoal;
        expect(inViewer).toBe(true);
      }
    }
  });

  it("does not claim a shared goal when goals merely overlap", () => {
    const viewer = makeProfile({ id: "viewer", relationshipGoal: "long_term" });
    const candidate = makeProfile({ id: "candidate", relationshipGoal: "dating" });

    const result = scoreMatch({ viewer, candidate, mode: "local", location: sameCity });
    const reasons = buildReasons(result);

    expect(reasons.some((reason) => reason.id === "relationship_goal")).toBe(false);
  });

  it("never returns more than the reason cap", () => {
    const rich = {
      interests: ["travel", "music", "food"],
      idealDates: ["coffee", "dinner"] as const,
      cultureInterests: ["japanese", "italian"] as const,
      matchIntents: ["serious_relationship", "international_dating"] as const,
      languagesSpoken: ["tr", "en"]
    };

    const viewer = makeProfile({
      id: "viewer",
      ...rich,
      idealDates: [...rich.idealDates],
      cultureInterests: [...rich.cultureInterests],
      matchIntents: [...rich.matchIntents]
    });
    const candidate = makeProfile({
      id: "candidate",
      ...rich,
      idealDates: [...rich.idealDates],
      cultureInterests: [...rich.cultureInterests],
      matchIntents: [...rich.matchIntents]
    });

    const result = scoreMatch({ viewer, candidate, mode: "local", location: sameCity });
    expect(buildReasons(result).length).toBeLessThanOrEqual(5);
  });
});

describe("describeCompatibility", () => {
  it("labels bands rather than asserting a precise figure", () => {
    const viewer = makeProfile({ id: "viewer" });
    const candidate = makeProfile({ id: "candidate" });

    const result = scoreMatch({ viewer, candidate, mode: "local", location: sameCity });
    const display = describeCompatibility(result);

    expect(display.kind).toBe("band");
    if (display.kind === "band") {
      expect(["exploring", "promising", "strong"]).toContain(display.band);
      expect(display.percent).toBeGreaterThanOrEqual(0);
      expect(display.percent).toBeLessThanOrEqual(100);
    }
  });
});
