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
  const t = await getTranslations({ locale, namespace: "conversation" });
  return buildMetadata({
    locale: locale as Locale,
    path: "/conversations",
    title: t("title"),
    description: t("subtitle")
  });
}

export default function ConversationsPage() {
  const t = useTranslations("conversation");

  return (
    <>
      <PageHero eyebrow="Conversations" title={t("title")} subtitle={t("subtitle")} />

      <section className="container-fm grid gap-6 py-16 md:grid-cols-2">
        <Card title={t("icebreakerTitle")} body={t("icebreakerBody")} />
        <Card title={t("coachTitle")} body={t("coachBody")} />
        <Card title={t("gamesTitle")} body={t("gamesBody")} />
        <Card title={t("translationTitle")} body={t("translationBody")} />
      </section>

      <section className="border-t border-black/5 bg-dusk-900 py-16 text-white">
        <div className="container-fm max-w-3xl">
          <h2 className="font-display text-2xl font-semibold">{t("boundaryTitle")}</h2>
          <p className="mt-3 text-dusk-100">{t("boundaryBody")}</p>
        </div>
      </section>
    </>
  );
}

function Card({ title, body }: { title: string; body: string }) {
  return (
    <div className="card-fm">
      <h2 className="font-display text-xl font-semibold text-ink">{title}</h2>
      <p className="mt-3 text-sm text-ink/70">{body}</p>
    </div>
  );
}
