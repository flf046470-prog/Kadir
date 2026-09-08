--!strict
--[[
    Developer products (specification 4.3).

    **No developer product may affect a round in progress.** Only two survive that rule.

    Revive was removed rather than excepted: under the dream stack a downed player who is not
    revived does not die, they descend (3.2.3), so a purchased revive is a purchased kick, and
    4.5 forbids selling mobility. Temporary Protection was removed because reducing the
    monster's interest in you is the exact thing the guardrail names.

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
