import { describe, expect, it } from 'vitest';

import { darknessValues } from './Renderer.js';

/**
 * What a zone's darkness does to the scene.
 *
 * Tested away from the renderer because this is the half with a right answer, and the other half
 * needs a GPU. The behaviour it guards is a promise the level data has always made and nothing
 * ever kept: `ZoneDef.darkness` is documented as a "0..1 fog/darkness hint for the client" and set
 * to 0.75 for the cave, yet no client code read a zone at all, so the cave was lit exactly like
 * the clearing outside it.
 */
describe('darknessValues', () => {
  const BASE_FOG = 0.0075; // what buildJungleWorld ships

  it('changes nothing at zero', () => {
    // The common case by far — most of the map is open — so it has to be exactly neutral, not
    // approximately so, or standing in the jungle would look subtly wrong all the time.
    const v = darknessValues(0, BASE_FOG);
    expect(v.skyScale).toBe(1);
    expect(v.fogDensity).toBe(BASE_FOG);
    expect(v.hemiIntensity).toBeCloseTo(1.15, 10);
    expect(v.sunIntensity).toBeCloseTo(1.9, 10);
  });

  it('darkens the sky, thickens the fog and drops the lights together', () => {
    // One alone reads as a colour filter; together they read as a place.
    const v = darknessValues(0.75, BASE_FOG);
    expect(v.skyScale).toBeLessThan(0.45);
    expect(v.fogDensity).toBeGreaterThan(BASE_FOG * 4);
    expect(v.hemiIntensity).toBeLessThan(1.15 * 0.5);
    expect(v.sunIntensity).toBeLessThan(1.9 * 0.6);
  });

  it('keeps the cave playable at full darkness', () => {
    /**
     * The constraint that stops "dark" becoming "unplayable". With no directional light a cave has
     * no edges, and this game asks players to jump between ledges in there.
     */
    const v = darknessValues(1, BASE_FOG);
    expect(v.sunIntensity).toBeGreaterThan(0.6);
    expect(v.hemiIntensity).toBeGreaterThan(0.2);
    expect(v.skyScale).toBeGreaterThan(0.1);
  });

  it('moves monotonically, so walking deeper never gets brighter', () => {
    let previous = darknessValues(0, BASE_FOG);
    for (const amount of [0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const next = darknessValues(amount, BASE_FOG);
      expect(next.skyScale).toBeLessThan(previous.skyScale);
      expect(next.fogDensity).toBeGreaterThan(previous.fogDensity);
      expect(next.hemiIntensity).toBeLessThan(previous.hemiIntensity);
      expect(next.sunIntensity).toBeLessThan(previous.sunIntensity);
      previous = next;
    }
  });

  it('clamps anything out of range instead of inverting the scene', () => {
    // A weight that arrived slightly above 1 from a blend, or a negative from a bad level, must
    // not brighten the sky past its own colour or push fog density negative.
    expect(darknessValues(-3, BASE_FOG)).toEqual(darknessValues(0, BASE_FOG));
    expect(darknessValues(4, BASE_FOG)).toEqual(darknessValues(1, BASE_FOG));
    expect(darknessValues(Number.NaN, BASE_FOG)).toEqual(darknessValues(0, BASE_FOG));
  });

  it('scales the level own fog rather than replacing it', () => {
    // A level that wants a hazy baseline says so in `fogDensity`; darkness is the local departure
    // from it, so a clear level and a hazy one must not end up at the same density in a cave.
    const clear = darknessValues(0.75, 0.002);
    const hazy = darknessValues(0.75, 0.02);
    expect(hazy.fogDensity).toBeGreaterThan(clear.fogDensity);
  });
});
