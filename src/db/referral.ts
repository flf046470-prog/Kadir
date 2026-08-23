import { and, count, desc, eq, gte, isNull, lt, lte, sql } from "drizzle-orm";
import { db } from "./client";
import { advisoryLockKey } from "./advisory-lock";
import { profiles, referralCodes, referralRewards, referrals, users } from "./schema";
import { generateCode, normalizeCode, referralLink } from "@/lib/referral/codes";
import { isDisposableEmail } from "@/lib/referral/disposable-domains";
import {
  decideReward,
  MAX_REWARDED_REFERRALS_PER_MONTH,
  QUALIFICATION,
  type FraudSignal,
  type Referral,
  type RewardDecision,
  type RewardId
} from "@/lib/referral/rewards";
import type { VerificationId } from "@/lib/domain/taxonomies";

/**
 * Referrals — persistence, qualification, and payout.
 *
 * The decision logic in `lib/referral` is a pure function over a context. This
 * module builds that context from the database and is where the properties a
 * referral programme lives or dies by are actually enforced:
 *
 *  - **A person can be referred exactly once.** `referrals` is keyed by the
 *    *referee*, so the constraint is the primary key rather than a check some
 *    call path can skip. Two tabs racing the same signup produce one row.
 *  - **Rewards are earned, not claimed.** Nothing is granted at signup.
 *    Qualification is recomputed from what the referee has actually done, and
 *    only a transition out of `pending_qualification` can pay out.
 *  - **Every fraud signal is recomputable.** Nothing is a perishable snapshot:
 *    the burst signal is derived from the hour *around this referral's own
 *    signup*, which the stored timestamps still answer a year later. A signal
 *    that can only be observed once is a signal that quietly stops working.
 *  - **Detection never punishes.** A suspicious referral is held for a human,
 *    exactly as Scam Shield holds a message. Nobody is banned by arithmetic.
 */

/** Retries on a code collision. At 32^8 combinations, three is generous. */
const MAX_MINT_ATTEMPTS = 3;

const BURST_WINDOW_MS = 60 * 60 * 1000;

/**
 * Mints this member's code, or returns the one they already have.
 *
 * Lazily, on first read rather than at registration: most members never open
 * the referral screen, and a code nobody has seen is a row nobody needs.
 */
export async function codeFor(userId: string): Promise<string> {
  const existing = await readCode(userId);
  if (existing) return existing;

  for (let attempt = 0; attempt < MAX_MINT_ATTEMPTS; attempt++) {
    const inserted = await db
      .insert(referralCodes)
      .values({ userId, code: generateCode() })
      // Covers both conflicts: this member racing themselves in another tab
      // (primary key) and an unlucky duplicate code (unique index).
      .onConflictDoNothing()
      .returning({ code: referralCodes.code });

    if (inserted[0]) return inserted[0].code;

    // If the conflict was the member's own row, that row is the answer.
    const mine = await readCode(userId);
    if (mine) return mine;
  }

  throw new Error("Could not mint a referral code after repeated collisions");
}

async function readCode(userId: string): Promise<string | null> {
  const rows = await db
    .select({ code: referralCodes.code })
    .from(referralCodes)
    .where(eq(referralCodes.userId, userId))
    .limit(1);

  return rows[0]?.code ?? null;
}

/** Resolves a code as typed to the member who owns it. */
export async function referrerForCode(rawCode: string): Promise<string | null> {
  const code = normalizeCode(rawCode);
  if (!code) return null;

  const rows = await db
    .select({ userId: referralCodes.userId })
    .from(referralCodes)
    .where(eq(referralCodes.code, code))
    .limit(1);

  return rows[0]?.userId ?? null;
}

export type AttachOutcome =
  | "recorded"
  | "invalid_code"
  | "unknown_code"
  | "self_referral"
  | "already_referred";

/**
 * Records who referred a new member.
 *
 * Self-referral is refused at the door instead of being stored and rejected
 * later. Storing it would burn the referee's one and only referral row on a
 * mistake — someone who pasted their own code could then never be credited to
 * the friend who actually invited them. The `self_referral` fraud signal stays
 * in the decision path as defence in depth for identities that resolve to one
 * account by some route this check cannot see.
 */
export async function attachReferral(refereeId: string, rawCode: string): Promise<AttachOutcome> {
  const code = normalizeCode(rawCode);
  if (!code) return "invalid_code";

  const referrerId = await referrerForCode(code);
  if (!referrerId) return "unknown_code";
  if (referrerId === refereeId) return "self_referral";

  const inserted = await db
    .insert(referrals)
    .values({ refereeId, referrerId, code })
    .onConflictDoNothing()
    .returning({ refereeId: referrals.refereeId });

  if (!inserted[0]) return "already_referred";

  // Deliberately no decision here. A member who has existed for ten seconds is
  // "never active" by definition, and that signal plus any ordinary second one
  // clears the reject threshold — so evaluating at signup would permanently
  // reject legitimate referrals for the crime of being new. The row starts
  // pending and is decided once it could actually qualify.
  return "recorded";
}

type RefereeFacts = {
  email: string;
  verifications: VerificationId[];
  completedProfile: boolean;
  activeDays: number;
};

/**
 * "Active days" is counted from what the member actually did — distinct UTC
 * days on which they liked someone or sent a message — rather than from a
 * last-seen timestamp. A bot can open the app; engaging with another member is
 * the part that is expensive to fake, which is exactly the property
 * qualification needs.
 */
async function refereeFacts(refereeId: string): Promise<RefereeFacts | null> {
  const rows = await db
    .select({
      email: users.email,
      emailVerifiedAt: users.emailVerifiedAt,
      phoneVerifiedAt: users.phoneVerifiedAt,
      completedAt: profiles.completedAt
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(users.id, refereeId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const verifications: VerificationId[] = [];
  if (row.emailVerifiedAt) verifications.push("email");
  if (row.phoneVerifiedAt) verifications.push("phone");

  const activity = await db.execute<{ days: number | string }>(sql`
    select count(*)::int as days from (
      select distinct date_trunc('day', created_at at time zone 'UTC') as day
        from likes where from_user_id = ${refereeId}
      union
      select distinct date_trunc('day', created_at at time zone 'UTC') as day
        from messages where sender_id = ${refereeId}
    ) as active_days
  `);

  return {
    email: row.email,
    verifications,
    completedProfile: row.completedAt !== null,
    activeDays: Number(activity[0]?.days ?? 0)
  };
}

/** Referrals this referrer made within the hour ending at `at`, inclusive. */
async function referralsInHourAround(referrerId: string, at: Date): Promise<number> {
  const rows = await db
    .select({ total: count() })
    .from(referrals)
    .where(
      and(
        eq(referrals.referrerId, referrerId),
        gte(referrals.signedUpAt, new Date(at.getTime() - BURST_WINDOW_MS)),
        lte(referrals.signedUpAt, at)
      )
    );

  return rows[0]?.total ?? 0;
}

async function isCircular(referrerId: string, refereeId: string): Promise<boolean> {
  const rows = await db
    .select({ refereeId: referrals.refereeId })
    .from(referrals)
    // The referrer was themselves referred *by* the person they just referred.
    .where(and(eq(referrals.refereeId, referrerId), eq(referrals.referrerId, refereeId)))
    .limit(1);

  return rows.length > 0;
}

/** Referrals this referrer has been paid for in the calendar month of `at` (UTC). */
async function rewardedThisMonth(referrerId: string, at: Date): Promise<number> {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const next = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));

  const rows = await db
    .select({ total: count() })
    .from(referrals)
    .where(
      and(
        eq(referrals.referrerId, referrerId),
        eq(referrals.outcome, "granted"),
        gte(referrals.decidedAt, start),
        // Half-open, so a referral decided at exactly midnight on the 1st
        // counts for the month it starts, not for both.
        lt(referrals.decidedAt, next)
      )
    );

  return rows[0]?.total ?? 0;
}

/**
 * Re-decides one referral, and pays out if it has come good.
 *
 * Only `pending_qualification` is ever re-evaluated. `granted` is money already
 * spent, `rejected` is a decision, and `held_for_review` belongs to a human —
 * re-running the arithmetic over any of those would either double-pay or
 * silently overturn a moderator.
 *
 * Returns null when there is no referral to decide.
 */
export async function evaluateReferral(
  refereeId: string,
  now: Date = new Date()
): Promise<RewardDecision | null> {
  const rows = await db
    .select({
      referrerId: referrals.referrerId,
      code: referrals.code,
      outcome: referrals.outcome,
      signals: referrals.signals,
      signedUpAt: referrals.signedUpAt
    })
    .from(referrals)
    .where(eq(referrals.refereeId, refereeId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  if (row.outcome !== "pending_qualification") {
    return {
      outcome: row.outcome as RewardDecision["outcome"],
      rewards: [],
      signals: parseSignals(row.signals),
      reasonKey: `referral.outcome.${camel(row.outcome)}`
    };
  }

  // A referral younger than the qualification window has nothing to decide: it
  // cannot possibly qualify yet (that needs activity on `minActiveDays`
  // separate days), and any terminal outcome reached now would be reached
  // against a member who has not had the chance to look like a real one. This
  // is the guard that stops a referrer refreshing their screen from rejecting
  // the friend who signed up an hour ago.
  const ageInDays = (now.getTime() - row.signedUpAt.getTime()) / 86_400_000;
  if (ageInDays < QUALIFICATION.minActiveDays) {
    return {
      outcome: "pending_qualification",
      rewards: [],
      signals: [],
      reasonKey: "referral.outcome.pendingQualification"
    };
  }

  const facts = await refereeFacts(refereeId);
  if (!facts) return null;

  const referral: Referral = {
    referrerId: row.referrerId,
    refereeId,
    code: row.code,
    signedUpAt: row.signedUpAt.toISOString(),
    refereeVerifications: facts.verifications,
    refereeCompletedProfile: facts.completedProfile,
    refereeActiveDays: facts.activeDays
  };

  const decision = decideReward({
    referral,
    sameAccount: row.referrerId === refereeId,
    // Device fingerprinting and payments do not exist yet. These are reported
    // as absent rather than guessed: a fabricated signal is worse than a
    // missing one, because it looks like evidence. Both weigh under the review
    // threshold on their own, so the decision stands without them.
    sameDevice: false,
    samePaymentMethod: false,
    referralsInLastHour: await referralsInHourAround(row.referrerId, row.signedUpAt),
    circular: await isCircular(row.referrerId, refereeId),
    disposableEmail: isDisposableEmail(facts.email),
    rewardedThisMonth: await rewardedThisMonth(row.referrerId, now)
  });

  // Nothing changed yet — leave the row alone so `decided_at` keeps meaning
  // "when this stopped being provisional" rather than "last time anyone looked".
  if (decision.outcome === "pending_qualification") return decision;

  return persistDecision(refereeId, row.referrerId, decision, now);
}

/**
 * Writes the outcome and, when granted, the reward rows.
 *
 * The update is conditional on the row still being pending, which is what makes
 * a double payout impossible: two concurrent evaluations both read "pending",
 * both decide "granted", and exactly one of them updates a row. The loser sees
 * zero rows back and grants nothing.
 *
 * The advisory lock is a separate concern — it serialises *different* referees
 * belonging to the same referrer, so two friends qualifying at the same moment
 * cannot both slip past the monthly cap.
 */
async function persistDecision(
  refereeId: string,
  referrerId: string,
  decision: RewardDecision,
  now: Date
): Promise<RewardDecision> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${advisoryLockKey(`referral:${referrerId}`)})`);

    const updated = await tx
      .update(referrals)
      .set({
        outcome: decision.outcome,
        signals: JSON.stringify(decision.signals),
        decidedAt: now
      })
      .where(and(eq(referrals.refereeId, refereeId), eq(referrals.outcome, "pending_qualification")))
      .returning({ refereeId: referrals.refereeId });

    if (!updated[0]) {
      // Another evaluation decided this one first. Report what is stored, not
      // what this call computed.
      const current = await tx
        .select({ outcome: referrals.outcome, signals: referrals.signals })
        .from(referrals)
        .where(eq(referrals.refereeId, refereeId))
        .limit(1);

      return {
        outcome: (current[0]?.outcome ?? decision.outcome) as RewardDecision["outcome"],
        rewards: [],
        signals: parseSignals(current[0]?.signals ?? "[]"),
        reasonKey: `referral.outcome.${camel(current[0]?.outcome ?? decision.outcome)}`
      };
    }

    if (decision.outcome === "granted" && decision.rewards.length > 0) {
      await tx.insert(referralRewards).values(
        decision.rewards.map((reward) => ({
          userId: referrerId,
          refereeId,
          rewardId: reward.id,
          quantity: reward.quantity,
          trialDays: reward.trialDays ?? null,
          grantedAt: now
        }))
      );
    }

    return decision;
  });
}

function parseSignals(raw: string): FraudSignal[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FraudSignal[]) : [];
  } catch {
    // A corrupt row must not take the referral screen down with it.
    return [];
  }
}

/** `pending_qualification` → `pendingQualification`, matching the i18n keys. */
function camel(outcome: string): string {
  return outcome.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

export type WalletEntry = { rewardId: RewardId; quantity: number; trialDays: number | null };

/** What this member can currently spend, one entry per reward kind. */
export async function walletFor(userId: string): Promise<WalletEntry[]> {
  const rows = await db
    .select({
      rewardId: referralRewards.rewardId,
      quantity: sql<number>`sum(${referralRewards.quantity})::int`,
      trialDays: sql<number | null>`max(${referralRewards.trialDays})`
    })
    .from(referralRewards)
    .where(and(eq(referralRewards.userId, userId), isNull(referralRewards.consumedAt)))
    .groupBy(referralRewards.rewardId);

  return rows.map((row) => ({
    rewardId: row.rewardId as RewardId,
    quantity: Number(row.quantity),
    trialDays: row.trialDays === null ? null : Number(row.trialDays)
  }));
}

/**
 * Spends one unit of a reward, oldest first.
 *
 * Returns false when there was nothing to spend. The `consumed_at is null`
 * clause in the update makes this safe to call twice: the second call finds no
 * unspent row of that id and spends nothing.
 */
export async function spendReward(userId: string, rewardId: RewardId): Promise<boolean> {
  const spent = await db
    .update(referralRewards)
    .set({ consumedAt: new Date() })
    .where(
      sql`${referralRewards.id} = (
        select id from ${referralRewards}
         where user_id = ${userId} and reward_id = ${rewardId} and consumed_at is null
         order by granted_at asc
         limit 1
         for update skip locked
      )`
    )
    .returning({ id: referralRewards.id });

  return spent.length > 0;
}

export type ReferralEntry = {
  outcome: RewardDecision["outcome"];
  signedUpAt: string;
  decidedAt: string | null;
};

export type ReferralOverview = {
  code: string;
  link: string;
  entries: ReferralEntry[];
  wallet: WalletEntry[];
  /** Paid out this calendar month, against `MAX_REWARDED_REFERRALS_PER_MONTH`. */
  rewardedThisMonth: number;
  monthlyCap: number;
};

/** How many pending referrals one page load will re-check. */
const REEVALUATE_LIMIT = 50;

/**
 * Everything the referral screen shows.
 *
 * Pending referrals are re-decided here, on read, rather than by a background
 * job. Qualification depends on the referee's own activity, so the moment a
 * referrer has a reason to look is the moment the answer may have changed —
 * and it keeps the feature working on a deploy with no scheduler.
 *
 * Referees are never named. The referrer knows who they invited; the screen
 * does not need to confirm to anyone holding their phone that a particular
 * person has an account on a dating site.
 */
export async function referralOverview(
  userId: string,
  options: { baseUrl: string; locale: string },
  now: Date = new Date()
): Promise<ReferralOverview> {
  const code = await codeFor(userId);

  const pending = await db
    .select({ refereeId: referrals.refereeId })
    .from(referrals)
    .where(and(eq(referrals.referrerId, userId), eq(referrals.outcome, "pending_qualification")))
    .orderBy(desc(referrals.signedUpAt))
    .limit(REEVALUATE_LIMIT);

  for (const row of pending) {
    await evaluateReferral(row.refereeId, now);
  }

  const rows = await db
    .select({
      outcome: referrals.outcome,
      signedUpAt: referrals.signedUpAt,
      decidedAt: referrals.decidedAt
    })
    .from(referrals)
    .where(eq(referrals.referrerId, userId))
    .orderBy(desc(referrals.signedUpAt));

  return {
    code,
    link: referralLink(code, options.baseUrl, options.locale),
    entries: rows.map((row) => ({
      outcome: row.outcome as RewardDecision["outcome"],
      signedUpAt: row.signedUpAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() ?? null
    })),
    wallet: await walletFor(userId),
    rewardedThisMonth: await rewardedThisMonth(userId, now),
    monthlyCap: MAX_REWARDED_REFERRALS_PER_MONTH
  };
}
