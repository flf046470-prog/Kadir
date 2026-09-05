import { and, count, eq, gt, gte, inArray, isNull, lt, sql, type SQLWrapper } from "drizzle-orm";
import { db } from "./client";
import {
  gifts,
  likes,
  matches,
  messages,
  subscriptions,
  translationUsage,
  users,
  virtualDateInvites
} from "./schema";
import {
  NOT_MEASURED,
  share,
  withhold,
  type Bucket,
  type ProductMetrics
} from "@/lib/analytics/metrics";

/**
 * Reading the product's numbers out of the tables it already keeps.
 *
 * Every query below is an aggregate: `count`, `group by`, and one `exists`.
 * None of them selects a row, a name, a message or an id, which is what makes
 * this safe to expose at all — see `lib/analytics/metrics.ts` for why the whole
 * approach is queries rather than an event stream.
 *
 * The window is half-open, `[from, to)`. Closed at both ends, a member who
 * joined at exactly midnight lands in two weeks at once, and weekly numbers
 * that do not add up to the monthly one are the fastest way to lose trust in a
 * dashboard.
 */

export type MetricsWindow = { from: Date; to: Date };

/** Rows come back with counts as strings on some drivers; normalise once. */
function toCount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buckets(rows: { key: string | null; count: unknown }[]): Bucket[] {
  return rows
    .filter((row): row is { key: string; count: unknown } => Boolean(row.key))
    .map((row) => ({ key: row.key, count: toCount(row.count) }));
}

const DAY = 86_400_000;

export async function productMetrics(window: MetricsWindow): Promise<ProductMetrics> {
  const { from, to } = window;
  const inWindow = (column: SQLWrapper) => and(gte(column, from), lt(column, to));

  const [
    joined,
    total,
    likeCount,
    matchCount,
    messageCount,
    inviteStatuses,
    environments,
    giftRows,
    translations,
    tiers,
    retention
  ] = await Promise.all([
    db.select({ n: count() }).from(users).where(inWindow(users.createdAt)),

    // Everyone still present at the end of the window. `deletedAt` is set the
    // moment a member asks to go, before the purge job runs, so counting it
    // keeps the total from including people who have already left.
    db
      .select({ n: count() })
      .from(users)
      .where(and(lt(users.createdAt, to), isNull(users.deletedAt))),

    db.select({ n: count() }).from(likes).where(inWindow(likes.createdAt)),
    db.select({ n: count() }).from(matches).where(inWindow(matches.createdAt)),

    // Deleted messages still happened. Excluding them would make the number
    // fall retroactively whenever someone tidied a conversation.
    db.select({ n: count() }).from(messages).where(inWindow(messages.createdAt)),

    db
      .select({ key: virtualDateInvites.status, count: count() })
      .from(virtualDateInvites)
      .where(inWindow(virtualDateInvites.createdAt))
      .groupBy(virtualDateInvites.status),

    // Only invitations that were accepted say anything about which places
    // people want to go. Counting the ones nobody answered would measure what
    // gets *offered*, which is a different question with the same shape.
    db
      .select({ key: virtualDateInvites.environment, count: count() })
      .from(virtualDateInvites)
      .where(
        and(inWindow(virtualDateInvites.createdAt), eq(virtualDateInvites.status, "accepted"))
      )
      .groupBy(virtualDateInvites.environment),

    db
      .select({ key: gifts.giftId, count: count() })
      .from(gifts)
      .where(inWindow(gifts.createdAt))
      .groupBy(gifts.giftId),

    db
      .select({ n: count() })
      .from(translationUsage)
      .where(inWindow(translationUsage.createdAt)),

    /**
     * Who is paying *now*, not who paid during the window.
     *
     * A subscription is one row per member that is overwritten as it changes,
     * so it has no history to slice by date — and the question anyone actually
     * asks ("how many people are on VIP?") is about the present anyway.
     * `currentPeriodEnd` is what decides, for the reason the schema gives:
     * status is a hint, the date is authoritative.
     */
    db
      .select({ key: subscriptions.tier, count: count() })
      .from(subscriptions)
      .where(
        and(
          gt(subscriptions.currentPeriodEnd, to),
          /**
           * The same statuses `activeTier` grants access for, not just
           * `active`.
           *
           * Someone who cancelled keeps the period they bought, and someone
           * whose card failed has not asked to stop — both still have the
           * product, and both are still paying customers as far as this report
           * is concerned. Counting only `active` under-reported PLUS and VIP
           * and both conversion rates, while the comment above claimed the date
           * decided. `expired` is the one that is genuinely gone.
           */
          inArray(subscriptions.status, ["active", "past_due", "canceled"])
        )
      )
      .groupBy(subscriptions.tier),

    retentionFor(window)
  ]);

  const byStatus = new Map(buckets(inviteStatuses).map((bucket) => [bucket.key, bucket.count]));
  const accepted = byStatus.get("accepted") ?? 0;
  const declined = byStatus.get("declined") ?? 0;
  const expired = byStatus.get("expired") ?? 0;
  const invited = [...byStatus.values()].reduce((sum, value) => sum + value, 0);

  const byTier = new Map(buckets(tiers).map((bucket) => [bucket.key, bucket.count]));
  const plus = byTier.get("plus") ?? 0;
  const vip = byTier.get("vip") ?? 0;
  const members = toCount(total[0]?.n);

  return {
    window: { from: from.toISOString(), to: to.toISOString() },
    members: { joined: toCount(joined[0]?.n), total: members },
    engagement: {
      likes: toCount(likeCount[0]?.n),
      matches: toCount(matchCount[0]?.n),
      messages: toCount(messageCount[0]?.n)
    },
    virtualDates: {
      invited,
      accepted,
      declined,
      expired,
      // Answered, not sent: an invitation still sitting in someone's inbox is
      // not a refusal, and counting it as one makes the rate fall every time
      // usage grows.
      acceptanceRate: share(accepted, accepted + declined),
      environments: withhold(buckets(environments))
    },
    gifts: {
      sent: buckets(giftRows).reduce((sum, bucket) => sum + bucket.count, 0),
      byGift: withhold(buckets(giftRows))
    },
    translations: { requested: toCount(translations[0]?.n) },
    subscriptions: {
      plus,
      vip,
      plusShare: share(plus, members),
      vipShareOfPaying: share(vip, plus + vip)
    },
    retention,
    notMeasured: NOT_MEASURED
  };
}

/**
 * Did the members who joined in this window come back?
 *
 * Raw SQL because the shape — "for each member, does any activity exist in a
 * range relative to *that member's* join time" — is a correlated `exists`, and
 * writing it through the query builder would obscure the one thing worth
 * reading carefully.
 *
 * The cohort excludes anyone who has not had seven full days yet. Without that
 * the rate falls purely because the product grew this week, which is the
 * classic way a retention number turns into a reason to panic about nothing.
 */
async function retentionFor({ from, to }: MetricsWindow): Promise<ProductMetrics["retention"]> {
  const cohortEnd = new Date(to.getTime() - 7 * DAY);
  if (cohortEnd <= from) return { cohort: 0, returned: 0, day7: null };

  /**
   * Bound as ISO strings with an explicit cast rather than as `Date`s: this
   * driver binds parameters for raw SQL itself, and hands a `Date` straight to
   * the wire protocol, which only takes strings and buffers.
   */
  const rows = await db.execute<{ cohort: string; returned: string }>(sql`
    with cohort as (
      select id, created_at
      from users
      where created_at >= ${from.toISOString()}::timestamptz
        and created_at < ${cohortEnd.toISOString()}::timestamptz
        and deleted_at is null
    )
    select
      count(*) as cohort,
      count(*) filter (
        where exists (
          select 1 from likes
          where likes.from_user_id = cohort.id
            and likes.created_at >= cohort.created_at + interval '1 day'
            and likes.created_at < cohort.created_at + interval '7 days'
        )
        or exists (
          select 1 from messages
          where messages.sender_id = cohort.id
            and messages.created_at >= cohort.created_at + interval '1 day'
            and messages.created_at < cohort.created_at + interval '7 days'
        )
      ) as returned
    from cohort
  `);

  const row = Array.from(rows)[0];
  const cohort = toCount(row?.cohort);
  const returned = toCount(row?.returned);

  return { cohort, returned, day7: share(returned, cohort) };
}

/** Everything above uses these; exported so the route does not re-derive them. */
export const WINDOWS = {
  /** The default. Long enough that a quiet Tuesday does not read as a collapse. */
  month: 30,
  week: 7,
  quarter: 90
} as const;

export type WindowName = keyof typeof WINDOWS;

export function isWindowName(value: string): value is WindowName {
  return value in WINDOWS;
}

export function windowFor(name: WindowName, now: Date = new Date()): MetricsWindow {
  return { from: new Date(now.getTime() - WINDOWS[name] * DAY), to: now };
}
