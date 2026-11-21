import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildJungleWorld, heightfieldHeight, heightfieldMaxX, heightfieldMaxZ } from '@kc/core';
import type { HeightfieldCollider } from '@kc/core';
import { terrainGeometry } from './Terrain.js';

/**
 * The terrain a player sees is the terrain a player stands on.
 *
 * Four samples make a cell and two diagonals split it two ways, up to a quarter of the height
 * difference apart. Drawn on one diagonal and collided on the other, a player on a slope would
 * stand in the ground or over it. Asked of the real jungle floor, with three.js's own raycaster
 * against the drawn mesh — no GL context needed, and no second copy of the triangulation.
 */
describe('terrain drawn as it collides', () => {
  const level = buildJungleWorld();
  const hf = level.colliders.find((c): c is HeightfieldCollider => c.kind === 'heightfield');

  it('exists on the jungle, with real relief', () => {
    expect(hf).toBeDefined();
    const heights = hf!.heights;
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(3);
  });

  it('puts the drawn surface at the collision height everywhere', () => {
    const mesh = new THREE.Mesh(terrainGeometry(hf!), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.updateMatrixWorld(true);
    const raycaster = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    let worst = 0;
    let checked = 0;
    // A deterministic spread of points, most of them off the sample lattice where the diagonal matters.
    for (let n = 0; n < 2000; n++) {
      const x = hf!.minX + ((n * 0.6180339887) % 1) * (heightfieldMaxX(hf!) - hf!.minX);
      const z = hf!.minZ + ((n * 0.7548776662) % 1) * (heightfieldMaxZ(hf!) - hf!.minZ);
      raycaster.set(new THREE.Vector3(x, 50, z), down);
      const hit = raycaster.intersectObject(mesh)[0];
      if (!hit) continue;
      checked++;
      worst = Math.max(worst, Math.abs(hit.point.y - heightfieldHeight(hf!, x, z)));
    }
    expect(checked).toBeGreaterThan(1900);
    expect(worst).toBeLessThan(1e-4);
  });

  it('faces its surface up and its sides out', () => {
    const geometry = terrainGeometry(hf!);
    const index = geometry.getIndex()!;
    const p = geometry.getAttribute('position');
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const n = new THREE.Vector3();
    const centre = new THREE.Vector3((hf!.minX + heightfieldMaxX(hf!)) / 2, 0, (hf!.minZ + heightfieldMaxZ(hf!)) / 2);
    const cells = (hf!.cols - 1) * (hf!.rows - 1);
    for (let t = 0; t < index.count / 3; t++) {
      a.fromBufferAttribute(p, index.getX(t * 3));
      b.fromBufferAttribute(p, index.getX(t * 3 + 1));
      c.fromBufferAttribute(p, index.getX(t * 3 + 2));
      n.subVectors(b, a).cross(c.clone().sub(a)).normalize();
      if (t < cells * 2) {
        expect(n.y, `surface triangle ${t}`).toBeGreaterThan(0);
      } else if (Math.abs(n.y) < 0.5) {
        // A side: its normal points away from the middle of the footprint.
        const mid = a.clone().add(b).add(c).divideScalar(3);
        expect(n.x * (mid.x - centre.x) + n.z * (mid.z - centre.z), `side triangle ${t}`).toBeGreaterThan(0);
      } else {
        expect(n.y, 'underside').toBeLessThan(0);
      }
    }
  });
});
