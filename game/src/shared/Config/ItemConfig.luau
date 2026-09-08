--!strict
-- Inventory rules and the item catalogue (specification 4, P0 item 8).

export type ItemDefinition = {
    id: string,
    displayName: string,
    stackable: boolean,
    maxStack: number,
    consumable: boolean,
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
        }),
        Battery = table.freeze({
            id = "Battery",
            displayName = "Battery",
            stackable = true,
            maxStack = 4,
            consumable = true,
        }),
        -- Every player starts with one. It reports true depth; its function is never sold.
        Totem = table.freeze({
            id = "Totem",
            displayName = "Totem",
            stackable = false,
            maxStack = 1,
            consumable = false,
        }),
        SedativeDose = table.freeze({
            id = "SedativeDose",
            displayName = "Sedative Dose",
            stackable = true,
            maxStack = 2,
            consumable = true,
        }),
        Key = table.freeze({
            id = "Key",
            displayName = "Key",
            stackable = false,
            maxStack = 1,
            consumable = false,
        }),
    },
}

return table.freeze(ItemConfig)
