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
    Divergence: any,
    Item: any,
    Doubt: any,
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
        depth.dissolveWarningSeconds > 0,
        "DepthConfig.dissolveWarningSeconds must be positive; a room must warn before it drops anyone"
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

    -- 3.2.5. Without a cap one player can spend the whole team's run on purpose.
    check(
        errors,
        depth.maxDrainSharePerPlayer > 0 and depth.maxDrainSharePerPlayer <= 1,
        "DepthConfig.maxDrainSharePerPlayer must be within (0, 1]"
    )
    -- 3.2.12. A disconnected player keeps their depth for this long; zero would delete them.
    check(errors, depth.rejoinGraceSeconds > 0, "DepthConfig.rejoinGraceSeconds must be positive")
    -- 3.2.11. A paired prompt two players cannot physically hit together is not a mechanic.
    check(
        errors,
        depth.pairedPromptWindowSeconds > 0,
        "DepthConfig.pairedPromptWindowSeconds must be positive"
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
        surface.lightRangeScale == 1 and surface.divergenceScale == 1,
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
        check(
            errors,
            current.fragmentTruthfulness >= 0 and current.fragmentTruthfulness <= 1,
            `DistortionConfig depth {current.depth}: fragmentTruthfulness must be within [0, 1]`
        )
    end

    local maxPlayable = c.Depth.maxDepth

    --[[
        3.2.2. Depth 1 must always tell the truth. The first level down is where a player
        learns that descending is worth doing; a forgery there teaches the opposite lesson
        and the loop never lands.
    ]]
    for _, stop in stops do
        if stop.depth == 1 then
            check(
                errors,
                stop.fragmentTruthfulness == 1,
                "DistortionConfig: depth 1 fragments must always be truthful"
            )
        end
    end

    -- Information quality may only degrade with depth, never improve.
    for index = 2, #stops do
        local previous, current = stops[index - 1], stops[index]
        if current.depth > maxPlayable then
            break
        end
        check(
            errors,
            current.fragmentTruthfulness <= previous.fragmentTruthfulness,
            `DistortionConfig depth {current.depth}: fragments must not get more truthful with depth`
        )
    end

    -- Monotonicity across the playable depths only. Limbo (3.2.6) is deliberately outside
    -- the curve: it is the one coherent place in the game, so both of its divergence scales are
    -- inert and a naive comparison across it would fail.
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
            current.divergenceScale > previous.divergenceScale,
            `DistortionConfig depth {current.depth}: the dream must not agree with itself more than the level above`
        )
        -- 3.2.3. If rooms deeper down came apart more slowly, descending out of a dissolving
        -- room would be the cheapest move in the game.
        check(
            errors,
            current.incoherenceScale > previous.incoherenceScale,
            `DistortionConfig depth {current.depth}: rooms must not hold together better than the level above`
        )
    end
end

--[[
    The waking tasks of section 5, one per layer, in the order that teaches them. Restated here
    rather than required from LayerConfig so this module keeps validating the *vocabulary*
    rather than whatever the config happens to contain — a typo in a task name must be an error,
    not a new task.
]]
local KNOWN_TASKS = {
    CollectSymbols = true,
    OrderSequence = true,
    DeduceRule = true,
    SynchroniseAnchors = true,
    IdentifyReal = true,
    Decide = true,
}

local function validateLayers(c: Configs, errors: { string })
    local dreams = c.Layer.dreams
    check(errors, #dreams >= 1, "LayerConfig needs at least one dream")

    local seen: { [string]: boolean } = {}
    local seenTask: { [string]: boolean } = {}
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
            KNOWN_TASKS[dream.task] == true,
            `LayerConfig: dream "{dream.id}" declares unknown waking task "{dream.task}"`
        )
        check(
            errors,
            not seenTask[dream.task],
            `LayerConfig: waking task "{dream.task}" appears twice; the ladder teaches each once`
        )
        seenTask[dream.task] = true
        --[[
            Section 5. A layer that is neither solo-safe nor overridden makes the stated 1-6
            player range a lie, and it does it silently: the round simply cannot be finished and
            nothing says why. SynchroniseAnchors is the live example.
        ]]
        check(
            errors,
            dream.soloSafe or dream.soloOverride ~= nil,
            `LayerConfig: dream "{dream.id}" is not solo-safe and declares no solo override`
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

    -- Section 5. The Final Layer is where the run's decision is taken, so it must exist and it
    -- must be last: a layer after it would be a dream the players already chose to leave.
    check(
        errors,
        seen[c.Layer.finalLayerId] == true,
        "LayerConfig.finalLayerId is not a known dream"
    )
    local last = dreams[#dreams]
    if last then
        check(
            errors,
            last.id == c.Layer.finalLayerId,
            `LayerConfig: the Final Layer must be last, but "{last.id}" is`
        )
    end
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

    --[[
        4.6. A badge records what happened and grants nothing. Selling one, or hanging a
        purchase off one, turns the record into a gate — so the two namespaces must not
        overlap and no catalogue entry may reference a badge.
    ]]
    for key in c.Asset.badges do
        check(
            errors,
            c.Asset.gamepasses[key] == nil,
            `AssetConfig: "{key}" is both a badge and a gamepass; badges are not sold`
        )
        check(errors, not seenSku[key], `ShopConfig: "{key}" sells a badge, which 4.6 forbids`)
    end

    -- Removed on purpose (4.3). Naming them keeps a well-meaning future edit from quietly
    -- reintroducing a purchased kick, or a purchased advantage in the divergence system under
    -- some friendlier name.
    local FORBIDDEN_PRODUCTS = { revive = true, temporaryProtection = true }
    for key in c.Asset.developerProducts do
        check(
            errors,
            not FORBIDDEN_PRODUCTS[key],
            `AssetConfig.developerProducts contains "{key}", which specification 4.3 removed`
        )
    end
end

local function validateDivergence(c: Configs, errors: { string })
    local d = c.Divergence

    check(
        errors,
        d.graceSecondsAfterLayerEnter >= 0,
        "DivergenceConfig.graceSecondsAfterLayerEnter must not be negative"
    )
    --[[
        3.2.3. Granting arrival grace to someone who descended out of a dissolving room turns a
        dissolving room into an exit sign: step into the bathtub, drop a level, and leave the
        disagreement upstairs with free seconds on top.
    ]]
    check(
        errors,
        not d.graceAppliesToDescentFromDissolvingRoom,
        "DivergenceConfig.graceAppliesToDescentFromDissolvingRoom must be false; descending is not an escape"
    )

    -- 3.6.2. One threshold per lens beyond the first, ascending. Two lenses sharing a threshold
    -- would make a whole reading of the world unreachable.
    check(errors, d.maxLenses >= 2, "DivergenceConfig.maxLenses must be at least 2")
    check(
        errors,
        #d.lensThresholds == d.maxLenses - 1,
        `DivergenceConfig.lensThresholds must hold exactly maxLenses - 1 entries, found {#d.lensThresholds}`
    )
    for index = 2, #d.lensThresholds do
        check(
            errors,
            d.lensThresholds[index] > d.lensThresholds[index - 1],
            "DivergenceConfig.lensThresholds must be strictly increasing"
        )
    end
    if #d.lensThresholds > 0 then
        --[[
            3.6.2. The first threshold must sit above the minimum, or there is no band in which
            the dream agrees with itself and players never learn what coherence looks like
            before the game takes it away.
        ]]
        check(
            errors,
            d.lensThresholds[1] > d.minimum,
            "DivergenceConfig.lensThresholds[1] must be above the minimum; the dream must start out agreeing with itself"
        )
        check(
            errors,
            d.lensThresholds[#d.lensThresholds] <= d.maximum,
            "DivergenceConfig.lensThresholds must stay within the divergence range"
        )
    end

    local ledger = d.ledger
    check(
        errors,
        ledger.roundStart >= d.minimum and ledger.roundStart <= d.maximum,
        "DivergenceConfig.ledger.roundStart must be within the divergence range"
    )
    --[[
        3.6.7. An objective step must undo more than a failed attempt costs, or a team that is
        genuinely making progress still drowns and the ladder in section 5 is unplayable.
    ]]
    check(
        errors,
        -ledger.objectiveStepCompleted > ledger.failedTaskAttempt,
        "DivergenceConfig.ledger: an objective step must lower divergence by more than a failed attempt raises it"
    )
    -- Agreement must be the thing that calms the dream down, so both of its rewards go down.
    check(
        errors,
        ledger.setCollapsedByAgreement < 0 and ledger.firstCorroboration < 0,
        "DivergenceConfig.ledger: agreeing must lower divergence"
    )
    check(
        errors,
        ledger.falseConcession > 0 and ledger.involuntaryDescent > 0,
        "DivergenceConfig.ledger: failures must raise divergence"
    )

    --[[
        3.6.6. Divergence must not reach the top band from time alone. A team that plays well
        should never meet four lenses; a team that plays badly should earn it. The bound below
        is the whole-round passive rise with every player at the deepest playable level the
        entire time, which is the worst case the clock alone can produce.
    ]]
    local minutes = c.Game.sedativeSeconds / 60
    local passive = ledger.roundStart
        + minutes * (ledger.perMinuteElapsed + ledger.perMinutePerDepthLevel * c.Depth.maxDepth)
    local topBand = d.lensThresholds[#d.lensThresholds]
    check(
        errors,
        topBand == nil or passive < topBand,
        `DivergenceConfig: the passive rise over a full round reaches {math.floor(passive)}, which is the top lens band; only failures may buy the last lens`
    )

    check(
        errors,
        d.dissolveThreshold > 0,
        "DivergenceConfig.dissolveThreshold must be positive; a room must be allowed to be coherent"
    )
    -- 3.6.4 / 3.6.5. A room must telegraph for longer than it takes a teammate to answer it,
    -- or the cooperative half of dissolution is decorative.
    check(
        errors,
        d.dissolveSeconds > d.anchorHoldSeconds,
        "DivergenceConfig.dissolveSeconds must exceed anchorHoldSeconds or no rescue can finish"
    )
    check(
        errors,
        d.dissolveSeconds > c.Depth.dissolveWarningSeconds,
        "DivergenceConfig.dissolveSeconds must exceed DepthConfig.dissolveWarningSeconds"
    )

    -- 2.8. Authoring ceilings. Four variants is what the ten collision groups of 3.6.3 buy.
    check(
        errors,
        d.maxVariantsPerSet >= 2 and d.maxVariantsPerSet <= d.maxLenses,
        "DivergenceConfig.maxVariantsPerSet must be within [2, maxLenses]"
    )
    check(errors, d.maxSetsPerLayer >= 1, "DivergenceConfig.maxSetsPerLayer must be positive")
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
        check(
            errors,
            item.minSpawnDepth >= 0 and item.minSpawnDepth <= c.Depth.maxDepth,
            `ItemConfig: "{id}" has a minSpawnDepth outside the playable range`
        )
    end

    -- 3.2.5. The resource that pays for climbing is found only by going down.
    local sedative = c.Item.items["SedativeDose"]
    check(errors, sedative ~= nil, "ItemConfig must define SedativeDose")
    if sedative then
        check(
            errors,
            sedative.minSpawnDepth >= 1,
            "ItemConfig: SedativeDose must not spawn at the surface"
        )
    end

    check(
        errors,
        c.Doubt.minimum < c.Doubt.maximum,
        "DoubtConfig.minimum must be below DoubtConfig.maximum"
    )
    for index = 2, #c.Doubt.thresholds do
        check(
            errors,
            c.Doubt.thresholds[index] > c.Doubt.thresholds[index - 1],
            "DoubtConfig.thresholds must be strictly increasing"
        )
    end
    check(
        errors,
        c.Doubt.falseReportThreshold <= c.Doubt.maximum,
        "DoubtConfig.falseReportThreshold must be reachable"
    )
    --[[
        Section 6. Being the only person in the room who can see something is the frightening
        thing in this game, so it must be the largest rise in the table. If isolation or darkness
        ever outweighs it, the design has quietly turned back into a game about being alone in
        the dark, which is the genre it is trying not to be.
    ]]
    check(
        errors,
        c.Doubt.risePerSecondOddOneOut > c.Doubt.risePerSecondAlone
            and c.Doubt.risePerSecondOddOneOut > c.Doubt.risePerSecondInDarkness,
        "DoubtConfig.risePerSecondOddOneOut must be the largest rise; disagreement is the pressure, not darkness"
    )
    -- The one false thing the game says about another player must be contradicted while the
    -- player is still in the room to see it contradicted.
    check(
        errors,
        c.Doubt.falseReportContradictedWithinSeconds > 0
            and c.Doubt.falseReportContradictedWithinSeconds <= 60,
        "DoubtConfig.falseReportContradictedWithinSeconds must be within (0, 60]"
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
    check(
        errors,
        type(c.Asset.badges) == "table" and next(c.Asset.badges) ~= nil,
        "AssetConfig must define at least one badge (4.6)"
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
    validateDivergence(configs, errors)
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
