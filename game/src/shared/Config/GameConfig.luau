--!strict
-- Round-level tunables. Specification 7: if a number affects gameplay, it lives in a config.

export type GameConfigType = {
    displayName: string,
    minPlayers: number,
    maxPlayers: number,
    countdownSeconds: number,
    -- Real seconds, identical at every depth. See specification 3.2.7 on why there is no
    -- time dilation: it makes round length unpredictable and the state machine untestable.
    sedativeSeconds: number,
    wakeWindowSeconds: number,
    lateJoinGraceSeconds: number,
    autosaveIntervalSeconds: number,
    autosaveJitterSeconds: number,
}

local GameConfig: GameConfigType = {
    displayName = "Dream Layers: Don't Wake Up",
    minPlayers = 1,
    -- Specification 3.2.9: one server is one round, so Players.MaxPlayers matches this.
    -- Parallel rounds would need either reserved servers (ruled out in section 1) or more
    -- than the three concurrent layers 3.2.10 allows.
    maxPlayers = 6,
    countdownSeconds = 10,
    sedativeSeconds = 900,
    wakeWindowSeconds = 10,
    lateJoinGraceSeconds = 5,
    autosaveIntervalSeconds = 120,
    autosaveJitterSeconds = 15,
}

return table.freeze(GameConfig)
