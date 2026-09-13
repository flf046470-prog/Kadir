"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { placeLabel } from "@/lib/countries-data";

type Photo = { id: string; url: string };
type ProfileCard = {
  id: string;
  displayName: string;
  age: number | null;
  cityId: string | null;
  countryId: string | null;
};

type Entry = {
  profile: ProfileCard | null;
  photos: Photo[];
  superLike?: boolean;
  viewCount?: number;
  likedAt?: string;
  lastViewedAt?: string;
};

type Payload = { locked: boolean; total: number; results: Entry[] };

export type PeopleListLabels = {
  loading: string;
  empty: string;
  lockedTitle: string;
  lockedBody: string;
  upgrade: string;
  superLike: string;
  repeatVisit: string;
};

/**
 * The shared body of "who liked you" and "who visited you".
 *
 * Both are the same shape — a gated list with an ungated count — so they are
 * one component rather than two that drift. The lock is decided by the server;
 * this only renders what came back, and when the list is locked nothing about
 * those people is in the payload to render.
 */
export function PeopleList({
  endpoint,
  countKey,
  labels,
  pricingHref
}: {
  endpoint: string;
  /**
   * Key of the ICU plural message for the count, resolved here rather than
   * passed in as a string: the count is only known once the fetch returns, and
   * a message with a `{count}` argument that never receives one renders as its
   * own key — which is exactly what shipped before this was a plural.
   */
  countKey: "likesCount" | "visitorsCount";
  labels: PeopleListLabels;
  pricingHref: string;
}) {
  const locale = useLocale();
  const t = useTranslations("app");
  const [data, setData] = useState<Payload | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const response = await fetch(endpoint);
        if (response.ok && live) setData(await response.json());
        else if (live) setData({ locked: false, total: 0, results: [] });
      } catch {
        if (live) setData({ locked: false, total: 0, results: [] });
      }
    })();
    return () => {
      live = false;
    };
  }, [endpoint]);

  if (!data) return <p className="mt-8 text-ink/60">{labels.loading}</p>;

  const countLabel = t(countKey, { count: data.total });

  if (data.total === 0) {
    return <p className="mt-8 text-ink/60">{labels.empty}</p>;
  }

  if (data.locked) {
    return (
      <div className="mt-8 rounded-3xl border border-dusk-200 bg-dusk-50 p-8">
        <p className="font-display text-2xl font-semibold text-ink">{countLabel}</p>
        <h2 className="mt-3 font-semibold text-ink">{labels.lockedTitle}</h2>
        <p className="mt-2 max-w-prose text-sm text-ink/70">{labels.lockedBody}</p>
        <a href={pricingHref} className="btn-primary mt-6 inline-block">
          {labels.upgrade}
        </a>
      </div>
    );
  }

  return (
    <>
      <p className="mt-6 text-sm text-ink/60">{countLabel}</p>
      <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {data.results.map((entry, index) => {
          const profile = entry.profile;
          if (!profile) return null;
          const place = [profile.cityId, profile.countryId]
            .filter((id): id is string => Boolean(id))
            .map(placeLabel)
            .join(", ");
          const when = entry.likedAt ?? entry.lastViewedAt;

          return (
            <li
              key={profile.id ?? index}
              className="overflow-hidden rounded-2xl border border-black/10 bg-white"
            >
              {entry.photos[0] ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={entry.photos[0].url} alt="" className="aspect-[4/5] w-full object-cover" />
              ) : (
                <div className="aspect-[4/5] w-full bg-bloom-50" />
              )}
              <div className="p-3">
                <p className="text-sm font-semibold text-ink">
                  {profile.displayName}
                  {profile.age !== null && (
                    <span className="font-normal text-ink/60">, {profile.age}</span>
                  )}
                </p>
                {place && <p className="mt-0.5 text-xs text-ink/55">{place}</p>}
                {entry.superLike && (
                  <p className="mt-1 text-xs font-medium text-bloom-600">{labels.superLike}</p>
                )}
                {typeof entry.viewCount === "number" && entry.viewCount > 1 && (
                  <p className="mt-1 text-xs text-ink/55">
                    {labels.repeatVisit.replace("{count}", String(entry.viewCount))}
                  </p>
                )}
                {when && (
                  <time className="mt-1 block text-xs text-ink/45" dateTime={when}>
                    {new Date(when).toLocaleDateString(locale, {
                      day: "numeric",
                      month: "short"
                    })}
                  </time>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
