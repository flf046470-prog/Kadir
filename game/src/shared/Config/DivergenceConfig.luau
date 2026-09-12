--!strict
--[[
    Divergence — the world as the antagonist (specification 3.6).

    This config replaces the monster entirely. Nothing in this game chases the player; the
    pressure comes from the dream showing different things to different people, and from the
    fact that a room nobody can agree on stops holding them up.

    Every number here is tuning. The shape of the system is in the spec and in
    `Utility/Divergence.luau`, which is pure and takes these tables as arguments.
]]

export type DivergenceLedgerType = {
    roundStart: number,
    perMinuteElapsed: number,
    perMinutePerDepthLevel: number,
    failedTaskAttempt: number,
    involuntaryDescent: number,
    falseConcession: number,
    firstCorroboration: number,
    setCollapsedByAgreement: number,
    objectiveStepCompleted: number,
}

export type DivergenceConfigType = {
    minimum: number,
    maximum: number,

    -- 3.6.2. How many readings of the world can exist at once, and the divergence values at
    -- which each additional one appears.
    maxLenses: number,
    lensThresholds: { number },

    ledger: DivergenceLedgerType,

    -- 3.6.4. A room above this much incoherence starts dissolving under the people in it.
    dissolveThreshold: number,
    dissolveSeconds: number,

    -- 3.6.5. How long a teammate must hold the anchor prompt to stop a room dissolving.
    anchorHoldSeconds: number,

    -- Section 6. Holding a contested set in a flashlight beam asserts your reading of it over
    -- everybody else's, which is useful and loud and makes the room worse.
    assertionSeconds: number,
    assertionWeight: number,

    -- 3.2.3. Incoherence does not accrue for this long after an earned arrival.
    graceSecondsAfterLayerEnter: number,
    graceAppliesToDescentFromDissolvingRoom: boolean,

    -- Section 5, layer 4. Three anchors inside one window, or sequentially against a decay
    -- timer when one player is alone in the round.
    synchroniseWindowSeconds: number,
    anchorDecaySeconds: number,

    -- 3.6.6. The first dream at the surface does not disagree with itself until the players
    -- have had time to learn what it looks like when it agrees.
    pinnedUntilFirstObjectiveStep: boolean,

    -- 2.8 / 3.6.1. Authoring ceilings the builder enforces.
    maxSetsPerLayer: number,
    maxVariantsPerSet: number,

    -- 3.8. NPCs react to typed chat, matched against this list and nothing else. Empty until
    -- the dialogue content exists: an empty whitelist means no NPC reacts, which is correct
    -- behaviour rather than a broken state, because no reaction ever gates anything.
    npcKeywords: { string },
}

local DivergenceConfig: DivergenceConfigType = {
    minimum = 0,
    maximum = 100,

    maxLenses = 4,
    --[[
        One entry per lens beyond the first, so #lensThresholds == maxLenses - 1. Below the
        first threshold the dream agrees with itself completely and the game is a cooperative
        puzzle with no divergence in it at all — that state has to be reachable, or players
        never learn what agreement feels like.
    ]]
    lensThresholds = table.freeze({ 25, 50, 75 }),

    ledger = table.freeze({
        roundStart = 0,
        perMinuteElapsed = 1.5,
        perMinutePerDepthLevel = 0.5,
        failedTaskAttempt = 6,
        involuntaryDescent = 8,
        -- The team agreed on the wrong thing. This is the replacement for a hit landing, and
        -- it is better, because they chose it.
        falseConcession = 10,
        firstCorroboration = -3,
        setCollapsedByAgreement = -5,
        objectiveStepCompleted = -12,
    }),

    dissolveThreshold = 60,
    -- Long enough that standing still was a decision, not a reaction time test.
    dissolveSeconds = 12,
    anchorHoldSeconds = 4,

    assertionSeconds = 2,
    assertionWeight = 8,

    graceSecondsAfterLayerEnter = 8,
    --[[
        3.2.3. Granting arrival grace to someone who descended out of a dissolving room turns
        a dissolving room into an exit: step into the bathtub, drop a level, leave the problem
        upstairs with free seconds on top. The room you arrive in has not agreed on you yet.
    ]]
    graceAppliesToDescentFromDissolvingRoom = false,

    synchroniseWindowSeconds = 4,
    anchorDecaySeconds = 25,

    pinnedUntilFirstObjectiveStep = true,

    maxSetsPerLayer = 24,
    maxVariantsPerSet = 4,

    npcKeywords = table.freeze({}),
}

return table.freeze(DivergenceConfig)
