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

function cosmetic(
  id: string,
  name: string,
  slot: CosmeticSlot,
  rarity: Rarity,
  priceCents: number,
  priceCoins: number,
  shape: string,
  color: number,
  extra: Partial<CosmeticDef> = {},
): CosmeticDef {
  return {
    id,
    name,
    slot,
    rarity,
    unlock: priceCents > 0 ? 'purchase' : 'free',
    priceCents,
    priceCoins,
    visual: { color, shape },
    ...extra,
  };
}

export const LAUNCH_COSMETICS: CosmeticDef[] = [
  cosmetic('hat_leaf', 'Leaf Cap', 'hat', 'common', 0, 400, 'leaf', 0x4ade80),
  cosmetic('hat_explorer', 'Explorer Hat', 'hat', 'common', 99, 900, 'brim', 0xb45309),
  cosmetic('hat_crown', 'Jungle Crown', 'hat', 'epic', 199, -1, 'crown', 0xfbbf24),
  cosmetic('mask_tribal', 'Tribal Mask', 'mask', 'rare', 149, 1200, 'tribal', 0xdc2626),
  cosmetic('mask_bandit', 'Bandit Mask', 'mask', 'common', 0, 500, 'band', 0x1f2937),
  cosmetic('glasses_round', 'Round Shades', 'glasses', 'common', 0, 350, 'round', 0x111827),
  cosmetic('glasses_star', 'Star Shades', 'glasses', 'rare', 99, -1, 'star', 0xf472b6),
  cosmetic('backpack_vine', 'Vine Pack', 'backpack', 'common', 0, 600, 'vine', 0x16a34a),
  cosmetic('backpack_jet', 'Toy Jetpack', 'backpack', 'epic', 199, -1, 'jet', 0x0ea5e9),
  cosmetic('tail_stripe', 'Striped Tail', 'tail', 'common', 0, 450, 'stripe', 0xf59e0b),
  cosmetic('tail_glow', 'Glow Tail', 'tail', 'rare', 149, -1, 'glow', 0x22d3ee),
  cosmetic('hands_gloves', 'Grip Gloves', 'hands', 'common', 0, 400, 'gloves', 0xef4444),
  cosmetic('hands_boxing', 'Boxing Gloves', 'hands', 'rare', 99, 1500, 'boxing', 0xdc2626),
  cosmetic('effect_sparkle', 'Sparkle Aura', 'effect', 'rare', 149, -1, 'sparkle', 0xfde68a),
  cosmetic('effect_leaves', 'Leaf Swirl', 'effect', 'common', 0, 700, 'leaves', 0x22c55e),
  cosmetic('trail_dust', 'Dust Trail', 'trail', 'common', 0, 300, 'dust', 0xd6d3d1),
  cosmetic('trail_rainbow', 'Rainbow Trail', 'trail', 'epic', 199, -1, 'rainbow', 0xa855f7),
  cosmetic('emote_backflip', 'Backflip', 'emote', 'rare', 99, 1000, 'emote', 0xffffff, { emoteId: 5 }),
  cosmetic('emote_sleep', 'Power Nap', 'emote', 'common', 0, 350, 'emote', 0xffffff, { emoteId: 6 }),
  cosmetic('emote_victory', 'Victory Hop', 'emote', 'common', 0, 500, 'emote', 0xffffff, { emoteId: 7 }),
];

registerCosmetics(LAUNCH_COSMETICS);
