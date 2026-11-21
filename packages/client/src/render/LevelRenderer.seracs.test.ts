import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildLevel } from '@kc/core';
import type { BoxCollider, Collider } from '@kc/core';
import { SERAC_MODEL, SERAC_VARIANTS, fitSerac } from './LevelRenderer.js';

const PROPS = new URL('../../public/models/props/', import.meta.url);

async function loadMesh(name: string): Promise<THREE.BufferGeometry> {
  const bytes = readFileSync(new URL(`${name}.glb`, PROPS));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const scene = await new Promise<THREE.Group>((resolve, reject) =>
    new GLTFLoader().parse(buffer, '', (gltf) => resolve(gltf.scene), reject),
  );
  const meshes: THREE.Mesh[] = [];
  scene.traverse((n) => {
    if ((n as THREE.Mesh).isMesh) meshes.push(n as THREE.Mesh);
  });
  expect(meshes, `${name} has exactly one mesh to instance`).toHaveLength(1);
  const mesh = meshes[0] as THREE.Mesh;
  mesh.updateWorldMatrix(true, false);
  return mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
}

const isSerac = (c: Collider): c is BoxCollider => c.kind === 'box' && c.drawAs === 'serac';

/**
 * The glacier's ice towers are drawn as Blender models fitted to their boxes. What a player sees
 * must be what they collide with: no ice outside the box, a top at the box's top they can stand on,
 * and a model that fills the box rather than standing in it with a gap all round.
 */
describe('serac towers', () => {
  it('the glacier marks its ice towers, and only those', () => {
    const level = buildLevel('glacier-world');
    const towers = level.colliders.filter(isSerac);
    expect(towers.length).toBeGreaterThanOrEqual(12);
    for (const t of towers) expect(t.zone).toBe('seracs');
  });

  it('every model fills the unit box and never leaves it, with a flat top at the top', async () => {
    for (let i = 1; i <= SERAC_VARIANTS; i++) {
      const g = fitSerac(await loadMesh(`${SERAC_MODEL}-${i}`));
      const box = g.boundingBox as THREE.Box3;
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(box.min[axis], `serac-${i} ${axis} min`).toBeCloseTo(-1, 5);
        expect(box.max[axis], `serac-${i} ${axis} max`).toBeCloseTo(1, 5);
      }
      // The cap a player stands on: upward faces at the very top, covering most of the footprint.
      const pos = g.getAttribute('position');
      const normal = g.getAttribute('normal');
      let capArea = 0;
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      const c = new THREE.Vector3();
      for (let t = 0; t < pos.count; t += 3) {
        a.fromBufferAttribute(pos, t);
        b.fromBufferAttribute(pos, t + 1);
        c.fromBufferAttribute(pos, t + 2);
        if (a.y > 0.999 && b.y > 0.999 && c.y > 0.999 && normal.getY(t) > 0.99) {
          capArea += b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
        }
      }
      // The unit footprint is 2 x 2; a cap of at least two thirds of it is somewhere to land.
      expect(capArea, `serac-${i} cap`).toBeGreaterThan(4 * 0.66);
      // Faceted: a flat-shaded triangle's three normals agree.
      expect(normal.getX(0)).toBeCloseTo(normal.getX(1), 6);
    }
  });
});
