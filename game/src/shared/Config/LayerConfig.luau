--!strict
--[[
    Which dreams exist and in what order (specification 5).

    Only identity and ordering live here. The actual room graphs are `LayerDescriptor`
    tables built in a later milestone; M1 owns the list so ConfigValidator can check that
    the dream order is contiguous and that the P0 slice names a real starting dream.
]]

export type DreamEntry = {
    id: string,
    displayName: string,
    order: number,
    generation: "Authored" | "Procedural",
    monsterProfileId: string,
    inP0Slice: boolean,
}

export type LayerConfigType = {
    dreams: { DreamEntry },
    startingDreamId: string,
}

local LayerConfig: LayerConfigType = {
    dreams = {
        table.freeze({
            id = "House",
            displayName = "The House",
            order = 1,
            generation = "Authored" :: "Authored",
            monsterProfileId = "Sleeper",
            inP0Slice = true,
        }),
        table.freeze({
            id = "School",
            displayName = "Abandoned School",
            order = 2,
            generation = "Authored" :: "Authored",
            monsterProfileId = "Sleeper",
            inP0Slice = false,
        }),
        table.freeze({
            id = "Corridor",
            displayName = "The Endless Corridor",
            order = 3,
            generation = "Procedural" :: "Procedural",
            monsterProfileId = "Sleeper",
            inP0Slice = false,
        }),
        table.freeze({
            id = "Hospital",
            displayName = "Dream Hospital",
            order = 4,
            generation = "Authored" :: "Authored",
            monsterProfileId = "Sleeper",
            inP0Slice = false,
        }),
        table.freeze({
            id = "BrokenDream",
            displayName = "The Broken Dream",
            order = 5,
            generation = "Authored" :: "Authored",
            monsterProfileId = "Sleeper",
            inP0Slice = false,
        }),
    },
    startingDreamId = "House",
}

return table.freeze(LayerConfig)
