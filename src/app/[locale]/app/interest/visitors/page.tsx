import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { currentUser } from "@/auth/guard";
import { PeopleList } from "../PeopleList";

export const dynamic = "force-dynamic";

export default async function VisitorsPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  const user = await currentUser();
  if (!user) redirect(`/${locale}/login`);

  const t = await getTranslations({ locale, namespace: "app" });

  return (
    <section className="container-fm max-w-3xl py-10">
      <h1 className="font-display text-3xl font-semibold text-ink">{t("visitorsTitle")}</h1>
      <p className="mt-2 max-w-prose text-ink/70">{t("visitorsIntro")}</p>

      <PeopleList
        endpoint="/api/profile-views"
        countKey="visitorsCount"
        pricingHref={`/${locale}/pricing`}
        labels={{
          loading: t("listLoading"),
          empty: t("visitorsEmpty"),
          lockedTitle: t("visitorsLockedTitle"),
          lockedBody: t("visitorsLockedBody"),
          upgrade: t("listUpgrade"),
          superLike: t("listSuperLike"),
          repeatVisit: t("listRepeatVisit")
        }}
      />
    </section>
  );
}
