"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { gameIds, type GameId } from "@/lib/games/prompts";

/**
 * Match Games, inside the conversation.
 *
 * Games exist to start a conversation, so they live where the conversation is
 * rather than on a screen of their own.
 *
 * This component renders what the server sent and nothing more. A round the
 * server has not revealed arrives with `partnerAnswer: null` — the answer is
 * not in the payload — so there is no "hidden" state here to accidentally
 * show. That is deliberate: fair play must not depend on the client.
 */

type RoundView = {
  promptId: string | null;
  ownAnswer: { value: string } | null;
  partnerAnswer: { value: string } | null;
  revealed: boolean;
};

type SessionView = {
  id: string;
  game: GameId;
  status: "invited" | "active" | "completed" | "declined" | "ended";
  targetRounds: number;
  rounds: RoundView[];
  yourTurn: boolean;
};

export type GamesLabels = {
  title: string;
  subtitle: string;
  fairPlay: string;
  start: string;
  accept: string;
  decline: string;
  end: string;
  waiting: string;
  yourTurn: string;
  theirAnswer: string;
  yourAnswer: string;
  completed: string;
  declined: string;
  loading: string;
  invitePending: string;
};

export function GamesPanel({ matchId, labels }: { matchId: string; labels: GamesLabels }) {
  const t = useTranslations("games");
  const [sessions, setSessions] = useState<SessionView[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/matches/${matchId}/games`);
    if (!response.ok) return;
    const data: { sessions: SessionView[] } = await response.json();
    setSessions(data.sessions);
  }, [matchId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function invite(game: GameId) {
    if (busy) return;
    setBusy(true);
    try {
      await fetch(`/api/matches/${matchId}/games`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ game })
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function move(sessionId: string, status: string) {
    if (busy) return;
    setBusy(true);
    try {
      await fetch(`/api/games/${sessionId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status })
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function answer(sessionId: string, roundIndex: number, value: string) {
    if (busy) return;
    setBusy(true);
    try {
      await fetch(`/api/games/${sessionId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roundIndex, value })
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (sessions === null) {
    return <p className="text-sm text-ink/50">{labels.loading}</p>;
  }

  const open = sessions.find(
    (session) => session.status === "invited" || session.status === "active"
  );

  return (
    <section className="card-fm">
      <h2 className="font-display text-xl font-semibold text-ink">{labels.title}</h2>
      <p className="mt-1 text-sm text-ink/65">{labels.subtitle}</p>
      {/* Stated up front, because the guarantee is the reason to play. */}
      <p className="mt-2 text-xs text-ink/50">{labels.fairPlay}</p>

      {!open && (
        <div className="mt-5 flex flex-wrap gap-2">
          {gameIds.map((game, index) => (
            <button
              key={game}
              type="button"
              disabled={busy}
              onClick={() => invite(game)}
              className="rounded-full border border-dusk-200 px-4 py-2 text-sm font-medium text-dusk-700 transition hover:border-bloom-300 hover:bg-bloom-50 disabled:opacity-50"
            >
              {t(`list.${index}.name`)}
            </button>
          ))}
        </div>
      )}

      {open?.status === "invited" && (
        <div className="mt-5 rounded-2xl border border-bloom-200 bg-bloom-50 p-4">
          <p className="text-sm font-medium text-ink">{labels.invitePending}</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => move(open.id, "active")}
              className="btn-primary disabled:opacity-50"
            >
              {labels.accept}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => move(open.id, "declined")}
              className="rounded-full border border-dusk-200 px-5 py-2 text-sm font-semibold text-dusk-700 disabled:opacity-50"
            >
              {labels.decline}
            </button>
          </div>
        </div>
      )}

      {open?.status === "active" && (
        <div className="mt-5 space-y-4">
          {open.rounds.map((round, index) => (
            <Round
              key={`${round.promptId}-${index}`}
              round={round}
              index={index}
              game={open.game}
              busy={busy}
              labels={labels}
              onAnswer={(value) => answer(open.id, index, value)}
            />
          ))}
          <button
            type="button"
            disabled={busy}
            onClick={() => move(open.id, "ended")}
            className="text-sm text-ink/50 underline hover:text-ink disabled:opacity-50"
          >
            {labels.end}
          </button>
        </div>
      )}

      {!open && sessions.some((session) => session.status === "completed") && (
        <p className="mt-4 text-sm text-ink/60">{labels.completed}</p>
      )}
    </section>
  );
}

/**
 * One round.
 *
 * Two-option games get buttons; open games get a text field. Which one is
 * decided by the game, not by whether the prompt happens to have options — a
 * missing translation should render as a missing prompt, not as the wrong
 * input.
 */
function Round({
  round,
  index,
  game,
  busy,
  labels,
  onAnswer
}: {
  round: RoundView;
  index: number;
  game: GameId;
  busy: boolean;
  labels: GamesLabels;
  onAnswer: (value: string) => void;
}) {
  const t = useTranslations("games");
  const [text, setText] = useState("");

  if (!round.promptId) return null;

  const twoOption = game === "this_or_that" || game === "would_you_rather";
  const answered = round.ownAnswer !== null;

  return (
    <article className="rounded-2xl border border-black/[0.07] p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-bloom-600">
        {index + 1}
      </p>

      {twoOption ? (
        <>
          <div className="mt-2 flex flex-wrap gap-2">
            {(["a", "b"] as const).map((option) => (
              <button
                key={option}
                type="button"
                disabled={busy || answered}
                onClick={() => onAnswer(option)}
                className={`rounded-full border px-4 py-2 text-sm transition disabled:opacity-60 ${
                  round.ownAnswer?.value === option
                    ? "border-bloom-400 bg-bloom-50 font-semibold text-ink"
                    : "border-dusk-200 text-dusk-700 hover:border-bloom-300"
                }`}
              >
                {t(`prompts.${round.promptId}.${option}`)}
              </button>
            ))}
          </div>
          {round.revealed && round.partnerAnswer && (
            <p className="mt-3 text-sm text-ink/70">
              {labels.theirAnswer}: {t(`prompts.${round.promptId}.${round.partnerAnswer.value}`)}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="mt-2 text-ink">{t(`prompts.${round.promptId}`)}</p>
          {answered ? (
            <p className="mt-2 text-sm text-ink/70">
              {labels.yourAnswer}: {round.ownAnswer?.value}
            </p>
          ) : (
            <form
              className="mt-3 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (text.trim()) onAnswer(text.trim());
                setText("");
              }}
            >
              <input
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={140}
                className="min-w-0 flex-1 rounded-full border border-dusk-200 px-4 py-2 text-sm"
              />
              <button type="submit" disabled={busy} className="btn-primary disabled:opacity-50">
                {labels.yourTurn}
              </button>
            </form>
          )}
          {round.revealed && round.partnerAnswer && (
            <p className="mt-2 text-sm text-ink/70">
              {labels.theirAnswer}: {round.partnerAnswer.value}
            </p>
          )}
        </>
      )}

      {answered && !round.revealed && (
        <p className="mt-3 text-xs text-ink/45">{labels.waiting}</p>
      )}
    </article>
  );
}
