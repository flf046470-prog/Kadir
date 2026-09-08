--!strict
-- Progression curve (specification 4, P1 item 25). Cosmetic only; no gameplay gating.

export type RewardConfigType = {
    maxLevel: number,
    baseXpForLevel: number,
    xpCurveExponent: number,
    coinsPerDreamCleared: number,
    coinsPerWake: number,
    xpPerDreamCleared: number,
    xpPerWake: number,
    xpPerTeammateRevived: number,
}

local RewardConfig: RewardConfigType = {
    maxLevel = 60,
    baseXpForLevel = 120,
    xpCurveExponent = 1.35,
    coinsPerDreamCleared = 40,
    coinsPerWake = 150,
    xpPerDreamCleared = 60,
    xpPerWake = 220,
    xpPerTeammateRevived = 25,
}

return table.freeze(RewardConfig)
