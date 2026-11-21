import * as THREE from 'three';
import { makeRaycastResult } from '@kc/core';
import type { HeightfieldCollider, PhysicsWorld } from '@kc/core';

/**
 * Baked ambient occlusion for terrain: how much of the sky each point of ground can see.
 *
 * Screen-space AO (`postChain.ts`) runs on the high tier only and never in a headset, so on every
 * other frame the ground under a tree, against a cliff, beside a boulder or in a hollow was lit by
 * the sky exactly as brightly as open ground — the flat, pasted-on look that a single sun and a sky
 * light give. This computes it once, at load, from the same physics world players stand in, and the
 * terrain's material multiplies its indirect light by it. Nothing runs per frame, so it costs a
 * headset nothing.
 *
 * Only indirect light is darkened — sky, hemisphere and environment. Direct sunlight is the shadow
 * map's job, and darkening it too would put a shadow where the sun is plainly shining.
 */

/** How far a ray looks. With the quadratic falloff, 8 m puts the foot of a 6 m wall at 0.38 of the sky blocked (the geometry says 0.48) and fades with no visible edge; at 4 m it was 0.23. */
export const GROUND_AO_REACH = 8;
/** How much of the indirect light a fully enclosed point loses. */
export const GROUND_AO_STRENGTH = 0.8;
/** Rays start this far above the ground so the surface does not occlude itself. */
const LIFT = 0.06;

/**
 * Fixed directions over the hemisphere, the same for every vertex so neighbouring vertices agree and
 * the result is smooth. Each carries its share of the cosine-weighted sky: the hemisphere is cut into
 * elevation bands, a band [a, b] holds sin²b − sin²a of the sky light reaching a flat surface, and
 * its rays split that equally. Weighting rays by their elevation alone instead counted the low rays a
 * wall blocks at a quarter of their worth, and the foot of a 6 m wall read 0.81 where the geometry
 * says 0.61.
 */
export const GROUND_AO_DIRECTIONS: readonly { x: number; y: number; z: number; weight: number }[] = (() => {
  const dirs: { x: number; y: number; z: number; weight: number }[] = [];
  const bands = [
    { from: 0, to: 0.45, at: 0.25, count: 8 },
    { from: 0.45, to: 0.9, at: 0.67, count: 6 },
    { from: 0.9, to: 1.35, at: 1.12, count: 4 },
    { from: 1.35, to: Math.PI / 2, at: Math.PI / 2, count: 1 },
  ];
  for (const band of bands) {
    // A quarter step round, so no ray runs along an axis (an axis-aligned wall's face) and any
    // half-plane through an axis holds exactly half of each band. Stepped by an arbitrary 0.7 rad
    // per band, the foot of such a wall caught 3 of 8, 2 of 6 and 1 of 4; a half step still put
    // two of six rays along the wall.
    const offset = Math.PI / (2 * band.count);
    const share = Math.sin(band.to) ** 2 - Math.sin(band.from) ** 2;
    for (let k = 0; k < band.count; k++) {
      const a = offset + (k / band.count) * Math.PI * 2;
      const c = Math.cos(band.at);
      dirs.push({ x: Math.cos(a) * c, y: Math.sin(band.at), z: Math.sin(a) * c, weight: share / band.count });
    }
  }
  return dirs;
})();

/**
 * Occlusion for each surface vertex of `hf`, row by row as `terrainGeometry` lays them: 1 is open sky,
 * lower is enclosed. A ray that hits something close blocks nearly its whole share; one that hits
 * near `GROUND_AO_REACH` blocks almost none, so a wall 4 m away does not darken a clearing.
 */
export function bakeGroundOcclusion(hf: HeightfieldCollider, world: PhysicsWorld): Float32Array {
  const out = new Float32Array(hf.rows * hf.cols);
  const hit = makeRaycastResult();
  const origin = { x: 0, y: 0, z: 0 };
  for (let j = 0; j < hf.rows; j++) {
    for (let i = 0; i < hf.cols; i++) {
      origin.x = hf.minX + i * hf.cellSize;
      origin.y = (hf.heights[j * hf.cols + i] as number) + LIFT;
      origin.z = hf.minZ + j * hf.cellSize;
      let blocked = 0;
      for (const d of GROUND_AO_DIRECTIONS) {
        world.raycast(hit, origin, d, GROUND_AO_REACH);
        // Quadratic, not linear: a linear falloff halved the share of a wall 2 m away and left the
        // foot of a 6 m wall at 0.87 — barely darker than a clearing.
        if (hit.hit) {
          const t = hit.distance / GROUND_AO_REACH;
          blocked += d.weight * (1 - t * t);
        }
      }
      out[j * hf.cols + i] = 1 - GROUND_AO_STRENGTH * blocked;
    }
  }
  return out;
}

/** The geometry attribute the material reads. */
export const GROUND_AO_ATTRIBUTE = 'groundAo';

/**
 * Put the baked occlusion on a terrain geometry. Vertices beyond the surface grid (the sides and the
 * underside) are fully open: nobody sees them lit by the sky anyway.
 */
export function applyGroundOcclusion(geometry: THREE.BufferGeometry, occlusion: Float32Array): void {
  const count = geometry.getAttribute('position').count;
  const values = new Float32Array(count).fill(1);
  values.set(occlusion.subarray(0, Math.min(occlusion.length, count)));
  geometry.setAttribute(GROUND_AO_ATTRIBUTE, new THREE.BufferAttribute(values, 1));
}

/**
 * Make `material` read `groundAo` and darken its indirect light by it, on top of whatever shader
 * patch it already has (the triplanar one). Its own program cache key, so a terrain material never
 * shares a program with a box of the same surface, which has no such attribute — WebGL reads a
 * missing attribute as 0, and every box would go black.
 */
export function withGroundOcclusion(material: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const previous = material.onBeforeCompile.bind(material);
  const previousKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
       attribute float ${GROUND_AO_ATTRIBUTE};
       varying float vGroundAo;`,
    ).replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vGroundAo = ${GROUND_AO_ATTRIBUTE};`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
       varying float vGroundAo;`,
    ).replace(
      '#include <lights_fragment_end>',
      `#include <lights_fragment_end>
       reflectedLight.indirectDiffuse *= vGroundAo;
       reflectedLight.indirectSpecular *= mix( 1.0, vGroundAo, 0.6 );`,
    );
  };
  material.customProgramCacheKey = () => `${previousKey()}:groundAo`;
  return material;
}
