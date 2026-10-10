"use client";

import { useState } from "react";

type Labels = {
  button: string;
  sending: string;
  sent: string;
  failed: string;
  rateLimited: string;
  signedOut: string;
};

/**
 * The "send me another link" button.
 *
 * A client component for one reason: every path that lands on it is a failure
 * the member did not cause — a link that expired while the mail sat in spam, a
 * gateway that rewrote the URL — and the fix has to be one press without
 * leaving the page they are already on.
 *
 * It sends no body. The endpoint takes the address from the session, so there
 * is nothing here for a caller to point at somebody else's mailbox.
 */
export function ResendVerification({ labels }: { labels: Labels }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function resend() {
    if (state === "sending" || state === "sent") return;

    setState("sending");
    setMessage(null);

    try {
      const response = await fetch("/api/auth/verify/resend", { method: "POST" });

      if (response.ok) {
        setState("sent");
        setMessage(labels.sent);
        return;
      }

      setState("error");
      /**
       * Each status gets its own sentence, because they ask for different
       * things from the member. 401 means log in; 429 means wait; anything
       * else means try again or write to us. One generic "something went
       * wrong" would leave all three stuck.
       */
      if (response.status === 401) setMessage(labels.signedOut);
      else if (response.status === 429) setMessage(labels.rateLimited);
      else setMessage(labels.failed);
    } catch {
      setState("error");
      setMessage(labels.failed);
    }
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={resend}
        disabled={state === "sending" || state === "sent"}
        className="rounded-full bg-bloom-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-bloom-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {state === "sending" ? labels.sending : labels.button}
      </button>

      {message ? (
        <p
          // `role="status"` so a screen reader announces the outcome: the
          // button's own label does not change on success, so without this the
          // press is silent.
          role="status"
          className={`mt-3 text-sm ${state === "error" ? "text-red-700" : "text-ink/70"}`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
