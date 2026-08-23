import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { currentUser } from "@/auth/guard";
import { todaysFive } from "@/db/daily-suggestions";
import { DailyFiveClient } from "./DailyFiveClient";

// The day's list is per-member and reflects live moderation state, so it can
// never be prerendered or shared between viewers.
export const dynamic = "force-dynamic";

export default async function DailyFivePage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // Server-side gate: the API enforces this too, but an unauthenticated
  // visitor should never see the shell of a signed-in page.
  const user = await currentUser();
  if (!user) redirect(`/${locale}/login`);

  const t = await getTranslations({ locale, namespace: "app" });

  // Loaded on the server: the list is fixed for the day, so fetching it from
  // the client would cost a round trip and a loading state for nothing.
  const suggestions = await todaysFive(user.id);

  return (
    <section className="container-fm py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-display text-3xl font-semibold text-ink">{t("dailyFiveTitle")}</h1>
        <span className="text-sm text-ink/50">{user.displayName}</span>
      </div>
      <p className="mt-2 max-w-2xl text-ink/70">{t("dailyFiveSubtitle")}</p>

      {suggestions.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-black/5 bg-dusk-50 px-5 py-6 text-ink/70">
          {t("dailyFiveEmpty")}
        </p>
      ) : (
        <DailyFiveClient
          suggestions={suggestions}
          labels={{
            why: t("why"),
            like: t("like"),
            pass: t("pass"),
            superLike: t("superLike"),
            matched: t("matched"),
            done: t("dailyFiveDone"),
            noBio: t("cardNoBio"),
            decided: t("dailyFiveDecided")
          }}
        />
      )}
    </section>
  );
}
