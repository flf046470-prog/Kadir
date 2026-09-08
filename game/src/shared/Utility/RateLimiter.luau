--!strict
--[[
    Token-bucket rate limiting for remote handlers (specification 2.3, step 1).

    Pure: `now` is a parameter, never read from a clock inside this module, so the tests can
    drive time forward without waiting and the caller decides whether that clock is
    `os.clock()` or a synced server timestamp.
]]

export type Bucket = {
    capacity: number,
    refillPerSecond: number,
    tokens: number,
    lastRefillAt: number,
}

export type Limiter = {
    buckets: { [string]: Bucket },
    capacity: number,
    refillPerSecond: number,
}

local RateLimiter = {}

function RateLimiter.new(capacity: number, refillPerSecond: number): Limiter
    if capacity <= 0 then
        error("RateLimiter.new: capacity must be positive", 2)
    end
    if refillPerSecond < 0 then
        error("RateLimiter.new: refillPerSecond must not be negative", 2)
    end
    return {
        buckets = {},
        capacity = capacity,
        refillPerSecond = refillPerSecond,
    }
end

local function bucketFor(limiter: Limiter, key: string, now: number): Bucket
    local bucket = limiter.buckets[key]
    if bucket then
        return bucket
    end
    bucket = {
        capacity = limiter.capacity,
        refillPerSecond = limiter.refillPerSecond,
        tokens = limiter.capacity,
        lastRefillAt = now,
    }
    limiter.buckets[key] = bucket
    return bucket
end

--[[
    Spends one token for `key` and reports whether the call is allowed.
    A key with no bucket yet starts full, so a player's first call is never rejected.
]]
function RateLimiter.consume(limiter: Limiter, key: string, now: number): boolean
    local bucket = bucketFor(limiter, key, now)

    local elapsed = now - bucket.lastRefillAt
    if elapsed > 0 then
        bucket.tokens = math.min(bucket.capacity, bucket.tokens + elapsed * bucket.refillPerSecond)
        bucket.lastRefillAt = now
    end

    if bucket.tokens < 1 then
        return false
    end

    bucket.tokens -= 1
    return true
end

-- Drops a key's bucket. Call this when a player leaves so the table cannot grow unbounded.
function RateLimiter.forget(limiter: Limiter, key: string)
    limiter.buckets[key] = nil
end

function RateLimiter.tokensRemaining(limiter: Limiter, key: string): number
    local bucket = limiter.buckets[key]
    if not bucket then
        return limiter.capacity
    end
    return bucket.tokens
end

return RateLimiter
