import { getTranslations } from "next-intl/server";
import { redirect, notFound } from "next/navigation";
import { currentUser } from "@/auth/guard";
import { resolveMatchFor } from "@/db/messaging";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ConversationClient } from "./ConversationClient";

export const dynamic = "force-dynamic";

export default async function ConversationPage({
  params
}: {
  params: Promise<{ locale: string; matchId: string }>;
}) {
  const { locale, matchId } = await params;

  const user = await currentUser();
  if (!user) redirect(`/${locale}/login`);

  // Resolving through the member is the authorization check: a conversation
  // that isn't theirs is indistinguishable from one that doesn't exist.
  const match = await resolveMatchFor(user.id, matchId);
  if (!match) notFound();

  const [t, partnerRows] = await Promise.all([
    getTranslations({ locale, namespace: "app" }),
    db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, match.partnerId))
      .limit(1)
  ]);

  return (
    <ConversationClient
      matchId={matchId}
      partnerId={match.partnerId}
      partnerName={partnerRows[0]?.displayName ?? ""}
      locale={locale}
      labels={{
        placeholder: t("sendPlaceholder"),
        send: t("send"),
        noMessages: t("noMessages"),
        block: t("block"),
        report: t("report"),
        blockConfirm: t("blockConfirm"),
        reportSent: t("reportSent"),
        back: t("backToMatches"),
        scamWarningTitle: t("scamWarningTitle"),
        scamWarningBody: t("scamWarningBody")
      }}
    />
  );
}
