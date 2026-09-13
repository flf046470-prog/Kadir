"use client";

import { useState } from "react";
import type { ReferralOverview } from "@/db/referral";

type OutcomeLabels = Record<ReferralOverview["entries"][number]["outcome"], string>;

type Labels = {
  yourCode: string;
  yourLink: string;
  copy: string;
  copied: string;
  rewardsTitle: string;
  walletEmpty: string;
  statusTitle: string;
  statusEmpty: string;
  capNote: string;
  countGranted: string;
  countPending: string;
  countTotal: string;
  qualifyNote: string;
  outcome: OutcomeLabels;
  reward: Record<string, string>;
};

/**
 * The referral screen.
 *
 * Everything shown here is already decided on the server; this component copies
 * a link, and otherwise renders. In particular there is no "claim" button,
 * because there is nothing to claim: rewards are granted when a referee
 * qualifies, not when their referrer asks.
 *
 * The list names nobody. A referrer knows who they invited, and the screen has
 * no business confirming to whoever is holding the phone that a particular
 * person is on a dating site.
 */
export function ReferralClient({
  overview,
  locale,
  counts,
  labels
}: {
  overview: ReferralOverview;
  locale: string;
  counts: { granted: number; pending: number; total: number };
  labels: Labels;
}) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(overview.link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused outright (insecure origin, permission
      // denied). The link is on screen and selectable, so there is nothing to
      // recover from — just don't claim it was copied.
      setCopied(false);
    }
  }

  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-6">
        <div className="card-fm">
          <h2 className="text-sm font-medium uppercase tracking-wide text-ink/50">
            {labels.yourCode}
          </h2>
          <p className="mt-2 font-mono text-3xl font-semibold tracking-[0.3em] text-ink">
            {overview.code}
          </p>

          <label className="mt-5 block text-sm font-medium text-ink" htmlFor="referral-link">
            {labels.yourLink}
          </label>
          <div className="mt-1 flex flex-wrap gap-2">
            <input
              id="referral-link"
              readOnly
              value={overview.link}
              onFocus={(event) => event.currentTarget.select()}
              className="min-w-0 flex-1 rounded-lg border border-black/10 px-3 py-2 text-sm text-ink/80"
            />
            <button type="button" onClick={copyLink} className="btn-primary shrink-0">
              {copied ? labels.copied : labels.copy}
            </button>
          </div>
          <p className="mt-3 text-xs text-ink/50">{labels.qualifyNote}</p>
        </div>

        <div className="card-fm">
          <h2 className="font-display text-xl font-semibold text-ink">{labels.statusTitle}</h2>

          {overview.entries.length === 0 ? (
            <p className="mt-3 text-sm text-ink/60">{labels.statusEmpty}</p>
          ) : (
            <ul className="mt-4 divide-y divide-black/5">
              {overview.entries.map((entry) => (
                <li
                  key={`${entry.signedUpAt}-${entry.outcome}`}
                  className="flex flex-wrap items-center justify-between gap-2 py-3"
                >
                  <time className="text-sm text-ink/60" dateTime={entry.signedUpAt}>
                    {dateFormat.format(new Date(entry.signedUpAt))}
                  </time>
                  <OutcomeBadge outcome={entry.outcome} label={labels.outcome[entry.outcome]} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <aside className="space-y-6">
        <div className="card-fm">
          <h2 className="font-display text-xl font-semibold text-ink">{labels.rewardsTitle}</h2>

          {overview.wallet.length === 0 ? (
            <p className="mt-3 text-sm text-ink/60">{labels.walletEmpty}</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {overview.wallet.map((entry) => (
                <li key={entry.rewardId} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-ink/80">
                    {labels.reward[entry.rewardId] ?? entry.rewardId}
                    {entry.trialDays ? ` · ${entry.trialDays}d` : ""}
                  </span>
                  <span className="rounded-full bg-bloom-50 px-2.5 py-0.5 text-sm font-semibold text-bloom-700">
                    ×{entry.quantity}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-4 text-xs text-ink/50">{labels.capNote}</p>
        </div>

        <dl className="card-fm grid grid-cols-3 gap-2 text-center">
          <Stat label={labels.countGranted} value={counts.granted} />
          <Stat label={labels.countPending} value={counts.pending} />
          <Stat label={labels.countTotal} value={counts.total} />
        </dl>
      </aside>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-ink/50">{label}</dt>
      <dd className="font-display text-2xl font-semibold text-ink">{value}</dd>
    </div>
  );
}

function OutcomeBadge({
  outcome,
  label
}: {
  outcome: ReferralOverview["entries"][number]["outcome"];
  label: string;
}) {
  // Held and rejected are deliberately not alarming reds. A hold is a queue, not
  // an accusation, and the referrer is usually not the one who did anything.
  const tone =
    outcome === "granted"
      ? "bg-bloom-50 text-bloom-700"
      : outcome === "pending_qualification"
        ? "bg-dusk-50 text-ink/70"
        : "bg-black/5 text-ink/60";

  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>{label}</span>
  );
}
