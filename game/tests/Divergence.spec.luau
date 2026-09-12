--!strict
local TestRunner = require("../src/testing/TestRunner")
local Divergence = require("../src/shared/Utility/Divergence")
local DivergenceConfig = require("../src/shared/Config/DivergenceConfig")
local DistortionConfig = require("../src/shared/Config/DistortionConfig")
local GameConfig = require("../src/shared/Config/GameConfig")

local expect = TestRunner.expect
local suite = TestRunner.suite("Divergence — the world as the antagonist")
local test = TestRunner.test

local thresholds = DivergenceConfig.lensThresholds
local maxLenses = DivergenceConfig.maxLenses

local function set(id: string, weight: number, variants: number)
    local list = {}
    for index = 1, variants do
        table.insert(list, { index = index })
    end
    return { id = id, roomId = "room", weight = weight, variants = list }
end

test(suite, "the dream agrees with itself below the first threshold", function()
    --[[
        3.6.2. This has to be exact rather than merely likely. It is the state that teaches
        players what agreement feels like, and everything the game does afterwards is a
        departure from it.
    ]]
    expect(Divergence.lensCount(0, thresholds)):toBe(1)
    expect(Divergence.lensCount(thresholds[1] - 1, thresholds)):toBe(1)
end)

test(suite, "each threshold adds exactly one reading of the world", function()
    for index, threshold in thresholds do
        expect(Divergence.lensCount(threshold, thresholds)):toBe(index + 1)
    end
    expect(Divergence.lensCount(100, thresholds)):toBe(maxLenses)
end)

test(suite, "the lens count is monotonic and never exceeds the maximum", function()
    local previous = 0
    for divergence = 0, 100 do
        local count = Divergence.lensCount(divergence, thresholds)
        expect(count >= previous):toBeTruthy(`lens count fell at divergence {divergence}`)
        expect(count <= maxLenses):toBeTruthy(`divergence {divergence} exceeded maxLenses`)
        previous = count
    end
end)

test(suite, "at one lens every player shares it exactly", function()
    -- The whole-team-agrees case must be exact, not probable, so assert it across every seat a
    -- six-player server can hold rather than sampling.
    for slot = 1, 6 do
        expect(Divergence.lensFor(slot, 12345, 1)):toBe(1)
    end
end)

test(suite, "a lens assignment is deterministic in its inputs", function()
    -- The server recomputes lenses rather than storing them (3.6.3 step 4), so this is a
    -- correctness requirement, not a convenience.
    for slot = 1, 6 do
        local first = Divergence.lensFor(slot, 777, maxLenses)
        expect(Divergence.lensFor(slot, 777, maxLenses)):toBe(first)
    end
end)

test(suite, "a lens is always inside the permitted range", function()
    for lensCount = 1, maxLenses do
        for slot = 1, 24 do
            local lens = Divergence.lensFor(slot, 4242, lensCount)
            expect(lens >= 1 and lens <= lensCount):toBeTruthy(
                `lens {lens} outside 1..{lensCount} for slot {slot}`
            )
        end
    end
end)

test(suite, "a seat below one is a caller bug, not a wrapped index", function()
    -- Slots are seats, not UserIds. A zero here means somebody passed a UserId or an index that
    -- was never assigned, and silently wrapping it would be a lens nobody can account for.
    expect(function()
        Divergence.lensFor(0, 1, maxLenses)
    end):toErrorWith("slot must be at least 1")
end)

test(suite, "an impossible lens count is a caller bug, not a silent default", function()
    expect(function()
        Divergence.lensFor(1, 1, 0)
    end):toErrorWith("lensCount must be at least 1")
end)

test(suite, "every lens is occupied whenever there are at least that many players", function()
    --[[
        3.6.2. The even rotation is chosen over a hash precisely for this. A real hash would
        leave a reading of the world unoccupied now and then, and a round where the whole team
        happens to share one reading is a round with no antagonist in it. Assert across many
        salts, because "usually" is exactly the failure mode being ruled out.
    ]]
    for salt = 1, 300 do
        for players = maxLenses, 6 do
            local occupied: { [number]: boolean } = {}
            local count = 0
            for slot = 1, players do
                local lens = Divergence.lensFor(slot, salt, maxLenses)
                if not occupied[lens] then
                    occupied[lens] = true
                    count += 1
                end
            end
            expect(count):toBe(
                maxLenses,
                `salt {salt} with {players} players left a reading of the world unoccupied`
            )
        end
    end
end)

test(suite, "six players across four lenses always split two, two, one, one", function()
    --[[
        The property the whole cooperative design rests on, as an exact shape rather than an
        average: two pairs who can corroborate each other, and two players who are the odd one
        out. Section 6 hangs the largest source of doubt on being that second kind of player, so
        there has to reliably be one.
    ]]
    for salt = 1, 300 do
        local tally: { [number]: number } = {}
        for slot = 1, 6 do
            local lens = Divergence.lensFor(slot, salt, maxLenses)
            tally[lens] = (tally[lens] or 0) + 1
        end

        local sizes = {}
        for _, size in tally do
            table.insert(sizes, size)
        end
        table.sort(sizes)
        expect(table.concat(sizes, ",")):toBe(
            "1,1,2,2",
            `salt {salt} split six players as {table.concat(sizes, ",")}`
        )
    end
end)

test(suite, "the salt rotates who reads the world which way", function()
    --[[
        Otherwise the same six friends get the same assignment in every round they ever play and
        the team learns its own lens map instead of talking to each other.

        This is the test that caught the FNV overflow described in `Divergence.luau`: the first
        version of `lensFor` read `hash % lensCount`, and since the bad multiply flattens a hash's
        low bits to zero, every player landed on lens 1 in every round while every other test in
        this suite still passed.

        It would no longer catch it. `lensFor` now derives its offset from the hash's *high* bits,
        which the overflow leaves intact, so the rotation survives the bad arithmetic. That is
        deliberate — two independent guards rather than one — but it means this test proves the
        rotation spreads, not that the arithmetic is right. The arithmetic is pinned by the golden
        vectors in `Rng.spec`, which is the only place either spelling can still be told apart.
    ]]
    local seen: { [number]: boolean } = {}
    local count = 0
    for salt = 1, 400 do
        local lens = Divergence.lensFor(1, salt, maxLenses)
        if not seen[lens] then
            seen[lens] = true
            count += 1
        end
    end
    expect(count):toBe(maxLenses, "seat 1 could not reach every lens across 400 salts")
end)

test(suite, "lenses wrap onto a set with fewer variants than there are lenses", function()
    -- A two-variant set must resolve for all four lenses, and two lenses that wrap onto the
    -- same variant genuinely agree — which is the point rather than a rounding artefact.
    local pair = set("door", 10, 2)
    local hits = { 0, 0 }
    for lens = 1, maxLenses do
        local variant = Divergence.variantFor(pair, lens)
        expect(variant >= 1 and variant <= 2):toBeTruthy(
            `lens {lens} resolved to variant {variant}`
        )
        hits[variant] += 1
    end
    expect(hits[1]):toBe(2)
    expect(hits[2]):toBe(2)
end)

test(suite, "a set with no variants is rejected rather than resolved", function()
    expect(function()
        Divergence.variantFor(set("empty", 5, 0), 1)
    end):toErrorWith("has no variants")
end)

test(suite, "a room with one reading in it is perfectly coherent", function()
    --[[
        3.6.4. Zero however heavily the room is contested and however many players are standing
        there. A room only disagrees with itself once somebody is there to disagree, and this is
        the rule that keeps a solo run and a run where everyone agrees from dissolving.
    ]]
    local sets = { set("a", 30, 4), set("b", 30, 4) }
    expect(Divergence.roomIncoherence(sets, {}, 1)):toBe(0)
    expect(Divergence.roomIncoherence(sets, { 2 }, 1)):toBe(0)
    expect(Divergence.roomIncoherence(sets, { 3, 3, 3 }, 1)):toBe(0)
end)

test(suite, "incoherence rises with each additional reading present", function()
    local sets = { set("a", 10, 4) }
    local two = Divergence.roomIncoherence(sets, { 1, 2 }, 1)
    local three = Divergence.roomIncoherence(sets, { 1, 2, 3 }, 1)
    local four = Divergence.roomIncoherence(sets, { 1, 2, 3, 4 }, 1)
    expect(two > 0):toBeTruthy("two readings produced no incoherence")
    expect(three > two):toBeTruthy("a third reading did not make the room worse")
    expect(four > three):toBeTruthy("a fourth reading did not make the room worse")
end)

test(suite, "a second player on an existing lens changes nothing", function()
    -- Two people reading a room the same way are restful. Counting players rather than
    -- distinct readings would punish a team for staying together, which inverts the design.
    local sets = { set("a", 10, 4) }
    local pair = Divergence.roomIncoherence(sets, { 1, 2 }, 1)
    expect(Divergence.roomIncoherence(sets, { 1, 2, 2, 1, 2 }, 1)):toBe(pair)
end)

test(suite, "collapsing a set drops incoherence by exactly its weight", function()
    -- 3.6.5. The caller removes a collapsed set, so agreement has to pay out precisely; a
    -- rounding difference here would make concession feel arbitrary.
    local before = { set("a", 12, 4), set("b", 7, 4) }
    local after = { set("a", 12, 4) }
    local lenses = { 1, 2 }
    local delta = Divergence.roomIncoherence(before, lenses, 1)
        - Divergence.roomIncoherence(after, lenses, 1)
    expect(delta):toBe(7)
end)

test(suite, "depth makes the same disagreement worse", function()
    local sets = { set("a", 10, 4) }
    local surface = Divergence.roomIncoherence(sets, { 1, 2 }, 1.0)
    local deep = Divergence.roomIncoherence(sets, { 1, 2 }, 1.4)
    expect(deep > surface):toBeTruthy("the depth scale did not raise incoherence")
end)

test(suite, "a room only dissolves above the threshold", function()
    local threshold = DivergenceConfig.dissolveThreshold
    expect(Divergence.isDissolving(threshold - 1, threshold)):toBeFalsy()
    expect(Divergence.isDissolving(threshold, threshold)):toBeFalsy(
        "the threshold itself dissolved"
    )
    expect(Divergence.isDissolving(threshold + 1, threshold)):toBeTruthy()
end)

test(suite, "depth multiplies the team's divergence rather than adding to it", function()
    -- A team that has not diverged stays coherent all the way down, which is why this is a
    -- multiplier: depth punishes disagreement the team already has, it does not invent any.
    local deepest = DistortionConfig.stops[#DistortionConfig.stops - 1]
    expect(Divergence.effective(0, deepest.divergenceScale, 100)):toBe(0)

    local surface = Divergence.effective(40, 1.0, 100)
    local deep = Divergence.effective(40, deepest.divergenceScale, 100)
    expect(deep > surface):toBeTruthy("depth did not raise effective divergence")
    expect(Divergence.effective(95, 1.4, 100)):toBe(100, "effective divergence must clamp")
end)

test(suite, "depth can buy a lens the surface has not", function()
    --[[
        3.2.3, as an actual number rather than a claim. There must exist a divergence value at
        which the surface is calmer than a deeper layer, or "descending is not an escape" is
        prose with nothing behind it.
    ]]
    local deepest = DistortionConfig.stops[#DistortionConfig.stops - 1]
    local found = false
    for divergence = 0, 100 do
        local atSurface =
            Divergence.lensCount(Divergence.effective(divergence, 1.0, 100), thresholds)
        local atDepth = Divergence.lensCount(
            Divergence.effective(divergence, deepest.divergenceScale, 100),
            thresholds
        )
        if atDepth > atSurface then
            found = true
            break
        end
    end
    expect(found):toBeTruthy("no divergence value is more contested at depth than at the surface")
end)

test(suite, "the ledger clamps and an unknown event raises", function()
    local ledger = DivergenceConfig.ledger :: { [string]: number }
    local minimum, maximum = DivergenceConfig.minimum, DivergenceConfig.maximum

    expect(Divergence.applyEvent(0, ledger, "setCollapsedByAgreement", minimum, maximum)):toBe(
        minimum
    )
    expect(Divergence.applyEvent(100, ledger, "failedTaskAttempt", minimum, maximum)):toBe(maximum)

    -- A typo that quietly moved nothing would be invisible for the whole of tuning.
    expect(function()
        Divergence.applyEvent(0, ledger, "monsterAttackLanded", minimum, maximum)
    end):toErrorWith("unknown event")
end)

test(suite, "a bad run earns the last lens, and progress pulls it back", function()
    local ledger = DivergenceConfig.ledger :: { [string]: number }
    local minimum, maximum = DivergenceConfig.minimum, DivergenceConfig.maximum

    --[[
        A plausible bad run rather than a contrived one: six wrong answers and five rooms that
        came apart under somebody. That has to be enough to earn the last lens, because 3.6.6
        says the clock alone must never buy it — so if failure cannot buy it either, the fourth
        reading of the world is unreachable and a quarter of the system is dead content.
    ]]
    local divergence = ledger.roundStart
    for _ = 1, 6 do
        divergence =
            Divergence.applyEvent(divergence, ledger, "failedTaskAttempt", minimum, maximum)
    end
    for _ = 1, 5 do
        divergence =
            Divergence.applyEvent(divergence, ledger, "involuntaryDescent", minimum, maximum)
    end
    expect(Divergence.lensCount(divergence, thresholds)):toBe(
        maxLenses,
        `a run of six failures and five falls reached only divergence {divergence}`
    )

    for _ = 1, 8 do
        divergence =
            Divergence.applyEvent(divergence, ledger, "objectiveStepCompleted", minimum, maximum)
    end
    expect(Divergence.lensCount(divergence, thresholds)):toBe(1, "a recovered team stayed diverged")
end)

test(suite, "the clock alone never buys the last lens", function()
    --[[
        3.6.6, checked against the real round length rather than the config's own arithmetic, so
        that tuning `sedativeSeconds` and the ledger independently cannot quietly break it. The
        worst case is every player at the deepest playable level for the whole round.
    ]]
    local ledger = DivergenceConfig.ledger
    local minutes = GameConfig.sedativeSeconds / 60
    local deepest = DistortionConfig.stops[#DistortionConfig.stops - 1]
    local passive = ledger.roundStart
        + minutes * (ledger.perMinuteElapsed + ledger.perMinutePerDepthLevel * deepest.depth)

    local effective =
        Divergence.effective(passive, deepest.divergenceScale, DivergenceConfig.maximum)
    expect(Divergence.lensCount(effective, thresholds) < maxLenses):toBeTruthy(
        `a full idle round at depth {deepest.depth} reached {maxLenses} lenses on the clock alone`
    )
end)

return suite
