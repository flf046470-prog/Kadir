import { describe, expect, it } from 'vitest';
import { listLevels } from '@kc/core';
import { practiceLevelFor } from './practice.js';

const ids = listLevels().map((l) => l.id);

describe('the map a practice round plays', () => {
  it('is the one picked, for every map in the game', () => {
    expect(ids.length).toBeGreaterThan(1);
    for (const id of ids) expect(practiceLevelFor(id, ids, 'jungle-world')).toBe(id);
  });

  it('reaches every map when the pick is "Surprise me"', () => {
    // Offline this is the only way into a map, so a surprise that can never land on one of them
    // is the original defect again.
    const seen = new Set<string>();
    for (let i = 0; i < ids.length; i++) seen.add(practiceLevelFor('', ids, 'jungle-world', () => (i + 0.5) / ids.length));
    expect([...seen].toSorted()).toEqual([...ids].toSorted());
    expect(practiceLevelFor('', ids, 'jungle-world', () => 0.999999)).toBe(ids[ids.length - 1]);
  });

  it('keeps the current map for an id this build does not know', () => {
    expect(practiceLevelFor('patagonia', ids, 'glacier-world')).toBe('glacier-world');
  });
});
