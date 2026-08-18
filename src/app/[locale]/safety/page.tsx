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
      <ScamShieldSection />

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

type FlowStep = { step: string; desc: string };

function ScamShieldSection() {
  const t = useTranslations("safetyV2");
  const flow = t.raw("shieldFlow") as FlowStep[];

  return (
    <>
      <section className="border-t border-black/5 bg-dusk-900 py-16 text-white">
        <div className="container-fm">
          <h2 className="font-display text-3xl font-semibold">{t("shieldTitle")}</h2>
          <p className="mt-4 max-w-3xl text-dusk-100">{t("shieldBody")}</p>

          <h3 className="mt-10 text-xs font-semibold uppercase tracking-wide text-bloom-300">
            {t("shieldFlowTitle")}
          </h3>
          <ol className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {flow.map((item, index) => (
              <li key={item.step} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <span className="font-display text-2xl text-bloom-300">{index + 1}</span>
                <h4 className="mt-2 font-semibold">{item.step}</h4>
                <p className="mt-1 text-sm text-dusk-100">{item.desc}</p>
              </li>
            ))}
          </ol>

          <div className="mt-8 max-w-3xl rounded-2xl border border-white/10 p-5">
            <h3 className="font-semibold">{t("shieldNoteTitle")}</h3>
            <p className="mt-2 text-sm text-dusk-100">{t("shieldNote")}</p>
          </div>
        </div>
      </section>

      <section className="container-fm grid gap-8 py-16 md:grid-cols-2">
        <div className="card-fm">
          <h2 className="font-display text-xl font-semibold text-ink">{t("trustTitle")}</h2>
          <p className="mt-3 text-sm text-ink/70">{t("trustBody")}</p>
        </div>
        <div className="card-fm">
          <h2 className="font-display text-xl font-semibold text-ink">{t("dateTitle")}</h2>
          <p className="mt-3 text-sm text-ink/70">{t("dateBody")}</p>
          <p className="mt-4 rounded-lg bg-bloom-50 p-3 text-xs text-ink/70">
            {t("dateDisclaimer")}
          </p>
        </div>
      </section>
    </>
  );
}
