import { getAnimal } from '../content/animals.js';
import { getCosmetic } from '../content/cosmetics.js';
import type { CosmeticSlot } from '../content/cosmetics.js';
import { getStoreItem } from '../content/store.js';
import type { PlayerProfile, PurchaseRecord } from './profile.js';
import { spendCoins } from './economy.js';

export type PurchaseError =
  | 'unknown-item'
  | 'already-owned'
  | 'insufficient-coins'
  | 'not-coin-purchasable'
  | 'invalid-receipt';

export interface PurchaseOutcome {
  ok: boolean;
  error?: PurchaseError;
  granted: string[];
}

/** Grant content ids to a profile, ignoring duplicates. Also handles season/coin grants. */
export function grantContent(profile: PlayerProfile, ids: string[]): string[] {
  const granted: string[] = [];
  for (const id of ids) {
    if (id.startsWith('coins:')) {
      profile.coins += Number.parseInt(id.slice(6), 10) || 0;
      granted.push(id);
      continue;
    }
    if (id.startsWith('season:')) {
      const seasonId = id.slice(7);
      if (profile.season.seasonId === seasonId) profile.season.premiumOwned = true;
      granted.push(id);
      continue;
    }
    if (getAnimal(id)) {
      if (!profile.ownedAnimals.includes(id)) {
        profile.ownedAnimals.push(id);
        granted.push(id);
      }
      continue;
    }
    if (getCosmetic(id)) {
      if (!profile.ownedCosmetics.includes(id)) {
        profile.ownedCosmetics.push(id);
        granted.push(id);
      }
    }
  }
  profile.updatedAt = Date.now();
  return granted;
}

/**
 * Real-money purchase. `verifiedTransactionId` must come from a *server-side verified* store
 * receipt — this function trusts its caller to have done that, and records it for auditing.
 */
export function applyVerifiedPurchase(
  profile: PlayerProfile,
  itemId: string,
  verifiedTransactionId: string,
  now = Date.now(),
): PurchaseOutcome {
  const item = getStoreItem(itemId);
  if (!item) return { ok: false, error: 'unknown-item', granted: [] };
  if (!verifiedTransactionId) return { ok: false, error: 'invalid-receipt', granted: [] };
  if (profile.purchases.some((p) => p.transactionId === verifiedTransactionId)) {
    // Idempotent: replaying a receipt must never double-grant or double-charge.
    return { ok: true, granted: [] };
  }

  const granted = grantContent(profile, item.grants);
  const record: PurchaseRecord = {
    itemId,
    priceCents: item.priceCents,
    transactionId: verifiedTransactionId,
    at: now,
  };
  profile.purchases.push(record);
  return { ok: true, granted };
}

/** Soft-currency purchase — the free path to most cosmetics. */
export function purchaseWithCoins(profile: PlayerProfile, itemId: string, now = Date.now()): PurchaseOutcome {
  const item = getStoreItem(itemId);
  if (!item) return { ok: false, error: 'unknown-item', granted: [] };
  if (item.priceCoins < 0) return { ok: false, error: 'not-coin-purchasable', granted: [] };
  if (ownsAll(profile, item.grants)) return { ok: false, error: 'already-owned', granted: [] };
  if (!spendCoins(profile, item.priceCoins)) return { ok: false, error: 'insufficient-coins', granted: [] };

  const granted = grantContent(profile, item.grants);
  profile.purchases.push({ itemId, priceCents: 0, transactionId: `coins:${now}`, at: now });
  return { ok: true, granted };
}

export function ownsAll(profile: PlayerProfile, ids: string[]): boolean {
  return ids.every(
    (id) =>
      profile.ownedAnimals.includes(id) ||
      profile.ownedCosmetics.includes(id) ||
      (id.startsWith('season:') && profile.season.premiumOwned),
  );
}

export type EquipError = 'unknown' | 'not-owned' | 'wrong-slot';

export interface EquipOutcome {
  ok: boolean;
  error?: EquipError;
}

/** Equip requests come from the client and are always validated against the owned inventory. */
export function equipAnimal(profile: PlayerProfile, animalId: string): EquipOutcome {
  if (!getAnimal(animalId)) return { ok: false, error: 'unknown' };
  if (!profile.ownedAnimals.includes(animalId)) return { ok: false, error: 'not-owned' };
  profile.equipped.animalId = animalId;
  profile.updatedAt = Date.now();
  return { ok: true };
}

export function equipCosmetic(profile: PlayerProfile, slot: CosmeticSlot, cosmeticId: string | null): EquipOutcome {
  if (cosmeticId === null) {
    delete profile.equipped.cosmetics[slot];
    profile.updatedAt = Date.now();
    return { ok: true };
  }
  const def = getCosmetic(cosmeticId);
  if (!def) return { ok: false, error: 'unknown' };
  if (def.slot !== slot) return { ok: false, error: 'wrong-slot' };
  if (!profile.ownedCosmetics.includes(cosmeticId)) return { ok: false, error: 'not-owned' };
  profile.equipped.cosmetics[slot] = cosmeticId;
  profile.updatedAt = Date.now();
  return { ok: true };
}
