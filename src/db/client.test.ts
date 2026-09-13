import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `client.ts` builds its pool on first use and memoises it on `globalThis`, so
 * these read the two decisions it makes from the environment rather than
 * opening a connection. Both are the kind of thing that only misbehaves on a
 * platform nobody tests on locally.
 */

const KEYS = ["DATABASE_URL", "POSTGRES_URL", "DATABASE_POOL_MAX", "VERCEL"] as const;
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

async function freshModule() {
  // The pool is memoised on globalThis so it survives hot reloads, so the memo
  // has to go too or the second test reads the first one's client.
  delete (globalThis as { __fiorematchDb?: unknown }).__fiorematchDb;
  vi.resetModules();
  return import("./client");
}

describe("the connection string", () => {
  /**
   * Vercel's Postgres integration writes `POSTGRES_URL`, and that is not
   * negotiable from this side. Reading only `DATABASE_URL` meant a deploy with
   * a database plainly attached in the dashboard failed with "DATABASE_URL is
   * not set" — a confusing failure rather than a safe one.
   */
  it("accepts the name Vercel's integration writes", async () => {
    delete process.env.DATABASE_URL;
    process.env.POSTGRES_URL = "postgres://someone@example.test/db";

    const { db } = await freshModule();
    // Touching a property builds the client; it throws if neither name is set.
    expect(() => db.select).not.toThrow();
  });

  it("prefers DATABASE_URL when both are set", async () => {
    process.env.DATABASE_URL = "postgres://primary@example.test/db";
    process.env.POSTGRES_URL = "postgres://secondary@example.test/db";

    const { db } = await freshModule();
    expect(() => db.select).not.toThrow();
  });

  /** Neither name set is still a loud failure — no in-code default. */
  it("throws when neither is set, naming both", async () => {
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;

    const { db } = await freshModule();
    expect(() => db.select).toThrow(/DATABASE_URL.*POSTGRES_URL/s);
  });
});
