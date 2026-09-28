import type { Rarity, UnlockKind } from './animals.js';

/** Slots are fixed; new cosmetics are data, not code. */
export const COSMETIC_SLOTS = [
  'hat',
  'mask',
  'glasses',
  'backpack',
  'tail',
  'hands',
  'effect',
  'trail',
  'emote',
] as const;

export type CosmeticSlot = (typeof COSMETIC_SLOTS)[number];

export interface CosmeticDef {
  id: string;
  name: string;
  slot: CosmeticSlot;
  rarity: Rarity;
  unlock: UnlockKind;
  priceCents: number;
  /** Price in soft currency when earnable for free. -1 when not purchasable with coins. */
  priceCoins: number;
  visual: {
    color: number;
    accent?: number;
    /** Renderer picks a mesh recipe from this key. */
    shape: string;
    scale?: number;
  };
  seasonId?: string;
  eventId?: string;
  /** Emote cosmetics carry an animation id. */
  emoteId?: number;
}

const registry = new Map<string, CosmeticDef>();

export function registerCosmetics(defs: CosmeticDef[]): void {
  for (const def of defs) registry.set(def.id, def);
}

export function getCosmetic(id: string): CosmeticDef | undefined {
  return registry.get(id);
}

export function listCosmetics(): CosmeticDef[] {
  return [...registry.values()];
}

export function cosmeticsForSlot(slot: CosmeticSlot): CosmeticDef[] {
  return listCosmetics().filter((c) => c.slot === slot);
}

/**
 * Every cosmetic is free.
 *
 * The price columns are gone rather than zeroed, because a zero that used to be a price is a
 * thing someone will eventually "fix" back. `rarity` survives as what it always should have
 * been: a label describing how flashy something looks, not how much it costs.
 */
function cosmetic(
  id: string,
  name: string,
  slot: CosmeticSlot,
  rarity: Rarity,
  shape: string,
  color: number,
  extra: Partial<CosmeticDef> = {},
): CosmeticDef {
  return {
    id,
    name,
    slot,
    rarity,
    unlock: 'free',
    priceCents: 0,
    priceCoins: 0,
    visual: { color, shape },
    ...extra,
  };
}

export const LAUNCH_COSMETICS: CosmeticDef[] = [
  cosmetic('hat_leaf', 'Leaf Cap', 'hat', 'common', 'leaf', 0x4ade80),
  cosmetic('hat_explorer', 'Explorer Hat', 'hat', 'common', 'brim', 0xb45309),
  cosmetic('hat_crown', 'Jungle Crown', 'hat', 'epic', 'crown', 0xfbbf24),
  cosmetic('mask_tribal', 'Tribal Mask', 'mask', 'rare', 'tribal', 0xdc2626),
  cosmetic('mask_bandit', 'Bandit Mask', 'mask', 'common', 'band', 0x1f2937),
  cosmetic('glasses_round', 'Round Shades', 'glasses', 'common', 'round', 0x111827),
  cosmetic('glasses_star', 'Star Shades', 'glasses', 'rare', 'star', 0xf472b6),
  cosmetic('backpack_vine', 'Vine Pack', 'backpack', 'common', 'vine', 0x16a34a),
  cosmetic('backpack_jet', 'Toy Jetpack', 'backpack', 'epic', 'jet', 0x0ea5e9),
  cosmetic('tail_stripe', 'Striped Tail', 'tail', 'common', 'stripe', 0xf59e0b),
  cosmetic('tail_glow', 'Glow Tail', 'tail', 'rare', 'glow', 0x22d3ee),
  cosmetic('hands_gloves', 'Grip Gloves', 'hands', 'common', 'gloves', 0xef4444),
  cosmetic('hands_boxing', 'Boxing Gloves', 'hands', 'rare', 'boxing', 0xdc2626),
  cosmetic('effect_sparkle', 'Sparkle Aura', 'effect', 'rare', 'sparkle', 0xfde68a),
  cosmetic('effect_leaves', 'Leaf Swirl', 'effect', 'common', 'leaves', 0x22c55e),
  cosmetic('trail_dust', 'Dust Trail', 'trail', 'common', 'dust', 0xd6d3d1),
  cosmetic('trail_rainbow', 'Rainbow Trail', 'trail', 'epic', 'rainbow', 0xa855f7),
  cosmetic('emote_backflip', 'Backflip', 'emote', 'rare', 'emote', 0xffffff, { emoteId: 5 }),
  cosmetic('emote_sleep', 'Power Nap', 'emote', 'common', 'emote', 0xffffff, { emoteId: 6 }),
  cosmetic('emote_victory', 'Victory Hop', 'emote', 'common', 'emote', 0xffffff, { emoteId: 7 }),
];

/**
 * What a new account owns: everything that shipped at launch, and every cosmetic marked `free`.
 *
 * The game is free and stays free — nothing here is sold, and nothing that affects play is ever
 * locked. But a free game with nothing left to earn has a progression loop that pays out in
 * nothing, and that is what shipped: measured, 9 of the season pass's 13 rewards and 4 of the 7
 * daily rewards were items every account already owned from creation, and the coins the other
 * rewards paid could buy nothing at all (the only coin sink was an empty store). So a season adds
 * cosmetics of its own that are *earned* — by season level, or with coins won in matches — never
 * bought with money, and never anything but a look.
 */
export function isStarterCosmetic(def: CosmeticDef): boolean {
  return def.unlock === 'free';
}

/** Coins for a season cosmetic bought outright, by how showy it is. Earned in matches, never sold. */
export const SEASON_COIN_PRICE: Record<'common' | 'rare' | 'epic', number> = { common: 900, rare: 1600, epic: 2600 };

function seasonal(
  id: string,
  name: string,
  slot: CosmeticSlot,
  rarity: 'common' | 'rare' | 'epic',
  shape: string,
  color: number,
  accent: number,
): CosmeticDef {
  return {
    id,
    name,
    slot,
    rarity,
    unlock: 'season',
    seasonId: 'season-1',
    priceCents: 0,
    priceCoins: SEASON_COIN_PRICE[rarity],
    visual: { color, accent, shape },
  };
}

/** Season 1's own cosmetics: on its reward track, and on the coin shelf for anyone who missed a level. */
export const SEASON_ONE_COSMETICS: CosmeticDef[] = [
  seasonal('glasses_goggles', 'Canopy Goggles', 'glasses', 'common', 'goggles', 0x38bdf8, 0x78350f),
  seasonal('tail_bow', 'Ribbon Bow', 'tail', 'common', 'bow', 0xec4899, 0xfdf2f8),
  seasonal('backpack_boomerang', 'Boomerang', 'backpack', 'rare', 'boomerang', 0xb45309, 0xfde68a),
  seasonal('mask_snorkel', 'Reef Snorkel', 'mask', 'common', 'snorkel', 0xf97316, 0x0ea5e9),
  seasonal('hat_propeller', 'Propeller Beanie', 'hat', 'rare', 'propeller', 0xef4444, 0xfacc15),
  seasonal('hat_flower', 'Hibiscus Crown', 'hat', 'epic', 'flowers', 0xf43f5e, 0xfde047),
];

registerCosmetics(LAUNCH_COSMETICS);
registerCosmetics(SEASON_ONE_COSMETICS);
