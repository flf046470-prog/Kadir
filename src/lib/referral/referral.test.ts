import { describe, expect, it } from "vitest";
import { CODE_LENGTH, generateCode, isValidCode, normalizeCode, referralLink } from "./codes";
import {
  decideReward,
  detectFraud,
  isQualified,
  MAX_REWARDED_REFERRALS_PER_MONTH,
  rewardsFor,
  type DecisionContext,
  type Referral
} from "./rewards";

function qualifiedReferral(overrides: Partial<Referral> = {}): Referral {
  return {
    referrerId: "referrer-1",
    refereeId: "referee-1",
    code: "ABCD2345",
    signedUpAt: "2026-08-01T00:00:00Z",
    refereeVerifications: ["email", "phone"],
    refereeCompletedProfile: true,
    refereeActiveDays: 5,
    ...overrides
  };
}

function context(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    referral: qualifiedReferral(),
    sameAccount: false,
    sameDevice: false,
    samePaymentMethod: false,
    referralsInLastHour: 1,
    circular: false,
    disposableEmail: false,
    rewardedThisMonth: 0,
    ...overrides
  };
}

describe("codes", () => {
  it("generates codes of the expected length from the safe alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateCode();
      expect(code).toHaveLength(CODE_LENGTH);
      expect(isValidCode(code)).toBe(true);
    }
  });

  it("never emits the excluded confusable letters", () => {
    for (let i = 0; i < 500; i++) {
      expect(generateCode()).not.toMatch(/[ILOU]/);
    }
  });

  it("stays in range even if the random source returns 1", () => {
    expect(generateCode(() => 1)).toHaveLength(CODE_LENGTH);
    expect(isValidCode(generateCode(() => 1))).toBe(true);
  });

  it("folds confusable characters the way a typist would get them wrong", () => {
    // O typed for 0, I and L typed for 1.
    expect(normalizeCode("O123456I")).toBe("01234561");
    expect(normalizeCode("L1234567")).toBe("11234567");
  });

  it("tolerates spacing and separators from a copy-paste", () => {
    expect(normalizeCode("abcd-2345")).toBe("ABCD2345");
    expect(normalizeCode(" ABCD 2345 ")).toBe("ABCD2345");
  });

  it("rejects wrong-length and out-of-alphabet input", () => {
    expect(normalizeCode("ABC")).toBeNull();
    expect(normalizeCode("ABCD23456")).toBeNull();
    expect(normalizeCode("ABCD234U")).toBeNull();
    expect(normalizeCode("ABCD-23$")).toBeNull();
  });

  it("builds a locale-aware link", () => {
    expect(referralLink("ABCD2345", "https://fiorematch.com", "tr")).toBe(
      "https://fiorematch.com/tr/register?ref=ABCD2345"
    );
  });
});

describe("qualification", () => {
  it("does not count a bare signup", () => {
    expect(
      isQualified(
        qualifiedReferral({
          refereeVerifications: ["email"],
          refereeCompletedProfile: false,
          refereeActiveDays: 0
        })
      )
    ).toBe(false);
  });

  it("requires email and phone verification", () => {
    expect(isQualified(qualifiedReferral({ refereeVerifications: ["email"] }))).toBe(false);
    expect(isQualified(qualifiedReferral({ refereeVerifications: ["email", "phone"] }))).toBe(true);
  });

  it("requires real usage, not just an account", () => {
    expect(isQualified(qualifiedReferral({ refereeActiveDays: 1 }))).toBe(false);
    expect(isQualified(qualifiedReferral({ refereeCompletedProfile: false }))).toBe(false);
  });
});

describe("fraud detection", () => {
  it("flags self-referral", () => {
    const signals = detectFraud(context({ sameAccount: true }));
    expect(signals.map((signal) => signal.id)).toContain("self_referral");
  });

  it("flags circular referrals and shared payment methods", () => {
    const signals = detectFraud(context({ circular: true, samePaymentMethod: true }));
    const ids = signals.map((signal) => signal.id);
    expect(ids).toContain("circular_referral");
    expect(ids).toContain("shared_payment_method");
  });

  it("treats a shared device as weak on its own", () => {
    const decision = decideReward(context({ sameDevice: true }));
    // Couples and families share devices — this alone must not block a reward.
    expect(decision.outcome).toBe("granted");
  });

  it("escalates with signup bursts", () => {
    const small = detectFraud(context({ referralsInLastHour: 6 }));
    const large = detectFraud(context({ referralsInLastHour: 40 }));

    const smallWeight = small.find((signal) => signal.id === "signup_burst")!.weight;
    const largeWeight = large.find((signal) => signal.id === "signup_burst")!.weight;
    expect(largeWeight).toBeGreaterThan(smallWeight);
  });

  it("leaves an ordinary referral unflagged", () => {
    expect(detectFraud(context())).toEqual([]);
  });
});

describe("reward decisions", () => {
  it("grants a reward for a clean, qualified referral", () => {
    const decision = decideReward(context());
    expect(decision.outcome).toBe("granted");
    expect(decision.rewards).toHaveLength(1);
  });

  it("rejects self-referral outright", () => {
    const decision = decideReward(context({ sameAccount: true }));
    expect(decision.outcome).toBe("rejected");
    expect(decision.rewards).toEqual([]);
  });

  it("holds — never bans — when signals are suspicious but not conclusive", () => {
    const decision = decideReward(context({ samePaymentMethod: true }));
    expect(decision.outcome).toBe("held_for_review");
    expect(decision.rewards).toEqual([]);
    // The decision carries no punitive field for the referrer by design.
    expect(Object.keys(decision).sort()).toEqual(
      ["outcome", "reasonKey", "rewards", "signals"].sort()
    );
  });

  it("waits for qualification before paying out", () => {
    const decision = decideReward(
      context({ referral: qualifiedReferral({ refereeActiveDays: 0 }) })
    );
    expect(["pending_qualification", "held_for_review"]).toContain(decision.outcome);
    expect(decision.rewards).toEqual([]);
  });

  it("rejects fraud ahead of checking qualification", () => {
    // A self-referral that also is not qualified should read as fraud, not "pending".
    const decision = decideReward(
      context({ sameAccount: true, referral: qualifiedReferral({ refereeActiveDays: 0 }) })
    );
    expect(decision.outcome).toBe("rejected");
  });

  it("caps payouts per month", () => {
    const decision = decideReward(
      context({ rewardedThisMonth: MAX_REWARDED_REFERRALS_PER_MONTH })
    );
    expect(decision.outcome).toBe("held_for_review");
    expect(decision.rewards).toEqual([]);
  });

  it("cycles the reward ladder", () => {
    expect(rewardsFor(0)[0].id).toBe("super_like");
    expect(rewardsFor(1)[0].id).toBe("boost");
    expect(rewardsFor(2)[0].id).toBe("premium_trial");
    expect(rewardsFor(3)[0].id).toBe("super_like");
  });

  it("gives the premium trial a defined length", () => {
    const trial = rewardsFor(2)[0];
    expect(trial.trialDays).toBeGreaterThan(0);
  });
});
