import { describe, expect, it } from 'vitest';
import { PhysicsWorld } from './world.js';
import { DEFAULT_MOVE_PARAMS, makeMoveResult, moveCapsule } from './character.js';
import { makeRaycastResult, makeSurfaceQueryResult, DEFAULT_SURFACE, SurfaceFlags } from './types.js';
import type { Collider } from './types.js';
import { vec3 } from '../math/vec3.js';

function box(x: number, y: number, z: number, hx: number, hy: number, hz: number, id: number, yaw = 0): Collider {
  return { kind: 'box', id, center: vec3(x, y, z), half: vec3(hx, hy, hz), yaw, surface: { ...DEFAULT_SURFACE } };
}

function makeWorld(): PhysicsWorld {
  return new PhysicsWorld([
    box(0, -1, 0, 50, 1, 50, 0), // ground, top at y=0
    box(10, 2, 0, 0.5, 2, 10, 1), // wall at x=10
    box(-5, 0.15, 0, 2, 0.15, 2, 2), // 0.3m tall step, top at y=0.3
  ]);
}

const SHAPE = { radius: 0.35, height: 1.4 };

describe('PhysicsWorld', () => {
  it('indexes colliders into grid cells covering the level bounds', () => {
    const world = makeWorld();
    expect(world.cellCount).toBeGreaterThan(0);
    expect(world.levelBounds.minX).toBeLessThanOrEqual(-50);
    expect(world.levelBounds.maxX).toBeGreaterThanOrEqual(10);
  });

  it('finds the nearest surface point', () => {
    const world = makeWorld();
    const res = world.closestSurface(makeSurfaceQueryResult(), vec3(0, 1, 0), 3);
    expect(res.hit).toBe(true);
    expect(res.point.y).toBeCloseTo(0, 5);
    expect(res.normal.y).toBeCloseTo(1, 5);
    expect(res.distance).toBeCloseTo(1, 5);
  });

  it('returns no surface beyond max distance', () => {
    const world = makeWorld();
    const res = world.closestSurface(makeSurfaceQueryResult(), vec3(0, 40, 0), 3);
    expect(res.hit).toBe(false);
    expect(res.colliderIndex).toBe(-1);
  });

  it('raycasts downward onto the ground', () => {
    const world = makeWorld();
    const res = world.raycast(makeRaycastResult(), vec3(0, 5, 0), vec3(0, -1, 0), 20);
    expect(res.hit).toBe(true);
    expect(res.distance).toBeCloseTo(5, 4);
    expect(res.normal.y).toBeCloseTo(1, 4);
  });

  it('honours flag filters when raycasting', () => {
    const world = makeWorld();
    const res = world.raycast(makeRaycastResult(), vec3(0, 5, 0), vec3(0, -1, 0), 20, {
      rejectFlags: SurfaceFlags.Climbable,
    });
    expect(res.hit).toBe(false);
  });
});

describe('moveCapsule', () => {
  it('falls under gravity and settles on the ground', () => {
    const world = makeWorld();
    const pos = vec3(0, 5, 0);
    const vel = vec3(0, 0, 0);
    const out = makeMoveResult();
    let grounded = false;
    for (let i = 0; i < 180; i++) {
      vel.y -= 20 * (1 / 60);
      moveCapsule(world, pos, vel, SHAPE, 1 / 60, DEFAULT_MOVE_PARAMS, out, grounded);
      grounded = out.grounded;
    }
    expect(grounded).toBe(true);
    expect(pos.y).toBeGreaterThan(-0.05);
    expect(pos.y).toBeLessThan(0.05);
    expect(Math.abs(vel.y)).toBeLessThan(1);
  });

  it('slides along a wall instead of passing through it', () => {
    const world = makeWorld();
    const pos = vec3(5, 0, 0);
    const vel = vec3(0, 0, 0);
    const out = makeMoveResult();
    let grounded = true;
    for (let i = 0; i < 120; i++) {
      vel.x = 12;
      vel.z = 3;
      vel.y -= 20 * (1 / 60);
      moveCapsule(world, pos, vel, SHAPE, 1 / 60, DEFAULT_MOVE_PARAMS, out, grounded);
      grounded = out.grounded;
    }
    expect(pos.x).toBeLessThan(9.6); // stopped by the wall face at x = 9.5
    expect(out.touchedWall).toBe(true);
    expect(pos.z).toBeGreaterThan(4); // still slid along it
  });

  it('does not tunnel through the ground at high speed', () => {
    const world = makeWorld();
    const pos = vec3(0, 3, 0);
    const vel = vec3(0, -90, 0);
    const out = makeMoveResult();
    let impact = 0;
    for (let i = 0; i < 10 && !out.grounded; i++) {
      moveCapsule(world, pos, vel, SHAPE, 1 / 60, DEFAULT_MOVE_PARAMS, out, false);
      impact = Math.max(impact, out.landImpactSpeed);
      expect(pos.y).toBeGreaterThan(-0.1); // never below the ground surface
    }
    expect(out.grounded).toBe(true);
    expect(impact).toBeGreaterThan(10);
  });

  it('steps up a small ledge while grounded', () => {
    const world = makeWorld();
    const pos = vec3(-1.5, 0, 0);
    const vel = vec3(0, 0, 0);
    const out = makeMoveResult();
    let grounded = true;
    for (let i = 0; i < 45; i++) {
      vel.x = -4;
      vel.y -= 20 * (1 / 60);
      moveCapsule(world, pos, vel, SHAPE, 1 / 60, DEFAULT_MOVE_PARAMS, out, grounded);
      grounded = out.grounded;
    }
    expect(pos.x).toBeLessThan(-4); // walked onto the step footprint (x in -7..-3)
    expect(pos.y).toBeGreaterThan(0.25); // and is standing on top of it
  });

  it('reports the ceiling when hitting overhead geometry', () => {
    const world = new PhysicsWorld([box(0, -1, 0, 20, 1, 20, 0), box(0, 3, 0, 5, 0.5, 5, 1)]);
    const pos = vec3(0, 0, 0);
    const vel = vec3(0, 14, 0);
    const out = makeMoveResult();
    let touched = false;
    for (let i = 0; i < 30 && !touched; i++) {
      vel.y -= 20 * (1 / 60);
      moveCapsule(world, pos, vel, SHAPE, 1 / 60, DEFAULT_MOVE_PARAMS, out, false);
      touched = out.touchedCeiling;
    }
    expect(touched).toBe(true);
    expect(pos.y).toBeLessThan(2.5 - SHAPE.height + 0.1);
  });
});
