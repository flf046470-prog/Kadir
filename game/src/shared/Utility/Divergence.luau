--!strict
--[[
    Lenses and incoherence (specification 3.6) — the world as the antagonist.

    Pure by construction: every table this needs is passed in, so it requires nothing, touches
    no Roblox type, and runs headlessly under Lune. Turning a lens into hidden parts and
    collision groups is the adapter's job (`DivergenceController`), not this one's.

    The two ideas worth holding while reading:

    * A **lens** is a whole reading of a layer, assigned per player, not per object. That is
      partly an engine constraint — per-object resolution would need one collision group per
      subset of players, which does not fit in Roblox's 32 — and mostly better design: with at
      most four lenses and up to six players, players *share* readings, so two can corroborate
      while a third disagrees. Six private worlds would be noise.
    * **Incoherence** is what a room accrues while the people standing in it disagree about it.
      Past a threshold the room stops holding them up. Nothing chases anyone.
]]

export type Variant = {
    index: number,
}

export type VariantSet = {
    id: string,
    roomId: string,
    weight: number,
    variants: { Variant },
}

local Divergence = {}

--[[
    One FNV-1a step, with the 32-bit multiply done as shifts and adds.

    The obvious `(hash * 16777619) % 2^32` is wrong in Luau and wrong in a way that hides: for a
    hash anywhere near 2^32 the product exceeds 2^53, so float64 drops the low mantissa bits and
    the result comes back a multiple of a large power of two. Since the lens is picked with
    `hash % lensCount`, that zeroed low end is precisely the part being read, and every player
    lands on lens 1 — the game silently loses its antagonist while every other test still passes.
    Measured: the float multiply disagrees with exact arithmetic for about 69% of 32-bit inputs.

    16777619 = 2^24 + 2^8 + 2^7 + 2^4 + 2^1 + 2^0, so six shifted copies summed give the same
    product. `bit32.lshift` already truncates to 32 bits, so each term is below 2^32 and the sum
    stays far inside the exactly-representable range.

    Duplicated in `Rng.luau` on purpose: pure modules are leaves (specification 0.4) because
    `require(script.Parent.Rng)` does not resolve under Lune. Two copies of six shifts is a
    cheaper price than a module that cannot be unit-tested.
]]
local FNV_OFFSET = 2166136261
local FNV_SHIFTS = { 0, 1, 4, 7, 8, 24 }

local function fnvMix(hash: number, byte: number): number
    local mixed = bit32.bxor(hash, byte)
    local total = 0
    for _, shift in FNV_SHIFTS do
        total += bit32.lshift(mixed, shift)
    end
    return total % 0x100000000
end

--[[
    How many distinct readings of the world exist at `divergence`.

    `thresholds` is one ascending value per lens beyond the first, so a count of N thresholds
    permits N+1 lenses. Below the first threshold the answer is exactly 1: the dream agrees
    with itself, and that state must be reachable rather than merely likely, because it is what
    teaches players what agreement looks like before the game takes it away.
]]
function Divergence.lensCount(divergence: number, thresholds: { number }): number
    local count = 1
    for _, threshold in thresholds do
        if divergence >= threshold then
            count += 1
        end
    end
    return count
end

--[[
    The effective divergence at `depth`.

    Depth does not add disagreement of its own; it multiplies what the team already has. A team
    holding together at the surface can be unable to finish a sentence at depth 3, and a team
    that has not diverged at all stays coherent all the way down — which is why the scale is a
    multiplier rather than a bonus.
]]
function Divergence.effective(divergence: number, depthScale: number, maximum: number): number
    return math.clamp(divergence * depthScale, 0, maximum)
end

--[[
    Which lens the player in `slot` reads the layer through.

    **Deliberately an even rotation rather than a hash**, and that is the design rather than a
    shortcut. With six slots over four lenses a rotation always produces the multiset {2,2,1,1}:
    two pairs who can corroborate each other and two players who are the odd one out. A real
    hash would give that *on average* and would also, a few rounds in every thousand, put the
    whole team on one lens — a round where nothing is contested and the game quietly has no
    antagonist. The guarantee is worth more here than the unpredictability.

    `slot` is the player's 1..maxPlayers seat, the same index that names their `Player<slot>`
    collision group (3.6.3) — **not** a UserId. Rotating arbitrary UserIds would put any two
    players whose ids happen to differ by a multiple of `lensCount` on the same lens in every
    round they ever played together.

    `salt` is **server-only state and must never be the replicated round seed.** It decides who
    reads the world which way, and `lensFor` is a pure function living in shared code, so a
    client holding the salt can compute every teammate's lens — which deletes the conversation
    the whole game is built on while leaving every test passing. The server tells each client its
    own lens over `DivergenceSync` and nothing else (3.6.3, specification 9).
]]
function Divergence.lensFor(slot: number, salt: number, lensCount: number): number
    if lensCount < 1 then
        error("Divergence.lensFor: lensCount must be at least 1", 2)
    end
    if slot < 1 then
        error(`Divergence.lensFor: slot must be at least 1, got {slot}`, 2)
    end
    if lensCount == 1 then
        -- Not an optimisation. At one lens everybody must share it exactly, and rotating here
        -- would be a needless chance to get the one case that matters wrong.
        return 1
    end

    local hash = FNV_OFFSET
    local remaining = math.floor(math.abs(salt)) % 0x100000000
    for _ = 1, 4 do
        hash = fnvMix(hash, remaining % 256)
        remaining = math.floor(remaining / 256)
    end

    --[[
        The high bits, for two reasons. FNV mixes its low end poorly, so an offset taken from
        there walks linearly with the salt and consecutive rounds rotate by exactly one seat. And
        the low end is where the overflow described above does its damage, so reading the top is a
        second guard that holds even if somebody reintroduces the naive multiply.
    ]]
    local offset = math.floor((hash / 0x100000000) * lensCount)

    return ((slot - 1 + offset) % lensCount) + 1
end

--[[
    Which variant of `set` a player on `lens` is shown.

    Lenses wrap, so a two-variant set resolves for all four lenses and two lenses that wrap
    onto the same variant genuinely agree — which is the point: a set with fewer variants than
    there are lenses is a place where some of the team happens to be looking at the same thing.
]]
function Divergence.variantFor(set: VariantSet, lens: number): number
    local count = #set.variants
    if count == 0 then
        error(`Divergence.variantFor: set "{set.id}" has no variants`, 2)
    end
    return ((lens - 1) % count) + 1
end

-- The distinct lenses among `lenses`, which is what incoherence actually counts. Two players
-- reading a room the same way are one disagreement's worth of nothing.
local function distinctCount(lenses: { number }): number
    local seen: { [number]: boolean } = {}
    local count = 0
    for _, lens in lenses do
        if not seen[lens] then
            seen[lens] = true
            count += 1
        end
    end
    return count
end

--[[
    How far a room has drifted from agreeing with itself.

    Zero while at most one reading is present, however many players are standing there and
    however heavily the room is contested — a room only disagrees with itself once somebody is
    there to disagree. Above that it is the summed weight of the unresolved sets, scaled by how
    many readings are present and by the depth.

    `sets` is the room's *unresolved* sets: a set collapsed by agreement (3.6.5) is removed by
    the caller, which is why collapsing one drops incoherence by exactly its weight.
]]
function Divergence.roomIncoherence(
    sets: { VariantSet },
    lensesPresent: { number },
    scale: number
): number
    local distinct = distinctCount(lensesPresent)
    if distinct <= 1 then
        return 0
    end

    local weight = 0
    for _, set in sets do
        weight += set.weight
    end

    return weight * (distinct - 1) * scale
end

-- Whether a room this incoherent has started to come apart under the people in it (3.6.4).
function Divergence.isDissolving(incoherence: number, threshold: number): boolean
    return incoherence > threshold
end

--[[
    Applies one ledger event to the team's divergence, clamped.

    Pure and total: an unknown event is a caller bug that must not silently move the number, so
    it raises rather than returning the input unchanged. A typo in an event name that quietly
    did nothing would be invisible for the whole of tuning.
]]
function Divergence.applyEvent(
    divergence: number,
    ledger: { [string]: number },
    event: string,
    minimum: number,
    maximum: number
): number
    local delta = ledger[event]
    if delta == nil then
        error(`Divergence.applyEvent: unknown event "{event}"`, 2)
    end
    return math.clamp(divergence + delta, minimum, maximum)
end

return Divergence
