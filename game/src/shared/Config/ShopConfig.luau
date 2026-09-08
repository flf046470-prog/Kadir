--!strict
--[[
    The purchasable catalogue (specification 4.2).

    Every entry declares exactly one `category`, and there is no fourth one. The observer
    test in 4.1 is the rule these encode: put a player who has spent nothing next to one who
    has bought everything, and an observer watching the round must not be able to tell which
    is which. ConfigValidator rejects the build if any entry breaks that, so the guardrail is
    enforced rather than reviewed.
]]

-- Appearance: how you and your things look. OwnHistory: runs you have already finished.
-- OutOfRoundRate: how fast cosmetic currency and levels accrue. Nothing else is permitted.
export type Category = "Appearance" | "OwnHistory" | "OutOfRoundRate"

export type ShopEntry = {
    sku: string,
    displayName: string,
    kind: "Gamepass" | "Cosmetic" | "Emote" | "SeasonPass",
    category: Category,
    coinPrice: number?,
    gamepassKey: string?,
    grantsGameplayAdvantage: boolean,
}

export type ShopConfigType = {
    permittedCategories: { Category },
    entries: { ShopEntry },
    -- VIP and Double Coins stack additively and are clamped here.
    maxCoinMultiplier: number,
}

local function gamepass(
    sku: string,
    displayName: string,
    key: string,
    category: Category
): ShopEntry
    return table.freeze({
        sku = sku,
        displayName = displayName,
        kind = "Gamepass" :: "Gamepass",
        category = category,
        coinPrice = nil,
        gamepassKey = key,
        grantsGameplayAdvantage = false,
    })
end

local ShopConfig: ShopConfigType = {
    permittedCategories = table.freeze({
        "Appearance" :: Category,
        "OwnHistory" :: Category,
        "OutOfRoundRate" :: Category,
    }),

    entries = {
        -- VIP touches appearance and coin rate; it is filed under the rate it changes,
        -- because that is the half a validator has to police.
        gamepass("vip", "VIP", "vip", "OutOfRoundRate"),
        gamepass("sleepwear_pack", "Sleepwear Pack", "sleepwearPack", "Appearance"),
        -- Skins only. Read time, cooldown and truth are identical for every totem.
        gamepass("totem_collection", "Totem Collection", "totemCollection", "Appearance"),
        -- Housing and beam colour. No range, battery, or detection change.
        gamepass("flashlight_skins", "Flashlight Skins", "flashlightSkins", "Appearance"),
        gamepass("emote_pack", "Emote Pack", "emotePack", "Appearance"),
        -- Finished runs only, and never a fragment location for the current seed.
        gamepass("dream_journal", "Dream Journal", "dreamJournal", "OwnHistory"),
        gamepass("waking_room_decor", "Waking Room Décor", "wakingRoomDecor", "Appearance"),
        gamepass("double_coins", "Double Coins", "doubleCoins", "OutOfRoundRate"),
        gamepass("founders_mark", "Founder's Mark", "foundersMark", "Appearance"),

        -- Coin-priced cosmetics, earnable without spending anything.
        table.freeze({
            sku = "totem_skin_brass",
            displayName = "Brass Totem",
            kind = "Cosmetic" :: "Cosmetic",
            category = "Appearance" :: Category,
            coinPrice = 400,
            gamepassKey = nil,
            grantsGameplayAdvantage = false,
        }),
        table.freeze({
            sku = "flashlight_skin_hospital",
            displayName = "Hospital Lantern",
            kind = "Cosmetic" :: "Cosmetic",
            category = "Appearance" :: Category,
            coinPrice = 650,
            gamepassKey = nil,
            grantsGameplayAdvantage = false,
        }),
    },

    maxCoinMultiplier = 2.0,
}

return table.freeze(ShopConfig)
