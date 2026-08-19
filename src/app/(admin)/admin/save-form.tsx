"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { idleState, type ActionState } from "./state";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-snow px-6 py-2.5 text-xs font-medium tracking-[0.14em] text-basalt uppercase transition-colors hover:bg-ember disabled:opacity-70"
    >
      {pending ? "Saving…" : label}
    </button>
  );
}

/**
 * Wraps a server action with pending and result feedback. The fields
 * themselves stay server-rendered and are passed through as children.
 */
export function SaveForm({
  action,
  children,
  submitLabel = "Save",
  extra,
  encType,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  children: ReactNode;
  submitLabel?: string;
  extra?: ReactNode;
  encType?: string;
}) {
  const [state, formAction] = useActionState(action, idleState);

  return (
    <form action={formAction} encType={encType}>
      {children}
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Submit label={submitLabel} />
        {extra}
        {state.status !== "idle" ? (
          <span
            role="status"
            className={`text-sm ${state.status === "error" ? "text-tulip" : "text-moss"}`}
          >
            {state.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
