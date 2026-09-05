import { describe, expect, it } from "vitest";
import { db } from "./client";

/**
 * The connection is lazy, and that laziness has one failure mode worth a test.
 *
 * `db` is a Proxy whose every property access resolves the client. If the memo
 * behind it were wrong, each `db.select(...)` would open a *new* pool — which
 * does not fail loudly, it just leaks connections until Postgres refuses them,
 * somewhere in production, under load.
 */
describe("the lazy client", () => {
  it("opens one pool however many times it is touched", () => {
    const first = db.$client;

    for (let i = 0; i < 500; i += 1) {
      void db.$client;
      void db.select;
      void db.transaction;
    }

    expect(db.$client).toBe(first);
  });

  it("binds methods to the real client, with stable identity", () => {
    // `this` must be the client, not the Proxy — otherwise a drizzle release
    // that reads a `#private` field starts throwing from inside the dependency
    // on an upgrade that looked unrelated.
    expect(db.select).toBe(db.select);
    expect(() => db.select()).not.toThrow();
  });

  it("forwards introspection to the real client rather than the empty target", () => {
    // The Proxy's target is `{}`. Without the `has` and `ownKeys` traps these
    // would describe that empty object, and anything probing drizzle's shape
    // would silently conclude it has no methods.
    expect("select" in db).toBe(true);
    expect("transaction" in db).toBe(true);
    expect(Object.keys(db).length).toBeGreaterThan(0);
  });

  it("still runs a real query", async () => {
    const rows = await db.execute<{ ok: number }>("select 1 as ok" as never);
    expect(rows.length).toBeGreaterThan(0);
  });
});
