"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { placeLabel } from "@/lib/countries-data";
import { discoveryModes, type DiscoveryModeId } from "@/lib/domain/taxonomies";
import { filtersToParams, isDefault, type DiscoveryFilters } from "@/lib/matching/filters";
import { Filters, type FilterLabels } from "./Filters";

type Reason = { id: string; values: string[]; strength: number };
type Compatibility =
  | { kind: "unavailable" }
  | { kind: "band"; band: "exploring" | "promising" | "strong"; percent: number };

type Photo = { id: string; url: string; width: number; height: number };

/**
 * The display side of a candidate. Fields the member chose to hide arrive as
 * null or empty — the server applies visibility, so there is nothing here the
 * viewer is not allowed to see.
 */
type ProfileCard = {
  id: string;
  displayName: string;
  age: number | null;
  bio: string | null;
  cityId: string | null;
  countryId: string | null;
  relationshipGoal: string | null;
  languagesSpoken: string[];
  interests: string[];
};

type Suggestion = {
  profileId: string;
  profile: ProfileCard | null;
  score: number;
  compatibility: Compatibility;
  reasons: Reason[];
  photos: Photo[];
};

type Labels = {
  empty: string;
  emptyFiltered: string;
  why: string;
  like: string;
  pass: string;
  superLike: string;
  matched: string;
  loading: string;
  modeLabel: string;
  potential: string;
  speaks: string;
  noBio: string;
  bands: { strong: string; promising: string; exploring: string };
};

/**
 * Discover — the real feed, backed by the matching engine.
 *
 * Every card shows the reasons behind the suggestion. That is the product's
 * central claim, so it renders inline rather than behind a tap: if we can't
 * explain a suggestion, we shouldn't be making it.
 */
export function DiscoverClient({
  labels,
  filterLabels,
  initialFilters
}: {
  labels: Labels;
  filterLabels: FilterLabels;
  initialFilters: DiscoveryFilters;
}) {
  const taxonomy = useTranslations("taxonomy");
  const locale = useLocale();
  const [mode, setMode] = useState<DiscoveryModeId>("local");
  const [filters, setFilters] = useState<DiscoveryFilters>(initialFilters);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [matchBanner, setMatchBanner] = useState(false);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async (nextMode: DiscoveryModeId, nextFilters: DiscoveryFilters) => {
    setLoading(true);
    try {
      // The same serialiser the server parses with, so what the URL shows and
      // what the feed asked for cannot drift apart.
      const params = filtersToParams(nextFilters);
      params.set("mode", nextMode);
      const response = await fetch(`/api/discover?${params.toString()}`);
      const body = await response.json();
      setSuggestions(response.ok ? (body.results ?? []) : []);
    } catch {
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(mode, filters);
  }, [mode, filters, load]);

  /**
   * Filters live in the address bar rather than in storage: a reload keeps
   * them, a link carries them, and nothing about a member's search is left
   * behind on a shared device after they sign out.
   */
  function applyFilters(next: DiscoveryFilters) {
    setFilters(next);

    const params = filtersToParams(next);
    const query = params.toString();
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
  }

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

      <Filters value={filters} onChange={applyFilters} labels={filterLabels} />

      {matchBanner && (
        <p className="mt-6 rounded-xl bg-bloom-500 p-4 text-center font-semibold text-white" role="status">
          {labels.matched} ❤️
        </p>
      )}

      {loading && <p className="mt-10 text-ink/50">{labels.loading}</p>}

      {/* An empty feed means something different when filters are on, so it
          says so — otherwise a narrow filter reads as "nobody is here". */}
      {!loading && !current && (
        <p className="mt-10 text-ink/60">
          {isDefault(filters) ? labels.empty : labels.emptyFiltered}
        </p>
      )}

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
          {current.profile && (
            <ProfileHeader profile={current.profile} labels={labels} taxonomy={taxonomy} />
          )}

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
                  {taxonomy(`reasons.${reason.id}`)}
                  {reason.values.length > 0 &&
                    `: ${reason.values
                      .map((value) => reasonValueLabel(reason.id, value, taxonomy, locale))
                      .join(", ")}`}
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
type Translator = (key: string) => string;

/**
 * Who the viewer is deciding about.
 *
 * A card without a name, an age, or a face is a decision made on statistics
 * alone — this is the part that makes the reasons underneath mean something.
 * Location is shown at city level and only when the member publishes it; there
 * is no precise location anywhere in the payload to show.
 */
function ProfileHeader({
  profile,
  labels,
  taxonomy
}: {
  profile: ProfileCard;
  labels: Labels;
  taxonomy: Translator;
}) {
  const locale = useLocale();
  const place = [profile.cityId, profile.countryId]
    .filter((id): id is string => Boolean(id))
    .map(placeLabel)
    .join(", ");

  return (
    <header>
      <h2 className="font-display text-2xl font-semibold text-ink">
        {profile.displayName}
        {profile.age !== null && <span className="font-normal text-ink/70">, {profile.age}</span>}
      </h2>

      {place && <p className="mt-1 text-sm text-ink/60">{place}</p>}

      {profile.relationshipGoal && (
        <p className="mt-3">
          <span className="rounded-full bg-bloom-50 px-3 py-1 text-xs font-medium text-bloom-700">
            {taxonomy(`relationshipGoals.${profile.relationshipGoal}`)}
          </span>
        </p>
      )}

      <p className="mt-4 whitespace-pre-line text-sm text-ink/80">
        {profile.bio?.trim() ? profile.bio : <span className="text-ink/40">{labels.noBio}</span>}
      </p>

      {profile.languagesSpoken.length > 0 && (
        <p className="mt-3 text-xs text-ink/50">
          {labels.speaks}: {profile.languagesSpoken.map((tag) => languageName(tag, locale)).join(", ")}
        </p>
      )}

      <hr className="mt-6 border-black/5" />
    </header>
  );
}

/**
 * Language tags are stored as codes and read as names, in the viewer's own
 * language. `Intl.DisplayNames` knows every tag we accept, and an unknown one
 * falls back to the code rather than to nothing.
 */
function languageName(tag: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(tag) ?? tag.toUpperCase();
  } catch {
    return tag.toUpperCase();
  }
}

/**
 * Reason evidence is stored as ids, so it is translated the same way the rest
 * of the vocabulary is. Free-text evidence (interests a member typed) has no
 * translation and is shown as written.
 */
function reasonValueLabel(
  reasonId: string,
  value: string,
  taxonomy: Translator,
  locale: string
): string {
  if (reasonId === "relationship_goal") return taxonomy(`relationshipGoals.${value}`);
  if (reasonId === "match_intent") return taxonomy(`matchIntents.${value}`);
  if (reasonId === "location") return placeLabel(value);
  if (reasonId === "language" || reasonId === "language_exchange") {
    return languageName(value, locale);
  }
  return value;
}

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
