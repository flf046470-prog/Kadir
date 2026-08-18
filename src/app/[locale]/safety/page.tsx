import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { useTranslations } from "next-intl";
import { PageHero } from "@/components/PageHero";
import { buildMetadata } from "@/lib/seo";
import type { Locale } from "@/i18n/locales";

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "safety" });
  return buildMetadata({
    locale: locale as Locale,
    path: "/safety",
    title: t("title"),
    description: t("subtitle")
  });
}

export default function SafetyPage() {
  const t = useTranslations("safety");
  const platformItems = t.raw("platformItems") as string[];
  const userItems = t.raw("userItems") as string[];

  return (
    <>
      <PageHero eyebrow="Safety Center" title={t("title")} subtitle={t("subtitle")} />
      <section className="container-fm grid gap-10 py-16 md:grid-cols-2">
        <div>
          <h2 className="font-display text-2xl font-semibold text-ink">{t("platformTitle")}</h2>
          <ul className="mt-6 space-y-3">
            {platformItems.map((item) => (
              <li key={item} className="card-fm text-sm text-ink/80">
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="font-display text-2xl font-semibold text-ink">{t("userTitle")}</h2>
          <ul className="mt-6 space-y-3">
            {userItems.map((item) => (
              <li key={item} className="card-fm text-sm text-ink/80">
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section className="border-t border-black/5 bg-bloom-50 py-16">
        <div className="container-fm max-w-2xl">
          <h2 className="font-display text-xl font-semibold text-ink">{t("reportTitle")}</h2>
          <p className="mt-3 text-ink/70">{t("reportBody")}</p>
          <p className="mt-4 text-sm text-ink/60">{t("moderationNote")}</p>
        </div>
      </section>
    </>
  );
}
