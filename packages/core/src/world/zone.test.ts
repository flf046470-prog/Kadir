import { describe, expect, it } from 'vitest';

import { buildJungleWorld } from './jungle.js';
import { darknessAt, zoneAt } from './zone.js';
import type { LevelDef } from './level.js';

/**
 * The zone lookup, against the level that actually ships.
 *
 * Zones were authored and then read by nobody: three of them in `buildJungleWorld`, each with a
 * `darkness` field documented as a "0..1 fog/darkness hint for the client", and no client code
 * that ever asked which zone a player was in. The cave was as bright as the clearing.
 *
 * Asserted against the built world rather than a fixture, because the thing worth protecting is
 * that the *shipped* cave is found at the place the cave actually is.
 */
describe('zoneAt', () => {
  const level = buildJungleWorld();
  const at = (x: number, y: number, z: number) => ({ x, y, z });

  it('finds the three zones the jungle declares', () => {
    expect(level.zones.map((z) => z.name).sort()).toEqual(['canyon', 'cave', 'jungle']);
  });

  it('puts the spawn in the jungle', () => {
    expect(zoneAt(level, at(0, 0, 0))?.zone.name).toBe('jungle');
  });

  it('puts a player at the cave centre in the cave', () => {
    const cave = level.zones.find((z) => z.name === 'cave');
    expect(cave).toBeDefined();
    expect(zoneAt(level, cave?.center ?? at(0, 0, 0))?.zone.name).toBe('cave');
  });

  it('puts a player at the canyon centre in the canyon', () => {
    const canyon = level.zones.find((z) => z.name === 'canyon');
    expect(zoneAt(level, canyon?.center ?? at(0, 0, 0))?.zone.name).toBe('canyon');
  });

  it('returns nothing far outside every zone', () => {
    // Not a fallback to the first zone, which is the easy mistake: a player beyond the map is in
    // no zone at all, and the caller should get the level's own defaults rather than the jungle's.
    expect(zoneAt(level, at(0, 0, 900))).toBeUndefined();
    expect(darknessAt(level, at(0, 0, 900))).toBe(0);
  });

  it('gets darker the whole way in, along the route a player actually walks', () => {
    /**
     * The check two browser probes failed to make.
     *
     * Both drove a real player west from the spawn and measured the screen, both saw brightness
     * go *up*, and both were measuring the route rather than the feature — a guessed heading that
     * never reached the cave. The route is data, so it can be asserted here instead: from the
     * clearing at the origin to the cave's centre at x = -72, darkness must never step backwards
     * and must end up somewhere genuinely dark.
     *
     * Monotonic rather than "the end is darker than the start", because a dip in the middle is
     * exactly what a player would read as a bug — walking deeper into a cave and having it
     * brighten — and the endpoints alone cannot see it.
     */
    let previous = -1;
    for (let x = 0; x >= -72; x -= 4) {
      const here = darknessAt(level, at(x, 0, 0));
      expect(here).toBeGreaterThanOrEqual(previous);
      previous = here;
    }
    expect(previous).toBeGreaterThan(0.7);
    expect(darknessAt(level, at(0, 0, 0))).toBeLessThan(0.1);
  });

  it('makes the cave the darkest place in the level', () => {
    const cave = level.zones.find((z) => z.name === 'cave');
    const centre = darknessAt(level, cave?.center ?? at(0, 0, 0));
    expect(centre).toBeGreaterThan(darknessAt(level, at(0, 0, 0)));
    expect(centre).toBeGreaterThan(0.5);
  });

  it('fades in from the edge rather than snapping', () => {
    /**
     * The property that makes this usable for fog and for an ambience crossfade. A hard in/out
     * test swaps both in one frame at the boundary, which reads as a glitch rather than as
     * walking into a cave.
     */
    const cave = level.zones.find((z) => z.name === 'cave');
    if (!cave) throw new Error('no cave');
    const edge = { x: cave.center.x + cave.radius * 0.999, y: cave.center.y, z: cave.center.z };
    const inside = { x: cave.center.x + cave.radius * 0.5, y: cave.center.y, z: cave.center.z };

    const atEdge = zoneAt(level, edge);
    expect(atEdge?.zone.name).toBe('cave');
    expect(atEdge?.weight).toBeLessThan(0.05);
    expect(zoneAt(level, inside)?.weight).toBe(1);
  });

  it('never reports a weight outside 0..1', () => {
    for (const zone of level.zones) {
      for (const f of [0, 0.25, 0.5, 0.75, 0.999]) {
        const sample = zoneAt(level, { x: zone.center.x + zone.radius * f, y: zone.center.y, z: zone.center.z });
        if (!sample) continue;
        expect(sample.weight).toBeGreaterThanOrEqual(0);
        expect(sample.weight).toBeLessThanOrEqual(1);
      }
    }
  });

  it('prefers the smaller zone where two overlap', () => {
    // Zones nest by intent — a cave mouth sits inside the jungle's radius — so the answer wanted
    // is the most specific place the player is standing, not whichever was declared first.
    const nested: LevelDef = {
      ...level,
      zones: [
        { name: 'outer', center: { x: 0, y: 0, z: 0 }, radius: 100, ambience: 'jungle', darkness: 0 },
        { name: 'inner', center: { x: 0, y: 0, z: 0 }, radius: 10, ambience: 'cave', darkness: 0.8 },
      ],
    };
    expect(zoneAt(nested, { x: 0, y: 0, z: 0 })?.zone.name).toBe('inner');
    // And still finds the outer one where the inner does not reach.
    expect(zoneAt(nested, { x: 50, y: 0, z: 0 })?.zone.name).toBe('outer');
  });

  it('is unaffected by the order zones are declared in', () => {
    const forward: LevelDef = {
      ...level,
      zones: [
        { name: 'outer', center: { x: 0, y: 0, z: 0 }, radius: 100, ambience: 'jungle', darkness: 0 },
        { name: 'inner', center: { x: 0, y: 0, z: 0 }, radius: 10, ambience: 'cave', darkness: 0.8 },
      ],
    };
    const reversed: LevelDef = { ...forward, zones: [...forward.zones].reverse() };
    expect(zoneAt(forward, { x: 0, y: 0, z: 0 })?.zone.name).toBe(zoneAt(reversed, { x: 0, y: 0, z: 0 })?.zone.name);
  });
});
