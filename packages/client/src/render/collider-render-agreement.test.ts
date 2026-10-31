import { buildLevel, closestPointOnBox, rayBox, vec3 } from '@kc/core';
import type { BoxCollider } from '@kc/core';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { colliderMatrix } from './LevelRenderer.js';

/**
 * What you see is what you stand on.
 *
 * The physics used to apply the mirror of the rotation the renderer draws a box with. Measured on
 * the shipped maps: of points inside each drawn yawed box, the collider agreed on 47 % (jungle),
 * 64 % (glacier) and 45 % (outback) — only the vertical centre line on the worst boxes — and
 * drawing with −yaw agreed on 100 %. 222 boxes, 173 of them tree branches. A player landed on air
 * beside a branch and fell through the one they could see.
 *
 * This holds the renderer's own transform (`colliderMatrix`, the function `LevelRenderer` draws
 * with) against the physics' own query, on every yawed box of every map. Neither side is copied.
 */
const MAPS = ['jungle-world', 'glacier-world', 'outback-station'];

function yawedBoxes(id: string): BoxCollider[] {
  const level = buildLevel(id);
  // `buildLevel` falls back to the default map for an unknown id; measuring the jungle three
  // times would pass this file three times for one map.
  expect(level.id).toBe(id);
  return level.colliders.filter(
    (c): c is BoxCollider => c.kind === 'box' && Math.abs(Math.sin(2 * c.yaw)) > 1e-3,
  );
}

describe('boxes collide where they are drawn', () => {
  for (const id of MAPS) {
    it(`on ${id}`, () => {
      const boxes = yawedBoxes(id);
      expect(boxes.length, 'no yawed boxes: nothing is being checked').toBeGreaterThan(10);
      const matrix = new THREE.Matrix4();
      const p = new THREE.Vector3();
      const scratch = vec3(0, 0, 0);
      const normal = vec3(0, 0, 0);
      const misses: string[] = [];
      for (const box of boxes) {
        colliderMatrix(box, matrix);
        for (const u of [-0.45, 0.45]) {
          for (const w of [-0.45, 0.45]) {
            // A drawn corner, just inside: the corners are what a mirrored rotation moves most.
            p.set(u, 0, w).applyMatrix4(matrix);
            if (!closestPointOnBox(scratch, normal, vec3(p.x, p.y, p.z), box)) {
              misses.push(`#${box.id} yaw ${box.yaw.toFixed(2)}`);
            }
          }
        }
      }
      expect(misses.slice(0, 5), `${misses.length} drawn corners are not solid`).toEqual([]);
    });
  }

  it('hits a drawn box with a ray where it is drawn, not where its mirror would be', () => {
    // `rayBox` is the other half of the physics that reads yaw (line of sight, projectiles), and
    // it had the same mirrored rotation.
    const box: BoxCollider = {
      kind: 'box', id: 0, center: vec3(0, 1, 0), half: vec3(3, 1, 0.3), yaw: 0.6,
      surface: { friction: 1, bounciness: 0, flags: 0, material: 'rock' },
    };
    const matrix = colliderMatrix(box);
    const end = new THREE.Vector3(0.45, 0, 0).applyMatrix4(matrix); // near the drawn right end
    const origin = vec3(end.x, 10, end.z);
    const hit = rayBox(origin, vec3(0, -1, 0), 20, box, vec3(0, 0, 0));
    expect(hit).toBeGreaterThan(0);
    const mirrored = new THREE.Vector3(0.45, 0, 0).applyMatrix4(colliderMatrix({ ...box, yaw: -box.yaw }));
    expect(rayBox(vec3(mirrored.x, 10, mirrored.z), vec3(0, -1, 0), 20, box, vec3(0, 0, 0))).toBe(-1);
  });
});
