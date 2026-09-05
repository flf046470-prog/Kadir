"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { genders, relationshipGoals } from "@/lib/domain/taxonomies";

type Initial = {
  cityId: string;
  countryId: string;
  relationshipGoal: string;
  interests: string[];
  languagesSpoken: string[];
  /** Null when not answered — which is a real state, not a missing value. */
  gender: string | null;
  seeking: string[];
};

type Labels = {
  bio: string;
  interests: string;
  goal: string;
  city: string;
  country: string;
  languages: string;
  gender: string;
  genderUnspecified: string;
  seeking: string;
  seekingHint: string;
  complete: string;
  save: string;
  saved: string;
  logout: string;
  discover: string;
};

/** Splits a comma-separated field into clean values; the API validates again. */
function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
}

export function ProfileForm({
  initial,
  labels,
  locale
}: {
  initial: Initial;
  labels: Labels;
  locale: string;
}) {
  const router = useRouter();
  // Goal ids are language-neutral; their labels are translated like any other
  // copy, so the select never shows a raw id such as "long_term".
  const taxonomy = useTranslations("taxonomy");
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setSaved(false);

    const form = new FormData(event.currentTarget);

    const response = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        bio: form.get("bio"),
        cityId: form.get("cityId"),
        countryId: form.get("countryId"),
        relationshipGoal: form.get("relationshipGoal"),
        // "" is the "rather not say" option, and clears the field rather than
        // storing an empty string.
        gender: form.get("gender") === "" ? null : form.get("gender"),
        seeking: form.getAll("seeking").map(String),
        interests: splitList(String(form.get("interests") ?? "")),
        languagesSpoken: splitList(String(form.get("languagesSpoken") ?? "")),
        markComplete: form.get("complete") === "on"
      })
    });

    setPending(false);
    if (response.ok) {
      setSaved(true);
      router.refresh();
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
        <Field id="bio" label={labels.bio} textarea />
        <Field id="cityId" label={labels.city} defaultValue={initial.cityId} />
        <Field id="countryId" label={labels.country} defaultValue={initial.countryId} />

        <div>
          <label className="text-sm font-medium text-ink" htmlFor="relationshipGoal">
            {labels.goal}
          </label>
          <select
            id="relationshipGoal"
            name="relationshipGoal"
            defaultValue={initial.relationshipGoal}
            className="mt-1 w-full rounded-lg border border-black/10 px-4 py-2.5 text-sm"
          >
            {relationshipGoals.map((goal) => (
              <option key={goal.id} value={goal.id}>
                {taxonomy(`relationshipGoals.${goal.id}`)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-sm font-medium text-ink" htmlFor="gender">
            {labels.gender}
          </label>
          <select
            id="gender"
            name="gender"
            defaultValue={initial.gender ?? ""}
            className="mt-1 w-full rounded-lg border border-black/10 px-4 py-2.5 text-sm"
          >
            {/*
              First, and selected when nothing is stored. Not answering has to be
              a visible choice rather than the absence of one — and it keeps
              working: an unanswered profile is shown to everyone and sees
              everyone.
            */}
            <option value="">{labels.genderUnspecified}</option>
            {genders.map((gender) => (
              <option key={gender} value={gender}>
                {taxonomy(`genders.${gender}`)}
              </option>
            ))}
          </select>
        </div>

        <fieldset>
          <legend className="text-sm font-medium text-ink">{labels.seeking}</legend>
          <p className="mt-1 text-xs text-ink/50">{labels.seekingHint}</p>
          <div className="mt-2 flex flex-wrap gap-4">
            {genders.map((gender) => (
              <label key={gender} className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  name="seeking"
                  value={gender}
                  defaultChecked={initial.seeking.includes(gender)}
                  className="h-4 w-4"
                />
                {taxonomy(`genders.${gender}`)}
              </label>
            ))}
          </div>
        </fieldset>

        <Field id="interests" label={labels.interests} defaultValue={initial.interests.join(", ")} />
        <Field
          id="languagesSpoken"
          label={labels.languages}
          defaultValue={initial.languagesSpoken.join(", ")}
        />

        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" name="complete" defaultChecked className="h-4 w-4" />
          {labels.complete}
        </label>

        <div className="flex items-center gap-4">
          <button type="submit" className="btn-primary" disabled={pending}>
            {pending ? "…" : labels.save}
          </button>
          {saved && (
            <span className="text-sm font-medium text-bloom-600" role="status">
              ✓ {labels.saved}
            </span>
          )}
        </div>
      </form>

      <div className="mt-10 border-t border-black/10 pt-6">
        <button type="button" onClick={handleLogout} className="text-sm text-ink/60 hover:text-ink">
          {labels.logout}
        </button>
        <a
          href={`/${locale}/app/discover`}
          className="ml-6 text-sm font-medium text-bloom-600 hover:underline"
        >
          {labels.discover} →
        </a>
      </div>
    </>
  );
}

function Field({
  id,
  label,
  defaultValue,
  textarea = false
}: {
  id: string;
  label: string;
  defaultValue?: string;
  textarea?: boolean;
}) {
  const className =
    "mt-1 w-full rounded-lg border border-black/10 px-4 py-2.5 text-sm focus:border-bloom-400 focus:outline-none";

  return (
    <div>
      <label className="text-sm font-medium text-ink" htmlFor={id}>
        {label}
      </label>
      {textarea ? (
        <textarea id={id} name={id} rows={3} defaultValue={defaultValue} className={className} />
      ) : (
        <input id={id} name={id} type="text" defaultValue={defaultValue} className={className} />
      )}
    </div>
  );
}
