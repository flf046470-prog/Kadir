--!strict
local TestRunner = require("../src/testing/TestRunner")
local Rng = require("../src/shared/Utility/Rng")

local expect = TestRunner.expect
local suite = TestRunner.suite("Rng — seeded determinism")
local test = TestRunner.test

test(suite, "the same seed produces the same sequence", function()
    local a, b = Rng.new(12345), Rng.new(12345)
    for _ = 1, 20 do
        expect(a.nextUint()):toBe(b.nextUint(), "streams diverged")
    end
end)

test(suite, "different seeds diverge", function()
    local a, b = Rng.new(1), Rng.new(2)
    local same = 0
    for _ = 1, 20 do
        if a.nextUint() == b.nextUint() then
            same += 1
        end
    end
    expect(same < 20):toBeTruthy("two different seeds produced an identical sequence")
end)

test(suite, "a zero seed still advances", function()
    -- xorshift is stuck at zero forever, so the constructor must nudge it.
    local rng = Rng.new(0)
    expect(rng.nextUint() ~= 0):toBeTruthy("a zero seed produced a dead stream")
end)

test(suite, "nextNumber stays within [0, 1)", function()
    local rng = Rng.new(99)
    for _ = 1, 200 do
        local value = rng.nextNumber()
        expect(value >= 0 and value < 1):toBeTruthy(`nextNumber returned {value}`)
    end
end)

test(suite, "nextInt covers its bounds and never escapes them", function()
    local rng = Rng.new(7)
    local sawMin, sawMax = false, false
    for _ = 1, 500 do
        local value = rng.nextInt(1, 4)
        expect(value >= 1 and value <= 4):toBeTruthy(`nextInt returned {value}`)
        if value == 1 then
            sawMin = true
        elseif value == 4 then
            sawMax = true
        end
    end
    expect(sawMin):toBeTruthy("never produced the minimum")
    expect(sawMax):toBeTruthy("never produced the maximum")
end)

test(suite, "nextInt rejects an inverted range", function()
    local rng = Rng.new(1)
    expect(function()
        rng.nextInt(5, 2)
    end):toErrorWith("greater than max")
end)

test(suite, "a single-value range is allowed", function()
    local rng = Rng.new(1)
    expect(rng.nextInt(3, 3)):toBe(3)
end)

test(suite, "pick rejects an empty list", function()
    local rng = Rng.new(1)
    expect(function()
        rng.pick({})
    end):toErrorWith("empty list")
end)

test(suite, "weightedIndex never returns a zero-weight entry", function()
    local rng = Rng.new(42)
    for _ = 1, 300 do
        expect(rng.weightedIndex({ 0, 5, 0 })):toBe(2, "picked a zero-weight entry")
    end
end)

test(suite, "weightedIndex rejects all-zero and negative weights", function()
    local rng = Rng.new(1)
    expect(function()
        rng.weightedIndex({ 0, 0 })
    end):toErrorWith("must not all be zero")
    expect(function()
        rng.weightedIndex({ 1, -1 })
    end):toErrorWith("non-negative")
end)

test(suite, "derive is stable for a label and differs between labels", function()
    local parent = Rng.new(2024)
    local first = Rng.new(2024).derive("variants").nextUint()
    local second = Rng.new(2024).derive("variants").nextUint()
    expect(first):toBe(second, "the same label produced different child streams")

    local other = parent.derive("loot").nextUint()
    expect(first ~= other):toBeTruthy("two labels produced the same child stream")
end)

test(suite, "hashLabel matches exact 32-bit FNV-1a, bit for bit", function()
    --[[
        A regression test for a real bug that shipped in this module. `hashLabel` multiplied by
        the FNV prime directly, and for a hash anywhere near 2^32 that product passes 2^53, so
        float64 drops low mantissa bits and the result comes back flattened at the low end.

        Nothing here noticed, because a consumer that reads all 32 bits still looks random.
        Anything reading `seed % n` for small n does not, and that is how the divergence system
        in `Divergence.luau` silently put every player on the same lens.

        Distribution tests are too weak to catch it — the buggy version passes those. So assert
        the arithmetic itself against vectors computed independently with exact integers. Any
        deviation at all fails, which is the only property worth asserting about a hash whose
        whole job is to be a specific function.

        `derive` feeds hashLabel's 32-bit result through `normalizeSeed`, which is the identity
        for any non-zero 32-bit value, so `originalSeed()` is hashLabel's output unchanged. The
        seed-0 vector is kept because it is the one exception: `normalizeSeed` nudges zero to
        0x9E3779B9 to keep xorshift off its fixed point, and `derive` hashes the nudged value, so
        this vector pins that nudge down too.
    ]]
    local vectors = {
        { seed = 0, label = "layer", expected = 83258425 },
        { seed = 2024, label = "variants", expected = 3031666231 },
        { seed = 555, label = "loot", expected = 3809130792 },
        { seed = 4294967295, label = "lens", expected = 2198801702 },
        { seed = 9001, label = "a", expected = 3443521527 },
    }

    for _, vector in vectors do
        local actual = Rng.new(vector.seed).derive(vector.label).originalSeed()
        expect(actual):toBe(
            vector.expected,
            `derive({vector.seed}, "{vector.label}") gave {actual}, not exact FNV-1a`
        )
    end
end)

test(suite, "derive does not depend on how far the parent has advanced", function()
    -- Child seeds come from the original seed, so a service that draws before deriving
    -- cannot silently change another service's stream.
    local early = Rng.new(555)
    local beforeAdvancing = early.derive("layer").nextUint()
    for _ = 1, 50 do
        early.nextUint()
    end
    expect(early.derive("layer").nextUint()):toBe(beforeAdvancing)
end)

test(suite, "originalSeed reports the normalised starting seed", function()
    expect(Rng.new(777).originalSeed()):toBe(777)
end)

return suite
