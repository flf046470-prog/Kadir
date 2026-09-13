"use client";

import { useState } from "react";

/**
 * In-app account deletion.
 *
 * Not optional and not a nice-to-have: both stores require it. Apple's
 * guideline 5.1.1(v) says an app that lets someone create an account must let
 * them delete it *from inside the app*, and Google Play's account-deletion
 * policy says the same. A support email is explicitly not enough for either.
 * The endpoint already existed; nothing called it, so a submission would have
 * been rejected.
 *
 * The confirmation is a typed word rather than a dialog. Deletion here cascades
 * across every table that holds this member's data — profile, photos, matches,
 * messages, rewards — and it is not recoverable, so it should cost more than a
 * mis-tap on a moving train. The word is translated, because asking someone to
 * type an English word to erase their account is a trap for everyone else.
 */
export function DeleteAccount({
  labels
}: {
  labels: {
    title: string;
    body: string;
    /** The word the member must type. Translated per locale. */
    confirmWord: string;
    prompt: string;
    button: string;
    working: string;
    failed: string;
  };
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");

  const armed = typed.trim().toLocaleLowerCase() === labels.confirmWord.toLocaleLowerCase();

  async function remove() {
    if (!armed || state === "working") return;
    setState("working");

    try {
      const response = await fetch("/api/account", { method: "DELETE" });
      if (!response.ok) {
        setState("failed");
        return;
      }
      // The server clears the session cookie; a full reload rather than a
      // client transition so nothing of the signed-in tree survives in memory.
      window.location.assign("/");
    } catch {
      setState("failed");
    }
  }

  return (
    <section className="mt-16 rounded-2xl border border-black/10 p-5">
      <h2 className="font-semibold text-ink">{labels.title}</h2>
      <p className="mt-2 text-sm text-ink/70">{labels.body}</p>

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-4 rounded-full border border-bloom-300 px-4 py-1.5 text-sm font-medium text-bloom-700"
        >
          {labels.button}
        </button>
      ) : (
        <div className="mt-4">
          <label className="block text-sm text-ink/80" htmlFor="delete-confirm">
            {labels.prompt}
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              id="delete-confirm"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              className="min-w-0 flex-1 rounded-lg border border-black/10 px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={remove}
              disabled={!armed || state === "working"}
              className="shrink-0 rounded-full bg-bloom-600 px-5 py-2 text-sm font-semibold text-white disabled:bg-black/15"
            >
              {state === "working" ? labels.working : labels.button}
            </button>
          </div>

          {state === "failed" && (
            <p className="mt-3 text-sm text-bloom-700" role="alert">
              {labels.failed}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
