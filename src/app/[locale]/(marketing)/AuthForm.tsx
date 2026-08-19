"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";

type Labels = {
  name?: string;
  email: string;
  password: string;
  birthdate?: string;
  country?: string;
  submit: string;
  termsAgree?: string;
};

type FieldError = { field: string; code: string };

/**
 * Real authentication form. Posts to the API, which sets an httpOnly session
 * cookie; on success the member lands on Discover.
 */
export function AuthForm({
  mode,
  labels,
  locale
}: {
  mode: "login" | "register";
  labels: Labels;
  locale: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [generalError, setGeneralError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setErrors([]);
    setGeneralError(null);

    const form = new FormData(event.currentTarget);
    const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";

    const payload =
      mode === "login"
        ? { email: form.get("email"), password: form.get("password") }
        : {
            email: form.get("email"),
            password: form.get("password"),
            displayName: form.get("name"),
            birthdate: form.get("birthdate"),
            countryId: form.get("country"),
            locale
          };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        router.push(mode === "login" ? "/app/discover" : "/app/profile");
        router.refresh();
        return;
      }

      const body = await response.json().catch(() => ({}));

      if (response.status === 429) setGeneralError("tooManyAttempts");
      else if (body.errors) setErrors(body.errors as FieldError[]);
      else if (body.error === "invalid_credentials") setGeneralError("invalidCredentials");
      else setGeneralError("unknown");
    } catch {
      setGeneralError("network");
    } finally {
      setPending(false);
    }
  }

  const errorFor = (field: string) => errors.find((error) => error.field === field)?.code;

  return (
    <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
      {mode === "register" && labels.name && (
        <Field id="name" label={labels.name} type="text" autoComplete="given-name" error={errorFor("displayName")} />
      )}
      <Field id="email" label={labels.email} type="email" autoComplete="email" error={errorFor("email")} />
      {mode === "register" && labels.birthdate && (
        <Field id="birthdate" label={labels.birthdate} type="date" autoComplete="bday" error={errorFor("birthdate")} />
      )}
      {mode === "register" && labels.country && (
        <Field id="country" label={labels.country} type="text" autoComplete="country-name" error={errorFor("countryId")} />
      )}
      <Field
        id="password"
        label={labels.password}
        type="password"
        autoComplete={mode === "login" ? "current-password" : "new-password"}
        error={errorFor("password")}
      />

      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? "…" : labels.submit}
      </button>

      {generalError && (
        <p className="rounded-lg bg-bloom-50 p-3 text-sm text-bloom-700" role="alert">
          {generalErrorMessage(generalError)}
        </p>
      )}

      {mode === "register" && labels.termsAgree && (
        <p className="text-xs text-ink/50">{labels.termsAgree}</p>
      )}
    </form>
  );
}

function generalErrorMessage(code: string): string {
  switch (code) {
    case "invalidCredentials":
      return "That email and password don't match an account.";
    case "tooManyAttempts":
      return "Too many attempts. Please wait a minute and try again.";
    case "network":
      return "Couldn't reach the server. Check your connection and try again.";
    default:
      return "Something went wrong. Please try again.";
  }
}

function fieldErrorMessage(code: string): string {
  switch (code) {
    case "too_short":
      return "Use at least 10 characters.";
    case "too_common":
      return "That password is too common. Please pick another.";
    case "too_long":
      return "That password is too long.";
    case "taken":
      return "An account with this email already exists.";
    case "underage":
      return "You must be 18 or over to join FioreMatch.";
    case "invalid":
      return "Please check this field.";
    default:
      return "Please check this field.";
  }
}

function Field({
  id,
  label,
  type,
  autoComplete,
  error
}: {
  id: string;
  label: string;
  type: string;
  autoComplete: string;
  error?: string;
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
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`mt-1 w-full rounded-lg border px-4 py-2.5 text-sm focus:outline-none ${
          error ? "border-bloom-500 focus:border-bloom-600" : "border-black/10 focus:border-bloom-400"
        }`}
      />
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-bloom-600">
          {fieldErrorMessage(error)}
        </p>
      )}
    </div>
  );
}
