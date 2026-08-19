import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { currentUser } from "@/auth/guard";
import { DiscoverClient } from "./DiscoverClient";

export const dynamic = "force-dynamic";

export default async function DiscoverPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // Server-side gate: the API enforces this too, but an unauthenticated visitor
  // should never see the shell of a signed-in page.
  const user = await currentUser();
  if (!user) redirect(`/${locale}/login`);

  const t = await getTranslations({ locale, namespace: "app" });

  return (
    <section className="container-fm py-10">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-semibold text-ink">{t("discoverTitle")}</h1>
        <span className="text-sm text-ink/50">{user.displayName}</span>
      </div>

      <DiscoverClient
        labels={{
          empty: t("discoverEmpty"),
          why: t("why"),
          like: t("like"),
          pass: t("pass"),
          superLike: t("superLike"),
          matched: t("matched"),
          loading: t("loading"),
          modeLabel: t("modeLabel"),
          potential: t("potential"),
          bands: {
            strong: t("bandStrong"),
            promising: t("bandPromising"),
            exploring: t("bandExploring")
          }
        }}
      />
    </section>
  );
}
