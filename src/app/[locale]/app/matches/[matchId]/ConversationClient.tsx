"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "@/i18n/navigation";

type Message = {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
  mine: boolean;
  warning: { band: string; signals: string[] } | null;
};

type Labels = {
  placeholder: string;
  send: string;
  noMessages: string;
  block: string;
  report: string;
  blockConfirm: string;
  reportSent: string;
  back: string;
  scamWarningTitle: string;
  scamWarningBody: string;
};

/** Poll interval. Real-time delivery is a later change; this is honest for now. */
const POLL_MS = 5000;

export function ConversationClient({
  matchId,
  partnerId,
  partnerName,
  locale,
  labels
}: {
  matchId: string;
  partnerId: string;
  partnerName: string;
  locale: string;
  labels: Labels;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [reported, setReported] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/matches/${matchId}/messages`);
    if (!response.ok) return;
    const body = await response.json();
    setMessages(body.messages ?? []);
  }, [matchId]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function handleSend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;

    setSending(true);
    const response = await fetch(`/api/matches/${matchId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: text, language: locale })
    });
    setSending(false);

    if (response.ok) {
      setDraft("");
      await load();
    }
  }

  async function handleBlock() {
    if (!window.confirm(labels.blockConfirm)) return;

    await fetch("/api/blocks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: partnerId })
    });

    router.push("/app/matches");
    router.refresh();
  }

  async function handleReport(messageId?: string) {
    await fetch("/api/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reportedId: partnerId, messageId, reason: "scam_or_fraud" })
    });
    setReported(true);
  }

  return (
    <section className="container-fm flex max-w-2xl flex-col py-10">
      <div className="flex items-center justify-between">
        <div>
          <a href={`/${locale}/app/matches`} className="text-sm text-ink/50 hover:text-ink">
            {labels.back}
          </a>
          <h1 className="mt-1 font-display text-2xl font-semibold text-ink">{partnerName}</h1>
        </div>
        <div className="flex gap-3 text-sm">
          <button type="button" onClick={() => handleReport()} className="text-ink/60 hover:text-ink">
            {labels.report}
          </button>
          <button type="button" onClick={handleBlock} className="text-bloom-600 hover:underline">
            {labels.block}
          </button>
        </div>
      </div>

      {reported && (
        <p className="mt-4 rounded-lg bg-bloom-50 p-3 text-sm text-bloom-700" role="status">
          {labels.reportSent}
        </p>
      )}

      <div className="mt-6 min-h-[50vh] space-y-3">
        {messages.length === 0 && <p className="text-ink/50">{labels.noMessages}</p>}

        {messages.map((message) => (
          <div key={message.id}>
            {message.warning && (
              <div className="mb-2 rounded-xl border border-bloom-300 bg-bloom-50 p-4">
                <p className="text-sm font-semibold text-bloom-700">{labels.scamWarningTitle}</p>
                <p className="mt-1 text-xs text-ink/75">{labels.scamWarningBody}</p>
                <button
                  type="button"
                  onClick={() => handleReport(message.id)}
                  className="mt-2 text-xs font-semibold text-bloom-700 hover:underline"
                >
                  {labels.report}
                </button>
              </div>
            )}
            <p
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                message.mine
                  ? "ml-auto bg-bloom-500 text-white"
                  : "bg-dusk-50 text-ink"
              }`}
            >
              {message.body}
            </p>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form onSubmit={handleSend} className="mt-6 flex gap-3">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={labels.placeholder}
          aria-label={labels.placeholder}
          maxLength={2000}
          className="flex-1 rounded-full border border-black/10 px-5 py-3 text-sm focus:border-bloom-400 focus:outline-none"
        />
        <button type="submit" className="btn-primary" disabled={sending || draft.trim() === ""}>
          {labels.send}
        </button>
      </form>
    </section>
  );
}
