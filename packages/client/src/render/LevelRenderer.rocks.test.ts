import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildLevel, DEFAULT_SETTINGS } from '@kc/core';
import { LevelRenderer, fillUnitCube } from './LevelRenderer.js';
import { profileFor } from '../platform/Platform.js';
import type { AssetLibrary } from './AssetLibrary.js';

/**
 * Rock sphere colliders are drawn with `rockball-N` once the models load. The part with a right
 * answer before a GPU sees it: the rock fills its collider (so a player stands on what they see),
 * every boulder is still drawn, and the smooth ball is gone.
 */
describe('rock sphere colliders', () => {
  /** A lopsided stand-in for a rock sitting on the ground, as the real files are authored. */
  function rockStub(): THREE.BufferGeometry {
    // A plain BufferGeometry, as GLTFLoader returns: an IcosahedronGeometry would clone as one and
    // be counted as the ball it replaces.
    const geometry = new THREE.BufferGeometry().copy(new THREE.IcosahedronGeometry(1, 1));
    geometry.scale(1.08, 0.82, 0.97);
    geometry.translate(0, 0.72, 0);
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position!.count * 3), 3));
    return geometry;
  }

  function stubAssets(): AssetLibrary {
    return { loadGeometry: async () => rockStub() } as unknown as AssetLibrary;
  }

  it('fills the unit cube exactly and leaves the shared source alone', () => {
    const source = rockStub();
    const before = (source.attributes.position!.array as Float32Array).slice();
    const filled = fillUnitCube(source);
    const box = filled.boundingBox as THREE.Box3;
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(box.min[axis]).toBeCloseTo(-1, 5);
      expect(box.max[axis]).toBeCloseTo(1, 5);
    }
    expect(filled.getAttribute('color')).toBeUndefined();
    // The source is AssetLibrary's cached copy; mutating it would corrupt every later load.
    expect(source.attributes.position!.array).toEqual(before);
  });

  it('does not draw a rock prop through a boulder it will draw as a rock', () => {
    const level = buildLevel('glacier-world');
    const profile = profileFor('pc', 'high', DEFAULT_SETTINGS);
    const rockProps = (renderer: LevelRenderer): number => {
      let n = 0;
      renderer.group.traverse((obj) => {
        if (obj instanceof THREE.InstancedMesh && obj.userData.kind === 'rock') n += obj.count;
      });
      return n;
    };
    const onBoulder = level.props.filter(
      (p) =>
        p.kind === 'rock' &&
        level.colliders.some((c) => c.kind === 'sphere' && Math.abs(c.center.x - p.position.x) < 1e-3 && Math.abs(c.center.z - p.position.z) < 1e-3),
    ).length;
    expect(onBoulder).toBeGreaterThan(100);

    const bare = new LevelRenderer(level, profile);
    const withModels = new LevelRenderer(level, profile, stubAssets());
    // Without models the ball stays a ball, so the prop is what makes it read as a rock.
    expect(rockProps(bare)).toBe(level.props.filter((p) => p.kind === 'rock').length);
    expect(rockProps(withModels)).toBe(rockProps(bare) - onBoulder);
    bare.dispose();
    withModels.dispose();
  });

  it('draws every rock sphere as a rock and removes the ball', async () => {
    const level = buildLevel('glacier-world');
    const spheres = level.colliders.filter((c) => c.kind === 'sphere' && c.surface.material === 'rock');
    expect(spheres.length).toBeGreaterThan(100);

    const renderer = new LevelRenderer(level, profileFor('pc', 'high', DEFAULT_SETTINGS), stubAssets());
    const icoCount = (): number => {
      let n = 0;
      renderer.group.traverse((obj) => {
        if (obj instanceof THREE.InstancedMesh && obj.geometry instanceof THREE.IcosahedronGeometry) n += obj.count;
      });
      return n;
    };
    expect(icoCount()).toBe(spheres.length);

    // Let both upgrade passes (props and rocks) finish.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(icoCount()).toBe(0);
    let rocks = 0;
    const top = new THREE.Vector3();
    const matrix = new THREE.Matrix4();
    renderer.group.traverse((obj) => {
      if (!(obj instanceof THREE.InstancedMesh) || !obj.geometry.boundingBox) return;
      const box = obj.geometry.boundingBox;
      if (Math.abs(box.max.y - 1) > 1e-5 || Math.abs(box.min.y + 1) > 1e-5) return;
      for (let i = 0; i < obj.count; i++) {
        obj.getMatrixAt(i, matrix);
        top.set(0, 1, 0).applyMatrix4(matrix);
        // Its top is the top of some rock sphere collider: a player stands on what they see.
        const match = spheres.some(
          (c) => c.kind === 'sphere' && Math.abs(c.center.x - top.x) < 1e-4 && Math.abs(c.center.z - top.z) < 1e-4 && Math.abs(c.center.y + c.radius - top.y) < 1e-4,
        );
        expect(match).toBe(true);
        rocks++;
      }
    });
    expect(rocks).toBe(spheres.length);
    renderer.dispose();
  });
});
