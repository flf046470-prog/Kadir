import { afterEach, describe, expect, it, vi } from "vitest";
import { isTransactionPooler } from "./client";

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

/**
 * The other decision a deployment can get wrong silently.
 *
 * Against a transaction-mode pooler, postgres-js's default prepared statements
 * fail with `prepared statement "s1" does not exist` — not on the first query,
 * but on a later one under concurrency, once the pooler hands a different
 * backend to the EXECUTE than it did to the PREPARE. That is a production-only
 * failure no amount of local testing against a direct connection reaches,
 * which is why the rule is pinned here rather than left to whoever pastes the
 * connection string.
 */
describe("spotting a transaction-mode pooler", () => {
  it("knows Supabase's transaction pooler by its port", () => {
    expect(
      isTransactionPooler(
        "postgres://postgres.abcdefgh:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres"
      )
    ).toBe(true);
  });

  it("leaves session mode and direct connections alone", () => {
    // Session mode is the same host on 5432 and does support prepared
    // statements, so turning them off there would be a silent cost.
    expect(
      isTransactionPooler(
        "postgres://postgres.abcdefgh:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"
      )
    ).toBe(false);
    expect(
      isTransactionPooler("postgres://postgres:pw@db.abcdefgh.supabase.co:5432/postgres")
    ).toBe(false);
    expect(isTransactionPooler("postgres://fiorematch:pw@127.0.0.1:5432/fiorematch_dev")).toBe(
      false
    );
  });

  /**
   * A portless URL is the default 5432, and a direct connection. Guessing
   * "pooler" from a hostname containing the word would be wrong for anyone
   * running a session-mode pooler of their own, so only the port is read.
   */
  it("treats a portless URL as a direct connection", () => {
    expect(isTransactionPooler("postgres://postgres:pw@db.abcdefgh.supabase.co/postgres")).toBe(
      false
    );
  });

  it("does not throw on a string it cannot parse", () => {
    // postgres-js accepts some forms `URL` rejects; the driver should report
    // that, not this predicate.
    expect(() => isTransactionPooler("not a url")).not.toThrow();
    expect(isTransactionPooler("not a url")).toBe(false);
  });
});
