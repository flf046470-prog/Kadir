/**
 * In-process rate limiting.
 *
 * This is a fixed-window counter held in memory, which means it is per-instance
 * and resets on deploy. That is a deliberate starting point, not a finished
 * one: it stops casual abuse and credential-stuffing scripts without adding
 * infrastructure. Before running more than one instance, this must move to a
 * shared store (Redis) or the limit becomes "max × instance count".
 *
 * Documented here rather than left implicit, because a rate limiter that
 * silently does less than it appears to is worse than none.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Bounds memory if a lot of distinct keys appear (e.g. an IP-rotating bot). */
const MAX_TRACKED_KEYS = 10_000;

export type RateLimitOptions = {
  max: number;
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

export function checkRateLimit(key: string, options: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_TRACKED_KEYS) evictExpired(now);
    const bucket = { count: 1, resetAt: now + options.windowMs };
    buckets.set(key, bucket);
    return { allowed: true, remaining: options.max - 1, resetAt: bucket.resetAt };
  }

  existing.count += 1;
  return {
    allowed: existing.count <= options.max,
    remaining: Math.max(0, options.max - existing.count),
    resetAt: existing.resetAt
  };
}

function evictExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  // If everything is still live, drop the oldest to keep the map bounded.
  if (buckets.size >= MAX_TRACKED_KEYS) {
    const oldest = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    for (const [key] of oldest.slice(0, Math.floor(MAX_TRACKED_KEYS / 10))) {
      buckets.delete(key);
    }
  }
}

/** Test hook. */
export function resetRateLimits(): void {
  buckets.clear();
}
