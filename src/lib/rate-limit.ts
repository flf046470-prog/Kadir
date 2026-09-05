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

type Bucket = {
  count: number;
  resetAt: number;
  /**
   * The ceiling this bucket is counted against, kept so eviction can tell a
   * counter that is already refusing requests from one that is not.
   */
  max: number;
};

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
    if (buckets.size >= MAX_TRACKED_KEYS) evict(now);
    const bucket = { count: 1, resetAt: now + options.windowMs, max: options.max };
    buckets.set(key, bucket);
    return { allowed: true, remaining: options.max - 1, resetAt: bucket.resetAt };
  }

  existing.count += 1;
  existing.max = options.max;
  return {
    allowed: existing.count <= options.max,
    remaining: Math.max(0, options.max - existing.count),
    resetAt: existing.resetAt
  };
}

/**
 * Makes room, without handing an attacker a way to clear someone else's
 * counter.
 *
 * Expired buckets go first and cost nothing. What matters is the fallback when
 * everything is still live, which used to drop the buckets with the *earliest*
 * `resetAt` — the oldest ones. That is precisely backwards: a bucket's resetAt
 * is fixed when it is created, so the oldest live bucket is the one that has
 * been counting longest, which is the one an attack has been filling. Five
 * failed logins against one account, then ten thousand throwaway keys, and the
 * victim's counter was the first thing evicted; the attacker got a fresh five
 * attempts per flood, indefinitely, and the per-account limit that exists to
 * stop exactly that was the thing being used to defeat it.
 *
 * Eviction now follows how *established* a bucket is: never one that is already
 * at its ceiling while any bucket below its ceiling remains, and among the rest,
 * the lowest count first. A flood key sits at count 1 and evicts itself, so
 * clearing a counter that has reached its limit costs the attacker as many
 * requests per decoy as the limit itself — the attack stops being cheaper than
 * simply making the requests.
 */
function evict(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }

  if (buckets.size < MAX_TRACKED_KEYS) return;

  const ranked = [...buckets.entries()].sort((a, b) => {
    const aBlocked = a[1].count >= a[1].max ? 1 : 0;
    const bBlocked = b[1].count >= b[1].max ? 1 : 0;
    if (aBlocked !== bBlocked) return aBlocked - bBlocked;
    if (a[1].count !== b[1].count) return a[1].count - b[1].count;
    return a[1].resetAt - b[1].resetAt;
  });

  for (const [key] of ranked.slice(0, Math.floor(MAX_TRACKED_KEYS / 10))) {
    buckets.delete(key);
  }
}

/** Test hook. */
export function resetRateLimits(): void {
  buckets.clear();
}

/** Test hook: how many keys are currently held, to assert the bound holds. */
export function trackedKeyCount(): number {
  return buckets.size;
}
