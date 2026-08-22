import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { JsonLd } from "@/components/JsonLd";
import { Reveal } from "@/components/motion/Reveal";
import { Atmosphere } from "@/components/motion/Atmosphere";
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

      <section className="fm-stage fm-grain">
        <Atmosphere />
        <div className="container-fm fm-above py-24 sm:py-32">
          <Reveal direction="none">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-bloom-300">
              {t("heroEyebrow")}
            </p>
          </Reveal>

          <Reveal delay={80}>
            <h1 className="mt-5 max-w-3xl font-display text-5xl font-semibold leading-[1.03] tracking-tight sm:text-7xl">
              {t("heroTitle")}
            </h1>
          </Reveal>

          <Reveal delay={160}>
            <p className="mt-7 max-w-xl text-lg text-dusk-100/85">{t("heroSubtitle")}</p>
          </Reveal>

          <Reveal delay={240}>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Link href="/register" className="btn-primary">
                {t("ctaPrimary")}
              </Link>
              <Link
                href="/features"
                className="inline-flex items-center justify-center rounded-full border border-white/25 px-6 py-3 text-sm font-semibold text-white/90 transition hover:border-white/50 hover:bg-white/5"
              >
                {t("ctaSecondary")}
              </Link>
            </div>
          </Reveal>

          <Reveal delay={320}>
            <p className="mt-7 text-sm text-dusk-200/70">{t("trustBar")}</p>
          </Reveal>

          <div className="mt-16 grid gap-6 border-t border-white/10 pt-10 sm:grid-cols-3">
            {[t("statCountries"), t("statLanguages"), t("statPrice")].map((label, index) => (
              <Reveal key={label} delay={380 + index * 70}>
                <p className="text-sm font-medium text-dusk-100/80">{label}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="container-fm py-20">
        <Reveal>
          <div className="max-w-2xl">
            <h2 className="font-display text-3xl font-semibold text-ink sm:text-4xl">
              {t("sectionHowTitle")}
            </h2>
            <p className="mt-3 text-ink/70">{t("sectionHowSubtitle")}</p>
          </div>
        </Reveal>
        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {steps.map((step, index) => (
            <Reveal key={step.n} delay={index * 90}>
              <div className="card-fm h-full">
                <span className="font-display text-3xl text-bloom-300">{step.n}</span>
                <h3 className="mt-4 text-lg font-semibold text-ink">{step.title}</h3>
                <p className="mt-2 text-sm text-ink/70">{step.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="fm-stage fm-grain fm-dissolve py-24 text-white">
        <Atmosphere />
        <div className="container-fm fm-above grid gap-12 lg:grid-cols-2">
          <Reveal direction="right">
            <h2 className="font-display text-3xl font-semibold sm:text-4xl">{t("sectionAiTitle")}</h2>
            <p className="mt-4 text-dusk-100">{t("sectionAiBody")}</p>
          </Reveal>
          <Reveal direction="left" delay={120}>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-bloom-300">
              Why we think you may match
            </p>
            <ul className="mt-4 space-y-3 text-sm text-dusk-100">
              <li>• You both speak English and Spanish, and list travel as a top interest.</li>
              <li>• Same relationship intent: long-term.</li>
              <li>• Overlapping active hours and a 12km radius.</li>
            </ul>
          </div>
          </Reveal>
        </div>
      </section>

      <section className="container-fm py-20">
        <div className="grid gap-10 md:grid-cols-2">
          <Reveal>
            <div className="card-fm h-full">
              <h2 className="font-display text-2xl font-semibold text-ink">
                {t("sectionGlobalTitle")}
              </h2>
              <p className="mt-3 text-ink/70">{t("sectionGlobalBody")}</p>
            </div>
          </Reveal>
          <Reveal delay={100}>
            <div className="card-fm h-full">
              <h2 className="font-display text-2xl font-semibold text-ink">
                {t("sectionSafetyTitle")}
              </h2>
              <p className="mt-3 text-ink/70">{t("sectionSafetyBody")}</p>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="relative overflow-hidden border-t border-black/5 bg-bloom-50">
        <Atmosphere className="opacity-60" />
        <div className="container-fm fm-above flex flex-col items-start gap-6 py-20 sm:flex-row sm:items-center sm:justify-between">
          <Reveal>
            <h2 className="font-display text-2xl font-semibold text-ink sm:text-3xl">{t("ctaBandTitle")}</h2>
            <p className="mt-2 max-w-xl text-ink/70">{t("ctaBandBody")}</p>
          </Reveal>
          <Reveal delay={120} className="shrink-0">
            <Link href="/register" className="btn-primary">
              {t("ctaBandButton")}
            </Link>
          </Reveal>
        </div>
      </section>
    </>
  );
}
