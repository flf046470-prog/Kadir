import { describe, expect, it } from "vitest";
import {
  bucketOf,
  defaultFlags,
  enabledFeatures,
  isEnabled,
  ROLLOUT_STEPS,
  type FeatureName,
  type FlagConfig,
  type RolloutPercent
} from "./flags";

const memberIds = Array.from({ length: 5000 }, (_, i) => `member-${i}`);

function withRollout(rollout: RolloutPercent): Partial<Record<FeatureName, FlagConfig>> {
  return { todays_five: { rollout } };
}

describe("isEnabled", () => {
  it("ships every feature off by default", () => {
    for (const config of Object.values(defaultFlags)) {
      expect(config.rollout).toBe(0);
    }
    expect(enabledFeatures({ memberId: "anyone" })).toEqual([]);
  });

  it("is deterministic for the same member and flag", () => {
    const context = { memberId: "member-42", flags: withRollout(50) };
    const first = isEnabled("todays_five", context);
    for (let i = 0; i < 20; i++) {
      expect(isEnabled("todays_five", context)).toBe(first);
    }
  });

  it("keeps cohorts nested as the rollout widens", () => {
    // Anyone enabled at a given step must stay enabled at every larger step.
    for (const memberId of memberIds.slice(0, 500)) {
      let wasEnabled = false;
      for (const rollout of ROLLOUT_STEPS) {
        const enabled = isEnabled("todays_five", { memberId, flags: withRollout(rollout) });
        if (wasEnabled) expect(enabled).toBe(true);
        wasEnabled = wasEnabled || enabled;
      }
    }
  });

  it("lands within a couple of points of the target percentage", () => {
    for (const rollout of [1, 5, 10, 25, 50] as RolloutPercent[]) {
      const enabled = memberIds.filter((memberId) =>
        isEnabled("todays_five", { memberId, flags: withRollout(rollout) })
      ).length;
      const actual = (enabled / memberIds.length) * 100;
      expect(Math.abs(actual - rollout)).toBeLessThan(2.5);
    }
  });

  it("enables everyone at 100 and nobody at 0", () => {
    for (const memberId of memberIds.slice(0, 200)) {
      expect(isEnabled("todays_five", { memberId, flags: withRollout(100) })).toBe(true);
      expect(isEnabled("todays_five", { memberId, flags: withRollout(0) })).toBe(false);
    }
  });

  it("lets the kill switch override a full rollout", () => {
    const context = {
      memberId: "member-1",
      flags: { todays_five: { rollout: 100 as RolloutPercent, killed: true } }
    };
    expect(isEnabled("todays_five", context)).toBe(false);
  });

  it("kills a feature even for always-on members", () => {
    const context = {
      memberId: "tester",
      flags: {
        todays_five: { rollout: 0 as RolloutPercent, killed: true, alwaysOn: ["tester"] }
      }
    };
    expect(isEnabled("todays_five", context)).toBe(false);
  });

  it("includes always-on members below their bucket", () => {
    const context = {
      memberId: "tester",
      flags: { todays_five: { rollout: 0 as RolloutPercent, alwaysOn: ["tester"] } }
    };
    expect(isEnabled("todays_five", context)).toBe(true);
  });

  it("buckets independently per feature", () => {
    // A member in the early cohort for one flag shouldn't be for all of them.
    const buckets = (Object.keys(defaultFlags) as FeatureName[]).map((feature) =>
      bucketOf(feature, "member-7")
    );
    expect(new Set(buckets).size).toBeGreaterThan(1);
  });
});
