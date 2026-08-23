import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { currentUser } from "@/auth/guard";
import { parseFilters } from "@/lib/matching/filters";
import { DiscoverClient } from "./DiscoverClient";

export const dynamic = "force-dynamic";

export default async function DiscoverPage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;

  // Server-side gate: the API enforces this too, but an unauthenticated visitor
  // should never see the shell of a signed-in page.
  const user = await currentUser();
  if (!user) redirect(`/${locale}/login`);

  const t = await getTranslations({ locale, namespace: "app" });

  // A shared or bookmarked link carries its filters. It goes through the same
  // parser the API uses, so a hand-edited query can only ever produce a valid
  // filter set — never an unexpected one that the UI then displays as truth.
  const initialFilters = parseFilters(toSearchParams(await searchParams));

  return (
    <section className="container-fm py-10">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-semibold text-ink">{t("discoverTitle")}</h1>
        <span className="text-sm text-ink/50">{user.displayName}</span>
      </div>

      <DiscoverClient
        initialFilters={initialFilters}
        labels={{
          empty: t("discoverEmpty"),
          emptyFiltered: t("discoverEmptyFiltered"),
          why: t("why"),
          like: t("like"),
          pass: t("pass"),
          superLike: t("superLike"),
          matched: t("matched"),
          loading: t("loading"),
          modeLabel: t("modeLabel"),
          potential: t("potential"),
          speaks: t("cardSpeaks"),
          noBio: t("cardNoBio"),
          boost: t("boost"),
          boostRunning: t("boostRunning"),
          boostNone: t("boostNone"),
          likeLimitReached: t("likeLimitReached"),
          filtersDowngraded: t("filtersDowngraded"),
          bands: {
            strong: t("bandStrong"),
            promising: t("bandPromising"),
            exploring: t("bandExploring")
          }
        }}
        filterLabels={{
          title: t("filters"),
          ageRange: t("filterAge"),
          minAge: t("filterAgeMin"),
          maxAge: t("filterAgeMax"),
          country: t("country"),
          city: t("city"),
          placeHint: t("filterPlaceHint"),
          languages: t("filterLanguages"),
          languagesHint: t("filterLanguagesHint"),
          goal: t("goal"),
          intent: t("filterIntent"),
          apply: t("filterApply"),
          reset: t("filterReset"),
          active: t("filterActive"),
          none: t("filterNone")
        }}
      />
    </section>
  );
}

/** Next hands search params as a record; the filter parser speaks URLSearchParams. */
function toSearchParams(query: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") params.set(key, value);
    // A repeated key (?goals=a&goals=b) arrives as an array; the parser splits
    // on commas, so join rather than dropping the extras.
    else if (Array.isArray(value)) params.set(key, value.join(","));
  }

  return params;
}
