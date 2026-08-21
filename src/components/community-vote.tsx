"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { ideaAction, voteAction } from "@/app/actions";
import { initialIdeaState, initialVoteState } from "@/lib/form-state";
import type { VoteChoice } from "@/lib/community";

export type VoteLabels = {
  absolutely: string;
  absolutelyNote: string;
  love: string;
  loveNote: string;
  change: string;
  changeNote: string;
  idea: string;
  ideaNote: string;
  thanks: string;
  ideaThanks: string;
  results: string;
  noResults: string;
  responses: string;
  name: string;
  country: string;
  email: string;
  ideaField: string;
  optional: string;
  sendIdea: string;
  sending: string;
  privacy: string;
  error: string;
};

const CARD_ICONS: Record<VoteChoice, string> = {
  absolutely: "👍",
  love: "❤️",
  change: "🤔",
  idea: "💬",
};

function VoteCard({
  choice,
  title,
  note,
  selected,
  disabled,
}: {
  choice: VoteChoice;
  title: string;
  note: string;
  selected: boolean;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="choice"
      value={choice}
      disabled={disabled || pending}
      aria-pressed={selected}
      className={`group card-stone flex min-h-[7.5rem] w-full flex-col justify-between p-5 text-start transition-all duration-300 hover:-translate-y-0.5 hover:border-ember/50 disabled:cursor-default sm:min-h-[10rem] sm:p-6 ${
        selected ? "border-ember/70 bg-stone" : ""
      }`}
    >
      <span aria-hidden="true" className="text-2xl sm:text-3xl">
        {CARD_ICONS[choice]}
      </span>
      <span className="mt-4 block">
        <span
          className={`label block transition-colors ${selected ? "text-ember" : "text-snow group-hover:text-ember"}`}
        >
          {title}
        </span>
        <span className="mt-2 block text-sm text-fog">{note}</span>
      </span>
    </button>
  );
}

function Results({
  labels,
  total,
  tallies,
  selected,
}: {
  labels: VoteLabels;
  total: number;
  tallies: { choice: string; count: number; percent: number }[];
  selected?: string;
}) {
  if (total === 0) {
    return <p className="text-sm text-fog">{labels.noResults}</p>;
  }
  const nameFor = (choice: string) =>
    choice === "absolutely"
      ? labels.absolutely
      : choice === "love"
        ? labels.love
        : choice === "change"
          ? labels.change
          : labels.idea;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <p className="label text-snow">{labels.results}</p>
        <p className="label text-fog/60">
          {total} {labels.responses}
        </p>
      </div>
      <ul className="mt-5 space-y-4">
        {tallies.map((tally) => (
          <li key={tally.choice}>
            <div className="flex items-baseline justify-between gap-4 text-sm">
              <span className={tally.choice === selected ? "text-ember" : "text-mist"}>
                {nameFor(tally.choice)}
              </span>
              <span className="label text-fog/70">{tally.percent}%</span>
            </div>
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-fog/12">
              <span
                className={`block h-full rounded-full ${tally.choice === selected ? "bg-ember" : "bg-moss"}`}
                style={{ width: `${tally.percent}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** useFormStatus only reports on the form it is rendered inside. */
function IdeaSubmit({ labels }: { labels: VoteLabels }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-6 w-full rounded-full bg-snow px-8 py-4 text-xs font-medium tracking-[0.14em] text-basalt uppercase transition-colors hover:bg-ember disabled:opacity-70 sm:w-auto"
    >
      {pending ? labels.sending : labels.sendIdea}
    </button>
  );
}

function IdeaForm({ labels, locale }: { labels: VoteLabels; locale: string }) {
  const [state, formAction] = useActionState(ideaAction, initialIdeaState);

  if (state.status === "success") {
    return (
      <div className="card-stone p-6" role="status">
        <p className="font-display text-xl text-snow">{labels.ideaThanks}</p>
      </div>
    );
  }

  const field =
    "w-full rounded-sm border border-fog/20 bg-basalt/60 px-4 py-3 text-base text-snow placeholder:text-fog/40 focus:border-ember";

  return (
    <form action={formAction} noValidate className="card-stone p-6 sm:p-8">
      <input type="hidden" name="locale" value={locale} />
      <div
        aria-hidden="true"
        className="absolute h-px w-px overflow-hidden opacity-0"
        style={{ left: "-9999px" }}
      >
        <label htmlFor="idea-website">Website</label>
        <input id="idea-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="idea-name" className="label mb-2 block">
            {labels.name} <span className="text-fog/50">({labels.optional})</span>
          </label>
          <input
            id="idea-name"
            name="name"
            type="text"
            maxLength={80}
            defaultValue={state.values?.name ?? ""}
            className={field}
          />
        </div>
        <div>
          <label htmlFor="idea-country" className="label mb-2 block">
            {labels.country} <span className="text-fog/50">({labels.optional})</span>
          </label>
          <input
            id="idea-country"
            name="country"
            type="text"
            maxLength={80}
            autoComplete="country-name"
            defaultValue={state.values?.country ?? ""}
            className={field}
          />
        </div>
      </div>

      <div className="mt-4">
        <label htmlFor="idea-email" className="label mb-2 block">
          {labels.email} <span className="text-fog/50">({labels.optional})</span>
        </label>
        <input
          id="idea-email"
          name="email"
          type="email"
          maxLength={160}
          autoComplete="email"
          defaultValue={state.values?.email ?? ""}
          className={field}
        />
        {state.fieldErrors?.email ? (
          <p className="mt-1.5 text-xs text-tulip" role="alert">
            {state.fieldErrors.email}
          </p>
        ) : null}
      </div>

      <div className="mt-4">
        <label htmlFor="idea-body" className="label mb-2 block">
          {labels.ideaField}
        </label>
        <textarea
          id="idea-body"
          name="body"
          required
          rows={5}
          maxLength={4000}
          defaultValue={state.values?.body ?? ""}
          className={`${field} resize-y`}
        />
        {state.fieldErrors?.body ? (
          <p className="mt-1.5 text-xs text-tulip" role="alert">
            {state.fieldErrors.body}
          </p>
        ) : null}
      </div>

      <p className="mt-4 text-xs leading-relaxed text-fog/70">{labels.privacy}</p>

      {state.status === "error" && !state.fieldErrors ? (
        <p className="mt-4 text-sm text-tulip" role="alert">
          {state.message}
        </p>
      ) : null}

      <IdeaSubmit labels={labels} />
    </form>
  );
}

export function CommunityVote({
  labels,
  locale,
}: {
  labels: VoteLabels;
  locale: string;
}) {
  const [state, formAction] = useActionState(voteAction, initialVoteState);
  const [ideaOpen, setIdeaOpen] = useState(false);
  const voted = state.status === "success";

  return (
    <div>
      <form action={formAction}>
        <input type="hidden" name="locale" value={locale} />
        <div
          aria-hidden="true"
          className="absolute h-px w-px overflow-hidden opacity-0"
          style={{ left: "-9999px" }}
        >
          <label htmlFor="vote-website">Website</label>
          <input id="vote-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
        </div>

        <div
          data-motion="vote-cards"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4"
        >
          <VoteCard
            choice="absolutely"
            title={labels.absolutely}
            note={labels.absolutelyNote}
            selected={state.choice === "absolutely"}
            disabled={voted}
          />
          <VoteCard
            choice="love"
            title={labels.love}
            note={labels.loveNote}
            selected={state.choice === "love"}
            disabled={voted}
          />
          <VoteCard
            choice="change"
            title={labels.change}
            note={labels.changeNote}
            selected={state.choice === "change"}
            disabled={voted}
          />
          {/* The fourth card opens the form instead of casting a bare vote. */}
          <button
            type="button"
            onClick={() => setIdeaOpen((v) => !v)}
            aria-expanded={ideaOpen}
            aria-controls="idea-form"
            className={`group card-stone flex min-h-[7.5rem] w-full flex-col justify-between p-5 text-start transition-all duration-300 hover:-translate-y-0.5 hover:border-ember/50 sm:min-h-[10rem] sm:p-6 ${
              ideaOpen ? "border-ember/70 bg-stone" : ""
            }`}
          >
            <span aria-hidden="true" className="text-2xl sm:text-3xl">
              {CARD_ICONS.idea}
            </span>
            <span className="mt-4 block">
              <span
                className={`label block transition-colors ${ideaOpen ? "text-ember" : "text-snow group-hover:text-ember"}`}
              >
                {labels.idea}
              </span>
              <span className="mt-2 block text-sm text-fog">{labels.ideaNote}</span>
            </span>
          </button>
        </div>

        {state.status === "error" ? (
          <p className="mt-4 text-sm text-tulip" role="alert">
            {state.message}
          </p>
        ) : null}
      </form>

      {voted ? (
        <div className="card-stone mt-6 p-6 sm:p-8" role="status">
          <p className="font-display text-xl text-snow">{labels.thanks}</p>
          <div className="mt-6 border-t border-fog/10 pt-6">
            <Results
              labels={labels}
              total={state.total}
              tallies={state.tallies}
              selected={state.choice}
            />
          </div>
        </div>
      ) : null}

      {ideaOpen ? (
        <div id="idea-form" className="relative mt-6">
          <IdeaForm labels={labels} locale={locale} />
        </div>
      ) : null}
    </div>
  );
}
