import sharp from "sharp";
import type { HashMatch, HashMatcher, ScreenedImage } from "./screening";

/**
 * PhotoDNA Cloud Service — the hash matcher.
 *
 * Answers the first of the two screening questions: *is this known child
 * sexual abuse material?* Perceptual hashing against the lists Microsoft
 * maintains with child-protection organisations, so it catches resized,
 * cropped and recoloured copies rather than only byte-exact ones.
 *
 * ---
 *
 * **This driver never answers `matched: false` when it did not get an answer.**
 * Every failure path — network, HTTP status, a service status code, an image it
 * could not prepare — returns `unavailable` with a reason. The distinction is
 * the entire reason `HashMatch` has three cases rather than two: "we checked
 * and it is not on the list" may one day let a photo through an automatic
 * approval path, and "we could not check" never may. Collapsing them here
 * would put that decision in a catch block.
 */

/** Formats the service accepts. Notably **not** WebP, which is what we store. */
const ACCEPTED = new Set(["image/jpeg", "image/png", "image/bmp", "image/gif"]);

/**
 * The service's own floor, and it is a real one: an image under 160×160 is
 * rejected with status 3208 rather than matched against anything.
 *
 * `processUpload` already refuses anything below 200px, so no stored photo can
 * be this small. Kept anyway, because the alternative to a guard here is a
 * driver that reports a service error for a condition it could have named.
 */
const MIN_PIXELS = 160;

/** The service's ceiling. Also 3208. */
const MAX_BYTES = 4 * 1024 * 1024;

/** A hanging screening call holds up an upload, so it does not get to hang. */
const TIMEOUT_MS = 10_000;

const ENDPOINT = "https://api.microsoftmoderator.com/photodna/v1.0/Match";

/** 3000 is the service's "OK". Everything else is a refusal to answer. */
const STATUS_OK = 3000;

type MatchFlag = { Source?: unknown; Violations?: unknown };

export type PhotoDnaOptions = {
  key: string;
  /** Regional endpoints exist (`uk-api.…`); the global one is the default. */
  endpoint?: string;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
};

export class PhotoDnaMatcher implements HashMatcher {
  readonly name = "photodna";

  private readonly key: string;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor({ key, endpoint = ENDPOINT, fetchImpl = fetch }: PhotoDnaOptions) {
    this.key = key;
    this.endpoint = endpoint;
    this.fetchImpl = fetchImpl;
  }

  async match(image: ScreenedImage): Promise<HashMatch> {
    if (image.width < MIN_PIXELS || image.height < MIN_PIXELS) {
      return { unavailable: true, reason: "image_below_160px" };
    }

    let prepared: { body: Buffer; contentType: string };
    try {
      prepared = await prepare(image);
    } catch {
      // A photo sharp cannot re-encode is a photo nothing can check. It stays
      // pending rather than being called clean.
      return { unavailable: true, reason: "transcode_failed" };
    }

    if (prepared.body.byteLength > MAX_BYTES) {
      return { unavailable: true, reason: "image_over_4mb" };
    }

    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": prepared.contentType,
          "Ocp-Apim-Subscription-Key": this.key
        },
        // Raw bytes, not multipart: the service reads the body as the image.
        body: new Uint8Array(prepared.body),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
    } catch (error) {
      const reason = error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network";
      return { unavailable: true, reason };
    }

    if (!response.ok) {
      // The HTTP status, not the body: a 401 from a wrong key and a 429 from
      // rate limiting need different operator responses, and both look
      // identical once flattened to "unavailable".
      return { unavailable: true, reason: `http_${response.status}` };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { unavailable: true, reason: "unparseable_response" };
    }

    return read(payload);
  }
}

/**
 * The bytes, in a format the service accepts.
 *
 * **The stored bytes are WebP and PhotoDNA does not take WebP.** Handing them
 * over unconverted fails every photo with a format error that reads like a bad
 * upload, which is the same trap `ScreenedImage` carries its content type to
 * avoid for Rekognition. So anything outside the accepted set is re-encoded to
 * JPEG.
 *
 * Quality 90 rather than maximum: perceptual hashing is designed to survive
 * re-compression — that is the whole point of it — while a maximum-quality
 * 2048×2048 JPEG can approach the 4MB ceiling for no benefit.
 */
async function prepare(image: ScreenedImage): Promise<{ body: Buffer; contentType: string }> {
  if (ACCEPTED.has(image.contentType)) {
    return { body: image.body, contentType: image.contentType };
  }

  const body = await sharp(image.body).jpeg({ quality: 90 }).toBuffer();
  return { body, contentType: "image/jpeg" };
}

/**
 * The response, read defensively.
 *
 * `IsMatch` is the answer, but only once `Status.Code` says the service
 * actually processed the image — a 200 carrying status 3206 ("could not be
 * verified as an image") also carries `IsMatch: false`, and treating that as
 * "not on the list" would record a photo as checked that was never looked at.
 */
function read(payload: unknown): HashMatch {
  if (typeof payload !== "object" || payload === null) {
    return { unavailable: true, reason: "unparseable_response" };
  }

  const body = payload as Record<string, unknown>;
  const status = body.Status as { Code?: unknown } | undefined;
  const code = typeof status?.Code === "number" ? status.Code : null;

  if (code !== STATUS_OK) {
    return { unavailable: true, reason: `status_${code ?? "missing"}` };
  }

  if (body.IsMatch !== true) return { matched: false };

  return { matched: true, source: sources(body.MatchDetails) };
}

/**
 * Which list matched, for the record.
 *
 * A match is a legal event and what follows it depends on whose list it came
 * from, so the source travels rather than being flattened to a boolean. Several
 * flags can fire at once; all of them are kept, and an unnamed one is recorded
 * as unknown rather than dropped — a match with no readable source is still a
 * match.
 */
function sources(details: unknown): string {
  const flags = (details as { MatchFlags?: unknown } | undefined)?.MatchFlags;
  if (!Array.isArray(flags) || flags.length === 0) return "photodna:unspecified";

  const named = flags
    .map((flag: MatchFlag) => (typeof flag?.Source === "string" ? flag.Source : "unknown"))
    .filter((value, index, all) => all.indexOf(value) === index);

  return `photodna:${named.join(",")}`;
}
