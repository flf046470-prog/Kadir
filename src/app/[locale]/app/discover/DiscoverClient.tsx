"use client";

import { useCallback, useEffect, useState } from "react";
import { discoveryModes, type DiscoveryModeId } from "@/lib/domain/taxonomies";

type Reason = { id: string; values: string[]; strength: number };
type Compatibility =
  | { kind: "unavailable" }
  | { kind: "band"; band: "exploring" | "promising" | "strong"; percent: number };

type Photo = { id: string; url: string; width: number; height: number };

type Suggestion = {
  profileId: string;
  score: number;
  compatibility: Compatibility;
  reasons: Reason[];
  photos: Photo[];
};

type Labels = {
  empty: string;
  why: string;
  like: string;
  pass: string;
  superLike: string;
  matched: string;
  loading: string;
  modeLabel: string;
  potential: string;
  bands: { strong: string; promising: string; exploring: string };
};

/**
 * Discover — the real feed, backed by the matching engine.
 *
 * Every card shows the reasons behind the suggestion. That is the product's
 * central claim, so it renders inline rather than behind a tap: if we can't
 * explain a suggestion, we shouldn't be making it.
 */
export function DiscoverClient({ labels }: { labels: Labels }) {
  const [mode, setMode] = useState<DiscoveryModeId>("local");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [matchBanner, setMatchBanner] = useState(false);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async (nextMode: DiscoveryModeId) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/discover?mode=${nextMode}`);
      const body = await response.json();
      setSuggestions(response.ok ? (body.results ?? []) : []);
    } catch {
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(mode);
  }, [mode, load]);

  async function judge(profileId: string, kind: "like" | "pass" | "super_like") {
    if (acting) return;
    setActing(profileId);

    try {
      const response = await fetch("/api/likes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toUserId: profileId, kind })
      });

      if (response.ok) {
        const body = await response.json();
        if (body.matched) {
          setMatchBanner(true);
          setTimeout(() => setMatchBanner(false), 4000);
        }
      }

      // Remove the card either way — a failed write shouldn't trap the member
      // on a profile they already judged.
      setSuggestions((current) => current.filter((item) => item.profileId !== profileId));
    } finally {
      setActing(null);
    }
  }

  const current = suggestions[0];

  return (
    <div className="mt-8">
      <label className="block text-sm font-medium text-ink">
        {labels.modeLabel}
        <select
          value={mode}
          onChange={(event) => setMode(event.target.value as DiscoveryModeId)}
          className="ml-3 rounded-full border border-black/10 px-4 py-2 text-sm"
        >
          {discoveryModes.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </label>

      {matchBanner && (
        <p className="mt-6 rounded-xl bg-bloom-500 p-4 text-center font-semibold text-white" role="status">
          {labels.matched} ❤️
        </p>
      )}

      {loading && <p className="mt-10 text-ink/50">{labels.loading}</p>}

      {!loading && !current && <p className="mt-10 text-ink/60">{labels.empty}</p>}

      {!loading && current && (
        <article className="mt-6 max-w-xl overflow-hidden rounded-3xl border border-black/10 bg-white shadow-sm">
          {current.photos.length > 0 && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={current.photos[0].url}
              alt=""
              className="aspect-[4/5] w-full object-cover"
            />
          )}
          <div className="p-8">
          <CompatibilityLine
            compatibility={current.compatibility}
            potentialLabel={labels.potential}
            bands={labels.bands}
          />

          <h2 className="mt-4 font-display text-xl font-semibold text-ink">{labels.why}</h2>
          <ul className="mt-3 space-y-2 text-sm text-ink/80">
            {current.reasons.map((reason) => (
              <li key={reason.id} className="flex gap-2">
                <span aria-hidden="true" className="text-bloom-500">
                  ✓
                </span>
                <span>
                  {reason.id.replace(/_/g, " ")}
                  {reason.values.length > 0 && `: ${reason.values.join(", ")}`}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-8 flex gap-3">
            <button
              type="button"
              onClick={() => judge(current.profileId, "pass")}
              className="btn-secondary flex-1"
              disabled={acting !== null}
            >
              {labels.pass}
            </button>
            <button
              type="button"
              onClick={() => judge(current.profileId, "super_like")}
              className="btn-secondary flex-1"
              disabled={acting !== null}
            >
              {labels.superLike}
            </button>
            <button
              type="button"
              onClick={() => judge(current.profileId, "like")}
              className="btn-primary flex-1"
              disabled={acting !== null}
            >
              {labels.like}
            </button>
          </div>
          </div>
        </article>
      )}
    </div>
  );
}

/**
 * Compatibility is shown as a band, and omitted entirely when the engine says
 * confidence is too low — never as a bare percentage implying precision we
 * don't have.
 */
function CompatibilityLine({
  compatibility,
  potentialLabel,
  bands
}: {
  compatibility: Compatibility;
  potentialLabel: string;
  bands: Labels["bands"];
}) {
  if (compatibility.kind === "unavailable") return null;

  return (
    <p className="text-xs font-semibold uppercase tracking-wide text-bloom-600">
      {potentialLabel}: {bands[compatibility.band]}
    </p>
  );
}
