import { describe, expect, it } from "vitest";
import {
  ANDROID_PACKAGE,
  appleAppSiteAssociation,
  assetLinks,
  normaliseFingerprint
} from "./app-links";

const VALID = "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89";

describe("fingerprints", () => {
  it("accepts the shape keytool prints", () => {
    expect(normaliseFingerprint(VALID)).toBe(VALID);
  });

  it("upper-cases and trims, because people paste from a terminal", () => {
    expect(normaliseFingerprint(`  ${VALID.toLowerCase()}\n`)).toBe(VALID);
  });

  it("refuses anything that is not 32 hex pairs", () => {
    expect(normaliseFingerprint("AB:CD")).toBeNull();
    expect(normaliseFingerprint(VALID.replace(/:/g, ""))).toBeNull();
    expect(normaliseFingerprint(VALID + ":FF")).toBeNull();
    expect(normaliseFingerprint("not a fingerprint")).toBeNull();
  });
});

describe("assetlinks.json", () => {
  it("is null when nothing is configured, so the route can 404", () => {
    // Serving a placeholder would be worse than serving nothing: Android
    // caches a failed verification and stops retrying.
    expect(assetLinks(undefined)).toBeNull();
    expect(assetLinks("")).toBeNull();
    expect(assetLinks("garbage")).toBeNull();
  });

  it("declares the package and its fingerprint", () => {
    const [entry] = assetLinks(VALID) as [{ target: Record<string, unknown> }];
    expect(entry.target.package_name).toBe(ANDROID_PACKAGE);
    expect(entry.target.sha256_cert_fingerprints).toEqual([VALID]);
  });

  it("carries both the upload key and Play's signing key", () => {
    // Listing only one verifies for exactly half the installs.
    const other = VALID.replace(/^AB/, "FF");
    const [entry] = assetLinks(`${VALID}, ${other}`) as [{ target: Record<string, unknown> }];
    expect(entry.target.sha256_cert_fingerprints).toEqual([VALID, other]);
  });

  it("drops an unusable entry rather than emitting a broken file", () => {
    const [entry] = assetLinks(`${VALID},nonsense`) as [{ target: Record<string, unknown> }];
    expect(entry.target.sha256_cert_fingerprints).toEqual([VALID]);
  });
});

describe("apple-app-site-association", () => {
  it("is null without a team id", () => {
    expect(appleAppSiteAssociation(undefined)).toBeNull();
    expect(appleAppSiteAssociation("SHORT")).toBeNull();
    expect(appleAppSiteAssociation("TOOLONGTEAMID")).toBeNull();
  });

  it("declares the fully qualified app id", () => {
    const json = appleAppSiteAssociation("A1B2C3D4E5") as {
      applinks: { details: [{ appIDs: string[] }] };
    };
    expect(json.applinks.details[0].appIDs).toEqual(["A1B2C3D4E5.com.fiorematch.app"]);
  });

  it("excludes the data endpoints, which have no screen to open", () => {
    const json = appleAppSiteAssociation("A1B2C3D4E5") as {
      applinks: { details: [{ components: Array<Record<string, unknown>> }] };
    };
    const [first] = json.applinks.details[0].components;
    expect(first).toMatchObject({ "/": "/api/*", exclude: true });
  });
});
