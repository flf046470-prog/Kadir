"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { subscribeAction } from "@/app/actions";
import { initialSubscribeState } from "@/lib/form-state";

export type JoinFormLabels = {
  firstName: string;
  email: string;
  country: string;
  optional: string;
  consent: string;
  privacy: string;
  submit: string;
  sending: string;
  success: string;
  successNote: string;
  interestsTitle?: string;
  interests?: { value: string; label: string }[];
};

function SubmitButton({ labels }: { labels: JoinFormLabels }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-full bg-snow px-6 py-4 text-sm font-medium tracking-[0.12em] text-basalt uppercase transition-colors hover:bg-ember disabled:cursor-wait disabled:opacity-70 sm:w-auto sm:px-10"
    >
      {pending ? labels.sending : labels.submit}
    </button>
  );
}

function FieldError({ message, id }: { message?: string; id?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1.5 text-xs text-tulip" role="alert">
      {message}
    </p>
  );
}

const fieldClass =
  "w-full rounded-sm border border-fog/20 bg-basalt/60 px-4 py-3.5 text-base text-snow placeholder:text-fog/45 transition-colors focus:border-ember";

export function CommunityForm({
  labels,
  locale,
  source = "website",
  variant = "full",
  hiddenInterests = [],
  compact = false,
  idPrefix = "join",
}: {
  labels: JoinFormLabels;
  locale: string;
  source?: string;
  /** "email" asks for the address only — used where a full form would be noise. */
  variant?: "full" | "email";
  hiddenInterests?: string[];
  compact?: boolean;
  idPrefix?: string;
}) {
  const [state, formAction] = useActionState(subscribeAction, initialSubscribeState);

  if (state.status === "success") {
    return (
      <div className="card-stone flex items-start gap-4 p-6" role="status">
        <svg
          viewBox="0 0 24 24"
          className="mt-0.5 h-6 w-6 shrink-0 text-moss"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9.25" />
          <path d="m8 12.5 2.8 2.8L16.5 9.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div>
          <p className="font-display text-xl text-snow">{labels.success}</p>
          <p className="mt-2 text-sm text-fog">{labels.successNote}</p>
        </div>
      </div>
    );
  }

  const id = (name: string) => `${idPrefix}-${name}`;

  return (
    <form action={formAction} noValidate className={compact ? "" : "card-stone p-6 sm:p-8"}>
      <input type="hidden" name="source" value={source} />
      <input type="hidden" name="locale" value={locale} />
      {hiddenInterests.map((interest) => (
        <input key={interest} type="hidden" name="interests" value={interest} />
      ))}

      {/* Honeypot — hidden from people, tempting to bots. */}
      <div
        aria-hidden="true"
        className="absolute h-px w-px overflow-hidden opacity-0"
        style={{ left: "-9999px" }}
      >
        <label htmlFor={id("website")}>Website</label>
        <input id={id("website")} name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {variant === "full" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={id("firstName")} className="label mb-2 block">
              {labels.firstName}
            </label>
            <input
              id={id("firstName")}
              name="firstName"
              type="text"
              required
              maxLength={80}
              autoComplete="given-name"
              className={fieldClass}
              aria-describedby={state.fieldErrors?.firstName ? id("firstName-error") : undefined}
            />
            <FieldError message={state.fieldErrors?.firstName} id={id("firstName-error")} />
          </div>

          <div>
            <label htmlFor={id("country")} className="label mb-2 block">
              {labels.country}{" "}
              <span className="text-fog/50 normal-case">({labels.optional})</span>
            </label>
            <input
              id={id("country")}
              name="country"
              type="text"
              maxLength={80}
              autoComplete="country-name"
              className={fieldClass}
            />
            <FieldError message={state.fieldErrors?.country} />
          </div>
        </div>
      ) : (
        <input type="hidden" name="firstName" value="—" />
      )}

      <div className={variant === "full" ? "mt-4" : ""}>
        <label htmlFor={id("email")} className="label mb-2 block">
          {labels.email}
        </label>
        <input
          id={id("email")}
          name="email"
          type="email"
          required
          maxLength={160}
          autoComplete="email"
          inputMode="email"
          className={fieldClass}
          placeholder="you@example.com"
          aria-describedby={state.fieldErrors?.email ? id("email-error") : undefined}
        />
        <FieldError message={state.fieldErrors?.email} id={id("email-error")} />
      </div>

      {labels.interests?.length ? (
        <fieldset className="mt-6">
          <legend className="label mb-3">{labels.interestsTitle}</legend>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {labels.interests.map((interest) => (
              <label
                key={interest.value}
                className="flex cursor-pointer items-start gap-3 text-sm text-mist"
              >
                <input
                  type="checkbox"
                  name="interests"
                  value={interest.value}
                  defaultChecked={interest.value === "updates"}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[#c0603a]"
                />
                <span>{interest.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <label className="mt-5 flex cursor-pointer items-start gap-3 text-sm text-fog">
        <input
          type="checkbox"
          name="consent"
          value="on"
          required
          className="mt-1 h-4 w-4 shrink-0 accent-[#c0603a]"
        />
        <span>{labels.consent}</span>
      </label>
      <FieldError message={state.fieldErrors?.consent} />

      <p className="mt-4 text-xs leading-relaxed text-fog/70">{labels.privacy}</p>

      {state.status === "error" && state.message ? (
        <p className="mt-4 text-sm text-tulip" role="alert">
          {state.message}
        </p>
      ) : null}

      <div className="mt-7">
        <SubmitButton labels={labels} />
      </div>
    </form>
  );
}
