--!strict
--[[
    The per-depth distortion curve (specification 3.2.2).

    Plain numbers only, no Color3 and no Vector3, so `Distortion.forDepth` stays pure and
    unit-testable under Lune. The renderer turns saturation and range scales into actual
    Roblox lighting; this table only says how far from the surface each level is.
]]

export type DistortionStop = {
    depth: number,
    saturation: number,
    fogEnd: number,
    lightRangeScale: number,
    gravityScale: number,
    monsterSpeedScale: number,
    monsterDetectionScale: number,
    propDuplicationChance: number,
    geometryJitterStuds: number,
    hudTruthfulness: number,
}

export type DistortionConfigType = {
    stops: { DistortionStop },
}

local DistortionConfig: DistortionConfigType = {
    stops = {
        -- Depth 0 is the dream exactly as authored. Every scale is identity here, which is
        -- what the "apply(d, 0, seed) is equivalent to d" test asserts.
        table.freeze({
            depth = 0,
            saturation = 1.0,
            fogEnd = 400,
            lightRangeScale = 1.0,
            gravityScale = 1.0,
            monsterSpeedScale = 1.0,
            monsterDetectionScale = 1.0,
            propDuplicationChance = 0.0,
            geometryJitterStuds = 0.0,
            hudTruthfulness = 1.0,
        }),
        table.freeze({
            depth = 1,
            saturation = 0.78,
            fogEnd = 300,
            lightRangeScale = 0.86,
            gravityScale = 0.94,
            monsterSpeedScale = 1.08,
            monsterDetectionScale = 1.10,
            propDuplicationChance = 0.06,
            geometryJitterStuds = 0.4,
            hudTruthfulness = 1.0,
        }),
        table.freeze({
            depth = 2,
            saturation = 0.52,
            fogEnd = 210,
            lightRangeScale = 0.71,
            gravityScale = 0.86,
            monsterSpeedScale = 1.18,
            monsterDetectionScale = 1.24,
            propDuplicationChance = 0.16,
            geometryJitterStuds = 1.1,
            -- Below 1.0 the depth indicator is allowed to lie; the totem is the answer.
            hudTruthfulness = 0.88,
        }),
        table.freeze({
            depth = 3,
            saturation = 0.24,
            fogEnd = 140,
            lightRangeScale = 0.58,
            gravityScale = 0.78,
            monsterSpeedScale = 1.30,
            monsterDetectionScale = 1.40,
            propDuplicationChance = 0.28,
            geometryJitterStuds = 2.2,
            hudTruthfulness = 0.72,
        }),
        -- Limbo. No monster, so its combat scales are inert; it is quiet, not hostile.
        table.freeze({
            depth = 4,
            saturation = 0.0,
            fogEnd = 900,
            lightRangeScale = 1.0,
            gravityScale = 0.6,
            monsterSpeedScale = 1.0,
            monsterDetectionScale = 1.0,
            propDuplicationChance = 0.0,
            geometryJitterStuds = 0.0,
            hudTruthfulness = 1.0,
        }),
    },
}

return table.freeze(DistortionConfig)
