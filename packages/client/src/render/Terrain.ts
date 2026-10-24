import * as THREE from 'three';
import { heightfieldMaxX, heightfieldMaxZ } from '@kc/core';
import type { HeightfieldCollider } from '@kc/core';

/** Texture coordinates repeat every this many metres; triplanar tiers ignore them. */
const UV_METRES = 4;

/**
 * The mesh of a terrain collider: its surface, its four sides and its underside.
 *
 * Each cell is split on the diagonal from its (0, 0) corner to its (1, 1) corner, which is the
 * split `physics/heightfield.ts` collides with. Two diagonals give two different surfaces between
 * the same four samples — up to a quarter of the height difference apart — so a mesh cut the other
 * way would put a player's feet above or below the ground they are drawn on. `Terrain.test.ts`
 * holds the two together by raycasting this mesh against the physics.
 *
 * The surface is smooth-shaded (normals averaged across cells) and its sides and underside carry
 * their own flat normals, so a cut edge reads as a cut edge.
 */
export function terrainGeometry(hf: HeightfieldCollider): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const cs = hf.cellSize;
  const maxX = heightfieldMaxX(hf);
  const maxZ = heightfieldMaxZ(hf);
  const vertex = (x: number, y: number, z: number, u = x / UV_METRES, v = z / UV_METRES): number => {
    positions.push(x, y, z);
    uvs.push(u, v);
    return positions.length / 3 - 1;
  };

  // Surface.
  for (let j = 0; j < hf.rows; j++) {
    for (let i = 0; i < hf.cols; i++) vertex(hf.minX + i * cs, hf.heights[j * hf.cols + i] as number, hf.minZ + j * cs);
  }
  const at = (i: number, j: number): number => j * hf.cols + i;
  for (let j = 0; j < hf.rows - 1; j++) {
    for (let i = 0; i < hf.cols - 1; i++) {
      // Counter-clockwise from above, both sharing the (0,0)–(1,1) diagonal.
      indices.push(at(i, j), at(i + 1, j + 1), at(i + 1, j));
      indices.push(at(i, j), at(i, j + 1), at(i + 1, j + 1));
    }
  }

  // Sides: a strip from the surface's edge down to `bottom`, facing outwards.
  const side = (count: number, point: (k: number) => [number, number], outward: 1 | -1, alongX: boolean): void => {
    const start = positions.length / 3;
    for (let k = 0; k < count; k++) {
      const [i, j] = point(k);
      const x = hf.minX + i * cs;
      const z = hf.minZ + j * cs;
      const along = (alongX ? x : z) / UV_METRES;
      vertex(x, hf.heights[at(i, j)] as number, z, along, (hf.heights[at(i, j)] as number) / UV_METRES);
      vertex(x, hf.bottom, z, along, hf.bottom / UV_METRES);
    }
    for (let k = 0; k < count - 1; k++) {
      const top0 = start + k * 2;
      const bot0 = top0 + 1;
      const top1 = top0 + 2;
      const bot1 = top0 + 3;
      if (outward > 0) indices.push(top0, bot0, top1, top1, bot0, bot1);
      else indices.push(top0, top1, bot0, top1, bot1, bot0);
    }
  };
  // North (-z) and south (+z) edges run along x; west (-x) and east (+x) run along z. The winding
  // flips with which way the strip is walked relative to its outward normal.
  side(hf.cols, (k) => [k, 0], -1, true);
  side(hf.cols, (k) => [k, hf.rows - 1], 1, true);
  side(hf.rows, (k) => [0, k], 1, false);
  side(hf.rows, (k) => [hf.cols - 1, k], -1, false);

  // Underside, facing down.
  const b0 = vertex(hf.minX, hf.bottom, hf.minZ);
  const b1 = vertex(maxX, hf.bottom, hf.minZ);
  const b2 = vertex(maxX, hf.bottom, maxZ);
  const b3 = vertex(hf.minX, hf.bottom, maxZ);
  indices.push(b0, b1, b2, b0, b2, b3);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
