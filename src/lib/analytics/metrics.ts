/**
 * Product metrics.
 *
 * **Nothing here is collected.** Every number is an aggregate over rows the
 * product already stores in order to work — likes, matches, invitations,
 * subscriptions — so there is no event stream, no tracking SDK, no second copy
 * of anyone's behaviour, and nothing leaves the server. A dating profile is
 * about the most sensitive category of data a person hands over, and the way to
 * keep an analytics surface from leaking it is not to build one that holds it.
 *
 * That decision also settles the questions §46 would otherwise raise: there is
 * no vendor to choose, no data-processing agreement to sign, no consent banner
 * for a tracker that does not exist, and no retention policy beyond the one the
 * underlying tables already have.
 *
 * What is left to get right is the shape of what comes *out*, which is what
 * this file is: counts and rates, never rows, with the small buckets withheld.
 */

/**
 * Below this, a bucket is withheld rather than counted.
 *
 * Aggregates stop being anonymous when the population is small, and this
 * product's population is smallest exactly when someone is most likely to be
 * reading these numbers. "One date in the Northern Lights this week" is a fact
 * about a person to anyone who knows one member, and a breakdown by a
 * twelve-item catalogue produces buckets that small constantly.
 *
 * It is not a defence against the admin reading the database directly — nothing
 * here could be. It stops the *reporting surface* from becoming the easy way to
 * do it, which is the difference between a mistake someone has to work at and
 * one they can make by opening a page.
 */
export const MIN_BUCKET = 5;

export type Bucket = { key: string; count: number };

export type Breakdown = {
  buckets: Bucket[];
  /** How many buckets were withheld for being too small to be anonymous. */
  withheld: number;
};

/**
 * Withholds the buckets too small to report, and says how many there were.
 *
 * The count of withheld buckets is itself safe — it is a fact about the
 * catalogue, not about anyone — and without it a reader cannot tell an empty
 * breakdown from a suppressed one, which is the sort of ambiguity that gets
 * resolved by someone going to look at the raw table.
 */
export function withhold(buckets: Bucket[]): Breakdown {
  const kept = buckets.filter((bucket) => bucket.count >= MIN_BUCKET);
  return {
    buckets: kept.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
    withheld: buckets.length - kept.length
  };
}

/**
 * A rate, or `null` when there is nothing to divide by.
 *
 * Zero would be a lie in that case — "0% of members converted" reads as a
 * failing product rather than an empty one — and this is the first thing anyone
 * looks at on a launch day, when every denominator is zero.
 */
export function share(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 10_000) / 10_000;
}

/**
 * The metrics §46 asks for that this product cannot answer yet, and why.
 *
 * Reported rather than returned as `0`. A zero here would be indistinguishable
 * from a product nobody is using, and the difference between "nobody finished a
 * virtual date" and "nothing exists that could record one finishing" is the
 * difference between an emergency and a roadmap item.
 */
export const NOT_MEASURED: { metric: string; why: string }[] = [
  {
    metric: "completedDates",
    why: "Nothing records a date happening. Invitations are rows; the session that would end is the VR client, which does not exist yet."
  },
  {
    metric: "averageDateDuration",
    why: "Same: no session, so no duration. `virtual_date_usage` counts what the allowance was spent on, not how long anyone stayed."
  },
  {
    metric: "avatarUsage",
    why: "There is no avatar system to use."
  }
];

export type ProductMetrics = {
  window: { from: string; to: string };
  members: {
    /** Joined inside the window. */
    joined: number;
    /** Everyone not deleted, at the end of the window. */
    total: number;
  };
  engagement: {
    likes: number;
    matches: number;
    messages: number;
  };
  virtualDates: {
    invited: number;
    accepted: number;
    declined: number;
    expired: number;
    /** Accepted ÷ answered, so invitations still pending do not count against it. */
    acceptanceRate: number | null;
    environments: Breakdown;
  };
  gifts: {
    sent: number;
    byGift: Breakdown;
  };
  /**
   * Translation is the only AI feature that ships, so it is the only AI usage
   * there is. Named for what it is rather than reported twice under two
   * headings that would always carry the same number.
   */
  translations: { requested: number };
  subscriptions: {
    plus: number;
    vip: number;
    /** Of everyone, the share holding PLUS: the FREE → PLUS conversion. */
    plusShare: number | null;
    /** Of everyone paying, the share on VIP: the PLUS → VIP conversion. */
    vipShareOfPaying: number | null;
  };
  /**
   * Did a new member come back?
   *
   * The cohort is everyone who joined inside the window *and* has had seven
   * full days since — a member who joined yesterday cannot yet have failed to
   * return, and counting them would drag the rate down by exactly how recently
   * the product grew.
   *
   * "Returned" means they sent a like or a message more than a day after
   * joining and within the week. Both are durable records of doing something
   * with another person; a session row would have been easier and would have
   * counted an app that reopened itself.
   */
  retention: {
    cohort: number;
    returned: number;
    day7: number | null;
  };
  notMeasured: typeof NOT_MEASURED;
};
