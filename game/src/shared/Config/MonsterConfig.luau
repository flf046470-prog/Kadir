--!strict
-- Monster profiles (specification 3.6). One profile is enough for the P0 slice.

export type MonsterProfile = {
    id: string,
    displayName: string,
    walkSpeedPatrol: number,
    walkSpeedChase: number,
    detectionDistance: number,
    fieldOfViewDegrees: number,
    hearingDistance: number,
    hearingSensitivity: number,
    attackDistance: number,
    attackCooldown: number,
    searchDuration: number,
    detectionCooldown: number,
    lingerChance: number,
    ambushChance: number,
    despawnAfter: number?,
    canOpenDoors: boolean,
}

export type MonsterConfigType = {
    profiles: { [string]: MonsterProfile },
    tickHz: number,
    graceSecondsAfterLayerEnter: number,
    -- Noise the monster can hear, in the units used by the hearing model.
    noiseUnits: { [string]: number },
    noiseDecaySeconds: number,
}

local MonsterConfig: MonsterConfigType = {
    profiles = {
        Sleeper = table.freeze({
            id = "Sleeper",
            displayName = "The Sleeper",
            walkSpeedPatrol = 8,
            walkSpeedChase = 19,
            detectionDistance = 55,
            fieldOfViewDegrees = 110,
            hearingDistance = 70,
            hearingSensitivity = 1.0,
            attackDistance = 4.5,
            attackCooldown = 3.0,
            searchDuration = 12,
            detectionCooldown = 2.0,
            -- It sometimes waits near where you went down instead of leaving.
            lingerChance = 0.35,
            ambushChance = 0.15,
            despawnAfter = nil,
            canOpenDoors = true,
        }),
    },
    tickHz = 10,
    graceSecondsAfterLayerEnter = 8,
    noiseUnits = table.freeze({
        crouching = 0,
        walking = 1,
        flashlightToggle = 2,
        sprinting = 3,
        droppedItem = 4,
        failedPuzzle = 5,
        doorSlam = 6,
    }),
    noiseDecaySeconds = 3,
}

return table.freeze(MonsterConfig)
