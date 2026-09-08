--!strict
--[[
    Flashlight tiers (specification 6).

    All three tiers are findable loot and none of them is for sale (specification 4.2). An
    earlier draft sold the Premium tier with capped extra range; it failed the observer test
    in 4.1, because the paid player's light visibly reached further in front of everyone.

    What is sold is the skin — housing and beam colour — with range, battery, and detection
    identical across every skin. ConfigValidator asserts that no tier is marked purchasable
    rather than leaving it to review.
]]

export type FlashlightTier = {
    id: string,
    displayName: string,
    batterySeconds: number,
    rangeStuds: number,
    rechargePerSecondWhileOff: number,
    purchasable: boolean,
}

export type FlashlightConfigType = {
    tiers: { FlashlightTier },
    flickerBelowFraction: number,
    detectionPenaltyWhileLit: number,
    tickHz: number,
}

local FlashlightConfig: FlashlightConfigType = {
    tiers = {
        table.freeze({
            id = "Basic",
            displayName = "Flashlight",
            batterySeconds = 240,
            rangeStuds = 60,
            rechargePerSecondWhileOff = 2.0,
            purchasable = false,
        }),
        table.freeze({
            id = "Advanced",
            displayName = "Advanced Flashlight",
            batterySeconds = 300,
            rangeStuds = 66,
            rechargePerSecondWhileOff = 2.6,
            purchasable = false,
        }),
        table.freeze({
            id = "Premium",
            displayName = "Premium Flashlight",
            batterySeconds = 330,
            rangeStuds = 72,
            rechargePerSecondWhileOff = 3.0,
            purchasable = false,
        }),
    },
    flickerBelowFraction = 0.15,
    -- A lit flashlight makes the monster notice you sooner. The light is a trade, not a win.
    detectionPenaltyWhileLit = 1.35,
    tickHz = 2,
}

return table.freeze(FlashlightConfig)
