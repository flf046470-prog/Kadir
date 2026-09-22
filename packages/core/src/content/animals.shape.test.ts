import { describe, expect, it } from 'vitest';

import { LAUNCH_ANIMALS } from './animals.js';
import type { AnimalDef } from './animals.js';

/**
 * No two animals may be the same body.
 *
 * `tools/blender/characters.py` *generates* each animal's mesh from its declared traits — the ear
 * shape, the tail, the snout and the body plan. Colours are materials applied afterwards and
 * `scale` is applied by the renderer to the avatar's body group, so neither reaches the geometry.
 * Two animals that declare the same four traits therefore ship as the same model in different
 * paint.
 *
 * That is not hypothetical. Measured on the shipped art: `fox.glb` and `wolf.glb` carried
 * **byte-identical `POSITION` and `NORMAL` data** — maximum absolute difference 0.0000 across
 * 8,448 values — because both declared `pointed`/`bushy`/`long`. A player picking Wolf over Fox
 * got a recoloured fox, in a game whose main customisation is which animal you are.
 *
 * The nine roadmap animals would have added three more such pairs the moment they were
 * registered: bear and panda both `round`/`stub`/`short`, raptor and dragon both
 * `pointed`/`thin`/`long`, and raccoon sharing the fox's and wolf's combination.
 *
 * Asserted on the *signature* rather than on any particular animal, so it keeps holding as the
 * roster grows, and it names the colliding pair rather than just failing.
 */
function shapeSignature(animal: AnimalDef): string {
  const v = animal.visual;
  // `build` is optional and falls back to `upright` in the renderer, so a missing one is not a
  // different shape from an explicit `upright` — comparing the raw field would let those two
  // declare the same body and pass.
  return [v.ears, v.tail, v.snout, v.build ?? 'upright'].join('/');
}

describe('every animal on the roster', () => {
  it('has a body shape no other animal has', () => {
    const seen = new Map<string, string>();
    const clones: string[] = [];
    for (const animal of LAUNCH_ANIMALS) {
      const signature = shapeSignature(animal);
      const previous = seen.get(signature);
      if (previous) clones.push(`${previous} = ${animal.id} (${signature})`);
      else seen.set(signature, animal.id);
    }
    expect(clones, `these animals generate the same mesh: ${clones.join(', ')}`).toEqual([]);
  });

  it('found enough animals to be worth checking', () => {
    // A roster that failed to load would make the assertion above vacuously true, which is the
    // failure mode every scan-style guard in this project has had to be protected from.
    expect(LAUNCH_ANIMALS.length).toBeGreaterThanOrEqual(16);
  });

  it('declares a body plan for every animal rather than drifting onto the fallback', () => {
    // `build` is optional so older data stays valid, but an animal that omits it is silently an
    // `upright` — which is how two of them can collide without either one saying so.
    for (const animal of LAUNCH_ANIMALS) {
      expect(animal.visual.build, `${animal.id} has no body plan`).toBeDefined();
    }
  });

  it('keeps every visual scale inside the band the renderer will clamp to', () => {
    // `animalScaleFor` clamps to 0.85..1.15 in the client. A value outside that is not a bug the
    // player ever sees, which is exactly why it would sit in the data unnoticed.
    for (const animal of LAUNCH_ANIMALS) {
      expect(animal.visual.scale, animal.id).toBeGreaterThanOrEqual(0.85);
      expect(animal.visual.scale, animal.id).toBeLessThanOrEqual(1.15);
    }
  });
});
