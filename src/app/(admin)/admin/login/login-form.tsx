"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { loginAction } from "../actions";
import { idleState } from "../state";
import { inputClass } from "../ui";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-6 w-full rounded-full bg-snow px-6 py-3 text-xs font-medium tracking-[0.14em] text-basalt uppercase transition-colors hover:bg-ember disabled:opacity-70"
    >
      {pending ? "Checking…" : "Sign in"}
    </button>
  );
}

export function LoginForm() {
  const [state, formAction] = useActionState(loginAction, idleState);

  return (
    <form action={formAction} className="card-stone mt-8 p-5">
      <label htmlFor="email" className="label mb-2 block">
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autoComplete="username"
        className={inputClass}
      />

      <label htmlFor="password" className="label mt-4 mb-2 block">
        Password
      </label>
      <input
        id="password"
        name="password"
        type="password"
        required
        autoComplete="current-password"
        className={inputClass}
      />

      {state.status === "error" ? (
        <p className="mt-4 text-sm text-tulip" role="alert">
          {state.message}
        </p>
      ) : null}

      <Submit />
    </form>
  );
}
