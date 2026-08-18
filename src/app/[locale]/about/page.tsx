import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { useTranslations } from "next-intl";
import { PageHero } from "@/components/PageHero";
import { buildMetadata } from "@/lib/seo";
import type { Locale } from "@/i18n/locales";

type Value = { name: string; desc: string };

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "about" });
  return buildMetadata({
    locale: locale as Locale,
    path: "/about",
    title: t("title"),
    description: t("subtitle")
  });
}

export default function AboutPage() {
  const t = useTranslations("about");
  const values = t.raw("values") as Value[];

  return (
    <>
      <PageHero eyebrow="About" title={t("title")} subtitle={t("subtitle")} />
      <section className="container-fm space-y-6 py-16">
        <p className="max-w-3xl text-ink/70">{t("body1")}</p>
        <p className="max-w-3xl text-ink/70">{t("body2")}</p>

        <h2 className="!mt-12 font-display text-2xl font-semibold text-ink">{t("valuesTitle")}</h2>
        <div className="grid gap-6 sm:grid-cols-2">
          {values.map((v) => (
            <div key={v.name} className="card-fm">
              <h3 className="font-semibold text-ink">{v.name}</h3>
              <p className="mt-2 text-sm text-ink/70">{v.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
