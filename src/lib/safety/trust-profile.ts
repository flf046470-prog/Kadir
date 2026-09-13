import type { VerificationId } from "../domain/taxonomies";
import { containsUnnegated } from "./copy-guards";

/**
 * Trust Profile — shows which verifications a member has actually completed.
 *
 * Rules:
 *  - A badge is shown only for a verification that genuinely passed.
 *  - There is no aggregate "safety score" and no "100% safe" claim. Verification
 *    confirms a specific fact (this email works, this face matches this photo);
 *    it does not certify a person's intentions.
 *  - Unverified members are not marked as suspicious. Absence of a badge means
 *    absence of a check, nothing more.
 */

export type VerificationState = {
  id: VerificationId;
  verifiedAt: string | null;
};

/** Badges are only ever derived from verifications with a real timestamp. */
export function earnedBadges(states: readonly VerificationState[]): VerificationId[] {
  return states.filter((state) => state.verifiedAt !== null).map((state) => state.id);
}

/**
 * Verification strength ordering, used to decide which badge to feature when
 * space is tight. This is a display concern only — it is never summed into a
 * score, and never used to rank members in Discover.
 */
const DISPLAY_PRIORITY: VerificationId[] = ["identity", "liveness", "photo", "phone", "email"];

export function primaryBadge(states: readonly VerificationState[]): VerificationId | null {
  const earned = new Set(earnedBadges(states));
  return DISPLAY_PRIORITY.find((id) => earned.has(id)) ?? null;
}

/**
 * Copy guard: these phrases must never appear alongside a Trust Profile. Kept
 * in code so the rule is testable rather than a convention someone forgets.
 */
export const FORBIDDEN_TRUST_CLAIMS = [
  "100% safe",
  "completely safe",
  "guaranteed safe",
  "verified safe",
  "risk-free",
  "safety score"
];

export function containsForbiddenTrustClaim(text: string): boolean {
  return FORBIDDEN_TRUST_CLAIMS.some((phrase) => containsUnnegated(text, phrase));
}
