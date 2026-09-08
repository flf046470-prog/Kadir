--!strict
--[[
    Client bootstrapper. Specification 0.3 allows exactly one LocalScript, and this is it.
    Controllers follow the identical shape as server services.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Remotes = require(Shared.Remotes)
local ServiceRegistry = require(Shared.Utility.ServiceRegistry)

-- Waits for the server's remotes before any controller tries to connect to one.
Remotes.get()

local registry = ServiceRegistry.new()

local controllersFolder = script:FindFirstChild("Controllers")
if controllersFolder then
    for _, module in controllersFolder:GetChildren() do
        if module:IsA("ModuleScript") then
            ServiceRegistry.register(registry, require(module) :: any)
        end
    end
end

ServiceRegistry.start(registry)
