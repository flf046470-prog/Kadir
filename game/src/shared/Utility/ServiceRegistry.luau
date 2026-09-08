--!strict
--[[
    Service lifecycle (specification 3.1).

    A service never requires another service at module scope; it resolves dependencies
    through this registry inside `Start`. That is what prevents cyclic requires and what
    makes a service testable on its own.

    Pure: the registry holds plain tables and calls plain methods, so the tests drive the
    whole lifecycle with fakes and no DataModel.
]]

export type Service = {
    Name: string,
    Priority: number?,
    Init: ((self: any) -> ())?,
    Start: ((self: any) -> ())?,
    Stop: ((self: any) -> ())?,
    [any]: any,
}

export type Phase = "Registering" | "Initialised" | "Started" | "Stopped"

export type Registry = {
    services: { Service },
    byName: { [string]: Service },
    phase: Phase,
}

local ServiceRegistry = {}

local DEFAULT_PRIORITY = 100

function ServiceRegistry.new(): Registry
    return { services = {}, byName = {}, phase = "Registering" }
end

function ServiceRegistry.register(registry: Registry, service: Service): Service
    if registry.phase ~= "Registering" then
        error(`ServiceRegistry.register: "{service.Name}" registered after startup began`, 2)
    end
    if type(service.Name) ~= "string" or service.Name == "" then
        error("ServiceRegistry.register: every service needs a non-empty Name", 2)
    end
    if registry.byName[service.Name] then
        error(`ServiceRegistry.register: duplicate service name "{service.Name}"`, 2)
    end
    registry.byName[service.Name] = service
    table.insert(registry.services, service)
    return service
end

--[[
    Looks up a peer. Errors rather than returning nil: a typo in a service name should stop
    the server at startup with a readable message, not surface as a nil index ten minutes
    into a round.
]]
function ServiceRegistry.get(registry: Registry, name: string): Service
    local service = registry.byName[name]
    if not service then
        error(`ServiceRegistry.get: no service named "{name}"`, 2)
    end
    return service
end

function ServiceRegistry.find(registry: Registry, name: string): Service?
    return registry.byName[name]
end

local function sortedByPriority(registry: Registry): { Service }
    local ordered = table.clone(registry.services)
    -- Stable: equal priorities keep registration order, so startup is reproducible.
    local indexOf: { [Service]: number } = {}
    for index, service in registry.services do
        indexOf[service] = index
    end
    table.sort(ordered, function(a: Service, b: Service): boolean
        local pa = a.Priority or DEFAULT_PRIORITY
        local pb = b.Priority or DEFAULT_PRIORITY
        if pa == pb then
            return indexOf[a] < indexOf[b]
        end
        return pa < pb
    end)
    return ordered
end

--[[
    Runs every `Init` in priority order, then every `Start` in the same order.

    The two passes are the whole point: `Init` may only build a service's own state, so by
    the time any `Start` runs every service exists and cross-service calls are safe.
]]
function ServiceRegistry.start(registry: Registry)
    if registry.phase ~= "Registering" then
        error("ServiceRegistry.start: already started", 2)
    end

    local ordered = sortedByPriority(registry)

    for _, service in ordered do
        local init = service.Init
        if init then
            init(service)
        end
    end
    registry.phase = "Initialised"

    for _, service in ordered do
        local start = service.Start
        if start then
            start(service)
        end
    end
    registry.phase = "Started"
end

-- Tears down in reverse priority order. Used by tests and by BindToClose paths.
function ServiceRegistry.stop(registry: Registry)
    local ordered = sortedByPriority(registry)
    for index = #ordered, 1, -1 do
        local stop = ordered[index].Stop
        if stop then
            stop(ordered[index])
        end
    end
    registry.phase = "Stopped"
end

return ServiceRegistry
