import { describe, expect, it } from 'vitest';
import { listLevels } from '@kc/core';
import { practiceLevelFor } from './practice.js';

const ids = listLevels().map((l) => l.id);

describe('the map a practice round plays', () => {
  it('is the one picked, for every map in the game', () => {
    expect(ids.length).toBeGreaterThan(1);
    for (const id of ids) expect(practiceLevelFor(id, ids, 'jungle-world')).toBe(id);
  });

  it('keeps the loaded map when nothing was picked', () => {
    // The main menu's Practice button sends no pick. Turning that into a random map rebuilt the
    // world inside the click handler, and CI's smoke test timed out waiting for the click.
    for (const id of ids) expect(practiceLevelFor('', ids, id)).toBe(id);
  });

  it('keeps the current map for an id this build does not know', () => {
    expect(practiceLevelFor('patagonia', ids, 'glacier-world')).toBe('glacier-world');
  });
});
