import { getAnimal } from './animals.js';
import { getCosmetic } from './cosmetics.js';

/**
 * Fixed-price storefront.
 *
 * Deliberate constraints, enforced by `validateCatalog()` and a unit test:
 *  - every price is one of the approved price points,
 *  - no randomised rewards (no loot boxes, no gacha),
 *  - nothing sold affects gameplay,
 *  - bundles must be cheaper than buying their contents separately.
 */
export const PRICE_POINTS = [99, 149, 199, 299, 499] as const;
export type PriceCents = (typeof PRICE_POINTS)[number];

export type StoreItemKind = 'animal' | 'cosmetic' | 'bundle' | 'season';

export interface StoreItem {
  id: string;
  kind: StoreItemKind;
  name: string;
  description: string;
  priceCents: number;
  /** Content ids granted on purchase. */
  grants: string[];
  /** Optional soft-currency price; -1 when the item is real-money only. */
  priceCoins: number;
  /** Marketing tag for the shelf ("new", "popular", "season"). */
  tag?: string;
  seasonId?: string;
}

const catalog = new Map<string, StoreItem>();

export function registerStoreItems(items: StoreItem[]): void {
  for (const item of items) catalog.set(item.id, item);
}

export function getStoreItem(id: string): StoreItem | undefined {
  return catalog.get(id);
}

export function listStoreItems(): StoreItem[] {
  return [...catalog.values()];
}

export interface CatalogProblem {
  itemId: string;
  problem: string;
}

/** Run at boot on the server: a bad catalog must never reach players. */
export function validateCatalog(items: StoreItem[] = listStoreItems()): CatalogProblem[] {
  const problems: CatalogProblem[] = [];
  for (const item of items) {
    if (!(PRICE_POINTS as readonly number[]).includes(item.priceCents)) {
      problems.push({ itemId: item.id, problem: `price ${item.priceCents} is not an approved price point` });
    }
    if (item.grants.length === 0) {
      problems.push({ itemId: item.id, problem: 'grants nothing' });
    }
    for (const grant of item.grants) {
      const known = getAnimal(grant) ?? getCosmetic(grant);
      if (!known && !grant.startsWith('season:') && !grant.startsWith('coins:')) {
        problems.push({ itemId: item.id, problem: `grants unknown content "${grant}"` });
      }
    }
    if (item.kind === 'bundle') {
      const separate = item.grants.reduce((sum, grant) => {
        const animal = getAnimal(grant);
        if (animal) return sum + animal.priceCents;
        const cosmetic = getCosmetic(grant);
        return sum + (cosmetic?.priceCents ?? 0);
      }, 0);
      if (separate > 0 && item.priceCents >= separate) {
        problems.push({ itemId: item.id, problem: 'bundle costs at least as much as its contents' });
      }
    }
  }
  return problems;
}

export const LAUNCH_STORE: StoreItem[] = [
  {
    id: 'animal_wolf',
    kind: 'animal',
    name: 'Wolf',
    description: 'Unlock the Wolf. Cosmetic only.',
    priceCents: 99,
    priceCoins: 6000,
    grants: ['wolf'],
    tag: 'popular',
  },
  {
    id: 'animal_fox',
    kind: 'animal',
    name: 'Fox',
    description: 'Unlock the Fox. Cosmetic only.',
    priceCents: 99,
    priceCoins: 6000,
    grants: ['fox'],
  },
  {
    id: 'animal_frog',
    kind: 'animal',
    name: 'Frog',
    description: 'Unlock the Frog. Cosmetic only.',
    priceCents: 99,
    priceCoins: 6000,
    grants: ['frog'],
  },
  {
    id: 'animal_tiger',
    kind: 'animal',
    name: 'Tiger',
    description: 'Unlock the Tiger. Cosmetic only.',
    priceCents: 149,
    priceCoins: 9000,
    grants: ['tiger'],
    tag: 'new',
  },
  {
    id: 'animal_penguin',
    kind: 'animal',
    name: 'Penguin',
    description: 'Unlock the Penguin. Cosmetic only.',
    priceCents: 149,
    priceCoins: 9000,
    grants: ['penguin'],
  },
  {
    id: 'bundle_starter',
    kind: 'bundle',
    name: 'Starter Pack',
    description: 'Wolf and Fox together, plus the Explorer Hat.',
    priceCents: 199,
    priceCoins: -1,
    grants: ['wolf', 'fox', 'hat_explorer'],
    tag: 'value',
  },
  {
    id: 'bundle_jungle',
    kind: 'bundle',
    name: 'Jungle Pack',
    description: 'Tiger, Penguin, Jungle Crown and the Rainbow Trail.',
    priceCents: 499,
    priceCoins: -1,
    grants: ['tiger', 'penguin', 'hat_crown', 'trail_rainbow'],
    tag: 'value',
  },
  {
    id: 'cosmetic_crown',
    kind: 'cosmetic',
    name: 'Jungle Crown',
    description: 'Wear the canopy.',
    priceCents: 199,
    priceCoins: -1,
    grants: ['hat_crown'],
  },
  {
    id: 'cosmetic_jetpack',
    kind: 'cosmetic',
    name: 'Toy Jetpack',
    description: 'Purely decorative. It does not actually fly — nothing in the store changes movement.',
    priceCents: 199,
    priceCoins: -1,
    grants: ['backpack_jet'],
  },
  {
    id: 'season_1_premium',
    kind: 'season',
    name: 'Season 1 Premium Track',
    description: 'Optional premium rewards for Season 1 — Jungle. The free track stays free.',
    priceCents: 199,
    priceCoins: -1,
    grants: ['season:season-1'],
    seasonId: 'season-1',
    tag: 'season',
  },
];

registerStoreItems(LAUNCH_STORE);
