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

registerCosmetics(LAUNCH_COSMETICS);
