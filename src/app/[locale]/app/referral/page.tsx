import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { currentUser } from "@/auth/guard";
import { referralOverview } from "@/db/referral";
import { ReferralClient } from "./ReferralClient";

// The code, the ledger and the outcomes are all per-member and change as
// referees qualify, so nothing here may be prerendered or shared.
export const dynamic = "force-dynamic";

export default async function ReferralPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  const user = await currentUser();
  if (!user) redirect(`/${locale}/login`);

  const t = await getTranslations({ locale, namespace: "referral" });

  const overview = await referralOverview(user.id, {
    baseUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "",
    locale
  });

  const granted = overview.entries.filter((entry) => entry.outcome === "granted").length;
  const pending = overview.entries.filter(
    (entry) => entry.outcome === "pending_qualification"
  ).length;

  return (
    <section className="container-fm py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-display text-3xl font-semibold text-ink">{t("title")}</h1>
        <span className="text-sm text-ink/50">{user.displayName}</span>
      </div>
      <p className="mt-2 max-w-2xl text-ink/70">{t("subtitle")}</p>

      <ReferralClient
        overview={overview}
        locale={locale}
        counts={{ granted, pending, total: overview.entries.length }}
        labels={{
          yourCode: t("yourCode"),
          yourLink: t("yourLink"),
          copy: t("copy"),
          copied: t("copied"),
          rewardsTitle: t("rewardsTitle"),
          walletEmpty: t("walletEmpty"),
          statusTitle: t("statusTitle"),
          statusEmpty: t("statusEmpty"),
          capNote: t("capNote", {
            used: overview.rewardedThisMonth,
            cap: overview.monthlyCap
          }),
          countGranted: t("countGranted"),
          countPending: t("countPending"),
          countTotal: t("countTotal"),
          qualifyNote: t("qualifyNote"),
          // Short labels for the badge. The `outcome.*` strings are full
          // sentences meant to explain a decision, not to sit in a pill; the
          // explanation lives once above the list instead of on every row.
          outcome: {
            granted: t("status.granted"),
            pending_qualification: t("status.pendingQualification"),
            held_for_review: t("status.heldForReview"),
            rejected: t("status.rejected")
          },
          reward: {
            super_like: t("reward.superLike"),
            boost: t("reward.boost"),
            premium_trial: t("reward.premiumTrial")
          }
        }}
      />
    </section>
  );
}
