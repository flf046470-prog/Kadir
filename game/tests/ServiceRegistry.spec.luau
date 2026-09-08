--!strict
local TestRunner = require("../src/testing/TestRunner")
local ServiceRegistry = require("../src/shared/Utility/ServiceRegistry")

local expect = TestRunner.expect
local suite = TestRunner.suite("ServiceRegistry — lifecycle")
local test = TestRunner.test

local function fake(name: string, log: { string }, priority: number?)
    return {
        Name = name,
        Priority = priority,
        Init = function()
            table.insert(log, `init:{name}`)
        end,
        Start = function()
            table.insert(log, `start:{name}`)
        end,
        Stop = function()
            table.insert(log, `stop:{name}`)
        end,
    }
end

test(suite, "every Init runs before any Start", function()
    -- This is the whole point of two passes: by the time any Start runs, every service
    -- exists, so cross-service calls in Start are safe.
    local log = {}
    local registry = ServiceRegistry.new()
    ServiceRegistry.register(registry, fake("A", log))
    ServiceRegistry.register(registry, fake("B", log))
    ServiceRegistry.start(registry)
    expect(table.concat(log, ",")):toBe("init:A,init:B,start:A,start:B")
end)

test(suite, "lower priority initialises first", function()
    local log = {}
    local registry = ServiceRegistry.new()
    ServiceRegistry.register(registry, fake("late", log, 200))
    ServiceRegistry.register(registry, fake("early", log, 1))
    ServiceRegistry.start(registry)
    expect(log[1]):toBe("init:early")
end)

test(suite, "equal priorities keep registration order", function()
    local log = {}
    local registry = ServiceRegistry.new()
    ServiceRegistry.register(registry, fake("first", log, 50))
    ServiceRegistry.register(registry, fake("second", log, 50))
    ServiceRegistry.start(registry)
    expect(log[1]):toBe("init:first")
    expect(log[2]):toBe("init:second")
end)

test(suite, "an unset priority defaults behind an explicit low one", function()
    local log = {}
    local registry = ServiceRegistry.new()
    ServiceRegistry.register(registry, fake("default", log))
    ServiceRegistry.register(registry, fake("explicit", log, 10))
    ServiceRegistry.start(registry)
    expect(log[1]):toBe("init:explicit")
end)

test(suite, "services with no callbacks are allowed", function()
    local registry = ServiceRegistry.new()
    ServiceRegistry.register(registry, { Name = "Bare" })
    ServiceRegistry.start(registry)
    expect(registry.phase):toBe("Started")
end)

test(suite, "an empty registry starts cleanly", function()
    -- M1 ships no gameplay services; an empty registry starting is correct, not a stub.
    local registry = ServiceRegistry.new()
    ServiceRegistry.start(registry)
    expect(registry.phase):toBe("Started")
end)

test(suite, "get resolves a peer and errors on a typo", function()
    local registry = ServiceRegistry.new()
    local service = ServiceRegistry.register(registry, { Name = "Match" })
    expect(ServiceRegistry.get(registry, "Match")):toBe(service)
    expect(function()
        ServiceRegistry.get(registry, "Mtach")
    end):toErrorWith('no service named "Mtach"')
end)

test(suite, "find returns nil rather than erroring", function()
    local registry = ServiceRegistry.new()
    expect(ServiceRegistry.find(registry, "Absent")):toBe(nil)
end)

test(suite, "duplicate and unnamed services are rejected", function()
    local registry = ServiceRegistry.new()
    ServiceRegistry.register(registry, { Name = "Only" })
    expect(function()
        ServiceRegistry.register(registry, { Name = "Only" })
    end):toErrorWith("duplicate service name")
    expect(function()
        ServiceRegistry.register(registry, { Name = "" })
    end):toErrorWith("non-empty Name")
end)

test(suite, "registering after startup is rejected", function()
    local registry = ServiceRegistry.new()
    ServiceRegistry.start(registry)
    expect(function()
        ServiceRegistry.register(registry, { Name = "TooLate" })
    end):toErrorWith("registered after startup began")
end)

test(suite, "starting twice is rejected", function()
    local registry = ServiceRegistry.new()
    ServiceRegistry.start(registry)
    expect(function()
        ServiceRegistry.start(registry)
    end):toErrorWith("already started")
end)

test(suite, "stop tears down in reverse priority order", function()
    local log = {}
    local registry = ServiceRegistry.new()
    ServiceRegistry.register(registry, fake("early", log, 1))
    ServiceRegistry.register(registry, fake("late", log, 200))
    ServiceRegistry.start(registry)
    table.clear(log)
    ServiceRegistry.stop(registry)
    expect(log[1]):toBe("stop:late")
    expect(log[2]):toBe("stop:early")
    expect(registry.phase):toBe("Stopped")
end)

return suite
