import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { contentClassifier, hashMatcher, screeningRequired, setContentClassifier, setHashMatcher } from "./screening-drivers";

const KEYS = [
  "PHOTODNA_SUBSCRIPTION_KEY",
  "SIGHTENGINE_API_USER",
  "SIGHTENGINE_API_SECRET",
  "AWS_REKOGNITION_REGION",
  "REQUIRE_PHOTO_SCREENING"
] as const;

const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

beforeEach(() => {
  for (const key of KEYS) delete process.env[key];
  // The selectors memoise; the hooks are how a test gets a clean one.
  setHashMatcher(null);
  setContentClassifier(null);
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  setHashMatcher(null);
  setContentClassifier(null);
});

describe("choosing screening drivers", () => {
  it("declines rather than pretends when nothing is configured", () => {
    expect(hashMatcher().name).toBe("none");
    expect(contentClassifier().name).toBe("none");
  });

  it("builds the PhotoDNA matcher once the key is set", () => {
    process.env.PHOTODNA_SUBSCRIPTION_KEY = "key";
    expect(hashMatcher().name).toBe("photodna");
  });

  it("builds the Sightengine classifier once both halves are set", () => {
    process.env.SIGHTENGINE_API_USER = "u";
    process.env.SIGHTENGINE_API_SECRET = "s";
    expect(contentClassifier().name).toBe("sightengine");
  });

  /**
   * Half a configuration is the case worth failing loudly on.
   *
   * With one of the two present the driver would build and then fail
   * authentication on every single upload — an error that reads as a Sightengine
   * outage rather than as a variable somebody forgot to paste, and which would
   * be diagnosed against the wrong system.
   */
  it("refuses half a Sightengine configuration", () => {
    process.env.SIGHTENGINE_API_USER = "u";
    expect(() => contentClassifier()).toThrow(/both be set/);

    setContentClassifier(null);
    delete process.env.SIGHTENGINE_API_USER;
    process.env.SIGHTENGINE_API_SECRET = "s";
    expect(() => contentClassifier()).toThrow(/both be set/);
  });

  /**
   * Rekognition is the only driver still unwritten, and a configured-but-absent
   * driver must never fall back to `none`: someone who set the variable
   * believes screening is on.
   */
  it("throws for a configured Rekognition, which has no driver", () => {
    process.env.AWS_REKOGNITION_REGION = "eu-central-1";
    expect(() => contentClassifier()).toThrow(/no Rekognition driver/);
  });

  it("reuses one client rather than rebuilding it per upload", () => {
    process.env.PHOTODNA_SUBSCRIPTION_KEY = "key";
    expect(hashMatcher()).toBe(hashMatcher());
  });

  it("requires screening only when the flag says exactly true", () => {
    expect(screeningRequired()).toBe(false);
    process.env.REQUIRE_PHOTO_SCREENING = "false";
    expect(screeningRequired()).toBe(false);
    process.env.REQUIRE_PHOTO_SCREENING = "1";
    expect(screeningRequired()).toBe(false);
    process.env.REQUIRE_PHOTO_SCREENING = "true";
    expect(screeningRequired()).toBe(true);
  });
});
