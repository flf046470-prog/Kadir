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
    --[[
        The switch that makes 3.6 testable by one person. Forcing a lens lets a developer
        walk the same room twice and see both readings of it; without this, every
        divergence bug needs two machines to reproduce.
    ]]
    forceLens: number?,
    freezeDivergence: boolean,
    infiniteBattery: boolean,
    infiniteStability: boolean,
    verboseLogging: boolean,
}

local DebugConfig: DebugConfigType = {
    forceSeed = nil,
    skipToLayer = nil,
    forceDepth = nil,
    forceLens = nil,
    freezeDivergence = false,
    infiniteBattery = false,
    infiniteStability = false,
    verboseLogging = false,
}

return table.freeze(DebugConfig)
