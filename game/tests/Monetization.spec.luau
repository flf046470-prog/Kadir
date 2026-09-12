--!strict
--[[
    The balance guardrail (specification 4.1), as tests.

    The observer test says a player who has spent nothing and one who has bought everything
    must be indistinguishable to someone watching the round. These cases are what turn that
    sentence into a build failure.
]]
local TestRunner = require("../src/testing/TestRunner")
local ConfigValidator = require("../src/shared/Utility/ConfigValidator")
local ShopConfig = require("../src/shared/Config/ShopConfig")
local ProductConfig = require("../src/shared/Config/ProductConfig")
local FlashlightConfig = require("../src/shared/Config/FlashlightConfig")
local AssetConfig = require("../src/shared/Config/AssetConfig")
local configs = require("./_configs")

local expect = TestRunner.expect
local suite = TestRunner.suite("Monetization — the guardrail is enforced, not reviewed")
local test = TestRunner.test

local function withShop(field: string, value: any)
    local shop = table.clone(ShopConfig :: any)
    shop[field] = value
    local copy = table.clone(configs)
    copy.Shop = shop
    return copy :: any
end

local function withProducts(products: any)
    local product = table.clone(ProductConfig :: any)
    product.products = products
    local copy = table.clone(configs)
    copy.Product = product
    return copy :: any
end

test(suite, "there are exactly three permitted categories", function()
    expect(#ShopConfig.permittedCategories):toBe(3)
end)

test(suite, "every shop entry declares a permitted category", function()
    local permitted = { Appearance = true, OwnHistory = true, OutOfRoundRate = true }
    for _, entry in ShopConfig.entries do
        expect(permitted[entry.category]):toBeTruthy(`"{entry.sku}" declares "{entry.category}"`)
    end
end)

test(suite, "no catalogue entry grants a gameplay advantage", function()
    for _, entry in ShopConfig.entries do
        expect(entry.grantsGameplayAdvantage):toBeFalsy(`"{entry.sku}" grants an advantage`)
    end
    for _, product in ProductConfig.products do
        expect(product.grantsGameplayAdvantage):toBeFalsy(`"{product.sku}" grants an advantage`)
    end
end)

test(suite, "a fourth category fails the build", function()
    local entries = table.clone(ShopConfig.entries :: any)
    local rogue = table.clone(entries[1] :: any)
    rogue.sku = "rogue"
    rogue.category = "InRoundPower"
    table.insert(entries, rogue)
    expect(ConfigValidator.validate(withShop("entries", entries)).ok):toBeFalsy()
end)

test(suite, "an entry that admits an advantage fails the build", function()
    local entries = table.clone(ShopConfig.entries :: any)
    local rogue = table.clone(entries[1] :: any)
    rogue.sku = "rogue"
    rogue.grantsGameplayAdvantage = true
    table.insert(entries, rogue)
    expect(ConfigValidator.validate(withShop("entries", entries)).ok):toBeFalsy()
end)

test(suite, "no flashlight tier is purchasable", function()
    -- The removed Premium tier failed the observer test: the paid player's light visibly
    -- reached further, in the round, in front of everyone.
    for _, tier in FlashlightConfig.tiers do
        expect(tier.purchasable):toBeFalsy(`tier "{tier.id}" is for sale`)
    end
end)

test(suite, "marking a tier purchasable fails the build", function()
    local tiers = table.clone(FlashlightConfig.tiers :: any)
    local paid = table.clone(tiers[3] :: any)
    paid.purchasable = true
    tiers[3] = paid
    local flashlight = table.clone(FlashlightConfig :: any)
    flashlight.tiers = tiers
    local copy = table.clone(configs)
    copy.Flashlight = flashlight
    expect(ConfigValidator.validate(copy :: any).ok):toBeFalsy()
end)

test(suite, "every developer product is out-of-round only", function()
    for _, product in ProductConfig.products do
        expect(product.category):toBe(
            "OutOfRoundRate",
            `"{product.sku}" may not touch a live round`
        )
    end
end)

test(suite, "a product that touches a live round fails the build", function()
    local products = table.clone(ProductConfig.products :: any)
    table.insert(products, {
        sku = "panic_button",
        displayName = "Panic Button",
        assetKey = "coinPack",
        grant = "Coins",
        amount = 1,
        category = "Appearance",
        grantsGameplayAdvantage = false,
    })
    expect(ConfigValidator.validate(withProducts(products)).ok):toBeFalsy()
end)

test(suite, "Revive and Temporary Protection stay removed", function()
    -- Under the dream stack a purchased revive is a purchased kick, and 4.5 forbids selling
    -- mobility. Naming them keeps a well-meaning future edit from reintroducing either.
    expect(AssetConfig.developerProducts["revive"]):toBe(nil)
    expect(AssetConfig.developerProducts["temporaryProtection"]):toBe(nil)
end)

test(suite, "reintroducing Revive fails the build", function()
    local products = table.clone(AssetConfig.developerProducts :: any)
    products.revive = 0
    local asset = table.clone(AssetConfig :: any)
    asset.developerProducts = products
    local copy = table.clone(configs)
    copy.Asset = asset
    expect(ConfigValidator.validate(copy :: any).ok):toBeFalsy()
end)

test(suite, "every gamepass and product key resolves to an asset entry", function()
    for _, entry in ShopConfig.entries do
        if entry.gamepassKey then
            expect(AssetConfig.gamepasses[entry.gamepassKey] ~= nil):toBeTruthy(
                `"{entry.sku}" names unknown gamepass key "{entry.gamepassKey}"`
            )
        end
    end
    for _, product in ProductConfig.products do
        expect(AssetConfig.developerProducts[product.assetKey] ~= nil):toBeTruthy(
            `"{product.sku}" names unknown product key "{product.assetKey}"`
        )
    end
end)

test(suite, "every asset id ships unset", function()
    -- Specification 2.7: never invent an id, and the game must run with all of them at 0.
    for key, id in AssetConfig.gamepasses do
        expect(id):toBe(0, `gamepass "{key}" ships with a hardcoded id`)
    end
    for key, id in AssetConfig.developerProducts do
        expect(id):toBe(0, `product "{key}" ships with a hardcoded id`)
    end
end)

test(suite, "shop skus are unique", function()
    local seen: { [string]: boolean } = {}
    for _, entry in ShopConfig.entries do
        expect(seen[entry.sku]):toBeFalsy(`duplicate sku "{entry.sku}"`)
        seen[entry.sku] = true
    end
end)

return suite
