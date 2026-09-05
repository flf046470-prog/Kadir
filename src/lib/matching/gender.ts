import type { GenderId } from "@/lib/domain/taxonomies";

/**
 * Who may be shown to whom.
 *
 * The rule is **mutual**, and that is the whole design: a viewer sees a
 * candidate only if the viewer is seeking the candidate's gender *and* the
 * candidate is seeking the viewer's. One-sided filtering — showing you everyone
 * you are interested in, regardless of whether they could be interested in you —
 * fills a feed with people who will never see you back. It looks like a bigger
 * product and behaves like a smaller one, because every like it produces is
 * dead on arrival.
 *
 * It also has a specific cost for the people least well served elsewhere: under
 * one-sided filtering, a member whose gender few people are seeking sees a full
 * feed and gets no matches, with nothing telling them why.
 */

export type GenderPreference = {
  /** Null when the member has not answered yet. */
  gender: GenderId | null;
  /** Empty when the member has not answered, meaning "no preference". */
  seeking: GenderId[];
};

/**
 * Unanswered means "no constraint", on both sides.
 *
 * This is what makes introducing the field safe. The alternative — treating an
 * empty preference as "seeking nobody" — would empty Discover for every member
 * who existed before the field did, on the deploy that added it, and the
 * symptom would be "the app has no users" rather than "a column is null".
 *
 * The asymmetry to notice: an unanswered *viewer* sees everyone, and an
 * unanswered *candidate* is shown to everyone. Both are the permissive reading,
 * and both stop applying the moment the member answers.
 */
export function discoverableBy(viewer: GenderPreference, candidate: GenderPreference): boolean {
  return wants(viewer, candidate.gender) && wants(candidate, viewer.gender);
}

function wants(member: GenderPreference, gender: GenderId | null): boolean {
  if (member.seeking.length === 0) return true;
  if (gender === null) return true;
  return member.seeking.includes(gender);
}

/**
 * Whether this member has enough answered to be filtered on at all.
 *
 * Used to decide whether to ask them, not to decide whether to show them.
 */
export function hasStatedPreference(member: GenderPreference): boolean {
  return member.gender !== null && member.seeking.length > 0;
}
