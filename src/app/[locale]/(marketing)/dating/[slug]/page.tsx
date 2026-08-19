import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { PageHero } from "@/components/PageHero";
import { JsonLd } from "@/components/JsonLd";
import { buildMetadata, faqSchema } from "@/lib/seo";
import { countries, cities } from "@/lib/countries-data";
import type { Locale } from "@/i18n/locales";
import { locales } from "@/i18n/locales";

export function generateStaticParams() {
  const slugs = [...Object.keys(countries), ...Object.keys(cities)];
  return locales.flatMap((locale) => slugs.map((slug) => ({ locale, slug })));
}

function resolve(slug: string) {
  if (countries[slug]) return { type: "country" as const, data: countries[slug] };
  if (cities[slug]) return { type: "city" as const, data: cities[slug] };
  return null;
}

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const resolved = resolve(slug);
  if (!resolved) return {};
  const t = await getTranslations({ locale, namespace: "meta" });
  const name = resolved.data.name;
  const title =
    resolved.type === "country"
      ? `Dating in ${name} — ${t("siteName")}`
      : `Dating in ${name} — ${t("siteName")}`;

  return buildMetadata({
    locale: locale as Locale,
    path: `/dating/${slug}`,
    title,
    description: resolved.data.intro
  });
}

export default async function DatingSlugPage({
  params
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { slug } = await params;
  const resolved = resolve(slug);
  if (!resolved) notFound();

  if (resolved.type === "country") {
    const c = resolved.data;
    const relatedCities = c.cities
      .map((slug) => cities[slug])
      .filter((city): city is NonNullable<typeof city> => Boolean(city));

    const faqs = [
      {
        question: `Is FioreMatch active in ${c.name}?`,
        answer: `Yes — ${c.name} is part of FioreMatch's ${c.region} launch coverage. ${c.stat}`
      },
      {
        question: `What should I know about dating in ${c.name}?`,
        answer: c.cultureNote
      }
    ];

    return (
      <>
        <JsonLd data={faqSchema(faqs)} />
        <PageHero eyebrow={c.region} title={`Dating in ${c.name}`} subtitle={c.intro}>
          <div className="mt-8">
            <Link href="/register" className="btn-primary">
              Create your free profile
            </Link>
          </div>
        </PageHero>
        <section className="container-fm py-16">
          <div className="grid gap-10 md:grid-cols-2">
            <div className="card-fm">
              <h2 className="font-display text-lg font-semibold text-ink">Why members choose FioreMatch here</h2>
              <p className="mt-2 text-sm text-ink/70">{c.whyHere}</p>
            </div>
            <div className="card-fm">
              <h2 className="font-display text-lg font-semibold text-ink">Dating culture note</h2>
              <p className="mt-2 text-sm text-ink/70">{c.cultureNote}</p>
            </div>
          </div>
          {relatedCities.length > 0 && (
            <div className="mt-12">
              <h2 className="font-display text-xl font-semibold text-ink">Popular cities in {c.name}</h2>
              <ul className="mt-4 flex flex-wrap gap-2">
                {relatedCities.map((city) => (
                  <li key={city.slug}>
                    <Link
                      href={`/dating/${city.slug}`}
                      className="inline-block rounded-full border border-black/10 px-4 py-2 text-sm text-ink/80 hover:border-bloom-300 hover:text-bloom-600"
                    >
                      {city.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </>
    );
  }

  const city = resolved.data;
  const country = countries[city.countrySlug];

  return (
    <>
      <PageHero
        eyebrow={country ? country.name : "FioreMatch"}
        title={`Dating in ${city.name}`}
        subtitle={city.intro}
      >
        <div className="mt-8">
          <Link href="/register" className="btn-primary">
            Create your free profile
          </Link>
        </div>
      </PageHero>
      <section className="container-fm py-16">
        <div className="card-fm max-w-2xl">
          <h2 className="font-display text-lg font-semibold text-ink">Good to know</h2>
          <p className="mt-2 text-sm text-ink/70">{city.neighborhoodsNote}</p>
        </div>
        {country && (
          <p className="mt-8 text-sm text-ink/60">
            Part of{" "}
            <Link href={`/dating/${country.slug}`} className="font-medium text-bloom-600 hover:underline">
              FioreMatch in {country.name}
            </Link>
            .
          </p>
        )}
      </section>
    </>
  );
}
