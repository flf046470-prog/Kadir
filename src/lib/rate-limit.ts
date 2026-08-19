import "server-only";

import { getDb } from "./db";

export type RateLimitResult = { ok: boolean; remaining: number; retryAfterSeconds: number };

/**
 * Fixed-window limiter backed by the same SQLite file as everything else — no
 * extra service to run, and it survives a restart.
 */
export function rateLimit(
  bucket: string,
  { limit, windowSeconds }: { limit: number; windowSeconds: number },
): RateLimitResult {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSeconds);

  const result = db.transaction(() => {
    const row = db
      .prepare("SELECT hits, window_start FROM rate_limits WHERE bucket = ?")
      .get(bucket) as { hits: number; window_start: number } | undefined;

    if (!row || row.window_start !== windowStart) {
      db.prepare(
        `INSERT INTO rate_limits (bucket, hits, window_start) VALUES (?, 1, ?)
         ON CONFLICT(bucket) DO UPDATE SET hits = 1, window_start = excluded.window_start`,
      ).run(bucket, windowStart);
      return { ok: true, remaining: limit - 1, retryAfterSeconds: 0 };
    }

    if (row.hits >= limit) {
      return {
        ok: false,
        remaining: 0,
        retryAfterSeconds: windowStart + windowSeconds - now,
      };
    }

    db.prepare("UPDATE rate_limits SET hits = hits + 1 WHERE bucket = ?").run(bucket);
    return { ok: true, remaining: limit - row.hits - 1, retryAfterSeconds: 0 };
  })();

  // Opportunistic cleanup of windows that can no longer be hit.
  if (Math.random() < 0.02) {
    db.prepare("DELETE FROM rate_limits WHERE window_start < ?").run(now - 86_400);
  }
  return result;
}
