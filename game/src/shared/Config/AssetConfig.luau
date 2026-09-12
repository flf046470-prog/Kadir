--!strict
--[[
    Every Roblox asset, gamepass, and developer product id.

    Specification 2.7: never invent an id. Everything here is 0 or "" and the game must be
    fully playable with them unset — a zero sound id plays nothing, a zero gamepass is simply
    not owned. Fill these in from the Creator Dashboard before publishing; nothing else in
    the codebase may hardcode an id.
]]

export type AssetConfigType = {
    sounds: { [string]: string },
    images: { [string]: string },
    gamepasses: { [string]: number },
    developerProducts: { [string]: number },
    badges: { [string]: number },
}

local AssetConfig: AssetConfigType = {
    sounds = {
        ambientHouse = "",
        heartbeat = "",
        breathing = "",
        flashlightToggle = "",
        doorOpen = "",
        doorSlam = "",
        descentWhoosh = "",
        kickImpact = "",
        stabilityLow = "",
        -- 3.6.4 / 3.6.5. What the world does instead of hunting anyone: a room coming apart,
        -- a set committing to one reading, and a teammate saying what they can see.
        roomDissolving = "",
        setCollapsed = "",
        reportCalledOut = "",
        concessionMade = "",
    },
    images = {
        icon = "",
        vignette = "",
        totem = "",
    },
    gamepasses = {
        vip = 0,
        sleepwearPack = 0,
        totemCollection = 0,
        flashlightSkins = 0,
        emotePack = 0,
        dreamJournal = 0,
        wakingRoomDecor = 0,
        doubleCoins = 0,
        foundersMark = 0,
    },
    -- Two only. Specification 4.3: no developer product may affect a round in progress,
    -- which is what removed Revive (a purchased kick) and Temporary Protection.
    developerProducts = {
        coinPack = 0,
        xpBoost = 0,
    },
    -- Specification 4.6. A badge is a record of what happened. It grants nothing: no
    -- currency, no cosmetic, no stability, no shortcut. A badge that unlocks something has
    -- stopped being a record and become a gate.
    badges = {
        firstWaking = 0,
        neverFell = 0,
        downAndBack = 0,
        calledBack = 0,
        aloneDownThere = 0,
        sleepless = 0,
    },
}

return table.freeze(AssetConfig)
