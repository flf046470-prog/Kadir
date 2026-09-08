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
    second.monsterSpeedScale = 0.5
    stops[2] = second
    local report = ConfigValidator.validate(withField("Distortion", "stops", stops))
    expect(report.ok):toBeFalsy("a monster that slows down with depth was accepted")
end)

test(suite, "a dream naming an unknown monster profile is rejected", function()
    local dreams = table.clone(configs.Layer.dreams :: any)
    local first = table.clone(dreams[1] :: any)
    first.monsterProfileId = "Nonexistent"
    dreams[1] = first
    local report = ConfigValidator.validate(withField("Layer", "dreams", dreams))
    expect(report.ok):toBeFalsy()
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

return suite
