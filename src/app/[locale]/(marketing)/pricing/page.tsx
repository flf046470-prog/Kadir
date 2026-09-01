import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { useTranslations } from "next-intl";
import { PageHero } from "@/components/PageHero";
import { PricingCard } from "@/components/PricingCard";
import { JsonLd } from "@/components/JsonLd";
import { buildMetadata, faqSchema } from "@/lib/seo";
import type { Locale } from "@/i18n/locales";

type Addon = { name: string; desc: string };

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pricing" });
  return buildMetadata({
    locale: locale as Locale,
    path: "/pricing",
    title: t("title"),
    description: t("subtitle")
  });
}

export default function PricingPage() {
  const t = useTranslations("pricing");
  const addons = t.raw("addons") as Addon[];

  const faqs = [
    {
      question: "How much do PLUS and VIP cost?",
      answer: "PLUS is $4.99/month and VIP is $9.99/month, shown in your local currency where supported by the App Store and Google Play. Cancel any time and you keep what you paid for until the period ends."
    },
    {
      question: "Is pricing the same in every country?",
      answer: "Local prices follow Apple App Store and Google Play country-level pricing tiers, not a raw currency conversion, and are managed centrally so pricing stays fair by market."
    },
    {
      question: "Can I use FioreMatch for free?",
      answer: "Yes. The Free tier includes full profile creation, Discover, matching, messaging, and standard filters."
    }
  ];

  return (
    <>
      <JsonLd data={faqSchema(faqs)} />
      <PageHero eyebrow="Pricing" title={t("title")} subtitle={t("subtitle")} />

      <section className="container-fm py-16">
        <div className="grid gap-6 lg:grid-cols-3">
          <PricingCard
            name={t("freeName")}
            price={t("freePrice")}
            period={t("freePeriod")}
            desc={t("freeDesc")}
            features={t.raw("freeFeatures") as string[]}
            cta={t("cta")}
          />
          <PricingCard
            name={t("plusName")}
            price={t("plusPrice")}
            period={t("plusPeriod")}
            desc={t("plusDesc")}
            features={t.raw("plusFeatures") as string[]}
            cta={t("cta")}
          />
          <PricingCard
            name={t("vipName")}
            price={t("vipPrice")}
            period={t("vipPeriod")}
            desc={t("vipDesc")}
            features={t.raw("vipFeatures") as string[]}
            cta={t("cta")}
            highlight
            badge={t("vipBadge")}
          />
        </div>
        <p className="mx-auto mt-8 max-w-2xl text-center text-xs text-ink/50">{t("localNote")}</p>

        <div className="mt-20">
          <h2 className="font-display text-2xl font-semibold text-ink">{t("addonsTitle")}</h2>
          <p className="mt-2 text-ink/70">{t("addonsSubtitle")}</p>
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {addons.map((addon) => (
              <div key={addon.name} className="card-fm">
                <h3 className="font-semibold text-ink">{addon.name}</h3>
                <p className="mt-2 text-sm text-ink/70">{addon.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
