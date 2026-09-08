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
        monsterFar = "",
        monsterNear = "",
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
    badges = {
        firstWake = 0,
        neverFell = 0,
        reachedLimbo = 0,
        secretEnding = 0,
    },
}

return table.freeze(AssetConfig)
