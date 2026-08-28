"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { GIFTS, giftById, type GiftId } from "@/lib/gifts/catalogue";

type Message = {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  mine: boolean;
  warning: { band: string; signals: string[] } | null;
};

type Presence = {
  partnerTyping: boolean;
  partnerLastSeenAt: string | null;
};

type SentGift = {
  id: string;
  giftId: GiftId;
  mine: boolean;
  createdAt: string;
};

/**
 * One entry in the conversation. Messages and gifts live in separate tables
 * because they are different things, and are merged here — by timestamp, on
 * the client — because to the two people talking they are one conversation.
 */
type TimelineEntry =
  | { kind: "message"; at: number; message: Message }
  | { kind: "gift"; at: number; gift: SentGift };

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
  typing: string;
  seen: string;
  sent: string;
  translate: string;
  translating: string;
  showOriginal: string;
  translatedNote: string;
  translateFailed: string;
  sendGift: string;
  giftAllowanceReached: string;
  giftSent: string;
  giftReceived: string;
};

/**
 * Poll intervals. Real-time delivery is a later change; this is honest for now.
 *
 * Two speeds rather than one. A typing indicator that lags five seconds is
 * worse than none — it says "typing" after they have stopped — so a visible
 * conversation polls fast. A hidden tab polls slowly, because nobody is
 * reading it and the only thing a fast poll would buy is load.
 */
const POLL_VISIBLE_MS = 2500;
const POLL_HIDDEN_MS = 15000;

/** Matches TYPING_PING_MS on the server: one write per few keystrokes, not per key. */
const TYPING_PING_MS = 3000;

export function ConversationClient({
  matchId,
  partnerId,
  partnerName,
  locale,
  translationAvailable,
  labels
}: {
  matchId: string;
  partnerId: string;
  partnerName: string;
  locale: string;
  /** False when no provider is configured, in which case there is no control. */
  translationAvailable: boolean;
  labels: Labels;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [reported, setReported] = useState(false);
  const [presence, setPresence] = useState<Presence>({
    partnerTyping: false,
    partnerLastSeenAt: null
  });
  const [gifts, setGifts] = useState<SentGift[]>([]);
  const [giftPickerOpen, setGiftPickerOpen] = useState(false);
  const [notice, setNotice] = useState<"gift_allowance" | null>(null);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [translateOn, setTranslateOn] = useState(false);
  const [translateState, setTranslateState] = useState<"idle" | "loading" | "failed">("idle");
  const endRef = useRef<HTMLDivElement>(null);
  const lastTypingPing = useRef(0);

  const load = useCallback(async () => {
    // Only claim the messages were seen when this tab is actually on screen.
    // The server trusts this flag for the read receipt the other side sees, so
    // sending it from a background poll would make that receipt dishonest.
    const seen = typeof document !== "undefined" && document.visibilityState === "visible";
    const response = await fetch(
      `/api/matches/${matchId}/messages${seen ? "?seen=1" : ""}`
    );
    if (!response.ok) return;
    const body = await response.json();
    setMessages(body.messages ?? []);
    setGifts(body.gifts ?? []);
    if (body.presence) setPresence(body.presence);
  }, [matchId]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    // A self-rescheduling timeout rather than an interval, so the cadence can
    // change with visibility without tearing the loop down and rebuilding it.
    function schedule() {
      const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
      timer = setTimeout(async () => {
        await load();
        schedule();
      }, hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS);
    }

    function onVisibility() {
      clearTimeout(timer);
      // Coming back to the tab should show the conversation now, not in two
      // and a half seconds — and it is the moment the messages are truly read.
      if (document.visibilityState === "visible") void load();
      schedule();
    }

    void load();
    schedule();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  const pingTyping = useCallback(
    (typing: boolean) => {
      const now = Date.now();
      // Stopping is always worth a request; starting is throttled, or a fast
      // typist would be one database write per keystroke.
      if (typing && now - lastTypingPing.current < TYPING_PING_MS) return;
      lastTypingPing.current = now;

      void fetch(`/api/matches/${matchId}/typing`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ typing })
      }).catch(() => {
        // A dropped typing ping is not worth surfacing: the indicator simply
        // expires on its own, which is the same thing the member would see.
      });
    },
    [matchId]
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, gifts.length, presence.partnerTyping]);

  async function handleGift(giftId: GiftId) {
    setGiftPickerOpen(false);

    const response = await fetch(`/api/matches/${matchId}/gifts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ giftId })
    });

    if (response.status === 402) {
      setNotice("gift_allowance");
      return;
    }
    if (response.ok) await load();
  }

  const partnerMessageCount = messages.filter((message) => !message.mine).length;

  useEffect(() => {
    if (!translateOn || partnerMessageCount === 0) return;

    let cancelled = false;
    setTranslateState("loading");

    void (async () => {
      try {
        const response = await fetch(`/api/matches/${matchId}/translate?to=${locale}`);
        if (!response.ok) throw new Error(String(response.status));
        const body = await response.json();
        if (cancelled) return;
        setTranslations(body.translations ?? {});
        setTranslateState(body.degraded ? "failed" : "idle");
      } catch {
        // The messages are unaffected — only the aid on top of them failed.
        if (!cancelled) setTranslateState("failed");
      }
    })();

    // Keyed on how many of the partner's messages exist rather than on the
    // array: the poll replaces `messages` every couple of seconds, and
    // re-running on identity would ask the server on every tick.
    return () => {
      cancelled = true;
    };
  }, [translateOn, partnerMessageCount, matchId, locale]);

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
      // The POST already cleared the indicator server-side; reset the throttle
      // so the next keystroke pings immediately rather than waiting it out.
      lastTypingPing.current = 0;
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

  // Only the newest message I sent carries a receipt. Stamping every outgoing
  // message would be noise — reading the last one means reading the ones above.
  const lastMineId = [...messages].reverse().find((message) => message.mine)?.id ?? null;

  // Merged by timestamp, then by kind so a gift and a message sent in the same
  // second land in a stable order rather than swapping places between polls.
  const timeline: TimelineEntry[] = [
    ...messages.map<TimelineEntry>((message) => ({
      kind: "message",
      at: new Date(message.createdAt).getTime(),
      message
    })),
    ...gifts.map<TimelineEntry>((gift) => ({
      kind: "gift",
      at: new Date(gift.createdAt).getTime(),
      gift
    }))
  ].sort((a, b) => a.at - b.at || a.kind.localeCompare(b.kind));

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
          {translationAvailable && (
            <button
              type="button"
              onClick={() => setTranslateOn((on) => !on)}
              aria-pressed={translateOn}
              className={translateOn ? "font-medium text-bloom-600" : "text-ink/60 hover:text-ink"}
            >
              {translateState === "loading" && translateOn
                ? labels.translating
                : translateOn
                  ? labels.showOriginal
                  : labels.translate}
            </button>
          )}
          <button type="button" onClick={() => handleReport()} className="text-ink/60 hover:text-ink">
            {labels.report}
          </button>
          <button type="button" onClick={handleBlock} className="text-bloom-600 hover:underline">
            {labels.block}
          </button>
        </div>
      </div>

      {translateOn && (
        <p className="mt-4 rounded-lg bg-dusk-50 p-3 text-xs text-ink/60" role="status">
          {translateState === "failed" ? labels.translateFailed : labels.translatedNote}
        </p>
      )}

      {reported && (
        <p className="mt-4 rounded-lg bg-bloom-50 p-3 text-sm text-bloom-700" role="status">
          {labels.reportSent}
        </p>
      )}

      {notice === "gift_allowance" && (
        <p className="mt-4 rounded-lg bg-dusk-50 p-3 text-sm text-ink/70" role="status">
          {labels.giftAllowanceReached}
        </p>
      )}

      <div className="mt-6 min-h-[50vh] space-y-3">
        {timeline.length === 0 && <p className="text-ink/50">{labels.noMessages}</p>}

        {timeline.map((entry) =>
          entry.kind === "gift" ? (
            <GiftBubble
              key={entry.gift.id}
              gift={entry.gift}
              label={entry.gift.mine ? labels.giftSent : labels.giftReceived}
            />
          ) : (
          <div key={entry.message.id}>
            {entry.message.warning && (
              <div className="mb-2 rounded-xl border border-bloom-300 bg-bloom-50 p-4">
                <p className="text-sm font-semibold text-bloom-700">{labels.scamWarningTitle}</p>
                <p className="mt-1 text-xs text-ink/75">{labels.scamWarningBody}</p>
                <button
                  type="button"
                  onClick={() => handleReport(entry.message.id)}
                  className="mt-2 text-xs font-semibold text-bloom-700 hover:underline"
                >
                  {labels.report}
                </button>
              </div>
            )}
            <p
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                entry.message.mine
                  ? "ml-auto bg-bloom-500 text-white"
                  : "bg-dusk-50 text-ink"
              }`}
            >
              {translateOn && translations[entry.message.id]
                ? translations[entry.message.id]
                : entry.message.body}
            </p>
            {translateOn && translations[entry.message.id] && (
              // The original stays on screen under the translation. A machine
              // translation of a message from someone you are getting to know
              // is a guess, and hiding what they actually wrote makes that
              // guess unfalsifiable.
              <p className="mt-1 max-w-[80%] text-xs italic text-ink/45">{entry.message.body}</p>
            )}
            {entry.message.id === lastMineId && (
              <p className="mt-1 text-right text-[11px] text-ink/45">
                {entry.message.readAt ? labels.seen : labels.sent}
              </p>
            )}
          </div>
          )
        )}

        {presence.partnerTyping && (
          <p
            className="w-fit rounded-2xl bg-dusk-50 px-4 py-2.5 text-sm text-ink/55"
            role="status"
            aria-live="polite"
          >
            {labels.typing}
          </p>
        )}

        <div ref={endRef} />
      </div>

      {giftPickerOpen && (
        <div
          className="mt-6 grid grid-cols-6 gap-2 rounded-2xl border border-black/5 bg-dusk-50 p-3"
          role="group"
          aria-label={labels.sendGift}
        >
          {GIFTS.map((gift) => (
            <button
              key={gift.id}
              type="button"
              onClick={() => handleGift(gift.id)}
              className="rounded-xl bg-white py-2 text-2xl transition hover:scale-110"
            >
              <span role="img" aria-label={gift.id}>
                {gift.emoji}
              </span>
            </button>
          ))}
        </div>
      )}

      {/*
        `min-w-0` on the input is load-bearing, not tidying. A flex item's
        default `min-width: auto` refuses to shrink past its intrinsic width,
        and an input's intrinsic width is its `size` — about 20 characters. On a
        412px phone that pushed the send button 42px off-screen and, because the
        tab bar is `inset-x-0`, dragged the whole bottom nav out with it.
      */}
      <form onSubmit={handleSend} className="mt-6 flex gap-2 sm:gap-3">
        <button
          type="button"
          onClick={() => setGiftPickerOpen((open) => !open)}
          aria-expanded={giftPickerOpen}
          aria-label={labels.sendGift}
          className="shrink-0 rounded-full border border-black/10 px-4 text-lg hover:border-bloom-400"
        >
          🎁
        </button>
        <input
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            pingTyping(event.target.value.trim() !== "");
          }}
          onBlur={() => pingTyping(false)}
          placeholder={labels.placeholder}
          aria-label={labels.placeholder}
          maxLength={2000}
          className="min-w-0 flex-1 rounded-full border border-black/10 px-4 py-3 text-sm focus:border-bloom-400 focus:outline-none sm:px-5"
        />
        <button
          type="submit"
          className="btn-primary shrink-0"
          disabled={sending || draft.trim() === ""}
        >
          {labels.send}
        </button>
      </form>
    </section>
  );
}

/**
 * A gift in the timeline.
 *
 * Deliberately not shaped like a message bubble. A gift is a gesture, not
 * something said, and giving it the same chrome as text would make the
 * conversation read as though someone had spoken when they had not.
 */
function GiftBubble({ gift, label }: { gift: SentGift; label: string }) {
  return (
    <div className={gift.mine ? "text-right" : "text-left"}>
      <span
        className="inline-flex items-center gap-2 rounded-full border border-bloom-200 bg-bloom-50/60 px-4 py-2"
        title={label}
      >
        <span className="text-2xl" role="img" aria-label={gift.giftId}>
          {giftById(gift.giftId).emoji}
        </span>
        <span className="text-xs text-ink/55">{label}</span>
      </span>
    </div>
  );
}
