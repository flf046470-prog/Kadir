--!strict
local TestRunner = require("../src/testing/TestRunner")
local RateLimiter = require("../src/shared/Utility/RateLimiter")

local expect = TestRunner.expect
local suite = TestRunner.suite("RateLimiter — remote budgets")
local test = TestRunner.test

test(suite, "a first call from an unseen key is allowed", function()
    local limiter = RateLimiter.new(4, 4)
    expect(RateLimiter.consume(limiter, "player1", 0)):toBeTruthy()
end)

test(suite, "a burst above budget is rejected", function()
    local limiter = RateLimiter.new(4, 4)
    for index = 1, 4 do
        expect(RateLimiter.consume(limiter, "p", 0)):toBeTruthy(`call {index} should be allowed`)
    end
    expect(RateLimiter.consume(limiter, "p", 0)):toBeFalsy("the fifth call should be rejected")
end)

test(suite, "the bucket recovers after the window", function()
    local limiter = RateLimiter.new(4, 4)
    for _ = 1, 4 do
        RateLimiter.consume(limiter, "p", 0)
    end
    expect(RateLimiter.consume(limiter, "p", 0)):toBeFalsy()
    -- One second at four tokens per second refills the bucket.
    expect(RateLimiter.consume(limiter, "p", 1.0)):toBeTruthy("did not recover after a full second")
end)

test(suite, "refill is proportional to elapsed time", function()
    local limiter = RateLimiter.new(4, 4)
    for _ = 1, 4 do
        RateLimiter.consume(limiter, "p", 0)
    end
    -- A quarter second buys exactly one token.
    expect(RateLimiter.consume(limiter, "p", 0.25)):toBeTruthy()
    expect(RateLimiter.consume(limiter, "p", 0.25)):toBeFalsy("refilled faster than configured")
end)

test(suite, "tokens never exceed capacity", function()
    local limiter = RateLimiter.new(4, 4)
    RateLimiter.consume(limiter, "p", 0)
    -- An hour of idling must not bank an hour of calls.
    RateLimiter.consume(limiter, "p", 3600)
    expect(RateLimiter.tokensRemaining(limiter, "p")):toBeCloseTo(3, 1e-6)
end)

test(suite, "keys are independent", function()
    local limiter = RateLimiter.new(2, 1)
    RateLimiter.consume(limiter, "a", 0)
    RateLimiter.consume(limiter, "a", 0)
    expect(RateLimiter.consume(limiter, "a", 0)):toBeFalsy()
    expect(RateLimiter.consume(limiter, "b", 0)):toBeTruthy("one player's burst limited another")
end)

test(suite, "forget drops a key so the table cannot grow unbounded", function()
    local limiter = RateLimiter.new(1, 1)
    RateLimiter.consume(limiter, "leaver", 0)
    RateLimiter.forget(limiter, "leaver")
    expect(limiter.buckets["leaver"]):toBe(nil)
    expect(RateLimiter.tokensRemaining(limiter, "leaver")):toBe(1)
end)

test(suite, "invalid construction is rejected", function()
    expect(function()
        RateLimiter.new(0, 1)
    end):toErrorWith("capacity must be positive")
    expect(function()
        RateLimiter.new(1, -1)
    end):toErrorWith("must not be negative")
end)

return suite
