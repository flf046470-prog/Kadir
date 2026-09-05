import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { useTranslations } from "next-intl";
import { PageHero } from "@/components/PageHero";
import { JsonLd } from "@/components/JsonLd";
import { buildMetadata } from "@/lib/seo";
import type { Locale } from "@/i18n/locales";

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "international" });
  return buildMetadata({
    locale: locale as Locale,
    path: "/international-dating",
    title: t("title"),
    description: t("subtitle")
  });
}

export default function InternationalDatingPage() {
  const t = useTranslations("international");
  const tips = t.raw("tips") as string[];

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Article",
          headline: t("title"),
          description: t("subtitle"),
          author: { "@type": "Organization", name: "FioreMatch" }
        }}
      />
      <PageHero eyebrow="International Dating" title={t("title")} subtitle={t("subtitle")} />
      <section className="container-fm space-y-6 py-16">
        <p className="max-w-3xl text-ink/70">{t("body1")}</p>
        <p className="max-w-3xl text-ink/70">{t("body2")}</p>

        <h2 className="!mt-12 font-display text-2xl font-semibold text-ink">{t("tipsTitle")}</h2>
        <ul className="grid gap-4 sm:grid-cols-2">
          {tips.map((tip) => (
            <li key={tip} className="card-fm text-sm text-ink/80">
              {tip}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
