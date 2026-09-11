import Link from "next/link";
import { notFound } from "next/navigation";
import { currentModerator } from "@/auth/moderator";
import { isWindowName, productMetrics, windowFor, WINDOWS } from "@/db/analytics";
import type { Breakdown } from "@/lib/analytics/metrics";

export const dynamic = "force-dynamic";

/**
 * How the product is doing.
 *
 * A server component reading the numbers directly rather than fetching its own
 * API — it is the same code on the same machine, and going out through HTTP
 * would only add a round trip and a second place for the authorization to be
 * wrong.
 *
 * Deliberately not translated. Every other page in this application is, because
 * members read them; this one is read by whoever runs the business, and the
 * moderation console already sets that precedent. Twelve locales of copy for an
 * audience of one is work that would go stale rather than get used.
 *
 * A moderator gets `notFound()` here, exactly as they do from the API. The two
 * roles do different jobs — see `requireAdmin`.
 */
export default async function MetricsPage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ window?: string }>;
}) {
  const moderator = await currentModerator();
  if (!moderator || moderator.role !== "admin") notFound();

  const { locale } = await params;
  const requested = (await searchParams).window ?? "month";
  const name = isWindowName(requested) ? requested : "month";
  const metrics = await productMetrics(windowFor(name));

  return (
    <section className="container-fm py-10">
      <h1 className="font-display text-3xl font-semibold text-ink">Metrics</h1>
      <p className="mt-1 text-sm text-ink/60">
        Counted from the product&rsquo;s own tables when you asked. Nothing is tracked, stored
        or sent anywhere to produce this page.
      </p>

      <nav className="mt-6 flex gap-2" aria-label="Window">
        {(Object.keys(WINDOWS) as (keyof typeof WINDOWS)[]).map((option) => (
          <Link
            key={option}
            href={`/${locale}/app/admin/metrics?window=${option}`}
            aria-current={option === name ? "page" : undefined}
            className={
              option === name
                ? "rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-white"
                : "rounded-lg border border-black/10 px-3 py-1.5 text-xs text-ink/70"
            }
          >
            Last {WINDOWS[option]} days
          </Link>
        ))}
      </nav>

      <Row title="Members">
        <Stat label="Joined" value={metrics.members.joined} />
        <Stat label="Total" value={metrics.members.total} />
        <Stat label="Came back (day 7)" value={percent(metrics.retention.day7)} />
        <Stat
          label="Cohort"
          value={metrics.retention.cohort}
          note="Joined with a full week since"
        />
      </Row>

      <Row title="Engagement">
        <Stat label="Likes" value={metrics.engagement.likes} />
        <Stat label="Matches" value={metrics.engagement.matches} />
        <Stat label="Messages" value={metrics.engagement.messages} />
        <Stat label="Translations" value={metrics.translations.requested} />
      </Row>

      <Row title="Virtual dates">
        <Stat label="Invited" value={metrics.virtualDates.invited} />
        <Stat label="Accepted" value={metrics.virtualDates.accepted} />
        <Stat label="Declined" value={metrics.virtualDates.declined} />
        <Stat label="Accepted of answered" value={percent(metrics.virtualDates.acceptanceRate)} />
      </Row>

      <Row title="Subscriptions">
        <Stat label="PLUS" value={metrics.subscriptions.plus} />
        <Stat label="VIP" value={metrics.subscriptions.vip} />
        <Stat label="Free → PLUS" value={percent(metrics.subscriptions.plusShare)} />
        <Stat label="VIP of paying" value={percent(metrics.subscriptions.vipShareOfPaying)} />
      </Row>

      <div className="mt-10 grid gap-6 sm:grid-cols-2">
        <BreakdownList title="Where people met" breakdown={metrics.virtualDates.environments} />
        <BreakdownList
          title={`Gifts sent (${metrics.gifts.sent})`}
          breakdown={metrics.gifts.byGift}
        />
      </div>

      <h2 className="mt-12 font-display text-xl font-semibold text-ink">Not measured</h2>
      <p className="mt-1 text-sm text-ink/60">
        Shown rather than reported as zero: an empty number here would read as nobody using
        something, instead of nothing existing to record it.
      </p>
      <dl className="mt-4 grid gap-3">
        {metrics.notMeasured.map((entry) => (
          <div key={entry.metric} className="card-fm">
            <dt className="text-sm font-medium text-ink">{entry.metric}</dt>
            <dd className="mt-1 text-sm text-ink/60">{entry.why}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** A rate as a percentage, or a dash when there was nothing to divide by. */
function percent(value: number | null): string {
  if (value === null) return "—";
  return `${Math.round(value * 1000) / 10}%`;
}

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <h2 className="mt-10 font-display text-xl font-semibold text-ink">{title}</h2>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{children}</dl>
    </>
  );
}

function Stat({
  label,
  value,
  note
}: {
  label: string;
  value: number | string;
  note?: string;
}) {
  return (
    <div className="card-fm">
      <dt className="text-xs uppercase tracking-wide text-ink/50">{label}</dt>
      <dd className="mt-1 font-display text-2xl font-semibold text-ink">{value}</dd>
      {note ? <p className="mt-1 text-xs text-ink/50">{note}</p> : null}
    </div>
  );
}

/**
 * A breakdown, with a line for what was withheld.
 *
 * The withheld count is shown rather than hidden: without it an empty list and
 * a fully suppressed one look identical, and the person reading resolves that
 * ambiguity by opening the database — which is the thing the threshold exists
 * to make unnecessary.
 */
function BreakdownList({ title, breakdown }: { title: string; breakdown: Breakdown }) {
  return (
    <div className="card-fm">
      <h3 className="text-sm font-medium text-ink">{title}</h3>
      {breakdown.buckets.length === 0 ? (
        <p className="mt-3 text-sm text-ink/50">Nothing large enough to show.</p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {breakdown.buckets.map((bucket) => (
            <li key={bucket.key} className="flex justify-between text-sm">
              <span className="text-ink/70">{bucket.key}</span>
              <span className="font-medium text-ink">{bucket.count}</span>
            </li>
          ))}
        </ul>
      )}
      {breakdown.withheld > 0 ? (
        <p className="mt-3 text-xs text-ink/50">
          {breakdown.withheld} withheld — too few to report without pointing at someone.
        </p>
      ) : null}
    </div>
  );
}
