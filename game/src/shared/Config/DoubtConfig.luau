--!strict
--[[
    Doubt (specification 6) — the system that used to be called fear.

    Renamed deliberately: "fear" kept pulling the design back towards something to be afraid
    *of*, and there is nothing in this game to be afraid of. What a player feels here is doubt,
    and its largest single source is being the only person in the room who can see something.

    Effects are subtractive, never obstructive. Nothing here is allowed to blur the screen to
    the point of unplayability or lock input.
]]

export type DoubtConfigType = {
    minimum: number,
    maximum: number,
    thresholds: { number },

    -- 3.6.4. Doubt rises with the room's incoherence, per point of it per second.
    risePerSecondPerIncoherence: number,
    --[[
        Section 6. The odd-one-out term: your lens matches nobody else's in the room. This is
        deliberately the largest rise in the table. Being the only person who can see something
        is the frightening thing in this game, and the number should say so.
    ]]
    risePerSecondOddOneOut: number,
    isolationDistanceStuds: number,
    risePerSecondAlone: number,
    risePerSecondInDarkness: number,
    riseOnFalseConcession: number,

    fallPerSecondSharedLens: number,
    fallPerSecondInSafeZone: number,
    fallOnCorroboration: number,
    fallOnSetCollapsed: number,
    fallOnObjectiveStep: number,

    --[[
        Above this, a **false report** may appear: a caption naming a teammate who said nothing.
        It is the only place in the entire game where the HUD lies about another player, which
        is why it is bounded so tightly — see `falseReportContradictedWithinSeconds`. If players
        come to believe the game fakes reports, they stop trusting each other and nothing works.
    ]]
    falseReportThreshold: number,
    falseReportChancePerMinute: number,
    falseReportContradictedWithinSeconds: number,

    tickHz: number,
}

local DoubtConfig: DoubtConfigType = {
    minimum = 0,
    maximum = 100,
    thresholds = table.freeze({ 25, 50, 75, 90 }),

    risePerSecondPerIncoherence = 0.08,
    risePerSecondOddOneOut = 6.0,
    isolationDistanceStuds = 60,
    risePerSecondAlone = 1.2,
    risePerSecondInDarkness = 1.8,
    riseOnFalseConcession = 15,

    fallPerSecondSharedLens = 2.4,
    fallPerSecondInSafeZone = 5.0,
    fallOnCorroboration = 10,
    fallOnSetCollapsed = 8,
    fallOnObjectiveStep = 12,

    falseReportThreshold = 90,
    falseReportChancePerMinute = 0.15,
    -- Short enough that the real report lands while the player is still in the same room.
    falseReportContradictedWithinSeconds = 30,

    tickHz = 4,
}

return table.freeze(DoubtConfig)
