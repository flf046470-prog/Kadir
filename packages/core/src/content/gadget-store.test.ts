import { describe, expect, it } from 'vitest';

import { getGadget, listGadgets } from '../gadgets/catalog.js';
import { createProfile } from '../progression/profile.js';
import { applyVerifiedPurchase, equipGadgets, grantContent, purchaseWithCoins } from '../progression/inventory.js';
import { GADGET_STORE, getStoreItem, listStoreItems, validateCatalog } from './store.js';

/**
 * The monetisation rules for gear, as executable statements.
 *
 * Gadgets are the first things sold in this game that actually change a round, which is exactly
 * why they need a test file of their own. The rule the whole design rests on is one sentence:
 * every gadget is reachable by playing, so money buys time and never advantage. If a future
 * change breaks that, it should break here first.
 */
describe('the gadget shelf', () => {
  it('passes the catalog validator', () => {
    expect(validateCatalog()).toEqual([]);
  });

  it('lists every sellable gadget and nothing else', () => {
    const sellable = listGadgets()
      .filter((g) => g.unlockCents > 0)
      .map((g) => g.id)
      .toSorted();
    expect(GADGET_STORE.map((item) => item.grants[0]).toSorted()).toEqual(sellable);
  });

  it('prices every one of them at $0.99', () => {
    for (const item of GADGET_STORE) expect(item.priceCents, item.id).toBe(99);
  });

  it('always offers the coin price beside the cash price', () => {
    for (const item of GADGET_STORE) {
      expect(item.priceCoins, `${item.id} must be earnable`).toBeGreaterThan(0);
    }
  });

  it('refuses a shelf entry that sells a gadget for money only', () => {
    const problems = validateCatalog([
      {
        id: 'gadget_paywalled',
        kind: 'gadget',
        name: 'Paywalled',
        description: 'Money only.',
        priceCents: 99,
        priceCoins: -1,
        grants: ['bear_trap'],
      },
    ]);
    expect(problems.map((p) => p.problem).join(' ')).toContain('without a coin price');
  });

  it('never sells anything that changes how fast or how high you move', () => {
    // Gadgets create situations; they do not touch MovementConfig. This asserts the *shape* of
    // that promise: every payload is a status, damage, armour or heal — never a stat.
    const allowed = new Set(['freeze', 'smoke', 'snare', 'damage', 'armour', 'heal', 'reveal']);
    for (const item of listStoreItems()) {
      for (const grant of item.grants) {
        const gadget = getGadget(grant);
        if (!gadget) continue;
        expect(allowed.has(gadget.payload.on), `${gadget.id} payload ${gadget.payload.on}`).toBe(true);
      }
    }
  });
});

describe('buying a gadget', () => {
  it('grants it for coins', () => {
    const profile = createProfile('p1', 'Roo');
    profile.coins = 5000;

    const outcome = purchaseWithCoins(profile, 'gadget_bear_trap');

    expect(outcome.ok).toBe(true);
    expect(profile.ownedGadgets).toContain('bear_trap');
    expect(profile.coins).toBe(5000 - (getStoreItem('gadget_bear_trap')?.priceCoins ?? 0));
  });

  it('refuses when the player cannot afford it, and takes nothing', () => {
    const profile = createProfile('p1', 'Roo');
    profile.coins = 10;

    const outcome = purchaseWithCoins(profile, 'gadget_bear_trap');

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe('insufficient-coins');
    expect(profile.coins).toBe(10);
    expect(profile.ownedGadgets).not.toContain('bear_trap');
  });

  it('grants it for a verified receipt, once, however many times the receipt is replayed', () => {
    const profile = createProfile('p1', 'Roo');

    const first = applyVerifiedPurchase(profile, 'gadget_bear_trap', 'txn-1');
    const replay = applyVerifiedPurchase(profile, 'gadget_bear_trap', 'txn-1');

    expect(first.granted).toContain('bear_trap');
    expect(replay.granted).toEqual([]);
    expect(profile.ownedGadgets.filter((id) => id === 'bear_trap')).toHaveLength(1);
    expect(profile.purchases).toHaveLength(1);
  });

  it('reaches the same inventory whether it was bought with coins or cash', () => {
    const grinder = createProfile('a', 'Grinder');
    grinder.coins = 9999;
    const spender = createProfile('b', 'Spender');

    purchaseWithCoins(grinder, 'gadget_bear_trap');
    applyVerifiedPurchase(spender, 'gadget_bear_trap', 'txn-1');

    expect(grinder.ownedGadgets.toSorted()).toEqual(spender.ownedGadgets.toSorted());
  });
});

describe('equipping', () => {
  it('saves a loadout the player owns', () => {
    const profile = createProfile('p1', 'Roo');
    grantContent(profile, ['bear_trap']);

    const outcome = equipGadgets(profile, { primary: 'freeze_gun', secondary: 'bear_trap', armour: 'steel_vest' });

    expect(outcome.problems).toEqual([]);
    expect(profile.equipped.gadgets).toEqual({
      primary: 'freeze_gun',
      secondary: 'bear_trap',
      armour: 'steel_vest',
    });
  });

  it('drops a slot the player does not own rather than trusting the request', () => {
    const profile = createProfile('p1', 'Roo');

    const outcome = equipGadgets(profile, { primary: 'freeze_gun', secondary: 'bear_trap' });

    expect(profile.equipped.gadgets.secondary).toBeUndefined();
    expect(outcome.problems[0]?.error).toBe('not-owned');
    expect(profile.equipped.gadgets.primary).toBe('freeze_gun');
  });

  it('replaces the whole loadout, so unequipping actually unequips', () => {
    const profile = createProfile('p1', 'Roo');
    equipGadgets(profile, { primary: 'freeze_gun', armour: 'steel_vest' });
    equipGadgets(profile, { primary: 'freeze_gun' });
    expect(profile.equipped.gadgets.armour).toBeUndefined();
  });

  it('starts every new account with a usable free loadout', () => {
    const profile = createProfile('p1', 'Roo');
    const outcome = equipGadgets(profile, profile.equipped.gadgets);
    expect(outcome.problems).toEqual([]);
    expect(outcome.applied.primary).toBe('freeze_gun');
    expect(outcome.applied.secondary).toBe('smoke_bomb');
    expect(outcome.applied.armour).toBe('steel_vest');
  });
});
