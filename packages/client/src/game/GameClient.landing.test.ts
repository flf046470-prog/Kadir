import { describe, expect, it } from 'vitest';

import { landingKickFor } from './GameClient.js';

/**
 * The camera's reaction to a hard landing — see `applyLandingKick`/`updateCamera` in
 * `GameClient.ts`. Pure and tested away from the class itself the same way `sunPositionFor` is
 * tested away from `Renderer`: standing up a `GameClient` needs a renderer, a simulation and a
 * network layer, none of which this curve depends on.
 */
describe('landingKickFor', () => {
  it('leaves an ordinary hop camera-neutral', () => {
    // 'land' fires on every hop this game's locomotion makes. Without a floor, the camera would
    // dip on every single one of them, which is not a landing cue any more — it is a constant
    // wobble.
    expect(landingKickFor(0)).toBe(0);
    expect(landingKickFor(3)).toBe(0);
    expect(landingKickFor(5)).toBe(0);
  });

  it('reacts to a landing hard enough to matter', () => {
    expect(landingKickFor(8)).toBeGreaterThan(0);
    expect(landingKickFor(16)).toBe(1);
  });

  it('grows with impact rather than snapping straight to the cap', () => {
    expect(landingKickFor(10)).toBeLessThan(landingKickFor(14));
  });

  it('never exceeds its cap, however hard the fall', () => {
    expect(landingKickFor(1000)).toBe(1);
  });

  it('survives a negative or non-finite magnitude rather than inverting the dip', () => {
    expect(landingKickFor(-5)).toBe(0);
    expect(landingKickFor(Number.NaN)).toBe(0);
  });
});
