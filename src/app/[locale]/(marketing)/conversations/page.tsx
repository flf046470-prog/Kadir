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

      <GamesSection />

      <section className="border-t border-black/5 bg-dusk-900 py-16 text-white">
        <div className="container-fm max-w-3xl">
          <h2 className="font-display text-2xl font-semibold">{t("boundaryTitle")}</h2>
          <p className="mt-3 text-dusk-100">{t("boundaryBody")}</p>
        </div>
      </section>
    </>
  );
}

type GameItem = { name: string; desc: string };

function GamesSection() {
  const t = useTranslations("games");
  const games = t.raw("list") as GameItem[];

  return (
    <section className="border-y border-black/5 bg-bloom-50 py-16">
      <div className="container-fm">
        <h2 className="font-display text-2xl font-semibold text-ink">{t("title")}</h2>
        <p className="mt-2 max-w-2xl text-ink/70">{t("subtitle")}</p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {games.map((game) => (
            <div key={game.name} className="rounded-2xl border border-black/5 bg-white p-5">
              <h3 className="font-semibold text-ink">{game.name}</h3>
              <p className="mt-2 text-sm text-ink/70">{game.desc}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <p className="rounded-xl border border-black/10 bg-white p-4 text-sm text-ink/75">
            {t("fairPlay")}
          </p>
          <p className="rounded-xl border border-black/10 bg-white p-4 text-sm text-ink/75">
            {t("optional")}
          </p>
        </div>
      </div>
    </section>
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
