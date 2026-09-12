--!strict
--[[
    Server bootstrapper. Specification 0.3 allows exactly one Script on the server, and this
    is it: it requires modules and starts them in a defined order, and holds no gameplay
    logic of its own.
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.Config)
local Remotes = require(Shared.Remotes)
local ConfigValidator = require(Shared.Utility.ConfigValidator)
local Scheduler = require(Shared.Utility.Scheduler)
local ServiceRegistry = require(Shared.Utility.ServiceRegistry)

-- A malformed config stops the server here with a readable message rather than surfacing as
-- a nil index ten minutes into a round (specification 7).
ConfigValidator.assertValid(Config)

-- The match service owns all spawning; nobody arrives in a dream by accident.
Players.CharacterAutoLoads = false

-- Built before anything else so a service connecting in Start finds every remote present.
Remotes.get()

local registry = ServiceRegistry.new()

-- Gameplay services are registered here as later milestones add them. M1 delivers the
-- lifecycle itself, which the tests exercise with fakes; an empty registry starting cleanly
-- is the correct M1 behaviour, not a placeholder.
local servicesFolder = script:FindFirstChild("Services")
if servicesFolder then
    for _, module in servicesFolder:GetChildren() do
        if module:IsA("ModuleScript") then
            ServiceRegistry.register(registry, require(module) :: any)
        end
    end
end

ServiceRegistry.start(registry)

-- The single server Heartbeat (specification 2.2). Every periodic system registers a task
-- here at its own rate instead of connecting its own.
local scheduler = Scheduler.new()
Scheduler.start(scheduler)

game:BindToClose(function()
    Scheduler.stop(scheduler)
    ServiceRegistry.stop(registry)
end)
