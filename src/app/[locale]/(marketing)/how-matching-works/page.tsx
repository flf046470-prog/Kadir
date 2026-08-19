import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { useTranslations } from "next-intl";
import { PageHero } from "@/components/PageHero";
import { JsonLd } from "@/components/JsonLd";
import { Link } from "@/i18n/navigation";
import { buildMetadata, faqSchema } from "@/lib/seo";
import type { Locale } from "@/i18n/locales";

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "matching" });
  return buildMetadata({
    locale: locale as Locale,
    path: "/how-matching-works",
    title: t("title"),
    description: t("intro")
  });
}

export default function HowMatchingWorksPage() {
  const t = useTranslations("matching");
  const home = useTranslations("home");
  const nav = useTranslations("nav");
  const signals = t.raw("signals") as string[];
  const reasonsExample = t.raw("reasonsExample") as string[];

  const faqs = [
    { question: t("matchmakerTitle"), answer: t("matchmakerBody") },
    { question: t("dnaTitle"), answer: t("dnaBody") },
    { question: t("reasonsTitle"), answer: t("reasonsBody") },
    { question: t("notScoredTitle"), answer: t("notScoredBody") }
  ];

  return (
    <>
      <JsonLd data={faqSchema(faqs)} />
      <PageHero eyebrow={t("subtitle")} title={t("title")} subtitle={t("intro")} />

      <section className="container-fm grid gap-6 py-16 md:grid-cols-2">
        <Block title={t("matchmakerTitle")} body={t("matchmakerBody")} />
        <Block title={t("dnaTitle")} body={t("dnaBody")} />
        <Block title={t("fiveTitle")} body={t("fiveBody")} />
        <Block title={t("learningTitle")} body={t("learningBody")} />
      </section>

      <section className="bg-dusk-900 py-16 text-white">
        <div className="container-fm grid gap-10 lg:grid-cols-2">
          <div>
            <h2 className="font-display text-3xl font-semibold">{t("reasonsTitle")}</h2>
            <p className="mt-4 text-dusk-100">{t("reasonsBody")}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-bloom-300">
              {t("reasonsExampleTitle")}
            </p>
            <ul className="mt-4 space-y-3 text-sm text-dusk-100">
              {reasonsExample.map((line) => (
                <li key={line} className="flex gap-2">
                  <span aria-hidden="true" className="text-bloom-300">
                    ✓
                  </span>
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="container-fm py-16">
        <h2 className="font-display text-2xl font-semibold text-ink">{t("signalsTitle")}</h2>
        <p className="mt-3 max-w-2xl text-ink/70">{t("signalsBody")}</p>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {signals.map((signal) => (
            <li key={signal} className="card-fm text-sm text-ink/80">
              {signal}
            </li>
          ))}
        </ul>

        <div className="mt-12 rounded-2xl border border-bloom-200 bg-bloom-50 p-6">
          <h2 className="font-display text-xl font-semibold text-ink">{t("notScoredTitle")}</h2>
          <p className="mt-3 max-w-3xl text-sm text-ink/75">{t("notScoredBody")}</p>
        </div>

        <div className="mt-10 flex flex-wrap gap-4">
          <Link href="/global-match" className="btn-secondary">
            {nav("globalMatch")}
          </Link>
          <Link href="/register" className="btn-primary">
            {home("ctaPrimary")}
          </Link>
        </div>
      </section>
    </>
  );
}

function Block({ title, body }: { title: string; body: string }) {
  return (
    <div className="card-fm">
      <h2 className="font-display text-xl font-semibold text-ink">{title}</h2>
      <p className="mt-3 text-sm text-ink/70">{body}</p>
    </div>
  );
}
