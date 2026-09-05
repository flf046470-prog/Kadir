import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Database connection.
 *
 * The URL comes from the environment only — there is no in-code default and no
 * fallback credential, so a misconfigured deploy fails loudly at startup rather
 * than silently connecting somewhere unintended.
 */
function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and set it before starting."
    );
  }
  return url;
}

declare global {
  // eslint-disable-next-line no-var
  var __fiorematchDb: ReturnType<typeof createClient> | undefined;
}

function createClient() {
  const client = postgres(connectionString(), {
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    // Fail fast rather than hanging a request behind an unreachable database.
    connect_timeout: 10
  });
  return drizzle(client, { schema });
}

/**
 * The connection, opened on first use rather than on import.
 *
 * `next build` imports every route module during its "collecting page data"
 * step. Building is not deploying — nothing is serving traffic and there is
 * legitimately no database — so connecting at import time failed the build for
 * a condition that only matters when a request arrives.
 *
 * The loud failure is kept, not traded away. `connectionString()` still throws
 * the same message on a misconfigured deploy; it now throws on the first query
 * instead of the first import. Nothing is silently connected anywhere, and a
 * deploy with no `DATABASE_URL` still fails on its first request rather than
 * serving something wrong.
 *
 * A Proxy rather than a `getDb()` function so the ~30 call sites keep reading
 * `db.select(...)`. Every property access resolves through here, so the client
 * is built at most once and then reused; the memo is the same one that
 * survives Next's dev-mode hot reloads, where a fresh pool per reload
 * exhausts Postgres connections.
 */
function client(): ReturnType<typeof createClient> {
  globalThis.__fiorematchDb ??= createClient();
  return globalThis.__fiorematchDb;
}

/**
 * Methods are bound to the real client, and the bound copies are cached.
 *
 * Bound, because `db.select(...)` would otherwise call drizzle's method with
 * `this` set to the Proxy. That works today, and would stop working the day a
 * drizzle release reads a `#private` field on one of these paths — a failure
 * that would arrive as a TypeError from inside a dependency, on an upgrade
 * that looked unrelated. Cached, so method identity is stable and a hot query
 * path does not allocate a closure per call.
 */
const bound = new WeakMap<object, Map<PropertyKey, unknown>>();

export const db = new Proxy({} as ReturnType<typeof createClient>, {
  get(_target, property) {
    const real = client();
    const value = Reflect.get(real, property);
    if (typeof value !== "function") return value;

    let methods = bound.get(real);
    if (!methods) bound.set(real, (methods = new Map()));

    let fn = methods.get(property);
    if (!fn) methods.set(property, (fn = value.bind(real)));
    return fn;
  },
  // `db.transaction(...)` and friends are plain property reads, but drizzle
  // also gets probed by `in`, spread and introspection in a few places, so the
  // remaining traps forward too rather than answering about the empty target.
  has(_target, property) {
    return Reflect.has(client(), property);
  },
  ownKeys() {
    return Reflect.ownKeys(client());
  },
  getOwnPropertyDescriptor(_target, property) {
    const descriptor = Reflect.getOwnPropertyDescriptor(client(), property);
    // A proxy may not report a non-configurable property that the (empty)
    // target does not have, so descriptors are handed back as configurable.
    return descriptor && { ...descriptor, configurable: true };
  }
});

export { schema };
