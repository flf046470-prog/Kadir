import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHero } from "@/components/PageHero";
import { JsonLd } from "@/components/JsonLd";
import { buildMetadata } from "@/lib/seo";
import { guides } from "@/lib/guides-data";
import { locales, type Locale } from "@/i18n/locales";

export function generateStaticParams() {
  return locales.flatMap((locale) => Object.keys(guides).map((slug) => ({ locale, slug })));
}

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const guide = guides[slug];
  if (!guide) return {};
  return buildMetadata({
    locale: locale as Locale,
    path: `/guides/${slug}`,
    title: guide.title,
    description: guide.description
  });
}

export default async function GuidePage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const guide = guides[slug];
  if (!guide) notFound();

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Article",
          headline: guide.title,
          description: guide.description,
          author: { "@type": "Organization", name: "FioreMatch" }
        }}
      />
      <PageHero eyebrow={guide.readTime} title={guide.title} subtitle={guide.description} />
      <article className="container-fm max-w-2xl space-y-10 py-16">
        {guide.sections.map((section) => (
          <div key={section.heading}>
            <h2 className="font-display text-xl font-semibold text-ink">{section.heading}</h2>
            <p className="mt-3 text-ink/70">{section.body}</p>
          </div>
        ))}
      </article>
    </>
  );
}
