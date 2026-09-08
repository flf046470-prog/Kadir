--!strict
--[[
    The complete remote surface (specification 3.7).

    One module builds every remote on the server and waits for it on the client, so no
    `WaitForChild` chain is scattered through gameplay code.

    The dream stack deliberately adds no client-to-server remotes. Bedding down, descending,
    kicking, reviving a downed teammate, the Limbo call ritual and the wake point are all
    ProximityPrompt interactions, so they arrive through `RequestInteract` and are validated
    by tag and distance like everything else. If you find yourself adding `RequestKickUp`,
    you have moved a decision to the client that belongs on the server.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local FOLDER_NAME = "DreamLayersRemotes"
local WAIT_TIMEOUT = 30

-- Client to server. Every one of these is rate limited, type checked, state checked,
-- distance checked and legality checked, in that order, before any state is mutated.
local EVENTS_TO_SERVER = {
    "RequestInteract",
    "RequestUseItem",
    "RequestDropItem",
    "RequestMoveItem",
    "RequestToggleFlashlight",
    "RequestSubmitCode",
    "RequestQueue",
    "RequestLeaveQueue",
    "RequestPurchase",
    "RequestEquipCosmetic",
}

-- Server to client. Never a RemoteFunction: a malicious client can hang the server thread.
local EVENTS_TO_CLIENT = {
    "StateSnapshot",
    "PlayerStateSync",
    "InventorySync",
    "ObjectiveSync",
    "FearSync",
    "DepthSync",
    "StabilitySync",
    "HorrorCue",
    "EndingCinematic",
}

export type RemoteMap = { [string]: RemoteEvent }

local Remotes = {}

local cached: RemoteMap? = nil

local function buildOnServer(): RemoteMap
    local folder = ReplicatedStorage:FindFirstChild(FOLDER_NAME)
    if not folder then
        folder = Instance.new("Folder")
        folder.Name = FOLDER_NAME
        folder.Parent = ReplicatedStorage
    end
    assert(folder, "remote folder must exist")

    local map: RemoteMap = {}
    local function ensure(name: string)
        local existing = folder:FindFirstChild(name)
        if existing and existing:IsA("RemoteEvent") then
            map[name] = existing
            return
        end
        local remote = Instance.new("RemoteEvent")
        remote.Name = name
        remote.Parent = folder
        map[name] = remote
    end

    for _, name in EVENTS_TO_SERVER do
        ensure(name)
    end
    for _, name in EVENTS_TO_CLIENT do
        ensure(name)
    end
    return map
end

local function waitOnClient(): RemoteMap
    local folder = ReplicatedStorage:WaitForChild(FOLDER_NAME, WAIT_TIMEOUT)
    if not folder then
        error(`Remotes: "{FOLDER_NAME}" did not replicate within {WAIT_TIMEOUT}s`)
    end

    local map: RemoteMap = {}
    local function grab(name: string)
        local remote = folder:WaitForChild(name, WAIT_TIMEOUT)
        if not remote or not remote:IsA("RemoteEvent") then
            error(`Remotes: "{name}" did not replicate within {WAIT_TIMEOUT}s`)
        end
        map[name] = remote
    end

    for _, name in EVENTS_TO_SERVER do
        grab(name)
    end
    for _, name in EVENTS_TO_CLIENT do
        grab(name)
    end
    return map
end

-- Builds on the server, waits on the client, and memoises either way.
function Remotes.get(): RemoteMap
    if cached then
        return cached
    end
    local map = if RunService:IsServer() then buildOnServer() else waitOnClient()
    cached = map
    return map
end

function Remotes.expect(name: string): RemoteEvent
    local remote = Remotes.get()[name]
    if not remote then
        error(`Remotes.expect: no remote named "{name}"; add it to Remotes.luau deliberately`, 2)
    end
    return remote
end

-- Exposed so a test can assert the surface has not quietly grown.
function Remotes.names(): { string }
    local names: { string } = {}
    for _, name in EVENTS_TO_SERVER do
        table.insert(names, name)
    end
    for _, name in EVENTS_TO_CLIENT do
        table.insert(names, name)
    end
    return names
end

return Remotes
