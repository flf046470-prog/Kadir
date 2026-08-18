"use client";

import { useState } from "react";

type Labels = {
  name?: string;
  email: string;
  password: string;
  birthdate?: string;
  submit: string;
  demoNotice: string;
  termsAgree?: string;
};

export function AuthForm({ mode, labels }: { mode: "login" | "register"; labels: Labels }) {
  const [submitted, setSubmitted] = useState(false);

  return (
    <form
      className="mt-6 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
      }}
    >
      {mode === "register" && labels.name && (
        <Field id="name" label={labels.name} type="text" autoComplete="given-name" />
      )}
      <Field id="email" label={labels.email} type="email" autoComplete="email" />
      {mode === "register" && labels.birthdate && (
        <Field id="birthdate" label={labels.birthdate} type="date" autoComplete="bday" />
      )}
      <Field id="password" label={labels.password} type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} />

      <button type="submit" className="btn-primary w-full">
        {labels.submit}
      </button>

      {submitted && (
        <p className="text-sm font-medium text-bloom-600" role="status">
          ✓ Demo only — no account was created and no data was sent anywhere.
        </p>
      )}

      {mode === "register" && labels.termsAgree && (
        <p className="text-xs text-ink/50">{labels.termsAgree}</p>
      )}
      <p className="rounded-lg bg-dusk-50 p-3 text-xs text-dusk-700">{labels.demoNotice}</p>
    </form>
  );
}

function Field({
  id,
  label,
  type,
  autoComplete
}: {
  id: string;
  label: string;
  type: string;
  autoComplete: string;
}) {
  return (
    <div>
      <label className="text-sm font-medium text-ink" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        required
        className="mt-1 w-full rounded-lg border border-black/10 px-4 py-2.5 text-sm focus:border-bloom-400 focus:outline-none"
      />
    </div>
  );
}
