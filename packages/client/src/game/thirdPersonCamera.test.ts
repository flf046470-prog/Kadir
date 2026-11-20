import { describe, expect, it } from 'vitest';
import { DEFAULT_SURFACE, PhysicsWorld, THIRD_PERSON_CAMERA_DISTANCE, makeRaycastResult, vec3 } from '@kc/core';
import type { Vec3 } from '@kc/core';
import { CAMERA_CLEARANCE, easeCameraTo, thirdPersonCameraTarget } from './thirdPersonCamera.js';

const box = (id: number, center: Vec3, half: Vec3) =>
  ({ kind: 'box', id, center, half, yaw: 0, surface: { ...DEFAULT_SURFACE } }) as const;
const floor = box(0, vec3(0, -1, 0), vec3(50, 1, 50));
const world = (...extra: ReturnType<typeof box>[]) => new PhysicsWorld([floor, ...extra] as never);
const ray = makeRaycastResult();
const head = vec3(0, 1.4, 0);
// Facing +z, so the camera stands towards -z.
const yaw = 0;
const orbit = -0.24;

describe('third-person camera', () => {
  it('stands at its full distance on open ground', () => {
    const out = vec3();
    const f = thirdPersonCameraTarget(out, world(), ray, head, yaw, orbit);
    expect(f).toBe(1);
    expect(Math.hypot(out.x, out.z)).toBeGreaterThan(THIRD_PERSON_CAMERA_DISTANCE * 0.9);
  });

  it('keeps clear of a wall its line only grazes', () => {
    // A wall beside the line to the camera, 5 cm from it: a ray misses, a camera stands in it.
    const w = world(box(1, vec3(0.3, 2, -4), vec3(0.25, 3, 2)));
    const out = vec3();
    thirdPersonCameraTarget(out, w, ray, head, yaw, orbit);
    expect(w.solidClearance(out, 1)).toBeGreaterThanOrEqual(CAMERA_CLEARANCE - 1e-6);
  });

  it('pulls in before a wall behind, clear of it', () => {
    const w = world(box(1, vec3(0, 3, -3.5), vec3(5, 4, 0.5)));
    const out = vec3();
    const f = thirdPersonCameraTarget(out, w, ray, head, yaw, orbit);
    expect(f).toBeLessThan(1);
    expect(out.z).toBeGreaterThan(-3);
    expect(w.solidClearance(out, 1)).toBeGreaterThanOrEqual(CAMERA_CLEARANCE - 1e-6);
  });

  it('rises over the head when backed into a wall', () => {
    // A wall 0.6 m behind and as high as a tree: no room on the camera's own line.
    const w = world(box(1, vec3(0, 3, -1.1), vec3(5, 4, 0.5)));
    const out = vec3();
    thirdPersonCameraTarget(out, w, ray, head, yaw, orbit);
    expect(out.y - head.y).toBeGreaterThan(1.5);
    expect(w.solidClearance(out, 1)).toBeGreaterThanOrEqual(CAMERA_CLEARANCE - 1e-6);
  });

  it('never eases through a wall: an eased point inside one takes the target', () => {
    const w = world(box(1, vec3(0, 2, 0), vec3(0.5, 3, 0.5)));
    const camera = vec3(-2, 2, 0);
    const target = vec3(2, 2, 0);
    easeCameraTo(camera, target, 0.5, w);
    expect(camera).toEqual(target);
    const open = vec3(-2, 2, 4);
    easeCameraTo(open, vec3(2, 2, 4), 0.5, w);
    expect(open.x).toBeCloseTo(0);
  });
});
