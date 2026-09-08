--!strict
--[[
    Studio-only switches (specification 7).

    Every field defaults to off. The server must additionally gate all of them behind
    `RunService:IsStudio()`, so a shipped place ignores this table even if a value is left on
    by accident.
]]

export type DebugConfigType = {
    forceSeed: number?,
    skipToLayer: number?,
    forceDepth: number?,
    disableMonster: boolean,
    infiniteBattery: boolean,
    infiniteStability: boolean,
    verboseLogging: boolean,
}

local DebugConfig: DebugConfigType = {
    forceSeed = nil,
    skipToLayer = nil,
    forceDepth = nil,
    disableMonster = false,
    infiniteBattery = false,
    infiniteStability = false,
    verboseLogging = false,
}

return table.freeze(DebugConfig)
