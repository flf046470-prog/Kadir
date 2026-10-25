import * as THREE from 'three';
import type { BoxCollider } from '@kc/core';

/** The chain-link's diamond, in metres across, and the wire's share of it. */
export const CHAIN_LINK_CELL = 0.22;
const WIRE = 0.16;
const TEXTURE_SIZE = 64;

/**
 * Chain-link as a texture: a diamond of wire, open in the middle, alpha 255 on the wire and 0
 * between. A `DataTexture`, not a canvas, so it is built the same way under Node as in a browser.
 *
 * The colour is the wire's everywhere, holes included: a mip level averages colour with alpha, and
 * black under the holes turned the far fence dark.
 */
export function chainLinkTexture(): THREE.DataTexture {
  const data = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  for (let y = 0; y < TEXTURE_SIZE; y++) {
    for (let x = 0; x < TEXTURE_SIZE; x++) {
      const u = (x + 0.5) / TEXTURE_SIZE;
      const v = (y + 0.5) / TEXTURE_SIZE;
      // Distance to the nearest of the two diagonals through the tile, which tile into diamonds.
      const a = Math.abs(((u + v) % 1) - 0.5);
      const b = Math.abs((((u - v) % 1) + 1) % 1 - 0.5);
      const wire = Math.min(0.5 - a, 0.5 - b) < WIRE / 2;
      const i = (y * TEXTURE_SIZE + x) * 4;
      data[i] = 205;
      data[i + 1] = 209;
      data[i + 2] = 215;
      data[i + 3] = wire ? 255 : 0;
    }
  }
  const texture = new THREE.DataTexture(data, TEXTURE_SIZE, TEXTURE_SIZE, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export interface CageMeshes {
  /** The chain-link, one instance per fence panel. */
  fence: THREE.InstancedMesh;
  /** A padded tube along the top of each panel and a thinner one along its foot. */
  rails: THREE.InstancedMesh;
  dispose(): void;
}

/**
 * A fight cage's fence (`LevelBuilder.cage`, `drawAs: 'cage'`), drawn as chain-link you can see the
 * fight through, with a padded top rail and a bar at the foot so the octagon reads at a distance.
 *
 * Each panel is a plane through the middle of its box, placed by the same `matrixOf` the solid
 * boxes use, so the wire a player sees is where the fence stops them. Two draw calls for the whole
 * cage. The chain-link casts no shadow: a shadow pass alpha-tests nothing, so it would cast a solid
 * octagon of shade over the floor.
 *
 * Blended, not alpha-tested. A third of the tile is wire, so from the third mip level on the
 * average alpha is under any cut-off that keeps the holes open up close, and the whole fence was
 * discarded: measured on a fixed camera, 11k fence pixels at 20 m, 1.7k at 30 m and none at all
 * past 45 m, which is most of the lobby. Blended, a far fence is the faint grey haze real
 * chain-link is from a distance. Every texel is the same grey, so the order the eight panels blend
 * in cannot show, and depth is not written; one pass for both sides for the same reason.
 */
export function buildCageFence(panels: BoxCollider[], matrixOf: (collider: BoxCollider, out: THREE.Matrix4) => THREE.Matrix4, shadows: boolean): CageMeshes {
  const texture = chainLinkTexture();
  const first = panels[0];
  if (first) texture.repeat.set((first.half.x * 2) / CHAIN_LINK_CELL, (first.half.y * 2) / CHAIN_LINK_CELL);
  const plane = new THREE.PlaneGeometry(1, 1);
  const fenceMaterial = new THREE.MeshStandardMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    metalness: 0.7,
    roughness: 0.42,
  });
  fenceMaterial.forceSinglePass = true;
  const fence = new THREE.InstancedMesh(plane, fenceMaterial, panels.length);
  fence.userData.kind = 'cage';
  fence.castShadow = false;
  fence.receiveShadow = shadows;
  // Transparent objects are sorted by their own position, and an instanced mesh's is the origin
  // unless it is moved: put it at the cage, and the panels relative to it.
  const middle = new THREE.Vector3();
  for (const panel of panels) middle.add(new THREE.Vector3(panel.center.x, panel.center.y, panel.center.z));
  if (panels.length > 0) middle.divideScalar(panels.length);
  fence.position.copy(middle);
  const toLocal = new THREE.Matrix4().makeTranslation(-middle.x, -middle.y, -middle.z);

  // A tube along X, a unit long and a unit across, so a box-shaped matrix lays it along a panel.
  const bar = new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 1).rotateZ(Math.PI / 2);
  const railMaterial = new THREE.MeshStandardMaterial({ color: 0x1d1f24, metalness: 0.2, roughness: 0.65 });
  const rails = new THREE.InstancedMesh(bar, railMaterial, panels.length * 2);
  rails.userData.kind = 'cage-rail';
  rails.castShadow = shadows;
  rails.receiveShadow = shadows;

  const matrix = new THREE.Matrix4();
  panels.forEach((panel, i) => {
    fence.setMatrixAt(i, matrixOf(panel, matrix).premultiply(toLocal));
    const top = panel.center.y + panel.half.y;
    const bottom = panel.center.y - panel.half.y;
    const rail = (y: number, size: number): BoxCollider => ({
      ...panel,
      center: { x: panel.center.x, y, z: panel.center.z },
      half: { x: panel.half.x + 0.04, y: size / 2, z: size / 2 },
    });
    rails.setMatrixAt(i * 2, matrixOf(rail(top - 0.06, 0.2), matrix));
    rails.setMatrixAt(i * 2 + 1, matrixOf(rail(bottom + 0.05, 0.1), matrix));
  });
  fence.instanceMatrix.needsUpdate = true;
  rails.instanceMatrix.needsUpdate = true;

  return {
    fence,
    rails,
    dispose() {
      plane.dispose();
      bar.dispose();
      texture.dispose();
      fenceMaterial.dispose();
      railMaterial.dispose();
    },
  };
}
