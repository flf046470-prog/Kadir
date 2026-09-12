--!strict
-- Inventory rules and the item catalogue (specification 4, P0 item 8).

export type ItemDefinition = {
    id: string,
    displayName: string,
    stackable: boolean,
    maxStack: number,
    consumable: boolean,
    -- Lowest depth this item may spawn at. Specification 3.2.5 puts sedative doses below
    -- the surface only, so the resource that pays for climbing is found by going down.
    minSpawnDepth: number,
}

export type ItemConfigType = {
    inventorySlots: number,
    maxInteractionDistanceStuds: number,
    items: { [string]: ItemDefinition },
}

local ItemConfig: ItemConfigType = {
    inventorySlots = 6,
    maxInteractionDistanceStuds = 12,
    items = {
        Flashlight = table.freeze({
            id = "Flashlight",
            displayName = "Flashlight",
            stackable = false,
            maxStack = 1,
            consumable = false,
            minSpawnDepth = 0,
        }),
        Battery = table.freeze({
            id = "Battery",
            displayName = "Battery",
            stackable = true,
            maxStack = 4,
            consumable = true,
            minSpawnDepth = 0,
        }),
        -- Every player starts with one. It reports true depth; its function is never sold.
        Totem = table.freeze({
            id = "Totem",
            displayName = "Totem",
            stackable = false,
            maxStack = 1,
            consumable = false,
            minSpawnDepth = 0,
        }),
        SedativeDose = table.freeze({
            id = "SedativeDose",
            displayName = "Sedative Dose",
            stackable = true,
            maxStack = 2,
            consumable = true,
            minSpawnDepth = 1,
        }),
        Key = table.freeze({
            id = "Key",
            displayName = "Key",
            stackable = false,
            maxStack = 1,
            consumable = false,
            minSpawnDepth = 0,
        }),
    },
}

return table.freeze(ItemConfig)
