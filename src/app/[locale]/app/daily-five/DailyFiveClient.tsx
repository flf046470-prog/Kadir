"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { reasonLine } from "@/lib/matching/reason-label";
import type { DailySuggestion } from "@/db/daily-suggestions";
import { placeLabel } from "@/lib/countries-data";

/**
 * The day's five, decided.
 *
 * Judged cards stay on screen as a settled row rather than disappearing. The
 * list is a fixed set of five decisions, so a member should be able to see how
 * far through it they are — a card vanishing on a tap makes five feel like an
 * endless feed again, which is the exact thing this replaces.
 */
export function DailyFiveClient({
  suggestions,
  labels
}: {
  suggestions: DailySuggestion[];
  labels: {
    why: string;
    like: string;
    pass: string;
    superLike: string;
    matched: string;
    done: string;
    noBio: string;
    decided: string;
  };
}) {
  const taxonomy = useTranslations("taxonomy");
  const locale = useLocale();
  const [decided, setDecided] = useState<Record<string, "like" | "pass" | "super_like">>({});
  const [matched, setMatched] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function judge(profileId: string, kind: "like" | "pass" | "super_like") {
    if (decided[profileId] || busy) return;
    setBusy(profileId);
    try {
      const response = await fetch("/api/likes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toUserId: profileId, kind })
      });
      if (!response.ok) return;

      const result: { matched?: boolean } = await response.json();
      setDecided((previous) => ({ ...previous, [profileId]: kind }));
      if (result.matched) setMatched((previous) => ({ ...previous, [profileId]: true }));
    } finally {
      setBusy(null);
    }
  }

  const remaining = suggestions.filter((s) => !decided[s.profileId]).length;

  return (
    <div className="mt-8 space-y-5">
      {remaining === 0 && (
        <p className="rounded-2xl border border-bloom-200 bg-bloom-50 px-5 py-4 text-sm font-medium text-ink">
          {labels.done}
        </p>
      )}

      {suggestions.map((suggestion) => {
        const profile = suggestion.profile;
        const choice = decided[suggestion.profileId];

        return (
          <article
            key={suggestion.profileId}
            className={`card-fm transition-opacity ${choice ? "opacity-60" : ""}`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-2xl font-semibold text-ink">
                {profile?.displayName ?? "—"}
                {profile?.age ? <span className="text-ink/60">, {profile.age}</span> : null}
              </h2>
              {matched[suggestion.profileId] && (
                <span className="rounded-full bg-bloom-500 px-3 py-1 text-xs font-semibold text-white">
                  {labels.matched}
                </span>
              )}
            </div>

            {profile?.cityId && (
              // Same renderer as Discover. Hand-rolling the casing here printed
              // "Istanbul, TURKEY" against Discover's "Istanbul, Turkey" for
              // the same person, and shouted the country at everyone.
              <p className="mt-1 text-sm text-ink/60">
                {[profile.cityId, profile.countryId]
                  .filter((id): id is string => Boolean(id))
                  .map(placeLabel)
                  .join(", ")}
              </p>
            )}

            <p className="mt-3 text-ink/75">{profile?.bio || labels.noBio}</p>

            {suggestion.reasons.length > 0 && (
              <>
                <h3 className="mt-5 font-display text-lg font-semibold text-ink">{labels.why}</h3>
                <ul className="mt-2 space-y-1 text-sm text-ink/70">
                  {suggestion.reasons.map((reason) => (
                    <li key={reason.id}>
                      <span aria-hidden="true" className="text-bloom-500">
                        ✓{" "}
                      </span>
                      {/* Ids become words here, through the same helper Discover
                          uses — a reason must not read differently per screen. */}
                      {reasonLine(reason, taxonomy, locale)}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {choice ? (
              <p className="mt-5 text-sm font-medium text-ink/50">{labels.decided}</p>
            ) : (
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => judge(suggestion.profileId, "pass")}
                  disabled={busy === suggestion.profileId}
                  className="rounded-full border border-dusk-200 px-5 py-2 text-sm font-semibold text-dusk-700 transition hover:bg-dusk-50 disabled:opacity-50"
                >
                  {labels.pass}
                </button>
                <button
                  type="button"
                  onClick={() => judge(suggestion.profileId, "super_like")}
                  disabled={busy === suggestion.profileId}
                  className="rounded-full border border-bloom-300 px-5 py-2 text-sm font-semibold text-bloom-600 transition hover:bg-bloom-50 disabled:opacity-50"
                >
                  {labels.superLike}
                </button>
                <button
                  type="button"
                  onClick={() => judge(suggestion.profileId, "like")}
                  disabled={busy === suggestion.profileId}
                  className="btn-primary disabled:opacity-50"
                >
                  {labels.like}
                </button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}