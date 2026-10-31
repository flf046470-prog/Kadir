import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildLevel, DEFAULT_SETTINGS } from '@kc/core';
import type { BoxCollider, Collider } from '@kc/core';
import { buildCageFence, chainLinkTexture } from './Cage.js';
import { LevelRenderer, colliderMatrix } from './LevelRenderer.js';
import { profileFor } from '../platform/Platform.js';

/**
 * A cage's fence is a box to the physics and chain-link to the eye (`drawAs: 'cage'`). What has a
 * right answer without a GPU: the wire is drawn where the fence stops a player, and the far fence
 * is not thrown away by an alpha test. The far fence itself was measured on a fixed-camera page
 * (`probe-cage.html`, untracked): alpha-tested, 1.7k fence pixels at 30 m and none from 45 m.
 */

const isPanel = (c: Collider): c is BoxCollider => c.kind === 'box' && c.drawAs === 'cage';

describe('the cage fence', () => {
  for (const id of ['jungle-world', 'glacier-world', 'outback-station']) {
    it(`${id}: draws each panel inside the box that stops you, as two draw calls`, () => {
      const level = buildLevel(id);
      const panels = level.colliders.filter(isPanel);
      expect(panels).toHaveLength(8);
      const renderer = new LevelRenderer(level, profileFor('pc', 'high', DEFAULT_SETTINGS));
      const meshes: THREE.InstancedMesh[] = [];
      renderer.group.traverse((obj) => {
        if (obj instanceof THREE.InstancedMesh && (obj.userData.kind === 'cage' || obj.userData.kind === 'cage-rail')) meshes.push(obj);
      });
      expect(meshes).toHaveLength(2);
      const fence = meshes.find((m) => m.userData.kind === 'cage') as THREE.InstancedMesh;
      expect(fence.count).toBe(8);
      fence.updateMatrixWorld(true);

      // Each drawn plane's corners, in the frame of the nearest panel's box, are inside it.
      const instance = new THREE.Matrix4();
      const world = new THREE.Matrix4();
      const toBox = new THREE.Matrix4();
      const corner = new THREE.Vector3();
      for (let i = 0; i < fence.count; i++) {
        fence.getMatrixAt(i, instance);
        world.multiplyMatrices(fence.matrixWorld, instance);
        const middle = new THREE.Vector3().setFromMatrixPosition(world);
        const panel = panels.reduce((best, p) =>
          Math.hypot(p.center.x - middle.x, p.center.z - middle.z) < Math.hypot(best.center.x - middle.x, best.center.z - middle.z) ? p : best,
        );
        toBox.copy(
          new THREE.Matrix4().compose(
            new THREE.Vector3(panel.center.x, panel.center.y, panel.center.z),
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), panel.yaw),
            new THREE.Vector3(1, 1, 1),
          ),
        ).invert();
        for (const [u, v] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]] as const) {
          corner.set(u, v, 0).applyMatrix4(world).applyMatrix4(toBox);
          expect(Math.abs(corner.x)).toBeLessThanOrEqual(panel.half.x + 1e-4);
          expect(Math.abs(corner.y)).toBeLessThanOrEqual(panel.half.y + 1e-4);
          expect(Math.abs(corner.z)).toBeLessThanOrEqual(panel.half.z + 1e-4);
        }
      }
      // Sorted as transparent by its own position, so that has to be the cage's, not the origin.
      expect(Math.hypot(fence.position.x - (level.arenas?.[0]?.center.x ?? 0), fence.position.z - (level.arenas?.[0]?.center.z ?? 0))).toBeLessThan(0.01);
      renderer.dispose();
    });
  }

  it('is not thrown away at a distance', () => {
    // A mip level averages alpha. Under a third of the tile is wire, so an alpha test that keeps the
    // holes open up close discards the whole fence once it is a few pixels a diamond.
    const texture = chainLinkTexture();
    const data = texture.image.data as Uint8Array;
    let alpha = 0;
    const colours = new Set<string>();
    for (let i = 0; i < data.length; i += 4) {
      alpha += (data[i + 3] as number) / 255;
      colours.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    }
    const mean = alpha / (data.length / 4);
    expect(mean).toBeGreaterThan(0.15);
    expect(mean).toBeLessThan(0.5);
    // Blended, so a far fence is a grey haze; and grey under the holes too, or the haze goes dark.
    const panels = buildLevel('jungle-world').colliders.filter(isPanel);
    const cage = buildCageFence(panels, colliderMatrix, true);
    const material = cage.fence.material as THREE.MeshStandardMaterial;
    expect(material.alphaTest).toBeLessThan(mean);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect([...colours]).toHaveLength(1);
    cage.dispose();
  });
});
