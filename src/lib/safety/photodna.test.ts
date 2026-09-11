import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { PhotoDnaMatcher } from "./photodna";
import type { ScreenedImage } from "./screening";

/** A real WebP, because "the bytes are WebP" is the thing under test. */
async function webp(width = 400, height = 400): Promise<ScreenedImage> {
  const body = await sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 120, b: 160 } }
  })
    .webp()
    .toBuffer();

  return { body, contentType: "image/webp", width, height };
}

/** Typed like `fetch`, so the recorded call can be read back as one. */
function respond(payload: unknown, init: ResponseInit = { status: 200 }) {
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify(payload), init)
  );
}

const OK = { Status: { Code: 3000 }, TrackingId: "t-1", IsMatch: false };

describe("the PhotoDNA matcher", () => {
  it("sends the image as raw bytes under the subscription key", async () => {
    const fetchImpl = respond(OK);
    await new PhotoDnaMatcher({ key: "secret-key", fetchImpl }).match(await webp());

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/photodna/v1.0/Match");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Ocp-Apim-Subscription-Key"]).toBe("secret-key");
    expect(init.body).toBeInstanceOf(Uint8Array);
  });

  /**
   * The trap this driver exists around.
   *
   * Every stored photo is WebP — `processUpload` re-encodes to strip EXIF — and
   * PhotoDNA accepts JPEG, PNG, BMP and GIF only. Sent unconverted, every
   * single photo fails with a format error that reads like a corrupt upload
   * rather than a wrong content type.
   */
  it("re-encodes WebP, which the service does not accept", async () => {
    const fetchImpl = respond(OK);
    await new PhotoDnaMatcher({ key: "k", fetchImpl }).match(await webp());

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("image/jpeg");

    // Not merely relabelled: the bytes really are a JPEG now.
    const sent = Buffer.from(init.body as Uint8Array);
    expect((await sharp(sent).metadata()).format).toBe("jpeg");
  });

  it("sends an accepted format through untouched", async () => {
    const fetchImpl = respond(OK);
    const body = await sharp({
      create: { width: 300, height: 300, channels: 3, background: { r: 1, g: 2, b: 3 } }
    })
      .png()
      .toBuffer();

    await new PhotoDnaMatcher({ key: "k", fetchImpl }).match({
      body,
      contentType: "image/png",
      width: 300,
      height: 300
    });

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("image/png");
    expect(Buffer.from(init.body as Uint8Array).equals(body)).toBe(true);
  });

  it("reports a match with the list it came from", async () => {
    const fetchImpl = respond({
      Status: { Code: 3000 },
      IsMatch: true,
      MatchDetails: { MatchFlags: [{ Source: "NCMEC", Violations: ["CSAM"] }] }
    });

    const result = await new PhotoDnaMatcher({ key: "k", fetchImpl }).match(await webp());
    expect(result).toEqual({ matched: true, source: "photodna:NCMEC" });
  });

  it("keeps every source when several flags fire", async () => {
    const fetchImpl = respond({
      Status: { Code: 3000 },
      IsMatch: true,
      MatchDetails: { MatchFlags: [{ Source: "NCMEC" }, { Source: "IWF" }, { Source: "NCMEC" }] }
    });

    const result = await new PhotoDnaMatcher({ key: "k", fetchImpl }).match(await webp());
    expect(result).toEqual({ matched: true, source: "photodna:NCMEC,IWF" });
  });

  it("still reports a match when the source is unreadable", async () => {
    const fetchImpl = respond({ Status: { Code: 3000 }, IsMatch: true, MatchDetails: {} });

    const result = await new PhotoDnaMatcher({ key: "k", fetchImpl }).match(await webp());
    expect(result).toEqual({ matched: true, source: "photodna:unspecified" });
  });

  it("reports a clean image as not matched", async () => {
    const fetchImpl = respond(OK);
    expect(await new PhotoDnaMatcher({ key: "k", fetchImpl }).match(await webp())).toEqual({
      matched: false
    });
  });

  /**
   * The invariant the whole file is built around.
   *
   * A 200 carrying status 3206 — "the given file could not be verified as an
   * image" — also carries `IsMatch: false`. Reading the boolean without
   * checking the status would record that photo as checked and clean when the
   * service never looked at it, which is the one failure mode this control
   * exists to prevent.
   */
  it("never calls a photo clean when the service refused to process it", async () => {
    for (const code of [3002, 3004, 3206, 3208]) {
      const fetchImpl = respond({ Status: { Code: code }, IsMatch: false });
      const result = await new PhotoDnaMatcher({ key: "k", fetchImpl }).match(await webp());

      expect(result).toEqual({ unavailable: true, reason: `status_${code}` });
    }
  });

  it("distinguishes HTTP failures so an operator can tell them apart", async () => {
    for (const status of [401, 429, 500]) {
      const fetchImpl = respond({}, { status });
      const result = await new PhotoDnaMatcher({ key: "k", fetchImpl }).match(await webp());

      expect(result).toEqual({ unavailable: true, reason: `http_${status}` });
    }
  });

  it("survives a network failure without answering", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });

    expect(await new PhotoDnaMatcher({ key: "k", fetchImpl }).match(await webp())).toEqual({
      unavailable: true,
      reason: "network"
    });
  });

  it("names a timeout as a timeout", async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error("timed out");
      error.name = "TimeoutError";
      throw error;
    });

    expect(await new PhotoDnaMatcher({ key: "k", fetchImpl }).match(await webp())).toEqual({
      unavailable: true,
      reason: "timeout"
    });
  });

  it("survives a response that is not JSON", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>gateway</html>", { status: 200 }));

    expect(await new PhotoDnaMatcher({ key: "k", fetchImpl }).match(await webp())).toEqual({
      unavailable: true,
      reason: "unparseable_response"
    });
  });

  /** Under the service's own floor, named here rather than reported as its error. */
  it("declines an image below the service's 160px minimum without calling it", async () => {
    const fetchImpl = respond(OK);
    const result = await new PhotoDnaMatcher({ key: "k", fetchImpl }).match(await webp(120, 400));

    expect(result).toEqual({ unavailable: true, reason: "image_below_160px" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("declines bytes it cannot re-encode", async () => {
    const fetchImpl = respond(OK);
    const result = await new PhotoDnaMatcher({ key: "k", fetchImpl }).match({
      body: Buffer.from("not an image at all"),
      contentType: "image/webp",
      width: 400,
      height: 400
    });

    expect(result).toEqual({ unavailable: true, reason: "transcode_failed" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
