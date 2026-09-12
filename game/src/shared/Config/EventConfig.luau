--!strict
--[[
    Random event rarity tiers (specification 4, P1 item 20).

    Section 11 makes two of these binding: at least three implemented events must produce no
    threat at all, and rare events must be memorable enough to describe to someone else.
]]

export type EventTier = {
    id: string,
    weight: number,
    harmless: boolean,
}

export type EventConfigType = {
    tiers: { EventTier },
    minSecondsBetweenEvents: number,
    maxStingersPerNinetySeconds: number,
    requiredSilenceSecondsPerLayer: number,
}

local EventConfig: EventConfigType = {
    tiers = {
        table.freeze({ id = "Common", weight = 60, harmless = true }),
        table.freeze({ id = "Uncommon", weight = 25, harmless = true }),
        table.freeze({ id = "Rare", weight = 10, harmless = false }),
        table.freeze({ id = "VeryRare", weight = 4, harmless = false }),
        table.freeze({ id = "Legendary", weight = 1, harmless = false }),
    },
    minSecondsBetweenEvents = 25,
    maxStingersPerNinetySeconds = 1,
    requiredSilenceSecondsPerLayer = 20,
}

return table.freeze(EventConfig)
