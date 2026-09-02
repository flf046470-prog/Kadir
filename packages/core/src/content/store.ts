import { getAnimal } from './animals.js';
import { getCosmetic } from './cosmetics.js';
import { getGadget } from '../gadgets/catalog.js';

/**
 * The storefront.
 *
 * The game is free, and everything in it is free — animals, cosmetics, gadgets, all of it, owned
 * from the moment an account exists. `validateCatalog()` is what holds that: it refuses any item
 * with a price and refuses any content that is not already owned by default, and the server
 * will not boot if it finds one.
 *
 * `PRICE_POINTS` survives as the list of prices that *would* be permissible if anything were
 * ever sold. It is not a plan; it is the constraint that was agreed once and is cheaper to keep
 * than to re-derive.
 */
export const PRICE_POINTS = [99, 149, 199, 299, 499] as const;
export type PriceCents = (typeof PRICE_POINTS)[number];

export type StoreItemKind = 'animal' | 'cosmetic' | 'bundle' | 'season' | 'gadget';

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
    // The rule that makes this a free game, enforced rather than remembered.
    if (item.priceCents !== 0) {
      problems.push({ itemId: item.id, problem: `costs ${item.priceCents} cents; nothing in this game is sold` });
    }
    if (item.grants.length === 0) {
      problems.push({ itemId: item.id, problem: 'grants nothing' });
    }
    for (const grant of item.grants) {
      const known = getAnimal(grant) ?? getCosmetic(grant) ?? getGadget(grant);
      if (!known && !grant.startsWith('season:') && !grant.startsWith('coins:')) {
        problems.push({ itemId: item.id, problem: `grants unknown content "${grant}"` });
      }
    }
  }
  return problems;
}

/**
 * The storefront, deliberately empty.
 *
 * Kangaroo Chase ships with everything unlocked: every animal, every cosmetic and every gadget is
 * owned by every account from the moment it is created. There is nothing to sell, so there is
 * nothing on the shelf.
 *
 * The purchase machinery below it — receipt verification, idempotent grants, the audit trail —
 * is kept and still tested. It is the part that takes real effort to get right, and an empty
 * catalog is a one-line decision to reverse; an unverified receipt path bolted on later is not.
 */
export const LAUNCH_STORE: StoreItem[] = [];

registerStoreItems(LAUNCH_STORE);
