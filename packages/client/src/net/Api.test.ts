import { describe, expect, it } from 'vitest';

import { listAnimals, listModes } from '@kc/core';
import { localContent } from './Api.js';

/**
 * The offline catalogue.
 *
 * A playtest with no server reachable found Game modes and Customise rendering as a title and a
 * Back button: `/api/content` had failed, the catch block did nothing, and the menus were never
 * handed anything. The comment at the call site said the client "already has the launch data
 * compiled in" — true, and exactly why the emptiness was invisible in review. The data was there;
 * nothing passed it on.
 *
 * These tests pin the property that makes the fix correct: the client can always describe its own
 * content, with or without a server. They fail if a catalogue ever stops registering itself on
 * import, which is the way this would silently come back.
 */
describe('the content the client can serve itself', () => {
  it('lists every animal, mode, cosmetic and store row without a server', () => {
    const content = localContent();

    expect(content.animals.length).toBeGreaterThan(0);
    expect(content.modes.length).toBeGreaterThan(0);
    expect(content.cosmetics.length).toBeGreaterThan(0);
    // The store is deliberately empty — everything in this game is free — so it is checked for
    // being an array, not for having rows. An empty store is correct; a missing one is not.
    expect(Array.isArray(content.store)).toBe(true);
  });

  it('matches the registries it is built from', () => {
    const content = localContent();
    expect(content.animals.map((a) => a.id).sort()).toEqual(listAnimals().map((a) => a.id).sort());
    expect(content.modes.map((m) => m.id).sort()).toEqual(listModes().map((m) => m.id).sort());
  });

  it('includes the two animals every mode needs', () => {
    // Hunt and Conversion Duel are kangaroos versus humans. If either is missing offline, those
    // modes cannot be previewed at all.
    const ids = localContent().animals.map((a) => a.id);
    expect(ids).toContain('kangaroo');
    expect(ids).toContain('human');
  });

  it('offers a mode a single player can actually start alone', () => {
    // The offline player has no one else. At least one mode has to accept one player, or the
    // menu lists modes that all refuse to start.
    const soloable = localContent().modes.filter((mode) => mode.minPlayers <= 1);
    expect(soloable.length, localContent().modes.map((m) => `${m.id}:${m.minPlayers}`).join(', ')).toBeGreaterThan(0);
  });

  it('never advertises a price, offline or on', () => {
    // The offline path builds its own bundle, so it is its own opportunity to reintroduce the
    // thing the whole catalogue was audited to remove.
    for (const animal of localContent().animals) {
      expect(animal.priceCents, animal.id).toBe(0);
    }
    for (const item of localContent().store) {
      expect(item, 'the store is meant to be empty').toBeUndefined();
    }
  });
});
