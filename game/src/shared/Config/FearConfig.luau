--!strict
-- Fear model (specification 6). Effects are subtractive, never obstructive.

export type FearConfigType = {
    minimum: number,
    maximum: number,
    thresholds: { number },
    monsterProximityStuds: number,
    isolationDistanceStuds: number,
    risePerSecondMonsterVisible: number,
    risePerSecondAlone: number,
    risePerSecondInDarkness: number,
    fallPerSecondNearTeammate: number,
    fallPerSecondInSafeZone: number,
    fallOnObjectiveStep: number,
    hallucinationThreshold: number,
    hallucinationChancePerMinute: number,
    tickHz: number,
}

local FearConfig: FearConfigType = {
    minimum = 0,
    maximum = 100,
    thresholds = table.freeze({ 25, 50, 75, 90 }),
    monsterProximityStuds = 40,
    isolationDistanceStuds = 60,
    risePerSecondMonsterVisible = 6.0,
    risePerSecondAlone = 1.2,
    risePerSecondInDarkness = 1.8,
    fallPerSecondNearTeammate = 2.4,
    fallPerSecondInSafeZone = 5.0,
    fallOnObjectiveStep = 12,
    -- Above this a hallucination may appear: it never damages and despawns silently.
    hallucinationThreshold = 90,
    hallucinationChancePerMinute = 0.15,
    tickHz = 4,
}

return table.freeze(FearConfig)
