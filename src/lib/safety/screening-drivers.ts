import {
  NoContentClassifier,
  NoHashMatcher,
  type ContentClassifier,
  type HashMatcher
} from "./screening";

/**
 * Which screening drivers this deployment uses.
 *
 * Shaped like `lib/billing/index.ts`, and for the same reason: the choice is
 * made from the environment, a missing configuration produces a driver that
 * declines rather than one that pretends, and a partial configuration throws at
 * startup instead of half-working.
 *
 * **Both drivers are unwritten, and unwritten rather than stubbed.** What each
 * has to do, so the shape of the work is on the record:
 *
 *   PhotoDNA Cloud Service (hash matcher)
 *       POST the image bytes to the Match endpoint with the subscription key
 *       in `Ocp-Apim-Subscription-Key`. The response says whether it matched
 *       and against which list. Access requires an application and third-party
 *       vetting; it is free for approved organisations. Note that the *cloud*
 *       service means the image is sent to Microsoft — that is a processor
 *       relationship and belongs in the KVKK/GDPR record before it is wired.
 *
 *   Sightengine or AWS Rekognition (classifier)
 *       Sightengine: POST to /1.0/check.json with `models=nudity-2.1,offensive`
 *       and read the class probabilities. Its nudity model separates explicit
 *       from suggestive natively, which is the distinction this product needs.
 *       Rekognition: DetectModerationLabels, then map its label taxonomy onto
 *       `ClassifierCategory` — the mapping is the work, and it is where the
 *       swimsuit-versus-nudity threshold gets decided.
 *
 * Both return the same types the pipeline already consumes, so nothing above
 * this line changes when either lands.
 */

let matcher: HashMatcher | null = null;
let classifier: ContentClassifier | null = null;

export function hashMatcher(): HashMatcher {
  if (matcher) return matcher;

  const key = process.env.PHOTODNA_SUBSCRIPTION_KEY;
  if (!key) return new NoHashMatcher();

  /**
   * Configured but unimplemented throws, rather than falling back to `none`.
   *
   * Someone who has been approved for PhotoDNA and put the key in the
   * environment believes screening is on. A silent fallback would give them a
   * deployment that reports itself unscreened only if they read the health
   * endpoint — and this is the one control where believing it is on when it is
   * off is the whole failure.
   */
  throw new Error(
    "PHOTODNA_SUBSCRIPTION_KEY is set but no PhotoDNA driver is implemented. See docs/PHOTO_SCREENING.md."
  );
}

export function contentClassifier(): ContentClassifier {
  if (classifier) return classifier;

  const sightengine = process.env.SIGHTENGINE_API_SECRET;
  const rekognition = process.env.AWS_REKOGNITION_REGION;

  if (!sightengine && !rekognition) return new NoContentClassifier();

  throw new Error(
    "A classifier is configured but no driver is implemented. See docs/PHOTO_SCREENING.md."
  );
}

/** Test hooks, matching `setPurchaseVerifier`. */
export function setHashMatcher(next: HashMatcher | null): void {
  matcher = next;
}

export function setContentClassifier(next: ContentClassifier | null): void {
  classifier = next;
}

/**
 * Whether uploads must be refused outright when screening is not configured.
 *
 * Off by default, because development and the test suite have no screening and
 * an upload path that cannot be exercised is not a useful default. **On in
 * production, before public signups.** The two states it chooses between:
 *
 *   off — every photo lands `pending` and waits for a person. Safe, because
 *         pending photos are visible only to their owner, but it does not
 *         scale past the number of uploads a human can actually look at.
 *   on  — uploads are refused entirely. The right setting for a deployment
 *         that has opened signups without wiring screening, because a review
 *         queue nobody can keep up with fails silently and gradually.
 *
 * `docs/DEPLOYMENT.md` lists it among the variables to set before launch.
 */
export function screeningRequired(): boolean {
  return process.env.REQUIRE_PHOTO_SCREENING === "true";
}
