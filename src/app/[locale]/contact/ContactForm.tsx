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
};

export function ContactForm({ labels }: { labels: Labels }) {
  const [sent, setSent] = useState(false);

  return (
    <form
      className="max-w-xl space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
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
      <button type="submit" className="btn-primary">
        {labels.submit}
      </button>
      {sent && (
        <p className="text-sm font-medium text-bloom-600" role="status">
          ✓ Demo submission received — nothing was sent anywhere.
        </p>
      )}
      <p className="text-xs text-ink/50">{labels.note}</p>
    </form>
  );
}
