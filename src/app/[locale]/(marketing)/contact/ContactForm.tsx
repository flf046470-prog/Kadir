"use client";

import { useState } from "react";

type Labels = {
  name: string;
  email: string;
  topic: string;
  topicOptions: string[];
  message: string;
  submit: string;
  note: string;
  opened: string;
};

/**
 * Contact, without a backend to post to.
 *
 * Submitting hands the message to the member's own mail client, prefilled.
 * There is no email provider configured and no route to receive a form post, so
 * the alternative was the form this replaces: it accepted a message, said so,
 * and dropped it. For a dating product that is not a missing feature — the
 * person filling this in may be reporting someone.
 *
 * The address is also printed next to the button, and that is the part that
 * actually has to work. `mailto:` is unreliable in exactly the places this app
 * runs: an in-app webview with no mail client registered, a desktop with no
 * default handler, a very long body that some clients truncate. A visible
 * address survives all of it, so the button is the convenience and the text is
 * the guarantee.
 */
export function ContactForm({
  labels,
  supportEmail
}: {
  labels: Labels;
  supportEmail: string;
}) {
  const [sent, setSent] = useState(false);

  return (
    <form
      className="max-w-xl space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const value = (key: string) => String(form.get(key) ?? "").trim();

        const subject = `${value("topic")} — ${value("name")}`;
        const body = `${value("message")}\n\n— ${value("name")} <${value("email")}>`;

        window.location.href = `mailto:${supportEmail}?subject=${encodeURIComponent(
          subject
        )}&body=${encodeURIComponent(body)}`;
        setSent(true);
      }}
    >
      <div>
        <label className="text-sm font-medium text-ink" htmlFor="name">
          {labels.name}
        </label>
        <input
          id="name"
          name="name"
          required
          className="mt-1 w-full rounded-lg border border-black/10 px-4 py-2.5 text-sm focus:border-bloom-400 focus:outline-none"
        />
      </div>
      <div>
        <label className="text-sm font-medium text-ink" htmlFor="email">
          {labels.email}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          className="mt-1 w-full rounded-lg border border-black/10 px-4 py-2.5 text-sm focus:border-bloom-400 focus:outline-none"
        />
      </div>
      <div>
        <label className="text-sm font-medium text-ink" htmlFor="topic">
          {labels.topic}
        </label>
        <select
          id="topic"
          name="topic"
          className="mt-1 w-full rounded-lg border border-black/10 px-4 py-2.5 text-sm focus:border-bloom-400 focus:outline-none"
        >
          {labels.topicOptions.map((opt) => (
            <option key={opt}>{opt}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-sm font-medium text-ink" htmlFor="message">
          {labels.message}
        </label>
        <textarea
          id="message"
          name="message"
          rows={5}
          required
          className="mt-1 w-full rounded-lg border border-black/10 px-4 py-2.5 text-sm focus:border-bloom-400 focus:outline-none"
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="submit" className="btn-primary">
          {labels.submit}
        </button>
        {/*
          The address in full, not hidden behind the button. If the mail client
          never opens — no handler registered, an in-app webview — this is what
          the member is left with, so it has to be readable and copyable rather
          than only clickable.
        */}
        <a href={`mailto:${supportEmail}`} className="text-sm font-medium text-bloom-600">
          {supportEmail}
        </a>
      </div>
      {sent && (
        <p className="text-sm font-medium text-bloom-600" role="status">
          {labels.opened}
        </p>
      )}
      <p className="text-xs text-ink/50">{labels.note}</p>
    </form>
  );
}
