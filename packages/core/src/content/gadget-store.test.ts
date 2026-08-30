import { describe, expect, it } from 'vitest';

import { freeGadgetIds, getGadget, listGadgets, validateGadgets } from '../gadgets/catalog.js';
import { createProfile } from '../progression/profile.js';
import { equipGadgets, grantContent } from '../progression/inventory.js';
import { listAnimals } from './animals.js';
import { listCosmetics } from './cosmetics.js';
import { LAUNCH_STORE, listStoreItems, validateCatalog } from './store.js';

/**
 * Kangaroo Chase is free, and everything in it is free.
 *
 * These are the tests that hold that decision in place. They are deliberately blunt: there is no
 * balance to tune, no price point to argue about and no "cosmetic only" line to police, because
 * nothing is sold. If a price ever reappears anywhere in the content pipeline, one of these fails
 * before it reaches a build.
 */
describe('nothing in this game is sold', () => {
  it('has an empty storefront', () => {
    expect(LAUNCH_STORE).toEqual([]);
    expect(listStoreItems()).toEqual([]);
  });

  it('passes catalog validation', () => {
    expect(validateCatalog()).toEqual([]);
  });

  it('refuses a store item that has a price', () => {
    const problems = validateCatalog([
      {
        id: 'sneaky_bundle',
        kind: 'bundle',
        name: 'Sneaky Bundle',
        description: 'Should never ship.',
        priceCents: 499,
        priceCoins: -1,
        grants: ['wolf'],
      },
    ]);
    expect(problems.map((p) => p.problem).join(' ')).toContain('nothing in this game is sold');
  });

  it('prices every animal at nothing, premium roster included', () => {
    for (const animal of listAnimals()) {
      expect(animal.priceCents, animal.id).toBe(0);
      expect(animal.unlock, animal.id).toBe('free');
    }
  });

  it('prices every cosmetic at nothing', () => {
    for (const cosmetic of listCosmetics()) {
      expect(cosmetic.priceCents, cosmetic.id).toBe(0);
      expect(cosmetic.priceCoins, cosmetic.id).toBe(0);
      expect(cosmetic.unlock, cosmetic.id).toBe('free');
    }
  });

  it('prices every gadget at nothing — weapons, smoke, vest and all', () => {
    for (const gadget of listGadgets()) {
      expect(gadget.unlockCents, gadget.id).toBe(-1);
      expect(gadget.unlockCoins, gadget.id).toBe(0);
    }
  });

  it('keeps rarity as a look, not a price tier', () => {
    // "epic" now means flashy. Every rarity is reachable by everyone.
    const rarities = new Set(listCosmetics().map((c) => c.rarity));
    expect(rarities.size).toBeGreaterThan(1);
    for (const cosmetic of listCosmetics()) expect(cosmetic.priceCents, cosmetic.id).toBe(0);
  });
});

describe('a new account owns everything', () => {
  it('starts with the whole animal roster', () => {
    const profile = createProfile('p1', 'Roo');
    for (const animal of listAnimals()) expect(profile.ownedAnimals, animal.id).toContain(animal.id);
  });

  it('starts with every cosmetic', () => {
    const profile = createProfile('p1', 'Roo');
    for (const cosmetic of listCosmetics()) expect(profile.ownedCosmetics, cosmetic.id).toContain(cosmetic.id);
  });

  it('starts with every equippable gadget', () => {
    const profile = createProfile('p1', 'Roo');
    expect(profile.ownedGadgets.toSorted()).toEqual(freeGadgetIds().toSorted());
    for (const id of ['freeze_gun', 'smoke_bomb', 'steel_vest', 'steel_helmet', 'bear_trap', 'tripwire_alarm', 'field_kit']) {
      expect(profile.ownedGadgets, id).toContain(id);
    }
  });

  it('does not own the hunter’s issued gear, which belongs to the role', () => {
    const profile = createProfile('p1', 'Roo');
    expect(profile.ownedGadgets).not.toContain('hunter_rifle');
    expect(profile.ownedGadgets).not.toContain('hunter_net');
  });

  it('starts with a working loadout already equipped', () => {
    const profile = createProfile('p1', 'Roo');
    const outcome = equipGadgets(profile, profile.equipped.gadgets);
    expect(outcome.problems).toEqual([]);
    expect(outcome.applied.primary).toBe('freeze_gun');
    expect(outcome.applied.secondary).toBe('smoke_bomb');
    expect(outcome.applied.armour).toBe('steel_vest');
  });

  it('can equip anything in the game without unlocking it first', () => {
    const profile = createProfile('p1', 'Roo');
    const outcome = equipGadgets(profile, { primary: 'freeze_gun', secondary: 'bear_trap', armour: 'steel_helmet' });
    expect(outcome.problems).toEqual([]);
    expect(profile.equipped.gadgets.secondary).toBe('bear_trap');
    expect(profile.equipped.gadgets.armour).toBe('steel_helmet');
  });
});

describe('equipping', () => {
  it('still refuses a gadget that does not exist', () => {
    const profile = createProfile('p1', 'Roo');
    const outcome = equipGadgets(profile, { primary: 'plasma_cannon' });
    expect(outcome.problems[0]?.error).toBe('unknown-gadget');
    expect(profile.equipped.gadgets.primary).toBeUndefined();
  });

  it('still refuses a gadget in the wrong slot', () => {
    const profile = createProfile('p1', 'Roo');
    const outcome = equipGadgets(profile, { primary: 'steel_vest' });
    expect(outcome.problems[0]?.error).toBe('wrong-slot');
  });

  it('still refuses the hunter rifle, which no lobby loadout may carry', () => {
    const profile = createProfile('p1', 'Roo');
    grantContent(profile, ['hunter_rifle']);
    const outcome = equipGadgets(profile, { primary: 'hunter_rifle' });
    expect(outcome.problems[0]?.error).toBe('role-locked');
    expect(profile.equipped.gadgets.primary).toBeUndefined();
  });

  it('replaces the whole loadout, so unequipping actually unequips', () => {
    const profile = createProfile('p1', 'Roo');
    equipGadgets(profile, { primary: 'freeze_gun', armour: 'steel_vest' });
    equipGadgets(profile, { primary: 'freeze_gun' });
    expect(profile.equipped.gadgets.armour).toBeUndefined();
  });
});

describe('the gadget catalog', () => {
  it('passes its own validation', () => {
    expect(validateGadgets()).toEqual([]);
  });

  it('refuses a gadget that acquired a coin price', () => {
    const base = getGadget('bear_trap');
    expect(base).toBeDefined();
    if (!base) return;
    const problems = validateGadgets([{ ...base, id: 'priced', unlockCoins: 2500 }]);
    expect(problems.map((p) => p.problem).join(' ')).toContain('every gadget is free');
  });

  it('refuses a gadget that acquired a cash price', () => {
    const base = getGadget('bear_trap');
    expect(base).toBeDefined();
    if (!base) return;
    const problems = validateGadgets([{ ...base, id: 'priced', unlockCents: 99 }]);
    expect(problems.map((p) => p.problem).join(' ')).toContain('nothing in this game is sold');
  });
});
