--!strict
--[[
    Cleanup bookkeeping (specification 2.2: every connection made for a player, character, or
    round is disconnected when that thing ends; unbounded connection growth is a failure).

    Deliberately structural rather than Roblox-typed: anything with `Disconnect`, `Destroy`,
    or `destroy`, plus plain functions and other Troves, can be tracked. That keeps this
    module free of `game` and lets the tests use fakes that record whether they were cleaned.
]]

export type Trackable = any

export type Trove = {
    objects: { Trackable },
    cleaned: boolean,
}

local Trove = {}

function Trove.new(): Trove
    return { objects = {}, cleaned = false }
end

-- Tracks `object` and returns it, so `local c = Trove.add(trove, signal:Connect(f))` reads well.
function Trove.add<T>(trove: Trove, object: T): T
    if trove.cleaned then
        error("Trove.add: this trove has already been cleaned", 2)
    end
    table.insert(trove.objects, object)
    return object
end

local function cleanupOne(object: Trackable)
    if type(object) == "function" then
        object()
        return
    end
    if type(object) == "table" then
        -- Another Trove.
        if object.objects ~= nil and object.cleaned ~= nil then
            Trove.clean(object)
            return
        end
        local disconnect = object.Disconnect or object.disconnect
        if type(disconnect) == "function" then
            disconnect(object)
            return
        end
        local destroy = object.Destroy or object.destroy
        if type(destroy) == "function" then
            destroy(object)
            return
        end
    end
    if typeof(object) == "RBXScriptConnection" then
        object:Disconnect()
        return
    end
    if typeof(object) == "Instance" then
        object:Destroy()
        return
    end
    error(`Trove: do not know how to clean up a {typeof(object)}`)
end

--[[
    Cleans everything in reverse order of addition, so a connection added after the instance
    it listens to is disconnected before that instance is destroyed.

    Marks the trove cleaned so a stale reference cannot quietly start collecting again.
]]
function Trove.clean(trove: Trove)
    for index = #trove.objects, 1, -1 do
        local object = trove.objects[index]
        trove.objects[index] = nil
        cleanupOne(object)
    end
    trove.cleaned = true
end

-- Cleans without retiring the trove, for something reused every round.
function Trove.reset(trove: Trove)
    Trove.clean(trove)
    trove.cleaned = false
end

function Trove.size(trove: Trove): number
    return #trove.objects
end

return Trove
