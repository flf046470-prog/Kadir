import { getTranslations } from "next-intl/server";
import { redirect, notFound } from "next/navigation";
import { currentUser } from "@/auth/guard";
import { resolveMatchFor } from "@/db/messaging";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ConversationClient } from "./ConversationClient";
import { GamesPanel } from "./GamesPanel";
import { translationEnabled } from "@/lib/translate";
import { entitlementsOf } from "@/db/entitlements";

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

  const gamesT = await getTranslations({ locale, namespace: "games" });

  // Both have to be true: a provider configured for the deployment, and this
  // member entitled to it. The API checks the same pair — this only decides
  // whether to draw a control that would otherwise refuse when pressed.
  const { entitlements } = await entitlementsOf(user.id);

  return (
    <>
      <ConversationClient
      matchId={matchId}
      partnerId={match.partnerId}
      partnerName={partnerRows[0]?.displayName ?? ""}
      locale={locale}
      // Resolved on the server: with no provider configured there is no
      // control at all, rather than a button that fails when pressed.
      translationAvailable={translationEnabled() && entitlements.messageTranslation}
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
        scamWarningBody: t("scamWarningBody"),
        typing: t("typingIndicator"),
        seen: t("messageSeen"),
        sent: t("messageSent"),
        translate: t("translate"),
        translating: t("translating"),
        showOriginal: t("showOriginal"),
        translatedNote: t("translatedNote"),
        translateFailed: t("translateFailed"),
        sendGift: t("sendGift"),
        giftAllowanceReached: t("giftAllowanceReached"),
        giftSent: t("giftSent"),
        giftReceived: t("giftReceived")
      }}
      />

      {/* Games sit with the conversation because starting one is the point. */}
      <div className="container-fm pb-10">
        <GamesPanel
          matchId={matchId}
          labels={{
            title: gamesT("title"),
            subtitle: gamesT("subtitle"),
            fairPlay: gamesT("fairPlay"),
            start: gamesT("start"),
            accept: gamesT("accept"),
            decline: gamesT("decline"),
            end: gamesT("end"),
            waiting: gamesT("waiting"),
            yourTurn: gamesT("yourTurn"),
            theirAnswer: gamesT("theirAnswer"),
            yourAnswer: gamesT("yourAnswer"),
            completed: gamesT("completed"),
            declined: gamesT("declined"),
            loading: gamesT("loading"),
            invitePending: gamesT("invitePending")
          }}
        />
      </div>
    </>
  );
}
