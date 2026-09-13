import { afterEach, describe, expect, it } from "vitest";
import { ROLLOUT_STEPS, defaultFlags, isEnabled, type FeatureName } from "./flags";
import { flagConfig, parseFlagOverrides, resetFlagConfig } from "./config";
import { DARK_FLAGS, WIRED_FLAGS, enabledFeaturesFor, featureEnabled } from "./server";

/**
 * The flag system, which until now described nothing.
 *
 * Twenty-two flags were declared with rollout percentages and `isEnabled` had
 * no callers anywhere in the codebase. Every number in `defaultFlags` was
 * therefore decoration: no feature was gated by it, no rollout could be
 * widened, and no incident could be stopped by flipping one. These tests are
 * about the two things that make it real — configuration that arrives from
 * outside the build, and a list of what is genuinely wired.
 */

afterEach(() => {
  delete process.env.FEATURE_FLAGS;
  resetFlagConfig();
});

describe("reading the override", () => {
  it("is empty when nothing is set", () => {
    expect(parseFlagOverrides(undefined)).toEqual({});
    expect(parseFlagOverrides("")).toEqual({});
  });

  it("takes a rollout for a known feature", () => {
    expect(parseFlagOverrides('{"ai_translation":{"rollout":25}}')).toEqual({
      ai_translation: { rollout: 25 }
    });
  });

  it("takes a kill switch", () => {
    const parsed = parseFlagOverrides('{"ai_translation":{"killed":true}}');
    expect(parsed.ai_translation?.killed).toBe(true);
    // Killing does not also reset the percentage — the rollout is still what it
    // was, so lifting the kill restores the cohort rather than starting over.
    expect(parsed.ai_translation?.rollout).toBe(defaultFlags.ai_translation.rollout);
  });

  it("takes an always-on list for internal testing", () => {
    expect(parseFlagOverrides('{"todays_five":{"alwaysOn":["a","b"]}}').todays_five?.alwaysOn).toEqual(
      ["a", "b"]
    );
  });

  /**
   * The failure this exists to prevent. A misspelled flag parses cleanly,
   * overrides nothing, and leaves the operator believing they turned something
   * off — which during an incident is the difference between a kill switch and
   * a delay.
   */
  it("refuses a name that is not a feature", () => {
    expect(() => parseFlagOverrides('{"ai_translations":{"rollout":0}}')).toThrow(
      /not a feature/
    );
  });

  /**
   * Only the published steps, so a widening is always a superset of the cohort
   * before it. An arbitrary integer invites narrowing 25 to 20, which takes the
   * feature back from members who already had it.
   */
  it("refuses a rollout that is not one of the steps", () => {
    expect(() => parseFlagOverrides('{"ai_translation":{"rollout":37}}')).toThrow(/must be one of/);
    expect(() => parseFlagOverrides('{"ai_translation":{"rollout":"25"}}')).toThrow(/must be one of/);
  });

  it.each([
    ["not json at all", /not valid JSON/],
    ['["ai_translation"]', /must be a JSON object/],
    ['{"ai_translation":"on"}', /must be an object/],
    ['{"ai_translation":{"killed":"yes"}}', /must be a boolean/],
    ['{"ai_translation":{"alwaysOn":"someone"}}', /must be an array/]
  ])("refuses %s", (raw, message) => {
    expect(() => parseFlagOverrides(raw)).toThrow(message);
  });

  it("names the flag in the error, since this throws at startup", () => {
    expect(() => parseFlagOverrides('{"match_games":{"rollout":3}}')).toThrow(/match_games/);
  });
});

describe("the live configuration", () => {
  it("reads the environment and caches it", () => {
    process.env.FEATURE_FLAGS = '{"ai_translation":{"rollout":5}}';
    resetFlagConfig();
    expect(flagConfig().ai_translation?.rollout).toBe(5);
  });

  it("throws at startup rather than silently ignoring a bad value", () => {
    process.env.FEATURE_FLAGS = "{oops";
    resetFlagConfig();
    expect(() => flagConfig()).toThrow(/not valid JSON/);
  });

  /**
   * The failure this file exists to prevent, and the one it used to allow.
   *
   * Unknown flag *names* threw; unknown keys inside an entry did not. A
   * mistyped kill switch therefore parsed cleanly, left the feature at full
   * rollout, and said nothing — while the operator believed it was off. Anyone
   * reaching for a kill switch is already having a bad day.
   */
  it("throws on a mistyped key inside an entry, rather than ignoring it", () => {
    process.env.FEATURE_FLAGS = JSON.stringify({ ai_translation: { kill: true } });
    resetFlagConfig();

    expect(() => flagConfig()).toThrow(/unknown key\(s\) kill/);
  });

  it("names every unrecognised key, so one fix covers them all", () => {
    process.env.FEATURE_FLAGS = JSON.stringify({
      ai_translation: { rollout: 5, enabled: true, percent: 50 }
    });
    resetFlagConfig();

    expect(() => flagConfig()).toThrow(/enabled, percent/);
  });

  it("still accepts every key it does understand", () => {
    process.env.FEATURE_FLAGS = JSON.stringify({
      ai_translation: { rollout: 25, killed: false, alwaysOn: ["someone"] }
    });
    resetFlagConfig();

    expect(flagConfig().ai_translation).toEqual({
      rollout: 25,
      killed: false,
      alwaysOn: ["someone"]
    });
  });
});

describe("reading a flag for a member", () => {
  it("is on for everyone at 100", () => {
    expect(featureEnabled("ai_translation", "member-1")).toBe(true);
    expect(featureEnabled("ai_translation", "member-2")).toBe(true);
  });

  it("is off for everyone once killed", () => {
    process.env.FEATURE_FLAGS = '{"ai_translation":{"killed":true}}';
    resetFlagConfig();
    expect(featureEnabled("ai_translation", "member-1")).toBe(false);
  });

  /**
   * A signed-out visitor has no stable id, and anything derived from an IP or a
   * fresh cookie would move them between cohorts on every visit — the one
   * property a staged rollout cannot have. Off is the answer, not a guess.
   */
  it("is off without a member id", () => {
    expect(featureEnabled("ai_translation", null)).toBe(false);
    expect(enabledFeaturesFor(null)).toEqual([]);
  });

  it("lists what is on for a member", () => {
    expect(enabledFeaturesFor("member-1")).toContain("ai_translation");
    // Unbuilt features stay off, so the list is short by design.
    expect(enabledFeaturesFor("member-1")).not.toContain("ai_matchmaker");
  });

  /**
   * The property the whole staged-rollout idea rests on: widening only ever
   * adds people. Checked against real bucketing rather than asserted, because
   * it is a claim about the hash, not about intent.
   */
  it("only ever grows a cohort as the rollout widens", () => {
    const members = Array.from({ length: 400 }, (_, i) => `member-${i}`);
    let previous: string[] = [];

    for (const rollout of ROLLOUT_STEPS) {
      const cohort = members.filter((memberId) =>
        isEnabled("todays_five", { memberId, flags: { todays_five: { rollout } } })
      );
      for (const member of previous) expect(cohort).toContain(member);
      previous = cohort;
    }

    expect(previous).toHaveLength(members.length);
  });
});

describe("which flags are actually read", () => {
  /**
   * The list exists so the dead flags are declared rather than forgotten. It is
   * only useful while it is true, so this checks both directions: every wired
   * flag is a real feature name, and a wired flag is not left at zero — which
   * would mean a gate was added to a shipping feature and turned it off for
   * everybody.
   */
  it("names only real features", () => {
    for (const flag of WIRED_FLAGS) expect(Object.keys(defaultFlags)).toContain(flag);
  });

  it("does not gate a shipping feature at zero", () => {
    for (const flag of WIRED_FLAGS) {
      if (DARK_FLAGS.includes(flag)) continue;
      expect(defaultFlags[flag].rollout).toBeGreaterThan(0);
    }
  });

  /**
   * The other side of that exemption, so it cannot be used to hide a gate that
   * was simply forgotten. A deliberately dark flag has to be wired — otherwise
   * it is an unbuilt feature and belongs in neither list — and it has to be at
   * zero, because a dark flag at 25% is on for a quarter of the members.
   */
  it("keeps the deliberately dark flags wired and at zero", () => {
    for (const flag of DARK_FLAGS) {
      expect(WIRED_FLAGS).toContain(flag);
      expect(defaultFlags[flag].rollout).toBe(0);
    }
  });

  /**
   * Most flags are still unread. That is the honest state — the alternative
   * would have been wiring twenty-two gates for features that do not exist —
   * and writing it down is what stops the number from quietly becoming
   * twenty-two again.
   */
  it("leaves the unbuilt features dark", () => {
    const unwired = (Object.keys(defaultFlags) as FeatureName[]).filter(
      (flag) => !WIRED_FLAGS.includes(flag)
    );

    expect(unwired.length).toBeGreaterThan(0);
    for (const flag of unwired) expect(defaultFlags[flag].rollout).toBe(0);
  });
});
