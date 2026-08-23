import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { JsonLd } from "@/components/JsonLd";
import { Reveal } from "@/components/motion/Reveal";
import { Atmosphere } from "@/components/motion/Atmosphere";
import { ScrollScene } from "@/components/motion/ScrollScene";
import { ScrubText } from "@/components/motion/ScrubText";
import { StackCards } from "@/components/motion/StackCards";
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

      {/* The hero recedes rather than cuts: as the page leaves it, the whole
          shot scales back a touch and fades, so the section below arrives over
          it instead of after it. */}
      <ScrollScene as="section" className="fm-stage fm-grain">
        <Atmosphere />
        <div className="container-fm fm-above fm-scene-depart py-24 sm:py-32">
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
      </ScrollScene>

      {/* The promise, scrubbed. The sentence *is* the section — it lights word
          by word as you scroll it, so reading and scrolling become one act.
          `span` finishes the reveal while the line is still centred rather than
          on its way out of frame. */}
      <ScrollScene as="section" span={0.62} className="container-fm py-28 sm:py-36">
        <ScrubText
          as="p"
          className="mx-auto max-w-4xl text-center font-display text-3xl font-semibold leading-[1.25] text-ink sm:text-5xl"
        >
          {t("heroSubtitle")}
        </ScrubText>
      </ScrollScene>

      {/* The three steps become a deck that gathers as you scroll, so the
          sequence reads as accumulation rather than as three cards going past. */}
      <section className="container-fm pb-28">
        <Reveal>
          <div className="max-w-2xl">
            <h2 className="font-display text-3xl font-semibold text-ink sm:text-4xl">
              {t("sectionHowTitle")}
            </h2>
            <p className="mt-3 text-ink/70">{t("sectionHowSubtitle")}</p>
          </div>
        </Reveal>

        <StackCards className="mt-12">
          {steps.map((step) => (
            <div
              key={step.n}
              className="card-fm border-black/[0.07] shadow-lg shadow-black/[0.06] sm:p-8"
            >
              <span className="font-display text-3xl text-bloom-300">{step.n}</span>
              <h3 className="mt-4 text-xl font-semibold text-ink">{step.title}</h3>
              <p className="mt-2 max-w-2xl text-ink/70">{step.body}</p>
            </div>
          ))}
        </StackCards>
      </section>

      <ScrollScene as="section" className="fm-stage fm-grain fm-dissolve py-28 text-white">
        <Atmosphere />
        <div className="container-fm fm-above grid items-center gap-12 lg:grid-cols-2">
          <Reveal direction="right">
            <h2 className="font-display text-3xl font-semibold sm:text-4xl">{t("sectionAiTitle")}</h2>
            <p className="mt-4 text-dusk-100">{t("sectionAiBody")}</p>
          </Reveal>

          {/* The card rides slightly against the scroll. The offset between it
              and the heading beside it is what the eye reads as depth. */}
          <Reveal direction="left" delay={120}>
            <div
              className="fm-scene-depth rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm"
              style={{ "--depth": "-56px" } as React.CSSProperties}
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-bloom-300">
                {t("matchCardTitle")}
              </p>
              <ul className="mt-4 space-y-3 text-sm text-dusk-100">
                <li>• {t("matchCardReason1")}</li>
                <li>• {t("matchCardReason2")}</li>
                <li>• {t("matchCardReason3")}</li>
              </ul>
            </div>
          </Reveal>
        </div>
      </ScrollScene>

      <section className="container-fm py-24">
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
