--!strict
--[[
    The pure half of the scheduler.

    Specification 2.2 allows exactly one `RunService.Heartbeat` connection on the server and
    one on the client. Every periodic system registers a task here instead of connecting its
    own. This module owns the "what is due" decision and knows nothing about RunService;
    `Scheduler.luau` is the thin adapter that feeds it real frame deltas.
]]

export type Task = {
    name: string,
    interval: number,
    accumulator: number,
    enabled: boolean,
}

export type Core = {
    tasks: { Task },
    byName: { [string]: Task },
    elapsed: number,
}

local SchedulerCore = {}

function SchedulerCore.new(): Core
    return { tasks = {}, byName = {}, elapsed = 0 }
end

--[[
    Registers a task ticking at `hz` (10 Hz for monster AI, 4 Hz for fear, and so on).
    Re-registering a name is a programming error rather than a silent replacement: two
    systems sharing a tick name would each see half their ticks.
]]
function SchedulerCore.register(core: Core, name: string, hz: number): Task
    if core.byName[name] then
        error(`SchedulerCore.register: duplicate task name "{name}"`, 2)
    end
    if hz <= 0 then
        error(`SchedulerCore.register: "{name}" needs a positive rate, got {hz}`, 2)
    end

    local task: Task = {
        name = name,
        interval = 1 / hz,
        -- Start due, so a system does its first pass on the very next frame.
        accumulator = 1 / hz,
        enabled = true,
    }
    table.insert(core.tasks, task)
    core.byName[name] = task
    return task
end

function SchedulerCore.setEnabled(core: Core, name: string, enabled: boolean)
    local task = core.byName[name]
    if not task then
        error(`SchedulerCore.setEnabled: no task named "{name}"`, 2)
    end
    task.enabled = enabled
end

function SchedulerCore.unregister(core: Core, name: string)
    local task = core.byName[name]
    if not task then
        return
    end
    core.byName[name] = nil
    local index = table.find(core.tasks, task)
    if index then
        table.remove(core.tasks, index)
    end
end

--[[
    Advances by `deltaTime` and returns the names due this frame, in registration order.

    A task never fires more than once per update no matter how long the frame was. A server
    that hitched for two seconds should resume its 10 Hz work, not run twenty catch-up ticks
    and hitch again.
]]
function SchedulerCore.update(core: Core, deltaTime: number): { string }
    if deltaTime < 0 then
        error("SchedulerCore.update: deltaTime must not be negative", 2)
    end
    core.elapsed += deltaTime

    local due: { string } = {}
    for _, task in core.tasks do
        if not task.enabled then
            continue
        end
        task.accumulator += deltaTime
        if task.accumulator >= task.interval then
            table.insert(due, task.name)
            -- Carry the remainder so the rate does not drift. Resetting to zero here loses
            -- a fraction of a period every tick, which turns 10 Hz into roughly 9 Hz.
            task.accumulator -= task.interval
            if task.accumulator >= task.interval then
                -- A stall banked more than a whole period. Drop it rather than firing back
                -- to back for the next several frames to catch up.
                task.accumulator = 0
            end
        end
    end
    return due
end

return SchedulerCore
