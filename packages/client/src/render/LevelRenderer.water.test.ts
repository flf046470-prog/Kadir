import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildLevel, DEFAULT_SETTINGS } from '@kc/core';
import { LevelRenderer } from './LevelRenderer.js';
import { profileFor } from '../platform/Platform.js';

/**
 * Water used to be a perfectly still, glossy surface: a real ripple normal map, never scrolled.
 * `applyTriplanar` (surfaces.ts) gives every triplanar material a `flowOffset` uniform, but only
 * `LevelRenderer.animate` ever writes to it, and only for water.
 *
 * `onBeforeCompile` — where `flowOffset` is actually attached to `userData` — only runs once a
 * real renderer compiles the material, so vitest's headless run never sees it fire (see the note
 * atop surfaces.test.ts). These tests stand in for that compile step by attaching the same shape
 * of stub `onBeforeCompile` would, then check what `animate` does to it — which is the part that
 * regresses without needing a GPU at all.
 */
describe('water animation wiring', () => {
  function waterMaterials(renderer: LevelRenderer): THREE.MeshStandardMaterial[] {
    const found: THREE.MeshStandardMaterial[] = [];
    renderer.group.traverse((obj) => {
      if (!(obj instanceof THREE.InstancedMesh)) return;
      const mat = obj.material as THREE.MeshStandardMaterial;
      // Water is the only material `LevelRenderer.material()` marks transparent — see
      // surfaces.test.ts's "marks water transparent and nothing else".
      if (mat.transparent && Math.abs(mat.opacity - 0.72) < 1e-6) found.push(mat);
    });
    return found;
  }

  it('never throws before a real renderer has attached a flow uniform', () => {
    // The ordinary case: every match starts here, one frame before the first real render.
    const level = buildLevel('jungle-world');
    const renderer = new LevelRenderer(level, profileFor('pc', 'high', DEFAULT_SETTINGS));
    expect(() => renderer.animate(3)).not.toThrow();
    renderer.dispose();
  });

  it('drives every water material and only water materials from animate(time)', () => {
    const level = buildLevel('jungle-world');
    const renderer = new LevelRenderer(level, profileFor('pc', 'high', DEFAULT_SETTINGS));

    const water = waterMaterials(renderer);
    expect(water.length).toBeGreaterThan(0);
    for (const mat of water) mat.userData.flowOffset = { value: new THREE.Vector2(0, 0) };

    // A non-water triplanar material — same shader capability, but nothing should ever move it.
    let untouched: THREE.MeshStandardMaterial | undefined;
    renderer.group.traverse((obj) => {
      if (untouched || !(obj instanceof THREE.InstancedMesh)) return;
      const mat = obj.material as THREE.MeshStandardMaterial;
      if (!mat.transparent) untouched = mat;
    });
    expect(untouched).toBeDefined();
    untouched!.userData.flowOffset = { value: new THREE.Vector2(1, 1) };

    renderer.animate(6);

    for (const mat of water) {
      const flow = mat.userData.flowOffset as { value: THREE.Vector2 };
      // Different rates per axis, so a current reads as a current rather than a diagonal texture
      // repeat sliding past — see the comment in LevelRenderer.animate.
      expect(flow.value.x).toBeCloseTo(6 * 0.035, 5);
      expect(flow.value.y).toBeCloseTo(6 * 0.05, 5);
    }
    const untouchedFlow = untouched!.userData.flowOffset as { value: THREE.Vector2 };
    expect(untouchedFlow.value.x).toBe(1);
    expect(untouchedFlow.value.y).toBe(1);

    renderer.dispose();
  });
});
