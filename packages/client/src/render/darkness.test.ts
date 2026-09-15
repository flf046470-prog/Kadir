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

  it('leaves a barely-enclosed zone alone', () => {
    /**
     * The jungle declares 0.05 and the glacier shelf 0.04, both meaning "open air, technically
     * inside a zone". A linear ramp charged the whole map ~4% of its sky for that, which is a
     * dimming a player sees and nothing in the level data asked for. Smoothstep makes the low end
     * nearly flat, so a value this small is a rounding error rather than a look.
     */
    const v = darknessValues(0.05, BASE_FOG);
    expect(v.skyScale).toBeGreaterThan(0.99);
    expect(v.fogDensity).toBeLessThan(BASE_FOG * 1.05);
    expect(v.sunIntensity).toBeGreaterThan(1.9 * 0.99);
  });

  it('makes the fog darker than the geometry it swallows', () => {
    /**
     * The one that caught the real bug, and the reason these numbers are measured rather than
     * chosen. The first version thickened the fog hard and darkened the sky gently, so inside the
     * cave the fog colour — 38% of a bright blue sky — was *lighter* than the dim rock behind it.
     * A fixed-camera A/B came back at +2.4%: switching the feature on made the cave brighter.
     *
     * Fog only hides things when it is darker than what it hides, so past the midpoint the sky has
     * to be far below anything the lights can still produce. At 0.75 it keeps a sixth of its
     * colour, which reads as an unlit interior instead of an overcast afternoon.
     */
    // 0.7 and 0.75 are the crevasse and the cave — the only enclosed values any level declares,
    // and the two the fixed-camera A/B actually measured. The rest of the range is covered by the
    // relative check below rather than by a threshold nobody has looked at on a screen.
    for (const amount of [0.7, 0.75, 0.9, 1]) {
      const v = darknessValues(amount, BASE_FOG);
      expect(v.skyScale).toBeLessThan(0.3);
      // And it must always fall faster than the lighting, or thickening the fog adds light back.
      expect(v.skyScale).toBeLessThan(v.sunIntensity / 1.9);
      expect(v.skyScale).toBeLessThan(v.hemiIntensity / 1.15);
    }
  });

  it('keeps the cave playable at full darkness', () => {
    /**
     * The constraint that stops "dark" becoming "unplayable". With no directional light a cave has
     * no edges, and this game asks players to jump between ledges in there; with no hemisphere
     * fill every face the sun misses is pure black. Both are hard floors in the implementation so
     * that re-tuning the ramp cannot quietly erase them.
     *
     * The sky is deliberately *not* floored with them. It was, at a tenth of the level colour, and
     * that tenth is what made the cave read as an overcast afternoon: the fog takes its colour
     * from the sky, and a fog brighter than the rock it covers is a whiteout. A hole in the ground
     * that opens onto nothing should look like nothing.
     */
    const v = darknessValues(1, BASE_FOG);
    expect(v.sunIntensity).toBeGreaterThan(0.6);
    expect(v.hemiIntensity).toBeGreaterThan(0.2);
    expect(v.skyScale).toBeGreaterThan(0);
    expect(v.skyScale).toBeLessThan(0.08);
  });

  it('moves monotonically, so walking deeper never gets brighter', () => {
    let previous = darknessValues(0, BASE_FOG);
    for (const amount of [0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const next = darknessValues(amount, BASE_FOG);
      expect(next.skyScale).toBeLessThan(previous.skyScale);
      expect(next.fogDensity).toBeGreaterThan(previous.fogDensity);
      // The lights are only *non*-increasing: they sit on a playability floor at the deep end, so
      // the last step of the ramp leaves them exactly where they were rather than dimming further.
      expect(next.hemiIntensity).toBeLessThanOrEqual(previous.hemiIntensity);
      expect(next.sunIntensity).toBeLessThanOrEqual(previous.sunIntensity);
      previous = next;
    }
    // …and over the range as a whole they really do fall, so "non-increasing" cannot be satisfied
    // by a function that never moves at all.
    expect(previous.sunIntensity).toBeLessThan(darknessValues(0, BASE_FOG).sunIntensity * 0.4);
    expect(previous.hemiIntensity).toBeLessThan(darknessValues(0, BASE_FOG).hemiIntensity * 0.25);
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
