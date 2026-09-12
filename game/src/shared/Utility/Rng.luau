--!strict
--[[
    Deterministic seeded pseudo-random number generator.

    Pure: this module never touches `game`, `workspace`, or any Roblox service, so it runs
    headlessly under Lune and every gameplay roll is reproducible from a single round seed.

    The specification bans `math.random` in gameplay because it cannot be reproduced from a
    seed, and it bans `Random.new` here for a stronger reason: `Random`'s sequence is an
    engine implementation detail, so a test asserting an exact sequence would be asserting
    something Roblox is free to change. This xorshift32 is ours, so "same seed, same graph"
    is a property we can actually hold.
]]

export type Rng = {
    -- Advances the stream and returns the raw 32-bit value.
    nextUint: () -> number,
    -- Uniform in [0, 1).
    nextNumber: () -> number,
    -- Uniform integer in [min, max] inclusive. Errors if min > max.
    nextInt: (min: number, max: number) -> number,
    -- Uniform element of `list`. Errors on an empty list.
    pick: <T>(list: { T }) -> T,
    -- Index of a weighted choice. Weights must be non-negative and not all zero.
    weightedIndex: (weights: { number }) -> number,
    -- A child stream, stable for a given (parent seed, label) pair.
    derive: (label: string) -> Rng,
    -- The seed this stream started from. Useful for logging a reproducible round.
    originalSeed: () -> number,
}

local Rng = {}

local UINT32 = 4294967296

--[[
    The FNV prime, 16777619, as shifts and adds: 2^24 + 2^8 + 2^7 + 2^4 + 2^1 + 2^0.

    `hash * 16777619` is the obvious spelling and it is wrong here. For a hash anywhere near
    2^32 the product exceeds 2^53, so float64 drops low mantissa bits and both `bit32.band` and
    `% 2^32` then return a value whose low bits are zero. Measured against exact arithmetic, the
    multiply disagrees for about 69% of 32-bit inputs, always by flattening the low end — which
    is invisible to anything that consumes the whole 32 bits, and fatal to anything that reads
    `hash % n`. `bit32.lshift` truncates to 32 bits, so each term here is below 2^32 and the sum
    of six stays far inside the exactly-representable range.

    `Divergence.luau` carries its own copy because pure modules are leaves (specification 0.4).
]]
local FNV_SHIFTS = { 0, 1, 4, 7, 8, 24 }

local function fnvMultiply(hash: number): number
    local total = 0
    for _, shift in FNV_SHIFTS do
        total += bit32.lshift(hash, shift)
    end
    return total % UINT32
end

-- FNV-1a, so a child seed is a pure function of the parent seed and a human-readable label.
local function hashLabel(seed: number, label: string): number
    local hash = bit32.bxor(2166136261, seed)
    for index = 1, #label do
        hash = bit32.bxor(hash, string.byte(label, index) :: number)
        hash = fnvMultiply(hash)
    end
    return hash
end

local function normalizeSeed(seed: number): number
    local normalized = bit32.band(math.floor(seed), 0xFFFFFFFF)
    -- xorshift is stuck at zero forever, so nudge it to an arbitrary non-zero constant.
    if normalized == 0 then
        return 0x9E3779B9
    end
    return normalized
end

function Rng.new(seed: number): Rng
    local state = normalizeSeed(seed)
    local original = state

    local self = {} :: Rng

    function self.nextUint(): number
        state = bit32.bxor(state, bit32.lshift(state, 13))
        state = bit32.bxor(state, bit32.rshift(state, 17))
        state = bit32.bxor(state, bit32.lshift(state, 5))
        return state
    end

    function self.nextNumber(): number
        return self.nextUint() / UINT32
    end

    function self.nextInt(min: number, max: number): number
        if min > max then
            error(`Rng.nextInt: min ({min}) is greater than max ({max})`, 2)
        end
        local span = max - min + 1
        return min + (self.nextUint() % span)
    end

    function self.pick<T>(list: { T }): T
        if #list == 0 then
            error("Rng.pick: cannot pick from an empty list", 2)
        end
        return list[self.nextInt(1, #list)]
    end

    function self.weightedIndex(weights: { number }): number
        local total = 0
        for _, weight in weights do
            if weight < 0 then
                error("Rng.weightedIndex: weights must be non-negative", 2)
            end
            total += weight
        end
        if total <= 0 then
            error("Rng.weightedIndex: weights must not all be zero", 2)
        end

        local roll = self.nextNumber() * total
        local cumulative = 0
        for index, weight in weights do
            cumulative += weight
            if roll < cumulative then
                return index
            end
        end
        -- Only reachable through floating point drift on the final boundary.
        return #weights
    end

    function self.derive(label: string): Rng
        return Rng.new(hashLabel(original, label))
    end

    function self.originalSeed(): number
        return original
    end

    return self
end

return Rng
