--!strict
--[[
    Developer products (specification 4.3).

    **No developer product may affect a round in progress.** Only two survive that rule.

    Revive was removed rather than excepted: nobody dies here, so a player whose room
    dissolves under them descends (3.2.3) and a purchased revive is a purchased kick, which 4.5
    forbids. Temporary Protection was removed because it protected against a monster and there
    is no monster — and because any divergence-shaped rework of it (a room that dissolves more
    slowly for you, a lens that agrees with more people) would sell an advantage in the one
    system the whole game is made of.

    Receipt handling is unchanged and non-negotiable: exactly one `ProcessReceipt` assignment,
    `PurchaseId` recorded inside the same `UpdateAsync` that grants, and `NotProcessedYet` on
    any failure.
]]

-- Deliberately no require: config modules stay leaves so Lune can load them with no
-- DataModel. The category vocabulary is restated here and ConfigValidator checks that both
-- modules agree, which is a cheaper coupling than a shared require the tests cannot resolve.
export type Category = "Appearance" | "OwnHistory" | "OutOfRoundRate"

export type ProductDefinition = {
    sku: string,
    displayName: string,
    assetKey: string,
    grant: "Coins" | "XpBoost",
    amount: number,
    category: Category,
    grantsGameplayAdvantage: boolean,
}

export type ProductConfigType = {
    products: { ProductDefinition },
    receiptStoreName: string,
}

local ProductConfig: ProductConfigType = {
    products = {
        table.freeze({
            sku = "coin_pack",
            displayName = "Coin Pack",
            assetKey = "coinPack",
            grant = "Coins" :: "Coins",
            amount = 1000,
            category = "OutOfRoundRate" :: Category,
            grantsGameplayAdvantage = false,
        }),
        table.freeze({
            sku = "xp_boost",
            displayName = "XP Boost",
            assetKey = "xpBoost",
            grant = "XpBoost" :: "XpBoost",
            amount = 2,
            category = "OutOfRoundRate" :: Category,
            grantsGameplayAdvantage = false,
        }),
    },
    receiptStoreName = "DreamLayers_Receipts_v1",
}

return table.freeze(ProductConfig)
