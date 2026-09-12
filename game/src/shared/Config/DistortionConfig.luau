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
    -- 3.6.2: multiplies the team's divergence here, so the same value buys more lenses
    -- deeper down. 3.6.4: multiplies how fast a room here stops agreeing with itself.
    divergenceScale: number,
    incoherenceScale: number,
    propDuplicationChance: number,
    geometryJitterStuds: number,
    hudTruthfulness: number,
    fragmentTruthfulness: number,
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
            divergenceScale = 1.0,
            incoherenceScale = 1.0,
            propDuplicationChance = 0.0,
            geometryJitterStuds = 0.0,
            hudTruthfulness = 1.0,
            fragmentTruthfulness = 1.0,
        }),
        table.freeze({
            depth = 1,
            saturation = 0.78,
            fogEnd = 300,
            lightRangeScale = 0.86,
            gravityScale = 0.94,
            divergenceScale = 1.08,
            incoherenceScale = 1.10,
            propDuplicationChance = 0.06,
            geometryJitterStuds = 0.4,
            hudTruthfulness = 1.0,
            fragmentTruthfulness = 1.0,
        }),
        table.freeze({
            depth = 2,
            saturation = 0.52,
            fogEnd = 210,
            lightRangeScale = 0.71,
            gravityScale = 0.86,
            divergenceScale = 1.18,
            incoherenceScale = 1.24,
            propDuplicationChance = 0.16,
            geometryJitterStuds = 1.1,
            -- Below 1.0 the depth indicator is allowed to lie; the totem is the answer.
            hudTruthfulness = 0.88,
            fragmentTruthfulness = 0.85,
        }),
        table.freeze({
            depth = 3,
            saturation = 0.24,
            fogEnd = 140,
            lightRangeScale = 0.58,
            gravityScale = 0.78,
            divergenceScale = 1.30,
            incoherenceScale = 1.40,
            propDuplicationChance = 0.28,
            geometryJitterStuds = 2.2,
            hudTruthfulness = 0.72,
            fragmentTruthfulness = 0.70,
        }),
        -- Limbo (3.2.6). The one place in the game where everybody sees the same thing:
        -- one lens, nothing contested, so both divergence scales are inert here. It is
        -- quiet and restful, and that is the joke — it is also the place you cannot leave
        -- without someone else.
        table.freeze({
            depth = 4,
            saturation = 0.0,
            fogEnd = 900,
            lightRangeScale = 1.0,
            gravityScale = 0.6,
            divergenceScale = 1.0,
            incoherenceScale = 1.0,
            propDuplicationChance = 0.0,
            geometryJitterStuds = 0.0,
            hudTruthfulness = 1.0,
            fragmentTruthfulness = 1.0,
        }),
    },
}

return table.freeze(DistortionConfig)
