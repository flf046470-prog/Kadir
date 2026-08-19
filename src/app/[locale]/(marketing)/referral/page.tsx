import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { useTranslations } from "next-intl";
import { PageHero } from "@/components/PageHero";
import { Link } from "@/i18n/navigation";
import { buildMetadata } from "@/lib/seo";
import type { Locale } from "@/i18n/locales";

type RewardItem = { name: string; desc: string };

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "referral" });
  return buildMetadata({
    locale: locale as Locale,
    path: "/referral",
    title: t("title"),
    description: t("subtitle")
  });
}

export default function ReferralPage() {
  const t = useTranslations("referral");
  const home = useTranslations("home");
  const steps = t.raw("how") as string[];
  const rewards = t.raw("rewards") as RewardItem[];

  return (
    <>
      <PageHero eyebrow="Referral" title={t("title")} subtitle={t("subtitle")} />

      <section className="container-fm py-16">
        <h2 className="font-display text-2xl font-semibold text-ink">{t("howTitle")}</h2>
        <ol className="mt-6 grid gap-4 md:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step} className="card-fm">
              <span className="font-display text-2xl text-bloom-300">{index + 1}</span>
              <p className="mt-2 text-sm text-ink/75">{step}</p>
            </li>
          ))}
        </ol>

        <h2 className="mt-14 font-display text-2xl font-semibold text-ink">{t("rewardsTitle")}</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {rewards.map((reward) => (
            <div key={reward.name} className="card-fm">
              <h3 className="font-semibold text-ink">{reward.name}</h3>
              <p className="mt-2 text-sm text-ink/70">{reward.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-black/5 bg-bloom-50 py-16">
        <div className="container-fm grid gap-8 md:grid-cols-2">
          <div>
            <h2 className="font-display text-xl font-semibold text-ink">{t("fairTitle")}</h2>
            <p className="mt-3 text-sm text-ink/75">{t("fairBody")}</p>
          </div>
          <div>
            <h2 className="font-display text-xl font-semibold text-ink">{t("abuseTitle")}</h2>
            <p className="mt-3 text-sm text-ink/75">{t("abuseBody")}</p>
          </div>
        </div>
      </section>

      <section className="container-fm py-14">
        <Link href="/register" className="btn-primary">
          {home("ctaPrimary")}
        </Link>
      </section>
    </>
  );
}
