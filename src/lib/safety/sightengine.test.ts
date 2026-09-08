import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { SightengineClassifier } from "./sightengine";
import type { ScreenedImage } from "./screening";

async function photo(): Promise<ScreenedImage> {
  const body = await sharp({
    create: { width: 400, height: 400, channels: 3, background: { r: 9, g: 9, b: 9 } }
  })
    .webp()
    .toBuffer();

  return { body, contentType: "image/webp", width: 400, height: 400 };
}

function respond(payload: unknown, init: ResponseInit = { status: 200 }) {
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify(payload), init)
  );
}

/** A success envelope with every band at zero, so each test sets only its own. */
function scores(nudity: Record<string, number> = {}, rest: Record<string, unknown> = {}) {
  return {
    status: "success",
    nudity: {
      sexual_activity: 0,
      sexual_display: 0,
      erotica: 0,
      very_suggestive: 0,
      suggestive: 0,
      mildly_suggestive: 0,
      none: 1,
      ...nudity
    },
    gore: { prob: 0 },
    offensive: { nazi: 0, supremacist: 0, terrorist: 0 },
    ...rest
  };
}

const classifier = (fetchImpl: ReturnType<typeof respond>) =>
  new SightengineClassifier({ user: "u", secret: "s", fetchImpl });

describe("the Sightengine classifier", () => {
  it("posts the image with the credentials and the models it needs", async () => {
    const fetchImpl = respond(scores());
    await classifier(fetchImpl).classify(await photo());

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/1.0/check.json");
    expect(init.method).toBe("POST");

    const form = init.body as FormData;
    expect(form.get("api_user")).toBe("u");
    expect(form.get("api_secret")).toBe("s");
    expect(form.get("models")).toContain("nudity-2.1");
    expect(form.get("media")).toBeInstanceOf(Blob);
  });

  it("passes a clean photo", async () => {
    const result = await classifier(respond(scores())).classify(await photo());
    expect(result).toEqual({ decision: "clean" });
  });

  it("refuses explicit content", async () => {
    const result = await classifier(respond(scores({ sexual_display: 0.97 }))).classify(await photo());
    expect(result).toEqual({ decision: "reject", category: "explicit", confidence: 0.97 });
  });

  /**
   * The defect this mapping is shaped around.
   *
   * Sightengine's scores are cumulative — its own documentation says an image
   * that triggers a level also scores high on every level beneath it. So a
   * pornographic photo reports `sexual_display: 0.97` *and* `very_suggestive:
   * 0.95` *and* `suggestive: 0.93`.
   *
   * A mapping that took the largest score, or summed them, or checked the
   * suggestive bands first would answer "suggestive" for that photo — and to
   * catch it at all you would then have to drop the suggestive threshold to
   * where it also catches every swimsuit photo on the product. Reading from
   * the most severe band downward is what keeps those two apart.
   */
  it("calls a cumulative explicit score explicit, not suggestive", async () => {
    const result = await classifier(
      respond(scores({ sexual_display: 0.97, very_suggestive: 0.95, suggestive: 0.93 }))
    ).classify(await photo());

    expect(result).toEqual({ decision: "reject", category: "explicit", confidence: 0.97 });
  });

  /**
   * The other half of the same decision, and the one that costs members.
   *
   * A swimsuit photo at the beach is an ordinary dating profile photo. It goes
   * to a person; it is never refused automatically, however confident the
   * model is — which is why the suggestive bands are marked unrejectable
   * rather than simply held under a threshold.
   */
  it("sends a confident suggestive photo to a person rather than refusing it", async () => {
    const result = await classifier(
      respond(scores({ very_suggestive: 0.99, suggestive: 0.98 }))
    ).classify(await photo());

    expect(result).toEqual({ decision: "uncertain", category: "suggestive", confidence: 0.99 });
  });

  it("ignores nudity scores under the review threshold", async () => {
    const result = await classifier(
      respond(scores({ suggestive: 0.2, mildly_suggestive: 0.4 }))
    ).classify(await photo());

    expect(result).toEqual({ decision: "clean" });
  });

  it("refuses graphic violence", async () => {
    const result = await classifier(
      respond(scores({}, { gore: { prob: 0.93 } }))
    ).classify(await photo());

    expect(result).toEqual({ decision: "reject", category: "violence", confidence: 0.93 });
  });

  it("refuses hate symbols, reading the strongest of the offensive signals", async () => {
    const result = await classifier(
      respond(scores({}, { offensive: { nazi: 0.91, supremacist: 0.4, terrorist: 0.2 } }))
    ).classify(await photo());

    expect(result).toEqual({ decision: "reject", category: "hate_symbols", confidence: 0.91 });
  });

  it("holds a middling explicit score for review rather than refusing it", async () => {
    const result = await classifier(respond(scores({ erotica: 0.6 }))).classify(await photo());
    expect(result).toEqual({ decision: "uncertain", category: "explicit", confidence: 0.6 });
  });

  /**
   * Sightengine reports failure *inside* a 200.
   *
   * With the status unchecked, a failed call carries no model scores, every
   * band reads zero, and the photo comes back clean — the classifier version
   * of the PhotoDNA status-code trap.
   */
  it("never calls a photo clean when the service reported a failure", async () => {
    const fetchImpl = respond({ status: "failure", error: { message: "invalid media" } });
    const result = await classifier(fetchImpl).classify(await photo());

    expect(result).toEqual({ unavailable: true, reason: "service_invalid media" });
  });

  it("survives an HTTP failure, a network failure and a timeout without answering", async () => {
    expect(await classifier(respond({}, { status: 402 })).classify(await photo())).toEqual({
      unavailable: true,
      reason: "http_402"
    });

    const dead = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(
      await new SightengineClassifier({ user: "u", secret: "s", fetchImpl: dead }).classify(
        await photo()
      )
    ).toEqual({ unavailable: true, reason: "network" });

    const slow = vi.fn(async () => {
      const error = new Error("timed out");
      error.name = "TimeoutError";
      throw error;
    });
    expect(
      await new SightengineClassifier({ user: "u", secret: "s", fetchImpl: slow }).classify(
        await photo()
      )
    ).toEqual({ unavailable: true, reason: "timeout" });
  });
});
