import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { PageHero } from "@/components/PageHero";
import { buildMetadata } from "@/lib/seo";
import { countries, cities } from "@/lib/countries-data";
import type { Locale } from "@/i18n/locales";

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "dating" });
  return buildMetadata({
    locale: locale as Locale,
    path: "/dating",
    title: t("title"),
    description: t("subtitle")
  });
}

export default function DatingPage() {
  const t = useTranslations("dating");
  const filters = t.raw("filters") as string[];

  return (
    <>
      <PageHero eyebrow="FioreMatch" title={t("title")} subtitle={t("subtitle")}>
        <div className="mt-8">
          <Link href="/register" className="btn-primary">
            {t("title")}
          </Link>
        </div>
      </PageHero>

      <section className="container-fm py-16">
        <p className="max-w-3xl text-ink/70">{t("intro")}</p>

        <h2 className="mt-12 font-display text-2xl font-semibold text-ink">{t("filtersTitle")}</h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {filters.map((f) => (
            <li key={f} className="card-fm text-sm text-ink/80">
              {f}
            </li>
          ))}
        </ul>

        <div className="mt-16 grid gap-10 md:grid-cols-2">
          <div>
            <h2 className="font-display text-xl font-semibold text-ink">{t("browseCountries")}</h2>
            <ul className="mt-4 flex flex-wrap gap-2">
              {Object.values(countries).map((c) => (
                <li key={c.slug}>
                  <Link
                    href={`/dating/${c.slug}`}
                    className="inline-block rounded-full border border-black/10 px-4 py-2 text-sm text-ink/80 hover:border-bloom-300 hover:text-bloom-600"
                  >
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="font-display text-xl font-semibold text-ink">{t("browseCities")}</h2>
            <ul className="mt-4 flex flex-wrap gap-2">
              {Object.values(cities).map((c) => (
                <li key={c.slug}>
                  <Link
                    href={`/dating/${c.slug}`}
                    className="inline-block rounded-full border border-black/10 px-4 py-2 text-sm text-ink/80 hover:border-bloom-300 hover:text-bloom-600"
                  >
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </>
  );
}
