/**
 * Referral rewards and abuse handling.
 *
 * Referral programmes attract fraud because they pay out for signups, so the
 * design assumption here is that some share of referrals are not real people.
 * Rewards are therefore **earned on qualification, not on signup**: a referee
 * has to verify and actually use the product before anything is granted.
 *
 * As with Scam Shield, detection never auto-punishes. A high fraud score holds
 * a reward for human review; it does not ban the referrer, who may simply have
 * shared their link somewhere popular.
 */

import type { VerificationId } from "../domain/taxonomies";

export type RewardId = "boost" | "super_like" | "premium_trial";

export type Reward = {
  id: RewardId;
  /** How many of the reward a single qualified referral grants. */
  quantity: number;
  /** Premium trial only: length in days. */
  trialDays?: number;
};

export const rewardLadder: Reward[] = [
  { id: "super_like", quantity: 1 },
  { id: "boost", quantity: 1 },
  { id: "premium_trial", quantity: 1, trialDays: 14 }
];

/** Caps total payout per referrer per period, bounding worst-case abuse cost. */
export const MAX_REWARDED_REFERRALS_PER_MONTH = 20;

export type Referral = {
  referrerId: string;
  refereeId: string;
  code: string;
  signedUpAt: string;
  /** Verifications the referee has completed. */
  refereeVerifications: VerificationId[];
  /** Whether the referee has genuinely used the product since signing up. */
  refereeCompletedProfile: boolean;
  refereeActiveDays: number;
};

/**
 * A referral only counts once the referee looks like a real, engaged member.
 * Signing up is not enough — that is the part a fraudster can automate.
 */
export const QUALIFICATION = {
  requiredVerifications: ["email", "phone"] as VerificationId[],
  requiresCompletedProfile: true,
  minActiveDays: 3
};

export function isQualified(referral: Referral): boolean {
  const verified = new Set(referral.refereeVerifications);
  const hasVerifications = QUALIFICATION.requiredVerifications.every((id) => verified.has(id));

  return (
    hasVerifications &&
    (!QUALIFICATION.requiresCompletedProfile || referral.refereeCompletedProfile) &&
    referral.refereeActiveDays >= QUALIFICATION.minActiveDays
  );
}

export type FraudSignalId =
  | "self_referral"
  | "shared_device"
  | "shared_payment_method"
  | "signup_burst"
  | "referee_never_active"
  | "disposable_email"
  | "circular_referral";

export type FraudSignal = { id: FraudSignalId; weight: number };

export type FraudContext = {
  referral: Referral;
  /** True when referrer and referee resolve to the same account. */
  sameAccount: boolean;
  /** True when both accounts share a device fingerprint. */
  sameDevice: boolean;
  /** True when both accounts share a payment instrument. */
  samePaymentMethod: boolean;
  /** Referrals from this referrer within the last hour. */
  referralsInLastHour: number;
  /** True when the referee also referred the referrer. */
  circular: boolean;
  /** True when the referee's email domain is a known disposable provider. */
  disposableEmail: boolean;
};

const BURST_THRESHOLD = 5;

export function detectFraud(context: FraudContext): FraudSignal[] {
  const signals: FraudSignal[] = [];

  // Self-referral is definitional abuse, not a probabilistic signal.
  if (context.sameAccount) signals.push({ id: "self_referral", weight: 1 });
  if (context.circular) signals.push({ id: "circular_referral", weight: 0.8 });
  if (context.samePaymentMethod) signals.push({ id: "shared_payment_method", weight: 0.7 });

  // A shared device is common for couples and families, so on its own it is weak.
  if (context.sameDevice) signals.push({ id: "shared_device", weight: 0.35 });

  if (context.referralsInLastHour > BURST_THRESHOLD) {
    signals.push({
      id: "signup_burst",
      weight: Math.min(0.7, 0.3 + 0.05 * (context.referralsInLastHour - BURST_THRESHOLD))
    });
  }

  if (context.disposableEmail) signals.push({ id: "disposable_email", weight: 0.5 });

  if (context.referral.refereeActiveDays === 0) {
    signals.push({ id: "referee_never_active", weight: 0.4 });
  }

  return signals.sort((a, b) => b.weight - a.weight);
}

export type RewardDecision = {
  outcome: "granted" | "pending_qualification" | "held_for_review" | "rejected";
  rewards: Reward[];
  signals: FraudSignal[];
  /** i18n key explaining the outcome to the referrer. */
  reasonKey: string;
};

const REVIEW_THRESHOLD = 0.6;
const REJECT_THRESHOLD = 1;

export type DecisionContext = FraudContext & {
  /** Referrals already rewarded to this referrer this month. */
  rewardedThisMonth: number;
};

export function decideReward(context: DecisionContext): RewardDecision {
  const signals = detectFraud(context);
  const score = signals.reduce((sum, signal) => sum + signal.weight, 0);

  // Self-referral and equivalents are rejected outright; nothing to review.
  if (score >= REJECT_THRESHOLD) {
    return {
      outcome: "rejected",
      rewards: [],
      signals,
      reasonKey: "referral.outcome.rejected"
    };
  }

  if (!isQualified(context.referral)) {
    return {
      outcome: "pending_qualification",
      rewards: [],
      signals,
      reasonKey: "referral.outcome.pendingQualification"
    };
  }

  if (score >= REVIEW_THRESHOLD) {
    return {
      outcome: "held_for_review",
      rewards: [],
      signals,
      reasonKey: "referral.outcome.heldForReview"
    };
  }

  if (context.rewardedThisMonth >= MAX_REWARDED_REFERRALS_PER_MONTH) {
    return {
      outcome: "held_for_review",
      rewards: [],
      signals,
      reasonKey: "referral.outcome.monthlyCapReached"
    };
  }

  return {
    outcome: "granted",
    rewards: rewardsFor(context.rewardedThisMonth),
    signals,
    reasonKey: "referral.outcome.granted"
  };
}

/**
 * Reward for the next qualified referral. The ladder repeats, with the premium
 * trial as the third-referral payoff.
 */
export function rewardsFor(previouslyRewarded: number): Reward[] {
  return [rewardLadder[previouslyRewarded % rewardLadder.length]];
}
