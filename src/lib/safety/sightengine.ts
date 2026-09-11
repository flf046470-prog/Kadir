import type {
  ClassifierCategory,
  ClassifierVerdict,
  ContentClassifier,
  ScreenedImage
} from "./screening";

/**
 * Sightengine — the content classifier.
 *
 * Answers the second screening question: *is this photo acceptable on a dating
 * profile?* Unlike the hash matcher this is a judgement with thresholds, it is
 * wrong in both directions, and its output is advice to a moderation queue
 * rather than a verdict.
 *
 * Chosen over Rekognition for launch because its nudity model separates
 * *explicit* from *suggestive* natively, which is the distinction this product
 * actually needs — a swimsuit photo at the beach is an ordinary dating profile
 * photo, and a classifier that reads it as mild nudity would reject a large
 * share of legitimate uploads. `docs/PHOTO_SCREENING.md` has the cost curve and
 * when to move.
 *
 * ---
 *
 * **The scores are cumulative, and that is the trap.** Sightengine's own
 * documentation is explicit: an image that triggers one intensity level also
 * scores high on every level beneath it, so an explicit photo reports high
 * `erotica` *and* high `very_suggestive` *and* high `suggestive`. Reading them
 * as independent probabilities — summing them, or taking the largest — makes
 * every explicit photo look suggestive too, and a mapping built that way
 * rejects swimsuit photos at whatever threshold catches pornography.
 *
 * So the bands are read from the most severe downward and the first one over
 * threshold wins. Nothing beneath it is consulted.
 */

const ENDPOINT = "https://api.sightengine.com/1.0/check.json";

/** A hanging call holds up an upload. */
const TIMEOUT_MS = 10_000;

/**
 * The models asked for.
 *
 * `nudity-2.1` is the current generation and the one whose bands are read
 * below. `offensive` covers hate symbols and extremist imagery; `gore` covers
 * graphic violence. Each model is billed as an operation, so this is three per
 * photo — which is what `docs/COST_ANALYSIS.md` counts.
 */
const MODELS = "nudity-2.1,offensive,gore";

/**
 * Where a photo stops being a dating photo.
 *
 * `REJECT` is the confidence at which this refuses without a person looking.
 * It is deliberately high: a false rejection is a member losing their photo
 * with no appeal in the moment, and everything under it still reaches the
 * queue rather than being published.
 *
 * `REVIEW` is where it stops being ignorable. Between the two, the verdict is
 * `uncertain` and the note tells the moderator where to start.
 */
const REJECT = 0.85;
const REVIEW = 0.5;

/**
 * The nudity bands, most severe first. Order is load-bearing — see the note on
 * cumulative scores above.
 *
 * `sexual_activity` and `sexual_display` are refusals on any dating product.
 * `erotica` is exposed breasts, which is also a refusal here. The suggestive
 * bands below it are the swimsuit range: they go to a person, never to an
 * automatic rejection, which is why they map to `suggestive` and are held under
 * the reject threshold by the mapping rather than by the number.
 */
const NUDITY_BANDS: ReadonlyArray<{ key: string; category: ClassifierCategory; rejectable: boolean }> = [
  { key: "sexual_activity", category: "explicit", rejectable: true },
  { key: "sexual_display", category: "explicit", rejectable: true },
  { key: "erotica", category: "explicit", rejectable: true },
  { key: "very_suggestive", category: "suggestive", rejectable: false },
  { key: "suggestive", category: "suggestive", rejectable: false }
];

export type SightengineOptions = {
  user: string;
  secret: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
};

export class SightengineClassifier implements ContentClassifier {
  readonly name = "sightengine";

  private readonly user: string;
  private readonly secret: string;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor({ user, secret, endpoint = ENDPOINT, fetchImpl = fetch }: SightengineOptions) {
    this.user = user;
    this.secret = secret;
    this.endpoint = endpoint;
    this.fetchImpl = fetchImpl;
  }

  async classify(image: ScreenedImage): Promise<ClassifierVerdict> {
    const form = new FormData();
    form.append("models", MODELS);
    form.append("api_user", this.user);
    form.append("api_secret", this.secret);
    // WebP is fine here — unlike PhotoDNA, Sightengine accepts it.
    form.append("media", new Blob([new Uint8Array(image.body)], { type: image.contentType }), "photo");

    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
    } catch (error) {
      const reason = error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network";
      return { unavailable: true, reason };
    }

    if (!response.ok) return { unavailable: true, reason: `http_${response.status}` };

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { unavailable: true, reason: "unparseable_response" };
    }

    return read(payload);
  }
}

function probability(source: unknown, key: string): number {
  const value = (source as Record<string, unknown> | undefined)?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * The response, mapped onto a verdict.
 *
 * Sightengine reports failure inside a 200 — `status: "failure"` with an error
 * object — so the status field is checked before anything is read from the
 * models. A failed call whose scores are all absent would otherwise read as a
 * clean photo, which is the classifier equivalent of the status-code trap in
 * the PhotoDNA driver.
 */
function read(payload: unknown): ClassifierVerdict {
  if (typeof payload !== "object" || payload === null) {
    return { unavailable: true, reason: "unparseable_response" };
  }

  const body = payload as Record<string, unknown>;

  if (body.status !== "success") {
    const error = body.error as { message?: unknown } | undefined;
    const detail = typeof error?.message === "string" ? error.message : "unknown";
    return { unavailable: true, reason: `service_${detail}` };
  }

  const worst = severest(body);
  if (!worst) return { decision: "clean" };

  if (worst.rejectable && worst.confidence >= REJECT) {
    return { decision: "reject", category: worst.category, confidence: worst.confidence };
  }

  if (worst.confidence >= REVIEW) {
    return { decision: "uncertain", category: worst.category, confidence: worst.confidence };
  }

  return { decision: "clean" };
}

type Finding = { category: ClassifierCategory; confidence: number; rejectable: boolean };

/**
 * The most severe thing in the photo.
 *
 * Nudity is walked from the top down and stops at the first band over the
 * review threshold, because the bands beneath it are raised by that same band
 * rather than by anything independently present. Violence and hate symbols are
 * separate models and are compared on their own numbers.
 */
function severest(body: Record<string, unknown>): Finding | null {
  const nudity = body.nudity;

  for (const band of NUDITY_BANDS) {
    const confidence = probability(nudity, band.key);
    if (confidence >= REVIEW) {
      return { category: band.category, confidence, rejectable: band.rejectable };
    }
  }

  const gore = probability(body.gore, "prob");
  const offensive = Math.max(
    probability(body.offensive, "nazi"),
    probability(body.offensive, "supremacist"),
    probability(body.offensive, "terrorist")
  );

  if (gore >= REVIEW && gore >= offensive) {
    return { category: "violence", confidence: gore, rejectable: true };
  }

  if (offensive >= REVIEW) {
    return { category: "hate_symbols", confidence: offensive, rejectable: true };
  }

  return null;
}
