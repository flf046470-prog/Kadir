--!strict
local TestRunner = require("../src/testing/TestRunner")
local ConfigValidator = require("../src/shared/Utility/ConfigValidator")
local configs = require("./_configs")

local expect = TestRunner.expect
local suite = TestRunner.suite("ConfigValidator — the shipped configs")
local test = TestRunner.test

-- Configs are frozen, so a negative test copies the set and swaps one table.
local function withOverride(key: string, value: any)
    local copy = table.clone(configs)
    copy[key] = value
    return copy :: any
end

local function withField(key: string, field: string, value: any)
    local branch = table.clone(configs[key] :: any)
    branch[field] = value
    return withOverride(key, branch)
end

test(suite, "the configs that ship are valid", function()
    local report = ConfigValidator.validate(configs :: any)
    if not report.ok then
        error("shipped configs are invalid:\n  - " .. table.concat(report.errors, "\n  - "))
    end
    expect(report.ok):toBeTruthy()
end)

test(suite, "assertValid does not raise on the shipped configs", function()
    ConfigValidator.assertValid(configs :: any)
    expect(true):toBeTruthy()
end)

test(suite, "Limbo must sit exactly one below the deepest playable level", function()
    local report = ConfigValidator.validate(withField("Depth", "limboDepth", 9))
    expect(report.ok):toBeFalsy("a detached Limbo depth was accepted")
end)

test(suite, "layers must stack downward", function()
    local report = ConfigValidator.validate(withField("Depth", "layerYSpacing", 3000))
    expect(report.ok):toBeFalsy("a positive layer spacing was accepted")
end)

test(suite, "a solo kick must cost more than a synchronised one", function()
    local ledger = table.clone(configs.Depth.stability :: any)
    ledger.soloKick = -1
    local report = ConfigValidator.validate(withField("Depth", "stability", ledger))
    expect(report.ok):toBeFalsy("a cheap solo kick was accepted; nobody would ever pair up")
end)

test(suite, "falling by accident must cost more than choosing to", function()
    local ledger = table.clone(configs.Depth.stability :: any)
    ledger.involuntaryDescent = -1
    local report = ConfigValidator.validate(withField("Depth", "stability", ledger))
    expect(report.ok):toBeFalsy("a risk-free involuntary descent was accepted")
end)

test(suite, "a run must be able to recover stability", function()
    local ledger = table.clone(configs.Depth.stability :: any)
    ledger.objectiveStepCompleted = 0
    local report = ConfigValidator.validate(withField("Depth", "stability", ledger))
    expect(report.ok):toBeFalsy("an unrecoverable stability ledger was accepted")
end)

test(suite, "depth 0 must be undistorted", function()
    local stops = table.clone(configs.Distortion.stops :: any)
    local surface = table.clone(stops[1] :: any)
    surface.saturation = 0.5
    stops[1] = surface
    local report = ConfigValidator.validate(withField("Distortion", "stops", stops))
    expect(report.ok):toBeFalsy("a distorted surface was accepted")
end)

test(suite, "the distortion curve must stay monotonic", function()
    local stops = table.clone(configs.Distortion.stops :: any)
    local second = table.clone(stops[2] :: any)
    second.divergenceScale = 0.5
    stops[2] = second
    local report = ConfigValidator.validate(withField("Distortion", "stops", stops))
    expect(report.ok):toBeFalsy(
        "a depth that agrees with itself more than the surface was accepted"
    )
end)

test(suite, "rooms may not hold together better the deeper you go", function()
    -- Otherwise descending out of a dissolving room is the cheapest move in the game.
    local stops = table.clone(configs.Distortion.stops :: any)
    local second = table.clone(stops[2] :: any)
    second.incoherenceScale = 0.5
    stops[2] = second
    local report = ConfigValidator.validate(withField("Distortion", "stops", stops))
    expect(report.ok):toBeFalsy("a calmer depth was accepted")
end)

test(suite, "a dream declaring an unknown waking task is rejected", function()
    local dreams = table.clone(configs.Layer.dreams :: any)
    local first = table.clone(dreams[1] :: any)
    first.task = "FindTheMonster"
    dreams[1] = first
    local report = ConfigValidator.validate(withField("Layer", "dreams", dreams))
    expect(report.ok):toBeFalsy("an invented waking task was accepted")
end)

test(suite, "a layer that cannot be finished alone must declare its override", function()
    -- Section 5. Otherwise the stated 1-6 player range is a lie, and it fails silently: the
    -- round simply cannot be completed and nothing says why.
    local dreams = table.clone(configs.Layer.dreams :: any)
    for index, dream in dreams do
        if not dream.soloSafe then
            local broken = table.clone(dream :: any)
            broken.soloOverride = nil
            dreams[index] = broken
        end
    end
    local report = ConfigValidator.validate(withField("Layer", "dreams", dreams))
    expect(report.ok):toBeFalsy("an unfinishable solo layer was accepted")
end)

test(suite, "the Final Layer must exist and must be last", function()
    expect(ConfigValidator.validate(withField("Layer", "finalLayerId", "Atlantis")).ok):toBeFalsy(
        "an unknown Final Layer was accepted"
    )

    -- A layer after the Final Layer would be a dream the players already chose to leave.
    local dreams = table.clone(configs.Layer.dreams :: any)
    local extra = table.clone(dreams[1] :: any)
    extra.id = "Epilogue"
    extra.order = #dreams + 1
    extra.task = "Decide"
    table.insert(dreams, extra)
    expect(ConfigValidator.validate(withField("Layer", "dreams", dreams)).ok):toBeFalsy(
        "a layer past the Final Layer was accepted"
    )
end)

test(suite, "the starting dream must exist", function()
    local report = ConfigValidator.validate(withField("Layer", "startingDreamId", "Atlantis"))
    expect(report.ok):toBeFalsy()
end)

test(suite, "the report lists every problem, not just the first", function()
    local broken = withField("Depth", "limboDepth", 9)
    broken.Layer = table.clone(configs.Layer :: any)
    broken.Layer.startingDreamId = "Atlantis"
    local report = ConfigValidator.validate(broken)
    expect(#report.errors >= 2):toBeTruthy("only one of two independent faults was reported")
end)

test(suite, "assertValid raises with every message", function()
    expect(function()
        ConfigValidator.assertValid(withField("Depth", "limboDepth", 9))
    end):toErrorWith("Config validation failed")
end)

test(suite, "depth 1 fragments must always be truthful", function()
    -- The first level down is where a player learns descending is worth doing. A forgery
    -- there teaches the opposite lesson and the loop never lands.
    local stops = table.clone(configs.Distortion.stops :: any)
    local first = table.clone(stops[2] :: any)
    first.fragmentTruthfulness = 0.5
    stops[2] = first
    local report = ConfigValidator.validate(withField("Distortion", "stops", stops))
    expect(report.ok):toBeFalsy("a lying depth 1 was accepted")
end)

test(suite, "fragments may not get more truthful with depth", function()
    local stops = table.clone(configs.Distortion.stops :: any)
    local deepest = table.clone(stops[4] :: any)
    deepest.fragmentTruthfulness = 1.0
    stops[4] = deepest
    local report = ConfigValidator.validate(withField("Distortion", "stops", stops))
    expect(report.ok):toBeFalsy("information improving with depth was accepted")
end)

test(suite, "sedative doses may not spawn at the surface", function()
    -- The resource that pays for climbing has to be found by going down.
    local items = table.clone(configs.Item.items :: any)
    local dose = table.clone(items.SedativeDose :: any)
    dose.minSpawnDepth = 0
    items.SedativeDose = dose
    local report = ConfigValidator.validate(withField("Item", "items", items))
    expect(report.ok):toBeFalsy("surface-spawning sedative was accepted")
end)

test(suite, "descending out of a dissolving room may not grant arrival grace", function()
    -- Otherwise a dissolving room has an exit sign in it: drop a level, leave the disagreement
    -- upstairs, and collect free seconds on arrival.
    local report = ConfigValidator.validate(
        withField("Divergence", "graceAppliesToDescentFromDissolvingRoom", true)
    )
    expect(report.ok):toBeFalsy("descent as an escape hatch was accepted")
end)

test(suite, "there must be a band where the dream agrees with itself", function()
    -- 3.6.2. Players have to learn what coherence feels like before the game takes it away, so
    -- the first lens threshold must sit above the minimum.
    local thresholds = table.clone(configs.Divergence.lensThresholds :: any)
    thresholds[1] = 0
    local report = ConfigValidator.validate(withField("Divergence", "lensThresholds", thresholds))
    expect(report.ok):toBeFalsy("a round that starts already diverged was accepted")
end)

test(suite, "every lens must be reachable", function()
    -- One threshold per lens beyond the first. A missing entry makes a whole reading of the
    -- world unreachable, which is invisible at runtime.
    local thresholds = table.clone(configs.Divergence.lensThresholds :: any)
    table.remove(thresholds)
    local report = ConfigValidator.validate(withField("Divergence", "lensThresholds", thresholds))
    expect(report.ok):toBeFalsy("an unreachable lens was accepted")
end)

test(suite, "progress must outrun failure in the divergence ledger", function()
    -- 3.6.7. Otherwise a team that is genuinely making progress still drowns.
    local ledger = table.clone(configs.Divergence.ledger :: any)
    ledger.objectiveStepCompleted = -1
    local report = ConfigValidator.validate(withField("Divergence", "ledger", ledger))
    expect(report.ok):toBeFalsy("a ledger where progress cannot keep up was accepted")
end)

test(suite, "agreeing must calm the dream down", function()
    local ledger = table.clone(configs.Divergence.ledger :: any)
    ledger.firstCorroboration = 3
    local report = ConfigValidator.validate(withField("Divergence", "ledger", ledger))
    expect(report.ok):toBeFalsy("corroboration that raised divergence was accepted")
end)

test(suite, "the clock alone may not buy the last lens", function()
    --[[
        3.6.6. A team that plays well must never meet four lenses; a team that plays badly must
        earn it. This is the check that keeps the passive rise honest as the round length and the
        ledger are tuned independently of each other, which is exactly when it would break.
    ]]
    local ledger = table.clone(configs.Divergence.ledger :: any)
    ledger.perMinuteElapsed = 20
    local report = ConfigValidator.validate(withField("Divergence", "ledger", ledger))
    expect(report.ok):toBeFalsy("a passive rise into the top band was accepted")
end)

test(suite, "a dissolving room must last longer than the rescue takes", function()
    local report = ConfigValidator.validate(withField("Divergence", "dissolveSeconds", 1))
    expect(report.ok):toBeFalsy("a room nobody could be pulled out of was accepted")
end)

test(suite, "being the odd one out must be the largest source of doubt", function()
    --[[
        Section 6. If isolation or darkness ever outweighs it, the design has quietly turned back
        into a game about being alone in the dark — which is the genre it is deliberately not.
    ]]
    local report = ConfigValidator.validate(withField("Doubt", "risePerSecondOddOneOut", 0.1))
    expect(report.ok):toBeFalsy("a design where darkness outweighs disagreement was accepted")
end)

test(suite, "one player may not be allowed to spend the whole pool", function()
    expect(ConfigValidator.validate(withField("Depth", "maxDrainSharePerPlayer", 0)).ok):toBeFalsy(
        "a zero drain share was accepted"
    )
    expect(ConfigValidator.validate(withField("Depth", "maxDrainSharePerPlayer", 1.5)).ok):toBeFalsy(
        "a drain share above the whole pool was accepted"
    )
end)

test(suite, "a disconnected player must be held, not deleted", function()
    local report = ConfigValidator.validate(withField("Depth", "rejoinGraceSeconds", 0))
    expect(report.ok):toBeFalsy("a zero rejoin grace was accepted")
end)

test(suite, "a paired prompt needs a window two people can hit", function()
    local report = ConfigValidator.validate(withField("Depth", "pairedPromptWindowSeconds", 0))
    expect(report.ok):toBeFalsy("a zero paired-prompt window was accepted")
end)

return suite
