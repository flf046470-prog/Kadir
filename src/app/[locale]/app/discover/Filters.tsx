"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { cities, countries } from "@/lib/countries-data";
import { relationshipGoals, matchIntents } from "@/lib/domain/taxonomies";
import {
  defaultFilters,
  isDefault,
  MAX_AGE,
  MIN_AGE,
  type DiscoveryFilters
} from "@/lib/matching/filters";

export type FilterLabels = {
  title: string;
  ageRange: string;
  minAge: string;
  maxAge: string;
  country: string;
  city: string;
  placeHint: string;
  languages: string;
  languagesHint: string;
  goal: string;
  intent: string;
  apply: string;
  reset: string;
  active: string;
  none: string;
};

/**
 * Discovery filters.
 *
 * Filters narrow the pool; they do not reorder it — ranking stays the matching
 * engine's job. Keeping those separate is what lets a member widen a filter
 * without wondering why the order changed too.
 *
 * Edits collect in a draft and are applied on submit rather than on every
 * keystroke: a half-typed city should not empty the feed.
 */
export function Filters({
  value,
  onChange,
  labels
}: {
  value: DiscoveryFilters;
  onChange: (next: DiscoveryFilters) => void;
  labels: FilterLabels;
}) {
  const t = useTranslations("taxonomy");
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DiscoveryFilters>(value);

  function toggleIn<T extends string>(list: T[], item: T): T[] {
    return list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item];
  }

  // Only the cities of the chosen country are worth suggesting once a country
  // is set; suggesting Berlin to someone filtering on Turkey is noise.
  const citySuggestions = Object.values(cities).filter(
    (city) => !draft.countryId || city.countrySlug === draft.countryId
  );

  return (
    <div className="mt-6 rounded-2xl border border-black/10 bg-white">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <span className="font-medium text-ink">{labels.title}</span>
        <span className="text-sm text-ink/50">
          {isDefault(value) ? labels.none : labels.active}
        </span>
      </button>

      {open && (
        <form
          id={panelId}
          onSubmit={(event) => {
            event.preventDefault();
            onChange(draft);
            setOpen(false);
          }}
          className="space-y-5 border-t border-black/10 px-5 py-5"
        >
          <fieldset>
            <legend className="text-sm font-medium text-ink">
              {labels.ageRange}: {draft.minAge}–{draft.maxAge}
            </legend>
            <div className="mt-2 flex items-center gap-3">
              <AgeField
                label={labels.minAge}
                value={draft.minAge}
                onChange={(minAge) => setDraft({ ...draft, minAge })}
              />
              <span aria-hidden="true" className="text-ink/40">
                —
              </span>
              <AgeField
                label={labels.maxAge}
                value={draft.maxAge}
                onChange={(maxAge) => setDraft({ ...draft, maxAge })}
              />
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="filter-country"
              label={labels.country}
              hint={labels.placeHint}
              list="filter-country-options"
              value={draft.countryId ?? ""}
              onChange={(next) => setDraft({ ...draft, countryId: next || null })}
            />
            <TextField
              id="filter-city"
              label={labels.city}
              list="filter-city-options"
              value={draft.cityId ?? ""}
              onChange={(next) => setDraft({ ...draft, cityId: next || null })}
            />
          </div>

          {/* Suggestions, not a closed list: members live in far more places
              than we have pages for, and the filter accepts any of them. */}
          <datalist id="filter-country-options">
            {Object.values(countries).map((country) => (
              <option key={country.slug} value={country.slug}>
                {country.name}
              </option>
            ))}
          </datalist>
          <datalist id="filter-city-options">
            {citySuggestions.map((city) => (
              <option key={city.slug} value={city.slug}>
                {city.name}
              </option>
            ))}
          </datalist>

          <TextField
            id="filter-languages"
            label={labels.languages}
            hint={labels.languagesHint}
            value={draft.languages.join(", ")}
            onChange={(next) =>
              setDraft({
                ...draft,
                languages: next
                  .split(",")
                  .map((item) => item.trim().toLowerCase())
                  .filter(Boolean)
              })
            }
          />

          <ChipGroup
            label={labels.goal}
            options={relationshipGoals.map((goal) => ({
              id: goal.id,
              label: t(`relationshipGoals.${goal.id}`)
            }))}
            selected={draft.relationshipGoals}
            onToggle={(id) =>
              setDraft({
                ...draft,
                relationshipGoals: toggleIn(draft.relationshipGoals, id as never)
              })
            }
          />

          <ChipGroup
            label={labels.intent}
            options={matchIntents.map((intent) => ({
              id: intent.id,
              label: `${intent.emoji} ${t(`matchIntents.${intent.id}`)}`
            }))}
            selected={draft.matchIntents}
            onToggle={(id) =>
              setDraft({ ...draft, matchIntents: toggleIn(draft.matchIntents, id as never) })
            }
          />

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={() => {
                setDraft(defaultFilters);
                onChange(defaultFilters);
              }}
              className="btn-secondary !px-4 !py-2 text-sm"
            >
              {labels.reset}
            </button>
            <button type="submit" className="btn-primary !px-5 !py-2 text-sm">
              {labels.apply}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/**
 * Ages are held as numbers here but only clamped on apply, so a member can
 * clear the field and retype without the input fighting them mid-edit. The
 * parser clamps again server-side, which is the boundary that matters.
 */
function AgeField({
  label,
  value,
  onChange
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <input
      type="number"
      inputMode="numeric"
      min={MIN_AGE}
      max={MAX_AGE}
      value={value}
      onChange={(event) => {
        const next = Number(event.target.value);
        if (Number.isFinite(next)) onChange(next);
      }}
      onBlur={(event) => {
        const next = Number(event.target.value);
        onChange(Math.min(MAX_AGE, Math.max(MIN_AGE, Math.floor(next) || MIN_AGE)));
      }}
      className="w-24 rounded-lg border border-black/10 px-3 py-2 text-sm"
      aria-label={label}
    />
  );
}

function TextField({
  id,
  label,
  hint,
  list,
  value,
  onChange
}: {
  id: string;
  label: string;
  hint?: string;
  list?: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const hintId = `${id}-hint`;

  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        type="text"
        list={list}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={hint ? hintId : undefined}
        className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
      />
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-ink/50">
          {hint}
        </p>
      )}
    </div>
  );
}

function ChipGroup({
  label,
  options,
  selected,
  onToggle
}: {
  label: string;
  options: { id: string; label: string }[];
  selected: readonly string[];
  onToggle: (id: string) => void;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-ink">{label}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => {
          const active = selected.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onToggle(option.id)}
              aria-pressed={active}
              className={`rounded-full border px-3 py-1.5 text-xs transition ${
                active
                  ? "border-bloom-400 bg-bloom-50 text-bloom-700"
                  : "border-black/10 text-ink/70 hover:border-black/25"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
