--!strict
--[[
    Which layers exist, in what order, and what each one asks of the players (specification 5).

    Only identity, ordering and the waking task live here. The actual room graphs, fragments and
    variant sets are `LayerDescriptor` tables built in a later milestone; M1 owns the list so
    ConfigValidator can check that the order is contiguous, that every task kind is real, and
    that the P0 slice names a layer that exists.

    The order is the teaching order and it is load-bearing. Each layer assumes the players
    learned the one before it, which is why `ConfigValidator` refuses to accept a gap or a
    reshuffle rather than treating `order` as a display hint.
]]

export type WakingTask =
    "CollectSymbols" -- find five of a thing
    | "OrderSequence" -- put known things into an unknown order
    | "DeduceRule" -- name the rule the world is running on
    | "SynchroniseAnchors" -- n points active inside one window
    | "IdentifyReal" -- choose between things claiming to be real
    | "Decide" -- the Final Layer: not a puzzle, a decision

export type DreamEntry = {
    id: string,
    displayName: string,
    order: number,
    generation: "Authored" | "Procedural",
    task: WakingTask,
    --[[
        Whether one player can finish this layer's task as written. `SynchroniseAnchors` cannot
        — three simultaneous points is impossible alone — so it declares a solo override
        instead (section 5: sequential holds against a decay timer). A layer that is neither
        solo-safe nor overridden would quietly make the stated 1-6 player range a lie, so
        ConfigValidator rejects it.
    ]]
    soloSafe: boolean,
    soloOverride: string?,
    inP0Slice: boolean,
}

export type LayerConfigType = {
    dreams: { DreamEntry },
    startingDreamId: string,
    finalLayerId: string,
}

local LayerConfig: LayerConfigType = {
    dreams = {
        table.freeze({
            id = "House",
            displayName = "The House",
            order = 1,
            generation = "Authored" :: "Authored",
            -- Teaches that the room shows different things to different people. Divergence is
            -- pinned at 0 here until the first symbol is found (3.6.6), so the House is the
            -- same house for everybody until the players know what that felt like.
            task = "CollectSymbols" :: "CollectSymbols",
            soloSafe = true,
            soloOverride = nil,
            inP0Slice = true,
        }),
        table.freeze({
            id = "School",
            displayName = "Abandoned School",
            order = 2,
            generation = "Authored" :: "Authored",
            -- Teaches that a teammate's reading is data. No single lens holds enough of the
            -- ordering clues, so solo play pools them across depths instead of across people.
            task = "OrderSequence" :: "OrderSequence",
            soloSafe = true,
            soloOverride = "CluesSplitAcrossDepthsInstead",
            inP0Slice = false,
        }),
        table.freeze({
            id = "Corridor",
            displayName = "The Endless Corridor",
            order = 3,
            generation = "Procedural" :: "Procedural",
            -- Teaches that the divergence itself is legible. The signature layer, and the one
            -- the whole design exists to make possible.
            task = "DeduceRule" :: "DeduceRule",
            soloSafe = true,
            soloOverride = nil,
            inP0Slice = false,
        }),
        table.freeze({
            id = "Hospital",
            displayName = "Dream Hospital",
            order = 4,
            generation = "Authored" :: "Authored",
            -- Teaches that agreement has to survive being split up. Impossible alone as
            -- written, hence the override.
            task = "SynchroniseAnchors" :: "SynchroniseAnchors",
            soloSafe = false,
            soloOverride = "SequentialHoldsAgainstDecayTimer",
            inP0Slice = false,
        }),
        table.freeze({
            id = "BrokenDream",
            displayName = "The Broken Dream",
            order = 5,
            generation = "Authored" :: "Authored",
            -- Teaches that collapsing a set is a choice with a cost. Every anchor here is
            -- contested and none has a plain option.
            task = "IdentifyReal" :: "IdentifyReal",
            soloSafe = true,
            soloOverride = nil,
            inP0Slice = false,
        }),
        table.freeze({
            id = "FinalLayer",
            displayName = "The Final Layer",
            order = 6,
            generation = "Authored" :: "Authored",
            -- The waking room, again. Asks whether waking up is an exit, and reads the run's
            -- concession ledger (3.6.7) to answer.
            task = "Decide" :: "Decide",
            soloSafe = true,
            soloOverride = nil,
            inP0Slice = false,
        }),
    },
    startingDreamId = "House",
    finalLayerId = "FinalLayer",
}

return table.freeze(LayerConfig)
