import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { JsonLd } from "@/components/JsonLd";
import { buildMetadata, softwareApplicationSchema, faqSchema } from "@/lib/seo";
import type { Locale } from "@/i18n/locales";

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  return buildMetadata({
    locale: locale as Locale,
    path: "/",
    title: `${t("siteName")} — ${t("tagline")}`,
    description: t("description")
  });
}

export default async function HomePage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("home");

  const steps = [
    { title: t("step1Title"), body: t("step1Body"), n: "01" },
    { title: t("step2Title"), body: t("step2Body"), n: "02" },
    { title: t("step3Title"), body: t("step3Body"), n: "03" }
  ];

  const faqs = [
    { question: t("sectionAiTitle"), answer: t("sectionAiBody") },
    { question: t("sectionSafetyTitle"), answer: t("sectionSafetyBody") },
    { question: t("sectionGlobalTitle"), answer: t("sectionGlobalBody") }
  ];

  return (
    <>
      <JsonLd data={softwareApplicationSchema(locale as Locale)} />
      <JsonLd data={faqSchema(faqs)} />

      <section className="bg-aurora relative overflow-hidden border-b border-black/5">
        <div className="container-fm py-20 sm:py-28">
          <p className="eyebrow">{t("heroEyebrow")}</p>
          <h1 className="mt-4 max-w-3xl font-display text-5xl font-semibold leading-[1.05] tracking-tight text-ink sm:text-6xl">
            {t("heroTitle")}
          </h1>
          <p className="mt-6 max-w-xl text-lg text-ink/70">{t("heroSubtitle")}</p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link href="/register" className="btn-primary">
              {t("ctaPrimary")}
            </Link>
            <Link href="/features" className="btn-secondary">
              {t("ctaSecondary")}
            </Link>
          </div>
          <p className="mt-6 text-sm text-ink/50">{t("trustBar")}</p>

          <div className="mt-14 grid gap-6 border-t border-black/5 pt-10 sm:grid-cols-3">
            <Stat label={t("statCountries")} />
            <Stat label={t("statLanguages")} />
            <Stat label={t("statPrice")} />
          </div>
        </div>
      </section>

      <section className="container-fm py-20">
        <div className="max-w-2xl">
          <h2 className="font-display text-3xl font-semibold text-ink sm:text-4xl">{t("sectionHowTitle")}</h2>
          <p className="mt-3 text-ink/70">{t("sectionHowSubtitle")}</p>
        </div>
        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {steps.map((step) => (
            <div key={step.n} className="card-fm">
              <span className="font-display text-3xl text-bloom-300">{step.n}</span>
              <h3 className="mt-4 text-lg font-semibold text-ink">{step.title}</h3>
              <p className="mt-2 text-sm text-ink/70">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-dusk-900 py-20 text-white">
        <div className="container-fm grid gap-12 lg:grid-cols-2">
          <div>
            <h2 className="font-display text-3xl font-semibold sm:text-4xl">{t("sectionAiTitle")}</h2>
            <p className="mt-4 text-dusk-100">{t("sectionAiBody")}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-bloom-300">
              Why we think you may match
            </p>
            <ul className="mt-4 space-y-3 text-sm text-dusk-100">
              <li>• You both speak English and Spanish, and list travel as a top interest.</li>
              <li>• Same relationship intent: long-term.</li>
              <li>• Overlapping active hours and a 12km radius.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="container-fm py-20">
        <div className="grid gap-10 md:grid-cols-2">
          <div className="card-fm">
            <h2 className="font-display text-2xl font-semibold text-ink">{t("sectionGlobalTitle")}</h2>
            <p className="mt-3 text-ink/70">{t("sectionGlobalBody")}</p>
          </div>
          <div className="card-fm">
            <h2 className="font-display text-2xl font-semibold text-ink">{t("sectionSafetyTitle")}</h2>
            <p className="mt-3 text-ink/70">{t("sectionSafetyBody")}</p>
          </div>
        </div>
      </section>

      <section className="border-t border-black/5 bg-bloom-50">
        <div className="container-fm flex flex-col items-start gap-6 py-16 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-2xl font-semibold text-ink sm:text-3xl">{t("ctaBandTitle")}</h2>
            <p className="mt-2 max-w-xl text-ink/70">{t("ctaBandBody")}</p>
          </div>
          <Link href="/register" className="btn-primary shrink-0">
            {t("ctaBandButton")}
          </Link>
        </div>
      </section>
    </>
  );
}

function Stat({ label }: { label: string }) {
  return <p className="text-sm font-medium text-ink/70">{label}</p>;
}
