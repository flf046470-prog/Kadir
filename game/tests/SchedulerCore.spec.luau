--!strict
local TestRunner = require("../src/testing/TestRunner")
local SchedulerCore = require("../src/shared/Utility/SchedulerCore")

local expect = TestRunner.expect
local suite = TestRunner.suite("SchedulerCore — one heartbeat, many rates")
local test = TestRunner.test

test(suite, "a task is due on its first update", function()
    local core = SchedulerCore.new()
    SchedulerCore.register(core, "monster", 10)
    expect(#SchedulerCore.update(core, 1 / 60)):toBe(1, "a fresh task should fire immediately")
end)

-- Counts fires over `seconds` of simulated 60 fps frames.
local function fireCount(hz: number, seconds: number): number
    local core = SchedulerCore.new()
    SchedulerCore.register(core, "task", hz)
    SchedulerCore.update(core, 0) -- consume the initial due tick

    local fires = 0
    for _ = 1, math.floor(60 * seconds) do
        for _, name in SchedulerCore.update(core, 1 / 60) do
            if name == "task" then
                fires += 1
            end
        end
    end
    return fires
end

test(suite, "the tick rate does not drift over a long run", function()
    --[[
        Asserting an exact count in a one-second window would be asserting phase: the
        boundary tick can land either side of it. What must hold is that the rate is right
        over time, within a tick of the ideal.

        This is not a theoretical concern. Resetting the accumulator to zero on each fire —
        the obvious implementation — discards a fraction of a period every tick, and a 10 Hz
        task then runs at about 8.5 Hz. That is a 15% loss on the monster's think rate.
    ]]
    for _, hz in { 2, 4, 10 } do
        local ideal = hz * 10
        local fires = fireCount(hz, 10)
        expect(math.abs(fires - ideal) <= 1):toBeTruthy(
            `{hz} Hz produced {fires} fires over ten seconds, expected about {ideal}`
        )
    end
end)

test(suite, "a long frame does not replay a backlog", function()
    -- A server that hitched for two seconds should resume its work, not run twenty
    -- catch-up ticks and hitch again.
    local core = SchedulerCore.new()
    SchedulerCore.register(core, "ai", 10)
    SchedulerCore.update(core, 0)

    local due = SchedulerCore.update(core, 2.0)
    local count = 0
    for _, name in due do
        if name == "ai" then
            count += 1
        end
    end
    expect(count):toBe(1, "a two-second frame replayed the backlog")
end)

test(suite, "rates are independent", function()
    local core = SchedulerCore.new()
    SchedulerCore.register(core, "fast", 10)
    SchedulerCore.register(core, "slow", 1)
    SchedulerCore.update(core, 0)

    local fast, slow = 0, 0
    for _ = 1, 600 do
        for _, name in SchedulerCore.update(core, 1 / 60) do
            if name == "fast" then
                fast += 1
            else
                slow += 1
            end
        end
    end
    -- Ten simulated seconds: 100 fires at 10 Hz and 10 at 1 Hz, within a tick either way.
    expect(math.abs(fast - 100) <= 1):toBeTruthy(`10 Hz task fired {fast} times, expected 100`)
    expect(math.abs(slow - 10) <= 1):toBeTruthy(`1 Hz task fired {slow} times, expected 10`)
end)

test(suite, "a disabled task does not fire and can be re-enabled", function()
    local core = SchedulerCore.new()
    SchedulerCore.register(core, "battery", 2)
    SchedulerCore.update(core, 0)

    SchedulerCore.setEnabled(core, "battery", false)
    expect(#SchedulerCore.update(core, 5)):toBe(0, "a disabled task fired")

    SchedulerCore.setEnabled(core, "battery", true)
    expect(#SchedulerCore.update(core, 5)):toBe(1, "a re-enabled task did not fire")
end)

test(suite, "unregister removes a task", function()
    local core = SchedulerCore.new()
    SchedulerCore.register(core, "autosave", 1)
    SchedulerCore.unregister(core, "autosave")
    expect(#SchedulerCore.update(core, 10)):toBe(0)
    expect(#core.tasks):toBe(0, "the task list still holds the removed task")
end)

test(suite, "duplicate names are rejected", function()
    local core = SchedulerCore.new()
    SchedulerCore.register(core, "monster", 10)
    expect(function()
        SchedulerCore.register(core, "monster", 4)
    end):toErrorWith("duplicate task name")
end)

test(suite, "a non-positive rate is rejected", function()
    local core = SchedulerCore.new()
    expect(function()
        SchedulerCore.register(core, "bad", 0)
    end):toErrorWith("positive rate")
end)

test(suite, "a negative delta is rejected", function()
    local core = SchedulerCore.new()
    expect(function()
        SchedulerCore.update(core, -1)
    end):toErrorWith("must not be negative")
end)

return suite
