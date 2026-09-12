--!strict
-- Headless test entry point: `lune run tests/run.luau` from `game/`.

local process = require("@lune/process")
local TestRunner = require("../src/testing/TestRunner")

local suites = {
    require("./Rng.spec"),
    require("./SchedulerCore.spec"),
    require("./RateLimiter.spec"),
    require("./Trove.spec"),
    require("./ServiceRegistry.spec"),
    require("./Distortion.spec"),
    require("./Divergence.spec"),
    require("./ConfigValidator.spec"),
    require("./Monetization.spec"),
}

print("Dream Layers — unit tests")
local results = TestRunner.run(suites)

print(
    `\n  {results.passed} passed, {results.failed} failed, `
        .. `{results.assertions} assertions across {#suites} suites`
)

if results.failed > 0 then
    process.exit(1)
end
process.exit(0)
