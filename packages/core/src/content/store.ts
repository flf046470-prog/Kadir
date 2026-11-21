import { getAnimal } from './animals.js';
import { SEASON_ONE_COSMETICS, getCosmetic, isStarterCosmetic } from './cosmetics.js';
import { getGadget } from '../gadgets/catalog.js';

/**
 * The storefront.
 *
 * The game is free, and everything in it is free — animals, gadgets and the launch cosmetics are
 * owned from the moment an account exists, and a season's own cosmetics are earned by playing
 * (its reward track, or coins won in matches). `validateCatalog()` is what holds that: it refuses
 * any item with a price in money and any coin price on something other than a season cosmetic,
 * and the server will not boot if it finds one.
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
      // Coins may buy only what is left to earn: a season's own cosmetics. A coin price on anything
      // every account already owns — an animal, a gadget, a starter cosmetic — would be a price on
      // something the player has had since their account existed, and on a gadget it would be a
      // price on play.
      if (item.priceCoins > 0) {
        const cosmetic = getCosmetic(grant);
        if (!cosmetic || isStarterCosmetic(cosmetic)) {
          problems.push({ itemId: item.id, problem: `sells "${grant}" for coins, and only a season cosmetic may be` });
        }
      }
    }
  }
  return problems;
}

/**
 * The storefront, deliberately empty.
 *
 * Kangaroo Chase ships with everything unlocked: every animal, every cosmetic and every gadget is
 * owned by every account from the moment it is created, and so is the season pass's premium
 * track — `createProfile` sets `premiumOwned: true`. There is nothing to sell, so there is
 * nothing on the shelf.
 *
 * A pass item was written for this shelf and then removed, which is worth recording because the
 * reasoning looked sound: a premium track unlocked with earned coins keeps "nothing is sold for
 * money" intact while still being a premium track. It was wrong for a simpler reason — every
 * player already owns it. Adding a price, even in coins, would have taken away something they
 * have had since their account existed. The pass is not missing a purchase; it was missing a
 * screen.
 *
 * The purchase machinery below it — receipt verification, idempotent grants, the audit trail —
 * is kept and still tested. It is the part that takes real effort to get right, and an empty
 * catalog is a one-line decision to reverse; an unverified receipt path bolted on later is not.
 */
export const LAUNCH_STORE: StoreItem[] = [];

/**
 * The coin shelf: each of a season's own cosmetics, for coins won in matches.
 *
 * Its reward track is one way to earn them and this is the other, so a player who joins late or
 * skips a week can still have the whole season — and the coins that every round, daily reward and
 * season level pay out finally buy something. Never money: `validateCatalog` refuses any price in
 * cents, and refuses a coin price on anything but a season cosmetic.
 */
export const SEASON_SHELF: StoreItem[] = SEASON_ONE_COSMETICS.map((cosmetic) => ({
  id: `shelf_${cosmetic.id}`,
  kind: 'cosmetic' as const,
  name: cosmetic.name,
  description: `Season 1 · ${cosmetic.slot}`,
  priceCents: 0,
  grants: [cosmetic.id],
  priceCoins: cosmetic.priceCoins,
  tag: 'season',
  ...(cosmetic.seasonId ? { seasonId: cosmetic.seasonId } : {}),
}));

registerStoreItems(LAUNCH_STORE);
registerStoreItems(SEASON_SHELF);
