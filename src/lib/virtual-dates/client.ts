import type { InviteResult, RespondResult } from "@/db/virtual-dates";
import { INVITE_TTL_DAYS } from "./rules";

/**
 * The browser's half of the virtual date flow.
 *
 * Two screens show invitations — the conversation, and the list of matches —
 * and without this they would each grow their own copy of "what does a 402
 * mean". They would drift, and the one that drifted would silently show
 * "something went wrong" for a refusal the server explained perfectly well.
 *
 * The type imports are erased at build time, so nothing here drags the database
 * layer into the bundle. What they buy is the property this file exists for:
 * `REFUSAL_KEYS` is a `Record` over the server's own refusal unions, so adding a
 * reason in `db/virtual-dates.ts` fails the type check here until it has copy —
 * in both languages, which `copy.test.ts` then checks.
 */

/** An open invitation, as the API serialises it. Dates arrive as ISO strings. */
export type InviteView = {
  id: string;
  matchId: string;
  /** True when this member sent it. Decides accept/decline versus cancel. */
  mine: boolean;
  partnerName: string;
  environment: string | null;
  scheduledFor: string | null;
  createdAt: string;
  expiresAt: string;
};

export type Allowance = { used: number; limit: number | null };

export type VirtualDatesView = {
  /**
   * False when the feature is off for this member, and then everything else is
   * empty. A screen renders nothing at all rather than an empty state — an
   * empty state is a promise that something could appear here.
   */
  available: boolean;
  /** Open invitations, in both directions. `mine` says which. */
  invites: InviteView[];
  /**
   * Dates that were accepted and have not happened yet.
   *
   * Separate from `invites` because they need opposite things from a screen: an
   * invitation is a question with buttons, an accepted date is an answer to
   * show. Merging them would mean deciding which one a row is by reading its
   * status in two components.
   */
  upcoming: InviteView[];
  environments: string[];
  allowance: Allowance | null;
};

type InviteRefusal = Extract<InviteResult, { ok: false }>["reason"];
type RespondRefusal = Extract<RespondResult, { ok: false }>["reason"];

/**
 * Everything that can come back as an `error`.
 *
 * The two server unions, plus the codes the transport contributes: a rate
 * limit, a malformed body, an expired session, a network that is not there.
 */
export type Refusal =
  | InviteRefusal
  | RespondRefusal
  | "rate_limited"
  | "invalid_body"
  | "unauthorized"
  | "offline"
  | "unexpected";

export type RefusalMessage = {
  /** A key inside the `virtualDates` namespace. */
  key: string;
  values?: Record<string, string | number>;
};

/**
 * Refusal codes to copy.
 *
 * `not_a_match` never reaches a client — the route answers `not_found` for it,
 * because a match that is not yours is indistinguishable from one that does not
 * exist — but it shares that copy rather than being omitted, so the map stays
 * exhaustive over the server's union instead of over what the routes currently
 * happen to translate.
 */
const REFUSAL_KEYS: Record<Refusal, string> = {
  not_a_match: "errors.notFound",
  not_found: "errors.notFound",
  not_yours: "errors.notYours",
  already_pending: "errors.alreadyPending",
  already_answered: "errors.alreadyAnswered",
  expired: "errors.expired",
  no_dates_left: "errors.noDatesLeftYou",
  unknown_environment: "errors.unknownEnvironment",
  environment_locked: "errors.environmentLocked",
  scheduled_in_the_past: "errors.scheduledInThePast",
  scheduled_too_far: "errors.scheduledTooFar",
  rate_limited: "errors.rateLimited",
  invalid_body: "errors.unexpected",
  unauthorized: "errors.signedOut",
  offline: "errors.offline",
  unexpected: "errors.unexpected"
};

function isRefusal(value: unknown): value is Refusal {
  return typeof value === "string" && value in REFUSAL_KEYS;
}

/**
 * What to tell the member about a refused request.
 *
 * `no_dates_left` is the one that needs more than a lookup. Whose allowance ran
 * out changes what the member does next — wait for the month to roll over, or
 * say something to the other person — and the ceiling is only quoted when the
 * server sent one, so an unlimited tier can never produce "0 of null".
 */
export function refusalFor(
  status: number,
  body: { error?: unknown; who?: unknown; limit?: unknown } | null
): RefusalMessage {
  if (status === 401) return { key: REFUSAL_KEYS.unauthorized };

  const error = body?.error;

  if (error === "no_dates_left") {
    const limit = typeof body?.limit === "number" ? body.limit : null;
    if (body?.who === "them") {
      return limit === null
        ? { key: "errors.noDatesLeftThemPlain" }
        : { key: "errors.noDatesLeftThem", values: { limit } };
    }
    return limit === null
      ? { key: "errors.noDatesLeftYouPlain" }
      : { key: "errors.noDatesLeftYou", values: { limit } };
  }

  // The one refusal whose sentence contains the rule that produced it, so the
  // number comes from the rule rather than from the translation.
  if (error === "scheduled_too_far") {
    return { key: REFUSAL_KEYS.scheduled_too_far, values: { days: INVITE_TTL_DAYS } };
  }

  if (isRefusal(error)) return { key: REFUSAL_KEYS[error] };

  return { key: REFUSAL_KEYS.unexpected };
}

/** Every copy key this module can ask for. What `copy.test.ts` checks. */
export const REFUSAL_MESSAGE_KEYS: string[] = [
  ...new Set([
    ...Object.values(REFUSAL_KEYS),
    "errors.noDatesLeftYouPlain",
    "errors.noDatesLeftThem",
    "errors.noDatesLeftThemPlain"
  ])
];

/**
 * A moment as `<input type="datetime-local">` wants it: local wall-clock time,
 * no timezone, minute precision.
 *
 * `toISOString` is the obvious thing to reach for and is wrong here — it is
 * UTC, so an `min` built from it would forbid times that are still in the
 * future for anyone east of Greenwich and allow past ones for anyone west.
 */
export function toLocalInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export type ActionResult = { ok: true } | { ok: false; refusal: RefusalMessage };

async function send(url: string, init: RequestInit): Promise<ActionResult> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    // A dropped connection, not a refusal. Said plainly rather than as
    // "something went wrong", because the member can act on it.
    return { ok: false, refusal: { key: "errors.offline" } };
  }

  if (response.ok) return { ok: true };

  const body = await response.json().catch(() => null);
  return { ok: false, refusal: refusalFor(response.status, body) };
}

const JSON_HEADERS = { "content-type": "application/json" };

export async function loadVirtualDates(): Promise<VirtualDatesView | null> {
  try {
    const response = await fetch("/api/virtual-dates");
    if (!response.ok) return null;
    return (await response.json()) as VirtualDatesView;
  } catch {
    return null;
  }
}

export function inviteToDate(input: {
  matchId: string;
  environment: string;
  scheduledFor: string | null;
}): Promise<ActionResult> {
  return send("/api/virtual-dates", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(input)
  });
}

export function answerInvite(inviteId: string, response: "accept" | "decline") {
  return send(`/api/virtual-dates/${inviteId}`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ response })
  });
}

export function withdrawInvite(inviteId: string): Promise<ActionResult> {
  return send(`/api/virtual-dates/${inviteId}`, { method: "DELETE" });
}
