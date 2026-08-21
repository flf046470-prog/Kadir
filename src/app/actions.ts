"use server";

import { addMember } from "@/lib/content";
import { getClientKey } from "@/lib/request";
import { rateLimit } from "@/lib/rate-limit";
import { subscribeSchema } from "@/lib/validation";
import { seedIfEmpty } from "@/lib/seed";
import {
  addIdea,
  getVoteTallies,
  isVoteChoice,
  recordVote,
} from "@/lib/community";
import { syncSubscriberSafely } from "@/services/email";
import {
  initialVoteState,
  type IdeaState,
  type SubscribeState,
  type VoteState,
} from "@/lib/form-state";

/* ── shared helpers ───────────────────────────────────────────────────── */

function normaliseCountry(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

function text(formData: FormData, key: string, max: number): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

const INTEREST_KEYS = ["updates", "opening", "reservations", "early_guest"] as const;

function readInterests(formData: FormData): string[] {
  return formData
    .getAll("interests")
    .filter((v): v is string => typeof v === "string")
    .filter((v) => (INTEREST_KEYS as readonly string[]).includes(v));
}

/* ── email community ──────────────────────────────────────────────────── */


export async function subscribeAction(
  _prev: SubscribeState,
  formData: FormData,
): Promise<SubscribeState> {
  seedIfEmpty();

  const parsed = subscribeSchema.safeParse({
    firstName: formData.get("firstName") ?? "",
    email: formData.get("email") ?? "",
    country: formData.get("country") ?? "",
    consent: formData.get("consent") ?? false,
    website: formData.get("website") ?? "",
  });

  // Handed back with any error so the visitor does not retype what they wrote.
  const submitted = {
    firstName: text(formData, "firstName", 80),
    email: text(formData, "email", 160),
    country: text(formData, "country", 80),
    interests: readInterests(formData),
  };

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
    // The honeypot is invisible, so a bot tripping it gets the generic message.
    if (fieldErrors.website) {
      return { status: "error", message: "Something went wrong. Please try again." };
    }
    return {
      status: "error",
      message: "Please check the highlighted fields.",
      fieldErrors,
      values: submitted,
    };
  }

  const key = await getClientKey();
  if (!rateLimit(`subscribe:${key}`, { limit: 5, windowSeconds: 3600 }).ok) {
    return {
      status: "error",
      message: "That's a few too many attempts. Please try again in a little while.",
      values: submitted,
    };
  }

  const interests = submitted.interests;
  const country = normaliseCountry(parsed.data.country);

  try {
    addMember({
      firstName: parsed.data.firstName,
      email: parsed.data.email,
      country,
      source: text(formData, "source", 40) || "website",
      interests,
      locale: text(formData, "locale", 8),
    });
  } catch {
    return {
      status: "error",
      message: "We couldn't save that just now. Please try again in a moment.",
    };
  }

  await syncSubscriberSafely({
    email: parsed.data.email,
    firstName: parsed.data.firstName,
    country,
    interests,
    locale: text(formData, "locale", 8),
    source: text(formData, "source", 40) || "website",
  });

  // A new sign-up and an address already on the list get the same confirmation,
  // so the form can't be used to test whether someone is subscribed.
  return { status: "success", message: "" };
}

/* ── "should we really build this house?" ─────────────────────────────── */


export async function voteAction(_prev: VoteState, formData: FormData): Promise<VoteState> {
  seedIfEmpty();

  const choice = text(formData, "choice", 20);
  if (!isVoteChoice(choice)) {
    return { ...initialVoteState, status: "error", message: "Please pick one of the options." };
  }
  if (text(formData, "website", 5)) {
    return { ...initialVoteState, status: "error", message: "Something went wrong." };
  }

  const key = await getClientKey();
  if (!rateLimit(`vote:${key}`, { limit: 10, windowSeconds: 3600 }).ok) {
    return { ...initialVoteState, status: "error", message: "Too many attempts. Try again later." };
  }

  try {
    recordVote(choice, normaliseCountry(text(formData, "country", 80)), key);
  } catch {
    return { ...initialVoteState, status: "error", message: "We couldn't record that. Try again." };
  }

  const { total, tallies } = getVoteTallies();
  return { status: "success", message: "", choice, total, tallies };
}

/** Lets the results panel refresh without re-voting. */
export async function getTalliesAction() {
  seedIfEmpty();
  return getVoteTallies();
}

/* ── ideas ────────────────────────────────────────────────────────────── */


export async function ideaAction(_prev: IdeaState, formData: FormData): Promise<IdeaState> {
  seedIfEmpty();

  if (text(formData, "website", 5)) {
    return { status: "error", message: "Something went wrong. Please try again." };
  }

  const body = text(formData, "body", 4000);
  // Handed back with any error: nobody should have to write their idea twice.
  const submitted = {
    body,
    name: text(formData, "name", 80),
    country: text(formData, "country", 80),
    email: text(formData, "email", 160),
  };

  if (body.length < 4) {
    return {
      status: "error",
      message: "Please check the highlighted fields.",
      fieldErrors: { body: "Tell us the idea — a sentence is plenty." },
      values: submitted,
    };
  }

  const email = text(formData, "email", 160).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return {
      status: "error",
      message: "Please check the highlighted fields.",
      fieldErrors: { email: "That email doesn't look right. You can also leave it blank." },
      values: submitted,
    };
  }

  const key = await getClientKey();
  if (!rateLimit(`idea:${key}`, { limit: 3, windowSeconds: 3600 }).ok) {
    return {
      status: "error",
      message: "That's a few too many messages. Please try again in a little while.",
      values: submitted,
    };
  }

  try {
    const country = normaliseCountry(text(formData, "country", 80));
    addIdea({ name: text(formData, "name", 80), country, email, body });
    // Sending an idea is itself an answer to the question, so it counts once.
    recordVote("idea", country, key);
  } catch {
    return { status: "error", message: "We couldn't save that just now. Please try again." };
  }

  return { status: "success", message: "" };
}
