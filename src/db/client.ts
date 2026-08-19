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
 * Reused across hot reloads in development; Next.js re-evaluates modules on
 * every change, and a fresh pool per reload exhausts Postgres connections.
 */
export const db = globalThis.__fiorematchDb ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__fiorematchDb = db;
}

export { schema };
