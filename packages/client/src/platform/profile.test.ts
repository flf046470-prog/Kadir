import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '@kc/core';
import type { QualityTier, Settings } from '@kc/core';

import { surfaceQualityFor } from '../render/surfaces.js';

import { VR_DISPLAY_HZ, VR_FOLIAGE_BUDGET, fpsFloor, profileFor } from './Platform.js';

/**
 * What a headset is handed.
 *
 * There is no Quest in CI, so none of this measures a frame. It pins the two numbers that decide
 * whether a frame can be made in time — the rate the governor holds the device to, and how much
 * geometry the tier asks for — because both were set by code that read like it had thought about
 * VR and neither survived to the renderer.
 */

const settings = (over: Partial<Settings['graphics']> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  graphics: { ...DEFAULT_SETTINGS.graphics, ...over },
});

const TIERS: QualityTier[] = ['low', 'medium', 'high'];

describe('the frame-rate target', () => {
  it('holds a headset to its display rate on every tier', () => {
    for (const tier of TIERS) {
      expect(profileFor('vr', tier, settings()).targetFps, tier).toBeGreaterThanOrEqual(VR_DISPLAY_HZ);
    }
  });

  it('does not let the player ask a headset for judder', () => {
    /**
     * The defect this replaces: the VR branch set 72 and the line applying the player's setting
     * overwrote it unconditionally, so the shipped default of 60 won every time. "Target 60" on a
     * 72Hz display is not a request for less work — the display still refreshes 72 times a second
     * and the runtime reprojects whatever is missing. It is a request to stop noticing.
     */
    expect(profileFor('vr', 'medium', settings({ targetFps: 30 })).targetFps).toBe(VR_DISPLAY_HZ);
    expect(profileFor('vr', 'medium', settings({ targetFps: 60 })).targetFps).toBe(VR_DISPLAY_HZ);
    // Above the floor the player is asking for *more*, which is theirs to ask for.
    expect(profileFor('vr', 'medium', settings({ targetFps: 90 })).targetFps).toBe(90);
  });

  it('leaves a flat screen to the player', () => {
    expect(fpsFloor('pc')).toBe(0);
    expect(fpsFloor('mobile')).toBe(0);
    expect(profileFor('pc', 'high', settings({ targetFps: 30 })).targetFps).toBe(30);
    expect(profileFor('mobile', 'low', settings({ targetFps: 144 })).targetFps).toBe(144);
  });
});

/**
 * The geometry budget, which is the other half of holding 72Hz.
 *
 * `suggestQuality` hands a headset the medium tier, and medium measured 90 draw calls and 1131k
 * triangles per scene pass — drawn once per eye, so about 1.76M triangles a frame against Meta's
 * published 750k–1M for a Quest 2. Nothing in the profile was doing anything about that: the VR
 * branch clamped resolution, post-processing and avatar detail, and left every triangle in place.
 */
describe('the geometry a headset is given', () => {
  const flatMedium = profileFor('pc', 'medium', settings());
  const flatLow = profileFor('pc', 'low', settings());

  it('spends no frame on a shadow pass on a standalone headset', () => {
    // 44 draw calls and 498k triangles of the medium tier, for a contact cue stereo vision
    // already provides. The tiers a headset can be *given* are low and medium.
    expect(profileFor('vr', 'medium', settings()).shadows).toBe(false);
    expect(profileFor('vr', 'low', settings()).shadows).toBe(false);
    expect(flatMedium.shadows).toBe(true);
  });

  it('thins foliage to the low tier while keeping the medium tier elsewhere', () => {
    const vr = profileFor('vr', 'medium', settings());
    expect(vr.foliageBudget).toBe(VR_FOLIAGE_BUDGET);
    expect(vr.foliageBudget).toBeLessThanOrEqual(flatLow.foliageBudget);
    // The point of clamping geometry rather than dropping the tier: the pixels and the avatars,
    // which are what a player in a headset is looking at, stay at medium.
    expect(vr.renderScale).toBe(flatMedium.renderScale);
    expect(vr.maxDetailedPlayers).toBe(flatMedium.maxDetailedPlayers);
    expect(vr.renderScale).toBeGreaterThan(flatLow.renderScale);
    expect(vr.maxDetailedPlayers).toBeGreaterThan(flatLow.maxDetailedPlayers);
  });

  it('holds the clamp however the tier was arrived at', () => {
    // The governor moves tiers at runtime and the settings screen offers them by hand, so this
    // cannot be something `suggestQuality` promises on the way in.
    for (const tier of ['low', 'medium'] as QualityTier[]) {
      const vr = profileFor('vr', tier, settings({ quality: tier }));
      expect(vr.shadows, tier).toBe(false);
      expect(vr.foliageBudget, tier).toBeLessThanOrEqual(VR_FOLIAGE_BUDGET);
    }
  });

  it('keeps the textures it turned the shadows off to afford', () => {
    /**
     * Nearly shipped: `surfaceQualityFor` chose the texture tier from `profile.shadows` and
     * `profile.shadowMapSize`, so turning the shadow pass off for VR also turned off every
     * procedural surface texture in the game — the whole PBR pipeline, undone by a line about
     * shadow maps. A headset would have been handed flat untextured colour, and the profile it
     * was built from would have looked entirely reasonable.
     */
    const vr = profileFor('vr', 'medium', settings());
    expect(vr.shadows).toBe(false);
    expect(surfaceQualityFor(vr).textures).toBe(true);
    expect(surfaceQualityFor(vr)).toEqual(surfaceQualityFor(profileFor('pc', 'medium', settings())));
  });

  it('gives the scenery slider something to move', () => {
    /**
     * The control it replaces said "Draw distance" and changed nothing: `drawDistance` sets
     * `camera.far` and no more, and 120 → 70 measured zero draw calls and zero triangles of
     * difference. Props are thinned by *count*, so that is what a player-facing slider has to
     * scale if it is going to be honest about existing.
     */
    const full = profileFor('pc', 'medium', settings());
    const quarter = profileFor('pc', 'medium', settings({ sceneryDetail: 0.25 }));
    expect(quarter.foliageBudget).toBeLessThan(full.foliageBudget);
    expect(quarter.foliageBudget).toBe(Math.round(full.foliageBudget * 0.25));
    // Never to nothing: a budget of 0 would silently delete every prop in the game.
    expect(profileFor('pc', 'low', settings({ sceneryDetail: 0.25 })).foliageBudget).toBeGreaterThan(0);
  });

  it('thins and only thins, so a headset cannot be talked back over its ceiling', () => {
    // The VR clamp is a frame-time promise rather than a preference, and it is applied before
    // this, so the slider can reduce below it and never above it.
    const vr = profileFor('vr', 'medium', settings({ sceneryDetail: 1 }));
    expect(vr.foliageBudget).toBe(VR_FOLIAGE_BUDGET);
    expect(profileFor('vr', 'medium', settings({ sceneryDetail: 0.5 })).foliageBudget)
      .toBe(Math.round(VR_FOLIAGE_BUDGET * 0.5));
  });

  it('lets a tethered headset keep what it measured it could afford', () => {
    // Nothing suggests `high` for VR; the governor only climbs into it after seeing 103fps of
    // headroom at medium, which a standalone chipset will not produce.
    const vr = profileFor('vr', 'high', settings());
    expect(vr.shadows).toBe(true);
    expect(vr.foliageBudget).toBeGreaterThan(VR_FOLIAGE_BUDGET);
    // Still no post-processing: that one is a comfort rule, not a budget one.
    expect(vr.postProcessing).toBe(false);
  });
});
