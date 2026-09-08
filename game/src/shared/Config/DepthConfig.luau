--!strict
--[[
    The dream stack (specification 3.2). Everything about descent, the kick, stability, and
    Limbo is tuned from here.

    The stability numbers are a starting point, not law. They are shaped so that a run of
    pure failure ends, and a run with any objective progress recovers.
]]

export type StabilityLedgerType = {
    roundStart: number,
    failedPuzzleAttempt: number,
    involuntaryDescent: number,
    voluntaryDescent: number,
    synchronisedKick: number,
    soloKick: number,
    monsterAttackLanded: number,
    objectiveStepCompleted: number,
    sedativeDoseFound: number,
    perMinuteElapsed: number,
    limboCallRitual: number,
}

export type DepthConfigType = {
    maxDepth: number,
    limboDepth: number,
    minimum: number,
    maximum: number,
    stability: StabilityLedgerType,
    reviveWindowSeconds: number,
    reviveHoldSeconds: number,
    descentFallSeconds: number,
    kickRiseSeconds: number,
    maxConcurrentLayers: number,
    layerYSpacing: number,
    layerDestroyGraceSeconds: number,
    crossDepthAudioBoundaries: number,
    totemReadSeconds: number,
    totemCooldownSeconds: number,
}

local DepthConfig: DepthConfigType = {
    maxDepth = 3,
    limboDepth = 4,
    minimum = 0,
    maximum = 100,

    stability = table.freeze({
        roundStart = 100,
        failedPuzzleAttempt = -4,
        involuntaryDescent = -10,
        voluntaryDescent = -5,
        synchronisedKick = -6,
        soloKick = -12,
        monsterAttackLanded = -8,
        objectiveStepCompleted = 15,
        sedativeDoseFound = 20,
        perMinuteElapsed = -2,
        limboCallRitual = -30,
    }),

    reviveWindowSeconds = 45,
    reviveHoldSeconds = 6,
    descentFallSeconds = 3,
    kickRiseSeconds = 2,

    -- Specification 3.2.10. Three concurrent layers is the ceiling the part budget in 2.8
    -- was restated around; a fourth requires an empty one to be destroyed first.
    maxConcurrentLayers = 3,
    layerYSpacing = -3000,
    layerDestroyGraceSeconds = 20,

    -- Teammates are audible across exactly one depth boundary. Two levels apart is silence.
    crossDepthAudioBoundaries = 1,

    totemReadSeconds = 2,
    totemCooldownSeconds = 45,
}

return table.freeze(DepthConfig)
