/**
 * How many people a young account may start talking to.
 *
 * A fresh account opening forty conversations in an hour is the signature of a
 * bulk operation, and it is the cheapest scam signal there is: it needs no
 * language model, no lexicon, and no judgement about the content of anything.
 * Scam Shield reads what a message says; this reads how many strangers it was
 * said to, and how old the account saying it is.
 *
 * Three properties this is built around:
 *
 *  - **It limits new conversations, not messages.** Replying is never
 *    restricted, and neither is talking a lot to someone who is talking back.
 *    The pattern being slowed is breadth, and only breadth — a member who
 *    matches with one person on their first day and sends two hundred messages
 *    is not doing anything this is looking for.
 *  - **It expires.** The cap loosens with account age and then stops applying,
 *    because the cost of a permanent throttle falls entirely on the honest
 *    majority who simply joined recently.
 *  - **It is told to the member.** A silent throttle reads as a broken app, and
 *    an app that says "you can start ten conversations a day for your first
 *    day, so that nobody can spam this place" reads as one with a spine. That
 *    sentence is also worth one more line in the store listing, which is the
 *    other half of why this is worth doing at all.
 */

const HOUR = 3_600_000;

export type AccountTier = {
  /** Applies while the account is younger than this. */
  maxAgeHours: number;
  /** New conversations allowed in a rolling 24 hours. */
  maxNewConversations: number;
};

/**
 * The ladder, loosest justifiable at every step.
 *
 * Ten on the first day is far above what a real person does — starting ten
 * conversations with strangers in a day is already an unusual amount of
 * dating — and far below the hundreds a bulk operation needs to be worth
 * running. The gap between those two numbers is the whole reason this works;
 * a limit set anywhere inside it costs the honest member nothing.
 */
export const TIERS: AccountTier[] = [
  { maxAgeHours: 24, maxNewConversations: 10 },
  { maxAgeHours: 24 * 7, maxNewConversations: 25 }
];

export type ConversationAllowance = {
  /** null once the account is old enough for the cap to stop applying. */
  limit: number | null;
  used: number;
  allowed: boolean;
};

/**
 * The cap for an account of this age, or null when it no longer applies.
 *
 * A negative age — a clock skew, a seeded row dated in the future — is treated
 * as brand new rather than as unlimited. Getting this backwards would make a
 * bad timestamp the way around the limit.
 */
export function limitForAge(accountAgeHours: number): number | null {
  const age = Math.max(accountAgeHours, 0);
  for (const tier of TIERS) {
    if (age < tier.maxAgeHours) return tier.maxNewConversations;
  }
  return null;
}

export function conversationAllowance(input: {
  accountAgeHours: number;
  /** Conversations this member has started in the last rolling 24 hours. */
  startedLastDay: number;
}): ConversationAllowance {
  const limit = limitForAge(input.accountAgeHours);
  if (limit === null) return { limit: null, used: input.startedLastDay, allowed: true };

  return {
    limit,
    used: input.startedLastDay,
    allowed: input.startedLastDay < limit
  };
}

/** Account age in hours, for feeding the functions above. */
export function ageInHours(createdAt: Date, now: Date = new Date()): number {
  return (now.getTime() - createdAt.getTime()) / HOUR;
}
