--!strict
local TestRunner = require("../src/testing/TestRunner")
local Trove = require("../src/shared/Utility/Trove")

local expect = TestRunner.expect
local suite = TestRunner.suite("Trove — no leaked connections")
local test = TestRunner.test

local function fakeConnection(log: { string }, name: string)
    return {
        Disconnect = function()
            table.insert(log, name)
        end,
    }
end

test(suite, "add returns what it was given", function()
    local trove = Trove.new()
    local object = { Destroy = function() end }
    expect(Trove.add(trove, object)):toBe(object)
end)

test(suite, "clean disconnects connections and calls functions", function()
    local log = {}
    local trove = Trove.new()
    Trove.add(trove, fakeConnection(log, "connection"))
    Trove.add(trove, function()
        table.insert(log, "function")
    end)
    Trove.clean(trove)
    expect(#log):toBe(2)
end)

test(suite, "cleanup runs in reverse order of addition", function()
    -- A connection added after the instance it listens to must be disconnected first.
    local log = {}
    local trove = Trove.new()
    Trove.add(trove, fakeConnection(log, "first"))
    Trove.add(trove, fakeConnection(log, "second"))
    Trove.clean(trove)
    expect(log[1]):toBe("second")
    expect(log[2]):toBe("first")
end)

test(suite, "Destroy is used when there is no Disconnect", function()
    local destroyed = false
    local trove = Trove.new()
    Trove.add(trove, {
        Destroy = function()
            destroyed = true
        end,
    })
    Trove.clean(trove)
    expect(destroyed):toBeTruthy()
end)

test(suite, "nested troves are cleaned", function()
    local log = {}
    local outer, inner = Trove.new(), Trove.new()
    Trove.add(inner, fakeConnection(log, "inner"))
    Trove.add(outer, inner)
    Trove.clean(outer)
    expect(log[1]):toBe("inner")
    expect(inner.cleaned):toBeTruthy()
end)

test(suite, "clean empties the trove and marks it retired", function()
    local trove = Trove.new()
    Trove.add(trove, function() end)
    Trove.clean(trove)
    expect(Trove.size(trove)):toBe(0)
    expect(trove.cleaned):toBeTruthy()
end)

test(suite, "adding to a cleaned trove is an error", function()
    -- A stale reference must not quietly start collecting again.
    local trove = Trove.new()
    Trove.clean(trove)
    expect(function()
        Trove.add(trove, function() end)
    end):toErrorWith("already been cleaned")
end)

test(suite, "reset allows reuse across rounds", function()
    local count = 0
    local trove = Trove.new()
    Trove.add(trove, function()
        count += 1
    end)
    Trove.reset(trove)
    expect(trove.cleaned):toBeFalsy()
    Trove.add(trove, function()
        count += 1
    end)
    Trove.clean(trove)
    expect(count):toBe(2)
end)

test(suite, "an untrackable value is rejected loudly", function()
    local trove = Trove.new()
    Trove.add(trove, 42 :: any)
    expect(function()
        Trove.clean(trove)
    end):toErrorWith("do not know how to clean up")
end)

return suite
