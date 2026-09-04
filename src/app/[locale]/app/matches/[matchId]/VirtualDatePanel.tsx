"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ENVIRONMENTS, DEFAULT_ENVIRONMENT } from "@/lib/virtual-dates/environments";
import { INVITE_TTL_DAYS } from "@/lib/virtual-dates/rules";
import {
  answerInvite,
  inviteToDate,
  loadVirtualDates,
  toLocalInputValue,
  withdrawInvite,
  type ActionResult,
  type InviteView,
  type VirtualDatesView
} from "@/lib/virtual-dates/client";

/**
 * Inviting this match to a virtual date, and answering theirs.
 *
 * Sits with the conversation for the reason Match Games does: the invitation is
 * part of talking to someone, not a separate destination. The list of matches
 * carries the same invitations in the other direction — an inbox — because an
 * invitation you have not opened the conversation to see is an invitation you
 * will miss.
 *
 * Everything shown here comes from the server on every load. The environments
 * are the ones the member's tier may pick, the allowance is theirs, and the
 * invitation state is whatever the database says — this component holds no
 * opinion the server could disagree with, which is what stops the screen from
 * offering an action that will be refused.
 */

export function VirtualDatePanel({
  matchId,
  partnerName
}: {
  matchId: string;
  partnerName: string;
}) {
  const t = useTranslations("virtualDates");
  const locale = useLocale();

  const [view, setView] = useState<VirtualDatesView | null>(null);
  const [environment, setEnvironment] = useState(DEFAULT_ENVIRONMENT);
  const [scheduledFor, setScheduledFor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** What just happened, for the moment after an action clears the invitation. */
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setView(await loadVirtualDates());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * One place where an action's outcome becomes what the member sees.
   *
   * Reloading on failure as well as success is deliberate: `already_pending`
   * and `already_answered` both mean the screen is out of date, and re-reading
   * is how it stops being wrong.
   */
  async function run(action: () => Promise<ActionResult>, success: string | null) {
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

  // Rendered only for members the feature is on for — the page decides that on
  // the server — so anything else here is a load that has not finished or one
  // that failed, and neither is worth a placeholder for a secondary panel.
  if (!view?.available) return null;

  const invite = view.invites.find((row) => row.matchId === matchId) ?? null;
  const at = (iso: string) =>
    new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  // The column is nullable and every invitation this app sends fills it, so the
  // fallback is for rows written before that was true rather than for a choice
  // a member can make.
  const placeName = (id: string | null) => t(`environments.${id ?? DEFAULT_ENVIRONMENT}`);
  const upcoming = view.upcoming.filter((row) => row.matchId === matchId);

  return (
    <section className="card-fm">
      <h2 className="font-display text-xl font-semibold text-ink">{t("title")}</h2>
      <p className="mt-1 text-sm text-ink/65">{t("subtitle")}</p>

      {/*
        A date that was said yes to, shown to both of them.

        This is the only place the sender finds out. An accepted invitation
        stops being pending, so it leaves the list of open ones, and without
        this the entire trace of "she said yes" on their screen is the monthly
        allowance going down by one.
      */}
      {upcoming.map((date) => (
        <div key={date.id} className="mt-5 rounded-2xl border border-dusk-200 bg-white p-4">
          <p className="text-sm font-semibold text-ink">{t("acceptedTitle")}</p>
          <p className="mt-1 text-sm text-ink/70">
            {t("acceptedBody", {
              name: date.partnerName || partnerName,
              place: placeName(date.environment)
            })}
          </p>
          {date.scheduledFor && (
            <p className="mt-1 text-sm text-ink/65">
              {t("scheduledFor", { when: at(date.scheduledFor) })}
            </p>
          )}
        </div>
      ))}

      {invite ? (
        <InviteState
          invite={invite}
          busy={busy}
          labels={{
            waiting: t("waitingForThem", { name: invite.partnerName || partnerName }),
            invited: t("invitedYou", { name: invite.partnerName || partnerName }),
            place: t("inEnvironment", { place: placeName(invite.environment) }),
            scheduled: invite.scheduledFor
              ? t("scheduledFor", { when: at(invite.scheduledFor) })
              : null,
            expires: t("expires", { when: at(invite.expiresAt) }),
            accept: t("accept"),
            decline: t("decline"),
            cancel: t("cancel")
          }}
          onAccept={() =>
            run(
              () => answerInvite(invite.id, "accept"),
              t("acceptedBody", {
                name: invite.partnerName || partnerName,
                place: placeName(invite.environment)
              })
            )
          }
          onDecline={() => run(() => answerInvite(invite.id, "decline"), t("declinedNote"))}
          onCancel={() => run(() => withdrawInvite(invite.id), t("cancelledNote"))}
        />
      ) : (
        <>
          <Allowance view={view} />

          <fieldset className="mt-5">
            <legend className="text-sm font-medium text-ink">{t("where")}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {ENVIRONMENTS.map((option) => {
                const locked = !view.environments.includes(option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={locked || busy}
                    aria-pressed={environment === option.id}
                    onClick={() => setEnvironment(option.id)}
                    className={`rounded-full border px-4 py-2 text-sm transition ${
                      environment === option.id && !locked
                        ? "border-bloom-400 bg-bloom-50 font-semibold text-ink"
                        : "border-dusk-200 text-dusk-700 hover:border-bloom-300"
                    } ${locked ? "cursor-not-allowed opacity-45" : ""}`}
                  >
                    {t(`environments.${option.id}`)}
                    {/* Named rather than hidden: a place you cannot pick yet is
                        the clearest thing an upgrade buys. */}
                    {locked && (
                      <span className="ml-2 text-xs uppercase tracking-wide text-ink/45">
                        {t("lockedWith", { tier: option.minimumTier.toUpperCase() })}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {view.environments.length < ENVIRONMENTS.length && (
              <p className="mt-2 text-xs text-ink/50">{t("upgradeNote")}</p>
            )}
          </fieldset>

          <div className="mt-5">
            <label htmlFor="vdate-when" className="text-sm font-medium text-ink">
              {t("when")}
            </label>
            <input
              id="vdate-when"
              type="datetime-local"
              value={scheduledFor}
              onChange={(event) => setScheduledFor(event.target.value)}
              // The same bounds the server enforces, so the picker cannot offer
              // a time it will then refuse. Local time on both ends: the input
              // has no timezone and neither does the member's idea of "Friday".
              min={toLocalInputValue(new Date())}
              max={toLocalInputValue(new Date(Date.now() + INVITE_TTL_DAYS * 24 * 3_600_000))}
              className="mt-2 block w-full max-w-xs rounded-2xl border border-dusk-200 px-4 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-ink/50">{t("whenHelp")}</p>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(
                () =>
                  inviteToDate({
                    matchId,
                    environment,
                    // An empty field means "we will sort the time out in chat",
                    // which the API reads as no schedule rather than as a date
                    // it has to parse.
                    scheduledFor: scheduledFor ? new Date(scheduledFor).toISOString() : null
                  }),
                null
              )
            }
            className="btn-primary mt-5 disabled:opacity-50"
          >
            {busy ? t("sending") : t("inviteCta", { name: partnerName })}
          </button>
        </>
      )}

      {notice && <p className="mt-4 text-sm font-medium text-ink">{notice}</p>}
      {error && (
        <p role="alert" className="mt-4 text-sm text-bloom-700">
          {error}
        </p>
      )}
    </section>
  );
}

/**
 * How many are left, said before one is spent rather than after.
 *
 * A member who does not know they have one date left finds out by having the
 * second refused, which reads as a bug rather than as a plan.
 */
function Allowance({ view }: { view: VirtualDatesView }) {
  const t = useTranslations("virtualDates");
  const allowance = view.allowance;

  if (!allowance) return null;
  if (allowance.limit === null) {
    return <p className="mt-4 text-sm text-ink/60">{t("allowanceUnlimited")}</p>;
  }

  const left = Math.max(0, allowance.limit - allowance.used);

  return (
    <p className="mt-4 text-sm text-ink/60">
      {left === 0 ? t("allowanceNone") : t("allowanceLeft", { left, limit: allowance.limit })}
    </p>
  );
}

/** The open invitation, from whichever side the member is on. */
function InviteState({
  invite,
  busy,
  labels,
  onAccept,
  onDecline,
  onCancel
}: {
  invite: InviteView;
  busy: boolean;
  labels: {
    waiting: string;
    invited: string;
    place: string;
    scheduled: string | null;
    expires: string;
    accept: string;
    decline: string;
    cancel: string;
  };
  onAccept: () => void;
  onDecline: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-5 rounded-2xl border border-bloom-200 bg-bloom-50 p-4">
      <p className="text-sm font-medium text-ink">
        {invite.mine ? labels.waiting : labels.invited}
      </p>
      <p className="mt-1 text-sm text-ink/65">{labels.place}</p>
      {labels.scheduled && <p className="mt-1 text-sm text-ink/65">{labels.scheduled}</p>}
      <p className="mt-1 text-xs text-ink/45">{labels.expires}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        {invite.mine ? (
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-full border border-dusk-200 px-5 py-2 text-sm font-semibold text-dusk-700 disabled:opacity-50"
          >
            {labels.cancel}
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={onAccept}
              className="btn-primary disabled:opacity-50"
            >
              {labels.accept}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onDecline}
              className="rounded-full border border-dusk-200 px-5 py-2 text-sm font-semibold text-dusk-700 disabled:opacity-50"
            >
              {labels.decline}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
