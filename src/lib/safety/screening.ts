/**
 * Automated photo screening.
 *
 * **Two different questions, asked of two different systems, and conflating
 * them is the mistake this file exists to prevent.**
 *
 * The first is *is this known child sexual abuse material?* That is answered by
 * perceptual hash matching against a database of hashes law enforcement and
 * child-protection organisations maintain. It is not a judgement call, it has
 * no threshold to tune, and a match is a legal event rather than a moderation
 * decision: the upload is refused, nothing is published, and what happens next
 * is governed by law in the jurisdictions the product serves.
 *
 * The second is *is this photo acceptable on a dating profile?* That is a
 * classifier, it has thresholds, it is wrong in both directions, and its output
 * is advice to a moderation queue.
 *
 * A single "is this bad?" interface across both would force one threshold onto
 * two problems, and the one it would get wrong is the first.
 *
 * ---
 *
 * **Nothing here is stubbed.** Both drivers default to declining, and declining
 * leaves a photo `pending` — visible only to its owner, exactly as today. A
 * driver that returned "clean" without asking anything would be worse than no
 * driver at all: it would turn the moderation queue, which is currently the
 * thing keeping unscreened photos off the product, into an empty list that
 * looks like success.
 *
 * See `docs/PHOTO_SCREENING.md` for which services fit these two interfaces and
 * what each driver has to do.
 */

/**
 * The answer to "is this known illegal material?".
 *
 * Deliberately not an enum with a "maybe": perceptual hash matching answers yes
 * or no against a specific list, and a driver that cannot answer says so with
 * `unavailable` rather than guessing.
 */
export type HashMatch =
  | { matched: true; /** Which list, so a match is traceable to its source. */ source: string }
  | { matched: false }
  | { unavailable: true; reason: string };

export interface HashMatcher {
  /** `"none"` when nothing is configured. Ops asserts on this before launch. */
  readonly name: string;
  match(image: Buffer): Promise<HashMatch>;
}

/**
 * No matcher configured.
 *
 * Answers `unavailable`, never `matched: false`. The difference is the whole
 * point: "we checked and it is not on the list" and "we did not check" must not
 * be the same value, because the first is allowed to let a photo through a
 * future automatic-approval path and the second never is.
 */
export class NoHashMatcher implements HashMatcher {
  readonly name = "none";

  async match(): Promise<HashMatch> {
    return { unavailable: true, reason: "no_hash_matcher_configured" };
  }
}

/** What a classifier found, before anything decides what to do about it. */
export type ClassifierVerdict =
  | {
      /** Confident the photo is unacceptable. */
      decision: "reject";
      /** For the moderation note and the member's explanation. */
      category: ClassifierCategory;
      /** 0–1, as the provider reported it. */
      confidence: number;
    }
  | { decision: "clean" }
  | { decision: "uncertain"; category: ClassifierCategory; confidence: number }
  | { unavailable: true; reason: string };

/**
 * The categories a dating product actually has to separate.
 *
 * `suggestive` is its own value rather than a low-confidence `explicit`,
 * because on this product they have different answers: a swimsuit photo at the
 * beach is an ordinary dating profile photo and a classifier that treats it as
 * mild nudity would reject a large share of legitimate uploads. Explicit
 * content is refused; suggestive content goes to a person.
 */
export const CLASSIFIER_CATEGORIES = [
  "explicit",
  "suggestive",
  "violence",
  "hate_symbols",
  "drugs",
  "other"
] as const;

export type ClassifierCategory = (typeof CLASSIFIER_CATEGORIES)[number];

export interface ContentClassifier {
  readonly name: string;
  classify(image: Buffer): Promise<ClassifierVerdict>;
}

export class NoContentClassifier implements ContentClassifier {
  readonly name = "none";

  async classify(): Promise<ClassifierVerdict> {
    return { unavailable: true, reason: "no_classifier_configured" };
  }
}

/**
 * What screening concluded, for one photo.
 *
 * `blocked` is separated from `rejected` because the two are different events
 * with different obligations. A rejected photo is a moderation outcome the
 * member can be told about and can appeal. A blocked one is a hash match, and
 * what the member is told, what is retained, and who is notified are legal
 * questions rather than product ones.
 */
export type ScreeningOutcome =
  | { status: "blocked"; source: string }
  | { status: "rejected"; category: ClassifierCategory; confidence: number }
  | { status: "review"; note: string };

/**
 * Screens one photo.
 *
 * Order matters and is not an optimisation: the hash match runs first, and a
 * match short-circuits before the classifier is asked. Sending known illegal
 * material to a second commercial provider for a second opinion serves no
 * purpose and widens who is handling it.
 *
 * **Nothing here returns "approved".** The most permissive outcome is
 * `review`, which is what a photo already gets today. Automatic approval is a
 * separate decision that needs a measured false-negative rate on this
 * product's own uploads, and shipping it as a default would mean the first
 * photo that fooled the classifier reached members with nobody having looked.
 */
export async function screenPhoto(
  image: Buffer,
  matcher: HashMatcher,
  classifier: ContentClassifier
): Promise<ScreeningOutcome> {
  const hash = await matcher.match(image);

  if ("matched" in hash && hash.matched) {
    return { status: "blocked", source: hash.source };
  }

  const classified = await classifier.classify(image);

  if ("decision" in classified && classified.decision === "reject") {
    return {
      status: "rejected",
      category: classified.category,
      confidence: classified.confidence
    };
  }

  return { status: "review", note: reviewNote(hash, classified) };
}

/**
 * Why this photo is waiting for a person, in a form a moderator can read.
 *
 * A queue where every item says "pending" tells the reviewer nothing about
 * where to start. "unchecked" and "clean, second opinion wanted" are different
 * items and should not look identical in a list of two hundred.
 */
function reviewNote(hash: HashMatch, classified: ClassifierVerdict): string {
  const parts: string[] = [];

  if ("unavailable" in hash) parts.push(`hash:${hash.reason}`);
  else parts.push("hash:no_match");

  if ("unavailable" in classified) parts.push(`classifier:${classified.reason}`);
  else if (classified.decision === "uncertain") {
    parts.push(`classifier:${classified.category}@${classified.confidence.toFixed(2)}`);
  } else {
    parts.push("classifier:clean");
  }

  return parts.join(" ");
}

/**
 * Whether this deployment screens photos at all.
 *
 * Both drivers have to be configured for this to be true. One without the
 * other is not "partly screened": a classifier alone does not detect known
 * illegal material, and a hash matcher alone does not detect anything that is
 * not already on a list.
 */
export function screeningConfigured(
  matcher: HashMatcher,
  classifier: ContentClassifier
): boolean {
  return matcher.name !== "none" && classifier.name !== "none";
}
