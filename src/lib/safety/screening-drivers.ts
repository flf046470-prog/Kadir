import {
  NoContentClassifier,
  NoHashMatcher,
  type ContentClassifier,
  type HashMatcher
} from "./screening";
import { PhotoDnaMatcher } from "./photodna";
import { SightengineClassifier } from "./sightengine";

/**
 * Which screening drivers this deployment uses.
 *
 * Shaped like `lib/billing/index.ts`, and for the same reason: the choice is
 * made from the environment, a missing configuration produces a driver that
 * declines rather than one that pretends, and a partial configuration throws at
 * startup instead of half-working.
 *
 * **Both drivers are written.** `photodna.ts` answers the hash question and
 * `sightengine.ts` the classifier one; each carries the trap it exists around
 * in its own comment — WebP is not a format PhotoDNA accepts, and Sightengine's
 * intensity scores are cumulative rather than independent.
 *
 * Still unwritten, and deliberately: **AWS Rekognition**. It is the move at
 * roughly 30,000 photos a month, where its per-image price wins and there is no
 * monthly floor, and the real work in it is mapping its label taxonomy onto
 * `ClassifierCategory` — which is where the swimsuit-versus-nudity threshold
 * gets decided a second time. Setting `AWS_REKOGNITION_REGION` therefore still
 * throws rather than falling back, for the same reason a configured PhotoDNA
 * key used to: believing screening is on when it is off is the whole failure.
 *
 * A note that belongs beside the key and not only in a document: the *cloud*
 * service means member photos are sent to Microsoft, and the classifier sends
 * them to Sightengine. Both are processor relationships and belong in the
 * KVKK/GDPR record before either is switched on in production.
 */

let matcher: HashMatcher | null = null;
let classifier: ContentClassifier | null = null;

export function hashMatcher(): HashMatcher {
  if (matcher) return matcher;

  const key = process.env.PHOTODNA_SUBSCRIPTION_KEY;
  if (!key) return new NoHashMatcher();

  // Memoised, so one client is shared rather than rebuilt per upload.
  matcher = new PhotoDnaMatcher({ key, endpoint: process.env.PHOTODNA_ENDPOINT });
  return matcher;
}

export function contentClassifier(): ContentClassifier {
  if (classifier) return classifier;

  const user = process.env.SIGHTENGINE_API_USER;
  const secret = process.env.SIGHTENGINE_API_SECRET;
  const rekognition = process.env.AWS_REKOGNITION_REGION;

  if (!user && !secret && !rekognition) return new NoContentClassifier();

  /**
   * Half a Sightengine configuration throws rather than declining.
   *
   * The two values are useless apart, and the failure they would otherwise
   * produce is an authentication error on every upload — which reads as a
   * service outage rather than as a variable somebody forgot to paste.
   */
  if (user || secret) {
    if (!user || !secret) {
      throw new Error(
        "SIGHTENGINE_API_USER and SIGHTENGINE_API_SECRET must both be set, or neither."
      );
    }

    classifier = new SightengineClassifier({ user, secret });
    return classifier;
  }

  throw new Error(
    "AWS_REKOGNITION_REGION is set but no Rekognition driver is implemented. See docs/PHOTO_SCREENING.md."
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
