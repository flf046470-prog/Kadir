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
    falseConcession: number,
    firstCorroboration: number,
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
    dissolveWarningSeconds: number,
    descentFallSeconds: number,
    kickRiseSeconds: number,
    maxConcurrentLayers: number,
    layerYSpacing: number,
    layerDestroyGraceSeconds: number,
    crossDepthAudioBoundaries: number,
    totemReadSeconds: number,
    totemCooldownSeconds: number,
    maxDrainSharePerPlayer: number,
    rejoinGraceSeconds: number,
    pairedPromptWindowSeconds: number,
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
        -- 3.6.5. The team agreed on the wrong thing. This replaces a monster landing a
        -- hit, and it is better, because they chose it.
        falseConcession = -8,
        -- Saying what you see pays, once per set, so it is worth doing before you need to.
        firstCorroboration = 4,
        objectiveStepCompleted = 15,
        sedativeDoseFound = 20,
        perMinuteElapsed = -2,
        limboCallRitual = -30,
    }),

    -- 3.6.4. How long a room telegraphs that it is coming apart before anybody falls. The
    -- player must have time to realise that standing still was a decision.
    dissolveWarningSeconds = 4,
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

    -- Specification 3.2.5. A shared pool with no limit is a griefing surface: one player
    -- descending on purpose, repeatedly, ends everybody's round. Past this share of the
    -- round's total loss, a player's further *voluntary* costs stop draining the team.
    -- Involuntary costs are never capped, because those are the game working.
    maxDrainSharePerPlayer = 0.5,

    -- Specification 3.2.12. A disconnected player keeps their depth and inventory this long.
    rejoinGraceSeconds = 120,

    -- Specification 3.2.11. Both halves of a paired prompt must be held inside this window,
    -- by two players one depth apart.
    pairedPromptWindowSeconds = 2,
}

return table.freeze(DepthConfig)
