import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHero } from "@/components/PageHero";
import { Link } from "@/i18n/navigation";
import { buildMetadata } from "@/lib/seo";
import { guides } from "@/lib/guides-data";
import type { Locale } from "@/i18n/locales";

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "guidesIndex" });
  return buildMetadata({
    locale: locale as Locale,
    path: "/guides",
    title: t("title"),
    description: t("subtitle")
  });
}

export default async function GuidesIndexPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "guidesIndex" });

  return (
    <>
      <PageHero eyebrow="Guides" title={t("title")} subtitle={t("subtitle")} />
      <section className="container-fm py-16">
        <div className="grid gap-6 md:grid-cols-2">
          {Object.values(guides).map((guide) => (
            <Link key={guide.slug} href={`/guides/${guide.slug}`} className="card-fm block hover:border-bloom-300">
              <p className="text-xs font-medium uppercase tracking-wide text-bloom-600">{guide.readTime}</p>
              <h2 className="mt-2 font-display text-xl font-semibold text-ink">{guide.title}</h2>
              <p className="mt-2 text-sm text-ink/70">{guide.description}</p>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
