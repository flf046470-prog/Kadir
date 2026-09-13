import { describe, expect, it, beforeEach } from "vitest";
import { checkRateLimit, resetRateLimits, trackedKeyCount } from "./rate-limit";

beforeEach(() => {
  resetRateLimits();
});

describe("checkRateLimit", () => {
  it("allows up to the ceiling and refuses past it", () => {
    const options = { max: 3, windowMs: 60_000 };

    expect(checkRateLimit("k", options).allowed).toBe(true);
    expect(checkRateLimit("k", options).allowed).toBe(true);
    expect(checkRateLimit("k", options).allowed).toBe(true);
    expect(checkRateLimit("k", options).allowed).toBe(false);
  });

  it("counts each key separately", () => {
    const options = { max: 1, windowMs: 60_000 };

    expect(checkRateLimit("a", options).allowed).toBe(true);
    expect(checkRateLimit("b", options).allowed).toBe(true);
    expect(checkRateLimit("a", options).allowed).toBe(false);
  });

  it("reports what is left", () => {
    const options = { max: 5, windowMs: 60_000 };

    expect(checkRateLimit("k", options).remaining).toBe(4);
    expect(checkRateLimit("k", options).remaining).toBe(3);
  });
});

describe("eviction", () => {
  /**
   * The attack the old eviction order permitted.
   *
   * Buckets were dropped by earliest `resetAt`, and a bucket's resetAt is fixed
   * when it is created — so the *oldest* live bucket went first, which is the
   * one an attack has been filling. Five failed logins against one account,
   * then a flood of throwaway keys, and the victim's counter was the first
   * thing evicted: a fresh five attempts per flood, indefinitely, using the
   * per-account limit to defeat the per-account limit.
   *
   * The flood here is deliberately larger than MAX_TRACKED_KEYS so eviction
   * runs several times over.
   */
  it("does not let a flood of new keys clear a counter that has hit its limit", () => {
    const login = { max: 5, windowMs: 300_000 };

    for (let attempt = 0; attempt < 5; attempt++) {
      checkRateLimit("login:acct:victim", login);
    }
    expect(checkRateLimit("login:acct:victim", login).allowed).toBe(false);

    for (let key = 0; key < 12_000; key++) {
      checkRateLimit(`login:acct:flood-${key}`, login);
    }

    expect(checkRateLimit("login:acct:victim", login).allowed).toBe(false);
  });

  it("keeps the map bounded while doing so", () => {
    const options = { max: 5, windowMs: 300_000 };

    for (let key = 0; key < 30_000; key++) {
      checkRateLimit(`k-${key}`, options);
    }

    // Protecting established counters must not come at the cost of the bound
    // eviction exists to keep — an IP-rotating bot must not be able to grow
    // the map without limit.
    expect(trackedKeyCount()).toBeLessThanOrEqual(10_000);
  });

  it("evicts the least-established buckets first", () => {
    const options = { max: 5, windowMs: 300_000 };

    checkRateLimit("busy", options);
    checkRateLimit("busy", options);
    checkRateLimit("busy", options);
    checkRateLimit("quiet", options);

    for (let key = 0; key < 12_000; key++) {
      checkRateLimit(`flood-${key}`, options);
    }

    // The busy bucket kept its three; the single-hit ones were the cheap ones
    // to drop, so "quiet" is back at one.
    expect(checkRateLimit("busy", options).remaining).toBe(1);
    expect(checkRateLimit("quiet", options).remaining).toBe(4);
  });
});
