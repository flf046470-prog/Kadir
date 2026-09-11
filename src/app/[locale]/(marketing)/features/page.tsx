import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { useTranslations } from "next-intl";
import { PageHero } from "@/components/PageHero";
import { buildMetadata } from "@/lib/seo";
import type { Locale } from "@/i18n/locales";

type FeatureGroup = {
  heading: string;
  items: { name: string; desc: string }[];
};

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "features" });
  return buildMetadata({
    locale: locale as Locale,
    path: "/features",
    title: t("title"),
    description: t("subtitle")
  });
}

export default function FeaturesPage() {
  const t = useTranslations("features");
  const groups = t.raw("groups") as FeatureGroup[];

  return (
    <>
      <PageHero eyebrow="Features" title={t("title")} subtitle={t("subtitle")} />
      <section className="container-fm space-y-14 py-16">
        {groups.map((group) => (
          <div key={group.heading}>
            <h2 className="font-display text-2xl font-semibold text-ink">{group.heading}</h2>
            <div className="mt-6 grid gap-6 md:grid-cols-3">
              {group.items.map((item) => (
                <div key={item.name} className="card-fm">
                  <h3 className="font-semibold text-ink">{item.name}</h3>
                  <p className="mt-2 text-sm text-ink/70">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
