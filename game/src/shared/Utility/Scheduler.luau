--!strict
--[[
    The Roblox half of the scheduler: one Heartbeat connection, feeding SchedulerCore.

    Specification 2.2 allows exactly one RunService connection per side. Every periodic
    system registers a callback here — room incoherence at 5 Hz, doubt at 4 Hz, battery at 2 Hz,
    autosave at 1/120 Hz — instead of connecting its own Heartbeat.
]]

local RunService = game:GetService("RunService")

local SchedulerCore = require(script.Parent.SchedulerCore)
local Trove = require(script.Parent.Trove)

export type Scheduler = {
    core: SchedulerCore.Core,
    callbacks: { [string]: (deltaTime: number) -> () },
    trove: Trove.Trove,
    running: boolean,
}

local Scheduler = {}

function Scheduler.new(): Scheduler
    return {
        core = SchedulerCore.new(),
        callbacks = {},
        trove = Trove.new(),
        running = false,
    }
end

function Scheduler.register(
    scheduler: Scheduler,
    name: string,
    hz: number,
    callback: (deltaTime: number) -> ()
)
    SchedulerCore.register(scheduler.core, name, hz)
    scheduler.callbacks[name] = callback
end

function Scheduler.unregister(scheduler: Scheduler, name: string)
    SchedulerCore.unregister(scheduler.core, name)
    scheduler.callbacks[name] = nil
end

function Scheduler.setEnabled(scheduler: Scheduler, name: string, enabled: boolean)
    SchedulerCore.setEnabled(scheduler.core, name, enabled)
end

--[[
    Starts the single Heartbeat connection.

    A task that errors is reported and the others still run: one broken system must not stop
    the incoherence sweep, the autosave, and the doubt model along with it.
]]
function Scheduler.start(scheduler: Scheduler)
    if scheduler.running then
        error("Scheduler.start: already running", 2)
    end
    scheduler.running = true

    local connection = RunService.Heartbeat:Connect(function(deltaTime: number)
        local due = SchedulerCore.update(scheduler.core, deltaTime)
        for _, name in due do
            local callback = scheduler.callbacks[name]
            if callback then
                local ok, err = pcall(callback, deltaTime)
                if not ok then
                    warn(`Scheduler: task "{name}" errored: {err}`)
                end
            end
        end
    end)

    Trove.add(scheduler.trove, connection)
end

function Scheduler.stop(scheduler: Scheduler)
    Trove.clean(scheduler.trove)
    scheduler.running = false
end

return Scheduler
