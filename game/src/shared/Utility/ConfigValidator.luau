--!strict
--[[
    Startup validation (specification 7): a malformed config must stop the server with a
    readable message, not fail silently halfway through a round.

    Pure: every config is passed in, so the whole rule set is exercised headlessly. Several
    of these are not shape checks but *policy* checks — the balance guardrail in section 4
    says paid items may not grant an advantage, and a rule nobody enforces is a comment.
]]

export type Report = {
    ok: boolean,
    errors: { string },
}

export type Configs = {
    Game: any,
    Depth: any,
    Distortion: any,
    Layer: any,
    Monster: any,
    Item: any,
    Fear: any,
    Flashlight: any,
    Asset: any,
    Event: any,
    Reward: any,
    Shop: any,
    Product: any,
    Debug: any,
}

local ConfigValidator = {}

local function check(errors: { string }, condition: boolean, message: string)
    if not condition then
        table.insert(errors, message)
    end
end

local function validateGame(c: Configs, errors: { string })
    local game = c.Game
    check(errors, game.minPlayers >= 1, "GameConfig.minPlayers must be at least 1")
    check(
        errors,
        game.maxPlayers >= game.minPlayers,
        "GameConfig.maxPlayers must be at least minPlayers"
    )
    check(errors, game.sedativeSeconds > 0, "GameConfig.sedativeSeconds must be positive")
    check(errors, game.countdownSeconds > 0, "GameConfig.countdownSeconds must be positive")
    check(
        errors,
        game.wakeWindowSeconds > 0,
        "GameConfig.wakeWindowSeconds must be positive; a zero window is unwinnable"
    )
    check(
        errors,
        game.autosaveJitterSeconds < game.autosaveIntervalSeconds,
        "GameConfig.autosaveJitterSeconds must be smaller than autosaveIntervalSeconds"
    )
end

local function validateDepth(c: Configs, errors: { string })
    local depth = c.Depth
    check(errors, depth.maxDepth >= 1, "DepthConfig.maxDepth must be at least 1")
    check(
        errors,
        depth.limboDepth == depth.maxDepth + 1,
        "DepthConfig.limboDepth must sit exactly one below maxDepth"
    )
    check(
        errors,
        depth.maxConcurrentLayers >= 2,
        "DepthConfig.maxConcurrentLayers must be at least 2; splitting the team needs two"
    )
    check(
        errors,
        depth.layerYSpacing < 0,
        "DepthConfig.layerYSpacing must be negative; deeper layers sit below"
    )
    check(
        errors,
        depth.reviveWindowSeconds > depth.reviveHoldSeconds,
        "DepthConfig.reviveWindowSeconds must exceed reviveHoldSeconds or no revive can finish"
    )

    local ledger = depth.stability
    check(
        errors,
        ledger.roundStart > 0 and ledger.roundStart <= depth.maximum,
        "DepthConfig.stability.roundStart must be within (0, maximum]"
    )
    -- A solo kick must cost more than a synchronised one, or nobody would ever pair up.
    check(
        errors,
        ledger.soloKick < ledger.synchronisedKick,
        "DepthConfig.stability.soloKick must cost more than synchronisedKick"
    )
    -- Falling by accident must cost more than choosing to go down, or descent has no risk.
    check(
        errors,
        ledger.involuntaryDescent < ledger.voluntaryDescent,
        "DepthConfig.stability.involuntaryDescent must cost more than voluntaryDescent"
    )
    check(
        errors,
        ledger.objectiveStepCompleted > 0,
        "DepthConfig.stability.objectiveStepCompleted must be positive or a run cannot recover"
    )
end

local function validateDistortion(c: Configs, errors: { string })
    local stops = c.Distortion.stops
    check(errors, #stops >= 2, "DistortionConfig needs at least a surface and one depth below")
    if #stops < 2 then
        return
    end

    check(errors, stops[1].depth == 0, "DistortionConfig.stops must start at depth 0")

    local surface = stops[1]
    check(errors, surface.saturation == 1, "Depth 0 must be undistorted: saturation must be 1")
    check(
        errors,
        surface.lightRangeScale == 1 and surface.monsterSpeedScale == 1,
        "Depth 0 must be undistorted: every scale at depth 0 must be 1"
    )
    check(
        errors,
        surface.hudTruthfulness == 1,
        "Depth 0 must never lie about depth: hudTruthfulness must be 1"
    )

    for index = 2, #stops do
        local previous, current = stops[index - 1], stops[index]
        check(
            errors,
            current.depth == previous.depth + 1,
            `DistortionConfig.stops must be contiguous; depth {current.depth} follows {previous.depth}`
        )
        check(
            errors,
            current.hudTruthfulness >= 0 and current.hudTruthfulness <= 1,
            `DistortionConfig depth {current.depth}: hudTruthfulness must be within [0, 1]`
        )
        check(
            errors,
            current.propDuplicationChance >= 0 and current.propDuplicationChance <= 1,
            `DistortionConfig depth {current.depth}: propDuplicationChance must be within [0, 1]`
        )
    end

    -- Monotonicity across the playable depths only. Limbo is deliberately outside the curve:
    -- it has no monster, so its combat scales are inert and would break a naive comparison.
    local maxPlayable = c.Depth.maxDepth
    for index = 2, #stops do
        local previous, current = stops[index - 1], stops[index]
        if current.depth > maxPlayable then
            break
        end
        check(
            errors,
            current.saturation < previous.saturation,
            `DistortionConfig depth {current.depth}: colour must keep draining with depth`
        )
        check(
            errors,
            current.lightRangeScale < previous.lightRangeScale,
            `DistortionConfig depth {current.depth}: light must not reach further than above it`
        )
        check(
            errors,
            current.monsterSpeedScale > previous.monsterSpeedScale,
            `DistortionConfig depth {current.depth}: the monster must not get slower with depth`
        )
    end
end

local function validateLayers(c: Configs, errors: { string })
    local dreams = c.Layer.dreams
    check(errors, #dreams >= 1, "LayerConfig needs at least one dream")

    local seen: { [string]: boolean } = {}
    local sliceCount = 0
    for index, dream in dreams do
        check(errors, not seen[dream.id], `LayerConfig: duplicate dream id "{dream.id}"`)
        seen[dream.id] = true
        check(
            errors,
            dream.order == index,
            `LayerConfig: dream "{dream.id}" has order {dream.order} at position {index}`
        )
        check(
            errors,
            c.Monster.profiles[dream.monsterProfileId] ~= nil,
            `LayerConfig: dream "{dream.id}" names unknown monster profile "{dream.monsterProfileId}"`
        )
        if dream.inP0Slice then
            sliceCount += 1
        end
    end

    check(
        errors,
        seen[c.Layer.startingDreamId] == true,
        "LayerConfig.startingDreamId is not a known dream"
    )
    check(errors, sliceCount >= 1, "LayerConfig: at least one dream must be in the P0 slice")
end

local function validateBalanceGuardrail(c: Configs, errors: { string })
    --[[
        Specification 4.1. The observer test says a player who has spent nothing and one who
        has bought everything must be indistinguishable to someone watching the round. These
        checks are what makes that a build failure rather than a code-review opinion.
    ]]
    local PERMITTED = { Appearance = true, OwnHistory = true, OutOfRoundRate = true }

    -- There is no fourth category. If an idea needs one, it failed the test.
    local declared = c.Shop.permittedCategories
    check(
        errors,
        #declared == 3,
        "ShopConfig.permittedCategories must list exactly three categories"
    )
    for _, category in declared do
        check(
            errors,
            PERMITTED[category] == true,
            `ShopConfig.permittedCategories contains unknown category "{category}"`
        )
    end

    -- No flashlight tier is for sale; the earlier paid tier failed the observer test outright.
    local unpaidTiers = 0
    for _, tier in c.Flashlight.tiers do
        check(
            errors,
            not tier.purchasable,
            `FlashlightConfig: tier "{tier.id}" is marked purchasable; tiers are loot, skins are sold`
        )
        if not tier.purchasable then
            unpaidTiers += 1
        end
    end
    check(errors, unpaidTiers > 0, "FlashlightConfig must contain at least one findable tier")

    local seenSku: { [string]: boolean } = {}
    for _, entry in c.Shop.entries do
        check(errors, not seenSku[entry.sku], `ShopConfig: duplicate sku "{entry.sku}"`)
        seenSku[entry.sku] = true

        check(
            errors,
            PERMITTED[entry.category] == true,
            `ShopConfig: "{entry.sku}" declares category "{entry.category}", which is not permitted`
        )
        check(
            errors,
            not entry.grantsGameplayAdvantage,
            `ShopConfig: "{entry.sku}" grants a gameplay advantage, which the guardrail forbids`
        )
        check(
            errors,
            entry.coinPrice ~= nil or entry.gamepassKey ~= nil,
            `ShopConfig: "{entry.sku}" has neither a coin price nor a gamepass`
        )
        if entry.gamepassKey then
            check(
                errors,
                c.Asset.gamepasses[entry.gamepassKey] ~= nil,
                `ShopConfig: "{entry.sku}" names unknown gamepass key "{entry.gamepassKey}"`
            )
        end
        if entry.coinPrice then
            check(
                errors,
                entry.coinPrice > 0,
                `ShopConfig: "{entry.sku}" has a non-positive coin price`
            )
        end
    end

    check(errors, c.Shop.maxCoinMultiplier >= 1, "ShopConfig.maxCoinMultiplier must be at least 1")

    for _, product in c.Product.products do
        check(
            errors,
            not product.grantsGameplayAdvantage,
            `ProductConfig: "{product.sku}" grants a gameplay advantage, which the guardrail forbids`
        )
        -- 4.3: no developer product may affect a round in progress, so the only category a
        -- repeatable purchase can carry is the out-of-round one.
        check(
            errors,
            product.category == "OutOfRoundRate",
            `ProductConfig: "{product.sku}" must be OutOfRoundRate; a product may not touch a live round`
        )
        check(
            errors,
            c.Asset.developerProducts[product.assetKey] ~= nil,
            `ProductConfig: "{product.sku}" names unknown product key "{product.assetKey}"`
        )
        check(
            errors,
            product.amount > 0,
            `ProductConfig: "{product.sku}" must grant a positive amount`
        )
    end

    -- Removed on purpose (4.3). Naming them keeps a well-meaning future edit from quietly
    -- reintroducing a purchased kick or a purchased reduction in monster interest.
    local FORBIDDEN_PRODUCTS = { revive = true, temporaryProtection = true }
    for key in c.Asset.developerProducts do
        check(
            errors,
            not FORBIDDEN_PRODUCTS[key],
            `AssetConfig.developerProducts contains "{key}", which specification 4.3 removed`
        )
    end
end

local function validateMisc(c: Configs, errors: { string })
    check(errors, c.Item.inventorySlots > 0, "ItemConfig.inventorySlots must be positive")
    for id, item in c.Item.items do
        check(errors, item.id == id, `ItemConfig: item keyed "{id}" reports id "{item.id}"`)
        check(
            errors,
            item.stackable or item.maxStack == 1,
            `ItemConfig: "{id}" is not stackable but has maxStack {item.maxStack}`
        )
    end

    check(
        errors,
        c.Fear.minimum < c.Fear.maximum,
        "FearConfig.minimum must be below FearConfig.maximum"
    )
    for index = 2, #c.Fear.thresholds do
        check(
            errors,
            c.Fear.thresholds[index] > c.Fear.thresholds[index - 1],
            "FearConfig.thresholds must be strictly increasing"
        )
    end
    check(
        errors,
        c.Fear.hallucinationThreshold <= c.Fear.maximum,
        "FearConfig.hallucinationThreshold must be reachable"
    )

    local harmless = 0
    for _, tier in c.Event.tiers do
        check(errors, tier.weight > 0, `EventConfig: tier "{tier.id}" must have a positive weight`)
        if tier.harmless then
            harmless += 1
        end
    end
    -- Section 11 makes this a requirement, not a preference.
    check(errors, harmless >= 1, "EventConfig must contain at least one harmless tier")

    check(errors, c.Reward.maxLevel > 1, "RewardConfig.maxLevel must be above 1")
    check(errors, c.Reward.xpCurveExponent > 1, "RewardConfig.xpCurveExponent must be above 1")

    -- Specification 2.7. A published place needs real ids, but the game must run without them.
    check(
        errors,
        type(c.Asset.gamepasses) == "table" and type(c.Asset.developerProducts) == "table",
        "AssetConfig must define gamepasses and developerProducts tables"
    )
end

--[[
    Validates every config together and returns a report rather than raising, so the caller
    decides whether an invalid config is fatal (the server) or merely reported (a test).
]]
function ConfigValidator.validate(configs: Configs): Report
    local errors: { string } = {}

    validateGame(configs, errors)
    validateDepth(configs, errors)
    validateDistortion(configs, errors)
    validateLayers(configs, errors)
    validateBalanceGuardrail(configs, errors)
    validateMisc(configs, errors)

    return { ok = #errors == 0, errors = errors }
end

-- Convenience for the server bootstrapper: fail loudly at startup.
function ConfigValidator.assertValid(configs: Configs)
    local report = ConfigValidator.validate(configs)
    if not report.ok then
        error("Config validation failed:\n  - " .. table.concat(report.errors, "\n  - "), 2)
    end
end

return ConfigValidator
