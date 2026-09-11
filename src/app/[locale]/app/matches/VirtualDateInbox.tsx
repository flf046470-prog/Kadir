"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { DEFAULT_ENVIRONMENT } from "@/lib/virtual-dates/environments";
import {
  answerInvite,
  loadVirtualDates,
  type ActionResult,
  type VirtualDatesView
} from "@/lib/virtual-dates/client";

/**
 * Invitations waiting for an answer, above the list of matches.
 *
 * Only the ones addressed to this member. An invitation *they* sent is already
 * visible where they sent it, and repeating it here would turn a list of
 * conversations into a list of things they are waiting for. An invitation
 * someone else sent is the opposite: it is easy to miss entirely, because
 * nothing in a list of matches says which conversation now contains a question.
 *
 * Answering happens here rather than only in the conversation, because "accept"
 * and "decline" are the whole of the interaction — making someone open a screen
 * to press a button that could have been on this one is a step that exists for
 * the app's benefit rather than theirs.
 */

export function VirtualDateInbox() {
  const t = useTranslations("virtualDates");
  const locale = useLocale();

  const [view, setView] = useState<VirtualDatesView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setView(await loadVirtualDates());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<ActionResult>, success: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await action();
      if (result.ok) setNotice(success);
      else setError(t(result.refusal.key, result.refusal.values));
      await load();
    } finally {
      setBusy(false);
    }
  }

  const incoming = view?.available ? view.invites.filter((invite) => !invite.mine) : [];

  // Nothing to answer means nothing to say. The section appears when there is
  // an invitation and disappears when it has been dealt with — except for the
  // line saying what just happened, which would otherwise vanish with it.
  if (incoming.length === 0 && !notice && !error) return null;

  const placeName = (id: string | null) => t(`environments.${id ?? DEFAULT_ENVIRONMENT}`);
  const at = (iso: string) =>
    new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });

  return (
    <section className="mt-6 rounded-2xl border border-bloom-200 bg-bloom-50 p-5">
      <h2 className="font-display text-lg font-semibold text-ink">{t("inboxTitle")}</h2>

      <ul className="mt-3 space-y-4">
        {incoming.map((invite) => (
          <li key={invite.id}>
            <p className="text-sm font-medium text-ink">
              {t("invitedYou", { name: invite.partnerName })}
            </p>
            <p className="mt-1 text-sm text-ink/65">
              {t("inEnvironment", { place: placeName(invite.environment) })}
            </p>
            {invite.scheduledFor && (
              <p className="mt-1 text-sm text-ink/65">
                {t("scheduledFor", { when: at(invite.scheduledFor) })}
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(
                    () => answerInvite(invite.id, "accept"),
                    t("acceptedBody", {
                      name: invite.partnerName,
                      place: placeName(invite.environment)
                    })
                  )
                }
                className="btn-primary disabled:opacity-50"
              >
                {t("accept")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => answerInvite(invite.id, "decline"), t("declinedNote"))}
                className="rounded-full border border-dusk-200 bg-white px-5 py-2 text-sm font-semibold text-dusk-700 disabled:opacity-50"
              >
                {t("decline")}
              </button>
              <a
                href={`/${locale}/app/matches/${invite.matchId}`}
                className="text-sm font-medium text-dusk-700 underline hover:text-ink"
              >
                {t("openConversation")}
              </a>
            </div>
          </li>
        ))}
      </ul>

      {notice && <p className="mt-4 text-sm font-medium text-ink">{notice}</p>}
      {error && (
        <p role="alert" className="mt-4 text-sm text-bloom-700">
          {error}
        </p>
      )}
    </section>
  );
}
