import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { useTranslations } from "next-intl";
import { PageHero } from "@/components/PageHero";
import { buildMetadata } from "@/lib/seo";
import type { Locale } from "@/i18n/locales";

type Mode = { name: string; desc: string };

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "globalMatch" });
  return buildMetadata({
    locale: locale as Locale,
    path: "/global-match",
    title: t("title"),
    description: t("intro")
  });
}

export default function GlobalMatchPage() {
  const t = useTranslations("globalMatch");
  const modes = t.raw("modes") as Mode[];

  return (
    <>
      <PageHero eyebrow={t("subtitle")} title={t("title")} subtitle={t("intro")} />

      <section className="container-fm py-16">
        <h2 className="font-display text-2xl font-semibold text-ink">{t("modesTitle")}</h2>
        <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {modes.map((mode) => (
            <div key={mode.name} className="card-fm">
              <h3 className="font-semibold text-ink">{mode.name}</h3>
              <p className="mt-2 text-sm text-ink/70">{mode.desc}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 card-fm max-w-2xl">
          <h2 className="font-display text-lg font-semibold text-ink">{t("reachTitle")}</h2>
          <p className="mt-2 text-sm text-ink/70">{t("reachBody")}</p>
        </div>
      </section>

      <section className="border-y border-black/5 bg-bloom-50 py-16">
        <div className="container-fm grid gap-8 md:grid-cols-3">
          <Feature title={t("cultureTitle")} body={t("cultureBody")} />
          <Feature title={t("languageTitle")} body={t("languageBody")} />
          <Feature title={t("travelTitle")} body={t("travelBody")} />
        </div>
      </section>

      <section className="container-fm py-16">
        <div className="max-w-3xl">
          <h2 className="font-display text-2xl font-semibold text-ink">{t("privacyTitle")}</h2>
          <p className="mt-3 text-ink/70">{t("privacyBody")}</p>
        </div>
      </section>
    </>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h2 className="font-display text-xl font-semibold text-ink">{title}</h2>
      <p className="mt-3 text-sm text-ink/75">{body}</p>
    </div>
  );
}
