import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_SURFACE, PhysicsWorld, vec3 } from '@kc/core';
import type { Collider, HeightfieldCollider } from '@kc/core';
import { terrainGeometry } from './Terrain.js';
import {
  GROUND_AO_ATTRIBUTE,
  GROUND_AO_DIRECTIONS,
  GROUND_AO_STRENGTH,
  applyGroundOcclusion,
  bakeGroundOcclusion,
  withGroundOcclusion,
} from './groundOcclusion.js';

/** A flat 20 x 20 m terrain at y = 0, 1 m cells. */
function flat(): HeightfieldCollider {
  const cols = 21;
  const rows = 21;
  return {
    kind: 'heightfield',
    id: 0,
    surface: DEFAULT_SURFACE,
    center: vec3(10, -2, 10),
    minX: 0,
    minZ: 0,
    cellSize: 1,
    cols,
    rows,
    heights: Array.from({ length: cols * rows }, () => 0),
    bottom: -4,
    top: 0,
  };
}

/** A wall 6 m high along x = 10, the full depth of the terrain. */
function wall(): Collider {
  return { kind: 'box', id: 1, center: vec3(10.5, 3, 10), half: vec3(0.5, 3, 12), yaw: 0, surface: DEFAULT_SURFACE } as Collider;
}

const at = (hf: HeightfieldCollider, ao: Float32Array, x: number, z: number) => ao[z * hf.cols + x] as number;

describe('baked ground occlusion', () => {
  it('weights its rays to the whole cosine-weighted sky', () => {
    expect(GROUND_AO_DIRECTIONS.reduce((n, d) => n + d.weight, 0)).toBeCloseTo(1, 9);
  });

  it('splits every band exactly in half across either axis, with no ray along one', () => {
    // So an axis-aligned wall, the commonest thing in these maps, is sampled as half the sky.
    const bands = new Map<number, { x: number; z: number }[]>();
    for (const d of GROUND_AO_DIRECTIONS) {
      if (d.y > 0.999) continue;
      const key = Math.round(d.y * 1000);
      bands.set(key, [...(bands.get(key) ?? []), d]);
    }
    for (const rays of bands.values()) {
      expect(rays.every((d) => Math.abs(d.x) > 1e-6 && Math.abs(d.z) > 1e-6)).toBe(true);
      expect(rays.filter((d) => d.x > 0).length).toBe(rays.length / 2);
      expect(rays.filter((d) => d.z > 0).length).toBe(rays.length / 2);
    }
  });

  it('leaves open ground fully lit', () => {
    const hf = flat();
    const ao = bakeGroundOcclusion(hf, new PhysicsWorld([hf]));
    expect(Math.min(...ao)).toBeGreaterThan(0.999);
  });

  it('darkens ground beside a wall, more the closer it is, and not beyond reach', () => {
    const hf = flat();
    const ao = bakeGroundOcclusion(hf, new PhysicsWorld([hf, wall()]));
    const foot = at(hf, ao, 9, 10);
    const near = at(hf, ao, 8, 10);
    const far = at(hf, ao, 0, 10); // 10 m out, beyond GROUND_AO_REACH
    expect(foot).toBeLessThan(near);
    expect(near).toBeLessThan(far);
    expect(far).toBeGreaterThan(0.999);
    // 1 m from a 6 m wall, half the cosine-weighted sky is behind it up to 80.5°: 0.49 blocked,
    // 1 - 0.8 x 0.49 = 0.61 with no falloff. The falloff keeps it a little above that.
    expect(foot).toBeGreaterThan(0.61);
    expect(foot).toBeLessThan(0.75);
    expect(foot).toBeGreaterThan(1 - GROUND_AO_STRENGTH);
  });

  it('puts the bake on the surface vertices and leaves the sides open', () => {
    const hf = flat();
    const geometry = terrainGeometry(hf);
    const ao = bakeGroundOcclusion(hf, new PhysicsWorld([hf, wall()]));
    applyGroundOcclusion(geometry, ao);
    const attr = geometry.getAttribute(GROUND_AO_ATTRIBUTE);
    expect(attr.count).toBe(geometry.getAttribute('position').count);
    expect(attr.getX(10 * hf.cols + 9)).toBeCloseTo(at(hf, ao, 9, 10), 6);
    expect(attr.getX(attr.count - 1)).toBe(1);
  });
});

describe('the ground occlusion material', () => {
  const fakeShader = () => ({
    uniforms: {},
    defines: {},
    vertexShader: '#include <common>\nvoid main() {\n#include <begin_vertex>\n}',
    fragmentShader: '#include <common>\nvoid main() {\n#include <lights_fragment_end>\n#include <aomap_fragment>\n}',
  });

  it('darkens indirect light by the attribute and keeps the patch it already had', () => {
    const material = new THREE.MeshStandardMaterial();
    let previousRan = false;
    material.onBeforeCompile = () => {
      previousRan = true;
    };
    withGroundOcclusion(material);
    const shader = fakeShader();
    material.onBeforeCompile(shader as never, {} as never);
    expect(previousRan).toBe(true);
    expect(shader.vertexShader).toContain(`attribute float ${GROUND_AO_ATTRIBUTE}`);
    expect(shader.fragmentShader).toContain('reflectedLight.indirectDiffuse *= vGroundAo');
    // Direct light is the shadow map's: the bake must not touch it.
    expect(shader.fragmentShader).not.toContain('reflectedLight.directDiffuse');
  });

  it('never shares a program with a material of the same surface without the attribute', () => {
    // Surface materials carry their own key (`triplanar:…`); a terrain material starts with the same
    // one, and sharing it would hand the boxes a program reading an attribute they lack (read as 0).
    const keyed = () => {
      const m = new THREE.MeshStandardMaterial();
      m.customProgramCacheKey = () => 'triplanar:4:1:1:0';
      return m;
    };
    const plain = keyed();
    const terrain = withGroundOcclusion(keyed());
    expect(terrain.customProgramCacheKey()).not.toBe(plain.customProgramCacheKey());
  });
});
