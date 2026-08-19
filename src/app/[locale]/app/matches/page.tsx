import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { currentUser } from "@/auth/guard";
import { listConversations } from "@/db/messaging";

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
      <h1 className="font-display text-3xl font-semibold text-ink">{t("matchesTitle")}</h1>

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
