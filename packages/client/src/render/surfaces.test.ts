import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { createSurfaceMaterial, surfaceQualityFor, tileMetres, worldNeedsRebuild } from './surfaces.js';
import { profileFor } from '../platform/Platform.js';
import { DEFAULT_SETTINGS } from '@kc/core';

/**
 * Surface materials and the tier that decides what they cost.
 *
 * Runs without a GL context: three.js materials and data textures are plain objects until a
 * renderer compiles them, so everything here — which maps are attached, which tier gets them, what
 * the shader patch is keyed on — is checkable in node. Only the compile itself needs a browser, and
 * that is covered by driving the real game in one.
 */
describe('surface quality tiers', () => {
  const profile = (tier: 'low' | 'medium' | 'high') => profileFor('pc', tier, DEFAULT_SETTINGS);

  it('gives a device that cannot afford shadows no textures either', () => {
    /**
     * The tier that keeps this affordable on a Quest and a mid-range phone. Triplanar sampling
     * costs three texture reads per map; with albedo, normal and ORM that is nine per fragment,
     * and the devices in this tier are the ones already dropping shadows to hold frame rate.
     *
     * They are not left where the game started, though — an untextured `MeshStandardMaterial` lit
     * by the environment map is still a long way from the flat lambert colour it replaces, and it
     * costs nothing per pixel.
     */
    const low = surfaceQualityFor(profile('low'));
    expect(low.textures).toBe(false);
    expect(low.triplanar).toBe(false);
    expect(low.normalMap).toBe(false);
  });

  it('gives the middle tier textures but no normal map', () => {
    const medium = surfaceQualityFor(profile('medium'));
    expect(medium.textures).toBe(true);
    expect(medium.triplanar).toBe(true);
    // Dropping the normal map is a third of the samples for the detail a player is least likely to
    // notice at arm's length on a phone.
    expect(medium.normalMap).toBe(false);
    expect(medium.size).toBeLessThan(surfaceQualityFor(profile('high')).size);
  });

  it('gives the top tier everything', () => {
    const high = surfaceQualityFor(profile('high'));
    expect(high.textures).toBe(true);
    expect(high.triplanar).toBe(true);
    expect(high.normalMap).toBe(true);
  });

  it('never hands a texture to a tier that asked for none', () => {
    // The check that the tier actually reaches the material rather than only the struct.
    const material = createSurfaceMaterial('ice', surfaceQualityFor(profile('low')), { color: 0xa8d8ea });
    expect(material.map).toBeNull();
    expect(material.normalMap).toBeNull();
    expect(material.roughnessMap).toBeNull();
    // Still standard, still lit by the environment.
    expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
  });

  it('attaches one packed map to three slots rather than three images', () => {
    /**
     * Occlusion, roughness and metalness share one texture in the glTF packing — three.js reads
     * roughness from green and metalness from blue of whatever it is handed. One upload instead of
     * three is a third of the memory and a third of the samples, which is the difference between
     * this being affordable on a headset and not.
     */
    const material = createSurfaceMaterial('rock', surfaceQualityFor(profile('high')), { color: 0xffffff });
    expect(material.roughnessMap).not.toBeNull();
    expect(material.roughnessMap).toBe(material.metalnessMap);
    expect(material.roughnessMap).toBe(material.aoMap);
    expect(material.map).not.toBe(material.roughnessMap);
  });

  it('leaves the albedo white when the texture carries the colour', () => {
    /**
     * The first build passed the material's tint *and* sampled the generated albedo, so two
     * mid-tones were multiplied together and the jungle floor came out near-black beside untextured
     * props that stayed bright. It read as a lighting bug and was a double-multiply.
     */
    const material = createSurfaceMaterial('dirt', surfaceQualityFor(profile('high')), { color: 0x6d5535 });
    expect(material.color.getHex()).toBe(0xffffff);
  });

  it('keeps a prop own colour and takes only its surface detail', () => {
    /**
     * Props carry a tint per instance — the foliage greens that stop every canopy being identical.
     * Sampling the albedo as well would multiply two greens and darken every leaf in the world, so
     * detail-only keeps the normal, roughness and occlusion and drops the one channel that clashes.
     */
    const material = createSurfaceMaterial('foliage', surfaceQualityFor(profile('high')), {
      color: 0xffffff,
      detailOnly: true,
      vertexColors: true,
    });
    expect(material.map).toBeNull();
    expect(material.roughnessMap).not.toBeNull();
    expect(material.vertexColors).toBe(true);
    // Faceted low-poly props keep flat shading; smoothing them to carry a normal map would round
    // off the silhouette the art is built on.
    expect(material.flatShading).toBe(true);
  });

  it('marks water transparent and nothing else', () => {
    const water = createSurfaceMaterial('water', surfaceQualityFor(profile('high')), {
      color: 0x2f7fa8,
      transparent: true,
      opacity: 0.72,
    });
    expect(water.transparent).toBe(true);
    expect(water.opacity).toBeCloseTo(0.72, 5);
    expect(createSurfaceMaterial('rock', surfaceQualityFor(profile('high')), { color: 0 }).transparent).toBe(false);
  });

  it('gives every material a tile size in metres', () => {
    // World-space tiling is what makes a 124 m floor and a 1 m boulder share one instanced
    // geometry and still show the same texel density. A missing entry silently falls back, which
    // would make one material's grain visibly the wrong scale beside every other.
    for (const material of ['dirt', 'rock', 'wood', 'foliage', 'water', 'metal', 'sand', 'stone', 'ice', 'snow'] as const) {
      expect(tileMetres(material), material).toBeGreaterThan(0);
      expect(tileMetres(material), material).toBeLessThan(20);
    }
  });

  it('rebuilds the world only for the settings baked into its meshes', () => {
    /**
     * Every graphics setting on the Settings screen used to be inert. `profileFor` reads shadows,
     * post-processing, render scale, draw distance, detailed players and target FPS out of the
     * settings, and `Renderer.applySettings` set one boolean and stopped — nothing recomputed the
     * profile. A player turning shadows off to claw back frame rate saw the toggle move and nothing
     * else, until the governor changed tier for its own reasons and quietly applied their choice
     * minutes later.
     *
     * Making settings apply immediately then raised the opposite risk, which is what this guards.
     * The sliders fire on every `input` event — continuously while a thumb is dragged — so a
     * rebuild on any profile change would regenerate every texture and every instanced mesh dozens
     * of times a second for a slider that touches no geometry.
     */
    const base = profileFor('pc', 'high', DEFAULT_SETTINGS);

    expect(worldNeedsRebuild(base, base)).toBe(false);

    // Live: the renderer applies these itself, and none of them is baked into a mesh.
    expect(worldNeedsRebuild(base, { ...base, renderScale: 0.6 })).toBe(false);
    expect(worldNeedsRebuild(base, { ...base, drawDistance: 80 })).toBe(false);
    expect(worldNeedsRebuild(base, { ...base, postProcessing: false })).toBe(false);
    expect(worldNeedsRebuild(base, { ...base, targetFps: 60 })).toBe(false);
    expect(worldNeedsRebuild(base, { ...base, maxDetailedPlayers: 4 })).toBe(false);

    // Baked in: shadow casting is set per instance, the foliage budget fixes instance counts, and
    // the shadow-map size decides the texture tier.
    expect(worldNeedsRebuild(base, { ...base, shadows: false })).toBe(true);
    expect(worldNeedsRebuild(base, { ...base, shadowMapSize: 1024 })).toBe(true);
    expect(worldNeedsRebuild(base, { ...base, foliageBudget: 60 })).toBe(true);
  });

  it('rebuilds whenever the texture tier would change', () => {
    // The two have to agree: a profile pair that `surfaceQualityFor` maps to different tiers must
    // be a pair that forces a rebuild, or the world keeps textures the current tier never asked
    // for. Checked as a relationship rather than restating the field list, so the two cannot drift.
    const tiers = (['low', 'medium', 'high'] as const).map((t) => profileFor('pc', t, DEFAULT_SETTINGS));
    for (const a of tiers) {
      for (const b of tiers) {
        const differs = JSON.stringify(surfaceQualityFor(a)) !== JSON.stringify(surfaceQualityFor(b));
        if (differs) expect(worldNeedsRebuild(a, b), `${a.shadowMapSize} vs ${b.shadowMapSize}`).toBe(true);
      }
    }
  });

  it('reuses one texture set across materials that ask for the same thing', () => {
    // The same ice is on hundreds of colliders and in both maps; regenerating a 512² set per
    // collider would cost seconds of loading.
    const quality = surfaceQualityFor(profile('high'));
    const a = createSurfaceMaterial('ice', quality, { color: 0xffffff });
    const b = createSurfaceMaterial('ice', quality, { color: 0xffffff });
    expect(a).not.toBe(b);
    expect(a.map).toBe(b.map);
    expect(a.normalMap).toBe(b.normalMap);
  });
});
