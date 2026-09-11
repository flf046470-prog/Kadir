import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { currentUser } from "@/auth/guard";
import { listConversations } from "@/db/messaging";
import { PushRegistrar } from "@/components/native/PushRegistrar";
import { VirtualDateInbox } from "./VirtualDateInbox";
import { featureEnabled } from "@/lib/flags/server";

export const dynamic = "force-dynamic";

export default async function MatchesPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  const user = await currentUser();
  if (!user) redirect(`/${locale}/login`);

  const [t, conversations] = await Promise.all([
    getTranslations({ locale, namespace: "app" }),
    listConversations(user.id)
  ]);

  return (
    <section className="container-fm max-w-2xl py-10">
      {/*
        The one place notification permission is asked for, and only once the
        member actually has a match. The OS shows that dialog once per install
        and a refusal is close to permanent, so spending it on first launch —
        before there is anything to be notified about — wastes it. No-op on the
        web and for a member with no matches yet.
      */}
      <PushRegistrar enabled={conversations.length > 0} />

      <h1 className="font-display text-3xl font-semibold text-ink">{t("matchesTitle")}</h1>

      {/*
        Above the list, because an invitation is a question someone asked and
        the list is a place to browse. Renders nothing when there is nothing to
        answer — see the component.
      */}
      {featureEnabled("virtual_dates", user.id) && <VirtualDateInbox />}

      {/*
        Interest that has not become a match yet lives one step from the list
        of ones that have. Not in the tab bar: five tabs is already the width
        of a phone, and these two are somewhere a member goes on purpose
        rather than somewhere they live.
      */}
      <nav className="mt-5 flex gap-2" aria-label={t("interestNav")}>
        <a
          href={`/${locale}/app/interest/likes`}
          className="rounded-full border border-black/10 px-4 py-2 text-sm font-medium text-ink/80 transition hover:border-bloom-300"
        >
          {t("likesTitle")}
        </a>
        <a
          href={`/${locale}/app/interest/visitors`}
          className="rounded-full border border-black/10 px-4 py-2 text-sm font-medium text-ink/80 transition hover:border-bloom-300"
        >
          {t("visitorsTitle")}
        </a>
      </nav>

      {conversations.length === 0 && <p className="mt-6 text-ink/60">{t("matchesEmpty")}</p>}

      <ul className="mt-8 space-y-3">
        {conversations.map((conversation) => (
          <li key={conversation.matchId}>
            <a
              href={`/${locale}/app/matches/${conversation.matchId}`}
              className="flex items-center justify-between rounded-2xl border border-black/10 bg-white p-5 transition hover:border-bloom-300"
            >
              <div className="min-w-0">
                <p className="font-semibold text-ink">{conversation.partnerName}</p>
                <p className="mt-1 truncate text-sm text-ink/60">
                  {conversation.lastMessage ?? t("noMessages")}
                </p>
              </div>
              {conversation.unreadCount > 0 && (
                <span className="ml-4 shrink-0 rounded-full bg-bloom-500 px-3 py-1 text-xs font-semibold text-white">
                  {conversation.unreadCount} {t("unread")}
                </span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
