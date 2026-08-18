import { matchesUnnegated } from "./copy-guards";

/**
 * Date Safety Mode — lets a member record a planned meeting and, if they
 * choose, share the details with one trusted contact.
 *
 * FioreMatch is not an emergency service and must never present itself as one.
 * This feature stores a plan and can notify a contact the member chose; it does
 * not monitor them, does not call anyone, and does not respond to incidents.
 * Every surface that renders this must carry `EMERGENCY_DISCLAIMER`.
 */

export const EMERGENCY_DISCLAIMER_KEY = "safety.dateSafety.notEmergencyService";

export type DatePlanStatus = "planned" | "started" | "completed" | "cancelled";

export type TrustedContact = {
  name: string;
  /** Contact channel the member supplied. Stored encrypted at rest. */
  channel: "sms" | "email";
  destination: string;
};

export type DatePlan = {
  id: string;
  /** The match this plan refers to. */
  matchProfileId: string;
  /** ISO timestamp of the planned meeting. */
  scheduledFor: string;
  /** Free-text place name as the member typed it. Never a precise coordinate. */
  locationLabel: string;
  status: DatePlanStatus;
  /** Null until the member explicitly opts to share. */
  sharedWith: TrustedContact | null;
  /** Set when the member marks the date started/completed themselves. */
  startedAt: string | null;
  completedAt: string | null;
};

const ALLOWED_TRANSITIONS: Record<DatePlanStatus, DatePlanStatus[]> = {
  planned: ["started", "cancelled"],
  started: ["completed", "cancelled"],
  completed: [],
  cancelled: []
};

export function canTransition(from: DatePlanStatus, to: DatePlanStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export type ShareDecision = {
  /** Whether the trusted contact receives the plan details. */
  notify: boolean;
  /** What we are permitted to include in that notification. */
  fields: ("matchFirstName" | "scheduledFor" | "locationLabel")[];
};

/**
 * Sharing is opt-in per plan and never implicit. With no explicit share, we
 * send nothing at all — a plan recorded privately stays private.
 */
export function resolveShare(plan: DatePlan, memberOptedIn: boolean): ShareDecision {
  if (!memberOptedIn || plan.sharedWith === null) {
    return { notify: false, fields: [] };
  }

  return {
    notify: true,
    fields: ["matchFirstName", "scheduledFor", "locationLabel"]
  };
}

/**
 * Copy guard — Date Safety must never describe FioreMatch as responding to an
 * emergency. Directing members to real emergency services is encouraged, so
 * these patterns target claims about what *we* will do, not mentions of
 * emergency services in general.
 *
 * Enforced by test so the wording can't drift into an implied guarantee.
 */
export const FORBIDDEN_EMERGENCY_CLAIMS: RegExp[] = [
  /\b(we|fiorematch)\b[^.!?]{0,40}\b(are|is|provide[sd]?|act as)\b[^.!?]{0,20}\bemergency (service|responder)/i,
  /\b(we|fiorematch)\b[^.!?]{0,40}\bwill\b[^.!?]{0,30}\b(call|contact|alert)\b[^.!?]{0,20}\b(the )?(police|authorities|emergency services)\b/i,
  /\b(we|fiorematch)\b[^.!?]{0,40}\b(monitor|track|watch)\b[^.!?]{0,20}\byour (date|meeting|location)\b/i,
  /\b(we|fiorematch)\b[^.!?]{0,40}\b(rescue|protect)\b[^.!?]{0,20}\byou\b/i,
  /\bguaranteed (protection|safety)\b/i
];

export function containsForbiddenEmergencyClaim(text: string): boolean {
  return FORBIDDEN_EMERGENCY_CLAIMS.some((pattern) => matchesUnnegated(text, pattern));
}
