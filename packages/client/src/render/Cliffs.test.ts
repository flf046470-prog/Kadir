import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_SETTINGS, buildLevel, listLevels } from '@kc/core';
import type { BoxCollider, Collider } from '@kc/core';
import { CARVE, CLIFF_CELL, SKYLINE_FALL, cliffCrest, cliffGeometry, faceCarve } from './Cliffs.js';
import { LevelRenderer } from './LevelRenderer.js';
import { profileFor } from '../platform/Platform.js';

/**
 * The boundary walls are boxes to the physics and rock to the eye (`BoxCollider.drawAs`). What has a
 * right answer before a GPU sees it: the rock never stands in front of a wall or sinks below its top,
 * every face faces out, the crest has lost its steps, and nothing is drawn twice.
 */

const isCliff = (c: Collider): c is BoxCollider => c.kind === 'box' && c.drawAs === 'cliff';
const maps = listLevels().map(({ id }) => buildLevel(id));

describe('the cliffs round every map', () => {
  it('are carved into their walls, never built out in front of them', () => {
    for (const level of maps) {
      const walls = level.colliders.filter(isCliff);
      expect(walls.length, level.id).toBeGreaterThan(20);
      const positions = cliffGeometry(walls, level.seed).getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const z = positions.getZ(i);
        const inside = walls.some(
          (w) => Math.abs(x - w.center.x) <= w.half.x + 1e-4 && Math.abs(z - w.center.z) <= w.half.z + 1e-4,
        );
        expect(inside, `${level.id} vertex ${i} at ${x.toFixed(2)},${z.toFixed(2)}`).toBe(true);
      }
    }
  });

  it('never sink below the top a player would hit, and face outwards on every side', () => {
    const ray = new THREE.Raycaster();
    for (const level of maps) {
      const walls = level.colliders.filter(isCliff);
      // Front faces only: a face wound the wrong way is culled, and the ray goes straight through.
      const mesh = new THREE.Mesh(cliffGeometry(walls, level.seed), new THREE.MeshBasicMaterial({ side: THREE.FrontSide }));
      for (const w of walls) {
        const top = w.center.y + w.half.y;
        for (const t of [-0.8, 0, 0.8]) {
          const x = w.center.x + (w.half.x >= w.half.z ? t * w.half.x : 0);
          const z = w.center.z + (w.half.x >= w.half.z ? 0 : t * w.half.z);
          ray.set(new THREE.Vector3(x, top + 50, z), new THREE.Vector3(0, -1, 0));
          const hit = ray.intersectObject(mesh)[0];
          expect(hit, `${level.id} wall ${w.id} has a top`).toBeDefined();
          expect((hit as THREE.Intersection).point.y, `${level.id} wall ${w.id}`).toBeGreaterThanOrEqual(top - 1e-3);
        }
        // From outside each side at a height every wall has, towards its middle.
        const y = w.center.y - w.half.y + 9;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const from = new THREE.Vector3(w.center.x + dx * (w.half.x + 5), y, w.center.z + dz * (w.half.z + 5));
          ray.set(from, new THREE.Vector3(-dx, 0, -dz));
          ray.far = (dx ? w.half.x : w.half.z) + 5.001;
          expect(ray.intersectObject(mesh).length, `${level.id} wall ${w.id} side ${dx},${dz}`).toBeGreaterThan(0);
        }
        ray.far = Infinity;
      }
    }
  });

  it('carve nothing at the ends of a face, so where two walls meet the join is flush', () => {
    // Carved up to the join, the next wall's uncarved end stood proud of the hollow beside it, and
    // every join on every map showed as a thin vertical fin.
    const at = { top: 30, floor: 0, limit: 5 };
    let deepest = 0;
    for (let along = -40; along <= 40; along += 0.7) {
      for (let y = 4; y <= 24; y += 1.3) {
        expect(faceCarve(7, along, y, 0, { ...at, end: 0 })).toBe(0);
        deepest = Math.max(deepest, faceCarve(7, along, y, 0, { ...at, end: CLIFF_CELL * 2 }));
      }
    }
    // And it does carve, away from the ends — up to `CARVE` and never past a third of the wall.
    expect(deepest).toBeGreaterThan(CARVE * 0.5);
    expect(deepest).toBeLessThanOrEqual(CARVE);
    expect(faceCarve(7, 3, 12, 0, { ...at, end: 10, limit: 0.01 })).toBeLessThanOrEqual(0.01);
  });

  it('have a crest that climbs and falls instead of stepping', () => {
    for (const level of maps) {
      const walls = level.colliders.filter(isCliff);
      const crest = cliffCrest(walls, level.seed);
      let worstBox = 0;
      let worstRock = 0;
      for (const w of walls) {
        const longX = w.half.x >= w.half.z;
        const span = longX ? w.half.x : w.half.z;
        for (let s = -span; s <= span + 1; s += 0.5) {
          const at = (d: number): [number, number] => (longX ? [w.center.x + d, w.center.z] : [w.center.x, w.center.z + d]);
          const [x0, z0] = at(s);
          const [x1, z1] = at(s + 0.5);
          worstRock = Math.max(worstRock, Math.abs(crest(x1, z1) - crest(x0, z0)) / 0.5);
          // The box tops it replaces: what is the highest wall under each point.
          const boxTop = (x: number, z: number): number =>
            Math.max(-Infinity, ...walls.filter((v) => Math.abs(x - v.center.x) <= v.half.x && Math.abs(z - v.center.z) <= v.half.z).map((v) => v.center.y + v.half.y));
          const a = boxTop(x0, z0);
          const b = boxTop(x1, z1);
          if (Number.isFinite(a) && Number.isFinite(b)) worstBox = Math.max(worstBox, Math.abs(b - a) / 0.5);
        }
      }
      // Box tops step by metres in half a metre; the crest is never steeper than its fall plus its ragged edge.
      expect(worstBox, `${level.id} boxes`).toBeGreaterThan(3);
      expect(worstRock, `${level.id} rock`).toBeLessThan(SKYLINE_FALL + 1.6);
    }
  });

  it('are drawn once each, as rock and not as boxes, within a triangle budget', () => {
    for (const level of maps) {
      const renderer = new LevelRenderer(level, profileFor('pc', 'high', DEFAULT_SETTINGS));
      let boxes = 0;
      let rock = 0;
      renderer.group.traverse((obj) => {
        if (obj instanceof THREE.InstancedMesh && obj.geometry instanceof THREE.BoxGeometry) boxes += obj.count;
        if (obj instanceof THREE.Mesh && obj.userData.kind === 'cliff') rock += (obj.geometry.getAttribute('position').count / 3);
      });
      expect(boxes, level.id).toBe(level.colliders.filter((c) => c.kind === 'box' && !c.drawAs).length);
      expect(rock, `${level.id} cliff triangles`).toBeGreaterThan(0);
      expect(rock, `${level.id} cliff triangles`).toBeLessThan(40_000);
      renderer.dispose();
    }
  });
});
