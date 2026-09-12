--!strict
--[[
    A small test harness for the pure modules, run by Lune.

    Not synced into the place: `default.project.json` maps `src/shared`, `src/server` and
    `src/client` individually, so this folder and `tests/` never reach a running game.

    Deliberately tiny. A test framework with its own dependencies is a thing that can break
    and hide a real failure; this one is a few dozen lines you can read in a minute.
]]

export type Suite = {
    name: string,
    cases: { { name: string, run: () -> () } },
}

export type Results = {
    passed: number,
    failed: number,
    assertions: number,
    failures: { string },
}

local TestRunner = {}

local assertionCount = 0

local Expect = {}
Expect.__index = Expect

export type Expectation = {
    value: any,
    toBe: (self: Expectation, expected: any, message: string?) -> (),
    toBeCloseTo: (self: Expectation, expected: any, tolerance: number?, message: string?) -> (),
    toBeTruthy: (self: Expectation, message: string?) -> (),
    toBeFalsy: (self: Expectation, message: string?) -> (),
    toErrorWith: (self: Expectation, needle: string?) -> (),
}

local function describeValue(value: any): string
    if type(value) == "string" then
        return `"{value}"`
    end
    return tostring(value)
end

function Expect.toBe(self: Expectation, expected: any, message: string?)
    assertionCount += 1
    if self.value ~= expected then
        error(
            `{message or "expected"} {describeValue(expected)}, got {describeValue(self.value)}`,
            2
        )
    end
end

function Expect.toBeCloseTo(self: Expectation, expected: any, tolerance: number?, message: string?)
    assertionCount += 1
    local limit = tolerance or 1e-9
    if type(self.value) ~= "number" or math.abs(self.value - expected) > limit then
        error(
            `{message or "expected"} {describeValue(expected)} ± {limit}, got {describeValue(
                self.value
            )}`,
            2
        )
    end
end

function Expect.toBeTruthy(self: Expectation, message: string?)
    assertionCount += 1
    if not self.value then
        error(`{message or "expected a truthy value"}, got {describeValue(self.value)}`, 2)
    end
end

function Expect.toBeFalsy(self: Expectation, message: string?)
    assertionCount += 1
    if self.value then
        error(`{message or "expected a falsy value"}, got {describeValue(self.value)}`, 2)
    end
end

-- Asserts the wrapped function raises, optionally containing `needle`.
function Expect.toErrorWith(self: Expectation, needle: string?)
    assertionCount += 1
    if type(self.value) ~= "function" then
        error("toErrorWith expects a function", 2)
    end
    local ok, err = pcall(self.value)
    if ok then
        error("expected an error, but the call succeeded", 2)
    end
    if needle and not string.find(tostring(err), needle, 1, true) then
        error(`expected an error containing "{needle}", got "{tostring(err)}"`, 2)
    end
end

function TestRunner.expect(value: any): Expectation
    return setmetatable({ value = value }, Expect) :: any
end

function TestRunner.suite(name: string): Suite
    return { name = name, cases = {} }
end

function TestRunner.test(suite: Suite, name: string, run: () -> ())
    table.insert(suite.cases, { name = name, run = run })
end

function TestRunner.run(suites: { Suite }): Results
    local results: Results = { passed = 0, failed = 0, assertions = 0, failures = {} }
    assertionCount = 0

    for _, suite in suites do
        print(`\n  {suite.name}`)
        for _, case in suite.cases do
            local ok, err = pcall(case.run)
            if ok then
                results.passed += 1
                print(`    ok    {case.name}`)
            else
                results.failed += 1
                print(`    FAIL  {case.name}`)
                print(`          {tostring(err)}`)
                table.insert(results.failures, `{suite.name} / {case.name}: {tostring(err)}`)
            end
        end
    end

    results.assertions = assertionCount
    return results
end

return TestRunner
