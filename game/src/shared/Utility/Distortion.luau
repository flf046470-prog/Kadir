--!strict
--[[
    The depth distortion curve (specification 3.2.2).

    Pure by construction: the caller passes the stops in, so this module requires nothing and
    touches no Roblox type. Plain numbers only — turning `saturation` into a ColorCorrection
    or `fogEnd` into Lighting.FogEnd is the adapter's job, not this one's.

    Depth 1 of the House is not a second authored level. It is the House descriptor put
    through this curve, which is the whole reason four depths across five dreams costs no
    new content.
]]

export type Profile = {
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

local Distortion = {}

--[[
    The profile for `depth`, clamped to the range the stops cover.

    Clamping rather than erroring is deliberate: a depth past the last stop is Limbo, and a
    negative depth is a caller bug that should still render something rather than crash a
    live round. `Distortion.isKnownDepth` is there for code that needs to tell the difference.
]]
function Distortion.forDepth(stops: { Profile }, depth: number): Profile
    if #stops == 0 then
        error("Distortion.forDepth: no stops configured", 2)
    end

    local wanted = math.floor(depth)
    local best = stops[1]
    for _, stop in stops do
        if stop.depth == wanted then
            return stop
        end
        if stop.depth <= wanted and stop.depth > best.depth then
            best = stop
        end
    end

    if wanted < stops[1].depth then
        return stops[1]
    end
    return best
end

function Distortion.isKnownDepth(stops: { Profile }, depth: number): boolean
    for _, stop in stops do
        if stop.depth == math.floor(depth) then
            return true
        end
    end
    return false
end

--[[
    Whether the HUD is allowed to misreport depth here.

    The roll is the caller's, taken from the round Rng, so this stays a pure predicate and
    the lie is still reproducible from the round seed.
]]
function Distortion.hudMayLie(profile: Profile, roll: number): boolean
    return roll >= profile.hudTruthfulness
end

return Distortion
