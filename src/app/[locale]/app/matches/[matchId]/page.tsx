import { getTranslations } from "next-intl/server";
import { redirect, notFound } from "next/navigation";
import { currentUser } from "@/auth/guard";
import { resolveMatchFor } from "@/db/messaging";
import { db } from "@/db/client";
import { profileAttributes, profiles, users } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { needsTranslation } from "@/lib/matching/shared-language";
import { ConversationClient } from "./ConversationClient";
import { GamesPanel } from "./GamesPanel";
import { VirtualDatePanel } from "./VirtualDatePanel";
import { translationEnabled } from "@/lib/translate";
import { awakeOverlap, zoneFor } from "@/lib/domain/timezones";
import { featureEnabled } from "@/lib/flags/server";

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

  const [t, partnerRows, languageRows, placeRows] = await Promise.all([
    getTranslations({ locale, namespace: "app" }),
    db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, match.partnerId))
      .limit(1),
    db
      .select({ userId: profileAttributes.userId, value: profileAttributes.value })
      .from(profileAttributes)
      .where(
        and(
          inArray(profileAttributes.userId, [user.id, match.partnerId]),
          eq(profileAttributes.kind, "language_spoken")
        )
      ),
    // Both sides' places: the partner's for their clock, the viewer's because
    // the shared window is only meaningful expressed in the reader's hours.
    db
      .select({
        userId: profiles.userId,
        cityId: profiles.cityId,
        countryId: profiles.countryId
      })
      .from(profiles)
      .where(inArray(profiles.userId, [user.id, match.partnerId]))
  ]);

  const placeOf = (id: string) => placeRows.find((row) => row.userId === id);
  const viewerZone = (() => {
    const place = placeOf(user.id);
    return zoneFor(place?.cityId, place?.countryId);
  })();
  const partnerPlace = placeOf(match.partnerId);
  const partnerZone = zoneFor(partnerPlace?.cityId, partnerPlace?.countryId);

  /**
   * The shared window needs both zones. One unknown place is enough to make it
   * unanswerable, and an unanswerable question is left unanswered rather than
   * guessed at — see `zoneFor`.
   */
  const overlap = viewerZone && partnerZone ? awakeOverlap(viewerZone, partnerZone) : null;

  const hour = (value: number) => `${String(value).padStart(2, "0")}:00`;
  const bothAwake =
    overlap === null
      ? null
      : t("bothAwake", { from: hour(overlap.startHour), to: hour(overlap.endHour) });

  const gamesT = await getTranslations({ locale, namespace: "games" });

  /**
   * Whether these two can read each other at all.
   *
   * Matching across languages is a feature here, so a pair with nothing in
   * common is an expected outcome rather than an edge case — and until now it
   * produced a conversation neither could read, behind a control that had to
   * be found and pressed on every visit. Decided on the server because the
   * partner's language list is not something the client is given.
   */
  const mine = languageRows.filter((row) => row.userId === user.id).map((row) => row.value);
  const theirs = languageRows
    .filter((row) => row.userId === match.partnerId)
    .map((row) => row.value);
  const noSharedLanguage = needsTranslation(mine, theirs);

  return (
    <>
      <ConversationClient
      matchId={matchId}
      partnerId={match.partnerId}
      partnerName={partnerRows[0]?.displayName ?? ""}
      locale={locale}
      // Resolved on the server: with no provider configured there is no
      // control at all, rather than a button that fails when pressed. The
      // member's tier is no longer part of this — everyone can translate, and
      // the response says when the day's allowance has run out.
      translationAvailable={translationEnabled()}
      // Starts on, rather than merely being offered, when the two of them have
      // no language in common. Still a toggle: a member who would rather read
      // the original turns it off, and that is a different thing from never
      // having been told translation existed.
      translationAuto={noSharedLanguage}
      // Null whenever either place is unresolvable, which is common and fine:
      // the header simply carries one line fewer.
      partnerZone={partnerZone}
      bothAwake={bothAwake}
      labels={{
        theirTime: t("theirTime"),
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
        autoTranslated: t("autoTranslated"),
        translateFailed: t("translateFailed"),
        sendGift: t("sendGift"),
        giftAllowanceReached: t("giftAllowanceReached"),
        giftSent: t("giftSent"),
        giftReceived: t("giftReceived")
      }}
      />

      {/* Games sit with the conversation because starting one is the point. */}
      <div className="container-fm space-y-6 pb-10">
        {/*
          Decided here rather than inside the panel so a member the feature is
          off for never fetches for it. The routes carry the same gate — this
          one only decides what is drawn.
        */}
        {featureEnabled("virtual_dates", user.id) && (
          <VirtualDatePanel matchId={matchId} partnerName={partnerRows[0]?.displayName ?? ""} />
        )}

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
