--!strict
local TestRunner = require("../src/testing/TestRunner")
local Distortion = require("../src/shared/Utility/Distortion")
local DistortionConfig = require("../src/shared/Config/DistortionConfig")
local DepthConfig = require("../src/shared/Config/DepthConfig")

local expect = TestRunner.expect
local suite = TestRunner.suite("Distortion — the depth curve")
local test = TestRunner.test

local stops = DistortionConfig.stops

test(suite, "depth 0 is the dream exactly as authored", function()
    -- The contract that lets depth 1 be generated rather than authored.
    local surface = Distortion.forDepth(stops, 0)
    expect(surface.depth):toBe(0)
    expect(surface.saturation):toBe(1)
    expect(surface.lightRangeScale):toBe(1)
    expect(surface.divergenceScale):toBe(1)
    expect(surface.hudTruthfulness):toBe(1, "depth 0 must never lie about depth")
end)

test(suite, "the same input always returns the same profile", function()
    expect(Distortion.forDepth(stops, 2)):toBe(Distortion.forDepth(stops, 2))
end)

test(suite, "colour drains and light shortens with depth", function()
    for depth = 1, DepthConfig.maxDepth do
        local above = Distortion.forDepth(stops, depth - 1)
        local here = Distortion.forDepth(stops, depth)
        expect(here.saturation < above.saturation):toBeTruthy(`depth {depth} did not desaturate`)
        expect(here.lightRangeScale < above.lightRangeScale):toBeTruthy(
            `depth {depth} light reached further than above it`
        )
    end
end)

test(suite, "the dream disagrees with itself more the deeper you go", function()
    --[[
        3.2.3. Both scales must rise, and the second one is the load-bearing half: if rooms
        deeper down came apart more slowly, descending out of a dissolving room would be the
        cheapest move in the game and the descent design would invert.
    ]]
    for depth = 1, DepthConfig.maxDepth do
        local above = Distortion.forDepth(stops, depth - 1)
        local here = Distortion.forDepth(stops, depth)
        expect(here.divergenceScale > above.divergenceScale):toBeTruthy(
            `depth {depth} agreed with itself more than the level above`
        )
        expect(here.incoherenceScale > above.incoherenceScale):toBeTruthy(
            `depth {depth} held together better than the level above`
        )
    end
end)

test(suite, "Limbo is the one place where the dream agrees with itself", function()
    -- 3.2.6. One lens, nothing contested, both scales inert. The only coherent place in the
    -- game is the one you cannot leave without somebody else.
    local limbo = Distortion.forDepth(stops, DepthConfig.limboDepth)
    expect(limbo.divergenceScale):toBe(1)
    expect(limbo.incoherenceScale):toBe(1)
end)

test(suite, "every profile keeps its probabilities in range", function()
    for _, stop in stops do
        expect(stop.hudTruthfulness >= 0 and stop.hudTruthfulness <= 1):toBeTruthy(
            `depth {stop.depth} hudTruthfulness out of range`
        )
        expect(stop.propDuplicationChance >= 0 and stop.propDuplicationChance <= 1):toBeTruthy(
            `depth {stop.depth} propDuplicationChance out of range`
        )
    end
end)

test(suite, "depth is clamped rather than erroring", function()
    -- A depth past the last stop is Limbo; a negative depth is a caller bug that should
    -- still render something rather than crash a live round.
    expect(Distortion.forDepth(stops, -5).depth):toBe(0)
    expect(Distortion.forDepth(stops, 99).depth):toBe(DepthConfig.limboDepth)
end)

test(suite, "a fractional depth resolves to the level below it", function()
    expect(Distortion.forDepth(stops, 1.9).depth):toBe(1)
end)

test(suite, "isKnownDepth separates real levels from clamped ones", function()
    expect(Distortion.isKnownDepth(stops, DepthConfig.limboDepth)):toBeTruthy()
    expect(Distortion.isKnownDepth(stops, 99)):toBeFalsy()
end)

test(suite, "the HUD may only lie below full truthfulness", function()
    local surface = Distortion.forDepth(stops, 0)
    expect(Distortion.hudMayLie(surface, 0.999)):toBeFalsy("depth 0 lied about depth")

    local deep = Distortion.forDepth(stops, 3)
    expect(Distortion.hudMayLie(deep, 0.0)):toBeFalsy("a low roll should be truthful")
    expect(Distortion.hudMayLie(deep, 0.99)):toBeTruthy("a high roll should be allowed to lie")
end)

test(suite, "an empty stop table is rejected", function()
    expect(function()
        Distortion.forDepth({}, 0)
    end):toErrorWith("no stops configured")
end)

return suite
