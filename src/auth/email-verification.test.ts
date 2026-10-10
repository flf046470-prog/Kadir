import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  VERIFICATION_TTL_HOURS,
  emailVerificationRequired,
  verificationLink
} from "./email-verification";

const KEYS = ["REQUIRE_EMAIL_VERIFICATION"] as const;
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

beforeEach(() => {
  for (const key of KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("the verification link", () => {
  it("is locale-prefixed, like every other page on the site", () => {
    expect(verificationLink("tok", "tr")).toBe(
      "https://fiorematch.com/tr/verify-email?token=tok"
    );
  });

  /**
   * Tokens are base64url, which contains `-` and `_` but never `+`, `/` or
   * `=`. Encoding is therefore a no-op today — and the guard that keeps this
   * correct if `generateToken` is ever changed to an encoding that is not
   * URL-safe, which would otherwise produce links that work for most members
   * and silently fail for a few.
   */
  it("percent-encodes the token", () => {
    expect(verificationLink("a+b/c=", "en")).toBe(
      "https://fiorematch.com/en/verify-email?token=a%2Bb%2Fc%3D"
    );
  });

  /**
   * `SITE_URL` is read once at import, so this cannot be driven from the
   * environment here — the assertion is on the invariant itself: whatever the
   * origin, exactly one slash separates it from the locale. A deployment that
   * sets `SITE_URL=https://app.fiorematch.com/` would otherwise mail links
   * with `//tr/verify-email`, which resolve for most clients and are rewritten
   * by some into a path that 404s.
   */
  it("separates origin from locale with exactly one slash", () => {
    expect(verificationLink("tok", "tr")).not.toContain("//tr");
    expect(verificationLink("tok", "tr")).toContain("/tr/verify-email");
  });
});

describe("the enforcement flag", () => {
  /**
   * Strict equality to "true", matching `REQUIRE_PHOTO_SCREENING`.
   *
   * The failure this avoids: a deployment that sets `REQUIRE_EMAIL_VERIFICATION=false`
   * meaning to switch it off, against a check like `!== undefined`, would turn
   * it on. Every value other than the one word is off, and the one word is the
   * only way to turn it on.
   */
  it("is off unless a deployment says exactly 'true'", () => {
    expect(emailVerificationRequired()).toBe(false);

    for (const value of ["false", "0", "1", "yes", "TRUE", ""]) {
      process.env.REQUIRE_EMAIL_VERIFICATION = value;
      expect(emailVerificationRequired()).toBe(false);
    }

    process.env.REQUIRE_EMAIL_VERIFICATION = "true";
    expect(emailVerificationRequired()).toBe(true);
  });
});

describe("the link lifetime", () => {
  it("is a day — long enough to survive a night, short enough to expire", () => {
    expect(VERIFICATION_TTL_HOURS).toBe(24);
  });
});
