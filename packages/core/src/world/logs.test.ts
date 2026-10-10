import { describe, expect, it } from 'vitest';

import { Rand } from '../math/rand.js';
import { vec3 } from '../math/vec3.js';
import { heightfieldHeight } from '../physics/heightfield.js';
import type { BoxCollider, Collider, HeightfieldCollider } from '../physics/types.js';
import { makeRaycastResult } from '../physics/types.js';
import { PhysicsWorld } from '../physics/world.js';
import { LOG_HALF_LENGTH, LOG_RADIUS, LevelBuilder } from './builder.js';
import { buildLevel, listLevels } from './registry.js';
import './index.js';

const isLog = (c: Collider): c is BoxCollider => c.kind === 'box' && c.drawAs === 'log';

/** A 40 m square of terrain shaped by `height`, flat for the outer clearance band. */
function ground(height: (x: number, z: number) => number): { b: LevelBuilder; hf: HeightfieldCollider } {
  const b = new LevelBuilder(new Rand(1));
  const hf = b.terrain({ minX: -20, maxX: 20, minZ: -20, maxZ: 20, cellSize: 1, base: 0, bottom: -4, surface: 'dirt' });
  b.sculpt(hf, (x, z) => height(x, z));
  return { b, hf };
}

/** Points on the ground under a log: along its axis and across its width. */
function footprint(log: BoxCollider): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const cos = Math.cos(log.yaw);
  const sin = Math.sin(log.yaw);
  for (let i = 0; i <= 16; i++) {
    const t = (i / 16 - 0.5) * 2 * log.half.x;
    for (const u of [-0.8, 0, 0.8]) {
      out.push({ x: log.center.x + cos * t + sin * u * log.half.z, z: log.center.z - sin * t + cos * u * log.half.z });
    }
  }
  return out;
}

describe('LevelBuilder.fallenLog', () => {
  it('lies down on flat ground, as a box the renderer draws as a log', () => {
    const { b } = ground(() => 0);
    expect(b.fallenLog(0, 0, 0, 0.3, LOG_HALF_LENGTH, LOG_RADIUS)).toBe(true);
    const log = b.colliders.find(isLog);
    expect(log).toBeDefined();
    expect(log!.half).toEqual({ x: LOG_HALF_LENGTH, y: LOG_RADIUS, z: LOG_RADIUS });
    expect(log!.center.y - log!.half.y).toBeCloseTo(0, 6);
    expect(log!.yaw).toBeCloseTo(0.3, 6);
  });

  it('turns to lie along a slope rather than across it, and rests on its lowest ground', () => {
    // Rising along x: a log lying along x would have one end 0.4 m in the air.
    const { b, hf } = ground((x) => 0.1 * x);
    expect(b.fallenLog(0, 0, 0, 0, LOG_HALF_LENGTH, LOG_RADIUS)).toBe(true);
    const log = b.colliders.find(isLog)!;
    expect(Math.abs(Math.cos(log.yaw))).toBeLessThan(1e-6);
    const bottom = log.center.y - log.half.y;
    for (const p of footprint(log)) {
      const h = heightfieldHeight(hf, p.x, p.z);
      // Never hanging over the ground, and never sunk into it by more than a third of its radius.
      expect(h).toBeGreaterThanOrEqual(bottom - 1e-6);
      expect(h - bottom).toBeLessThanOrEqual(LOG_RADIUS / 3 + 1e-6);
    }
  });

  it('refuses ground too steep to lie on in any direction', () => {
    const { b } = ground((x, z) => 0.3 * x + 0.3 * z);
    const before = b.colliders.length;
    expect(b.fallenLog(0, 0, 0, 0, LOG_HALF_LENGTH, LOG_RADIUS)).toBe(false);
    expect(b.colliders.length).toBe(before);
  });

  it('refuses to overhang the edge of its floor, or to lie in water', () => {
    const b = new LevelBuilder(new Rand(1));
    b.box(vec3(0, -0.5, 0), vec3(3, 0.5, 3), 'dirt');
    expect(b.fallenLog(2.5, 0, 2.5, 0, LOG_HALF_LENGTH, LOG_RADIUS)).toBe(false);
    expect(b.fallenLog(0, 0, 0, 0, LOG_HALF_LENGTH, LOG_RADIUS)).toBe(true);

    const wet = new LevelBuilder(new Rand(1));
    wet.box(vec3(0, -0.5, 0), vec3(6, 0.5, 6), 'water');
    expect(wet.fallenLog(0, 0, 0, 0, LOG_HALF_LENGTH, LOG_RADIUS)).toBe(false);
  });

  it('refuses to run through a trunk, a rock or another log', () => {
    const trunk = ground(() => 0).b;
    trunk.cylinder(vec3(0, 5, 0), 0.5, 5, 'wood');
    expect(trunk.fallenLog(0, 0, 0, 0, LOG_HALF_LENGTH, LOG_RADIUS)).toBe(false);

    const rock = ground(() => 0).b;
    rock.sphere(vec3(0, 0.4, 0), 0.8, 'rock');
    expect(rock.fallenLog(0, 0, 0, 0, LOG_HALF_LENGTH, LOG_RADIUS)).toBe(false);

    const crossed = ground(() => 0).b;
    expect(crossed.fallenLog(0, 0, 0, 0, LOG_HALF_LENGTH, LOG_RADIUS)).toBe(true);
    // A second log across the first, at every turn it may try: each one crosses it.
    expect(crossed.fallenLog(0, 0, 0, Math.PI / 2, LOG_HALF_LENGTH, LOG_RADIUS)).toBe(false);
    expect(crossed.colliders.filter(isLog)).toHaveLength(1);
  });

  it("keeps clear of a spawn's pad, and is laid when the spawn is elsewhere", () => {
    const near = ground(() => 0).b;
    near.spawn(vec3(0, 0.5, 2.2), 0, 'test', 'runner');
    expect(near.fallenLog(0, 0, 0, 0, LOG_HALF_LENGTH, LOG_RADIUS)).toBe(false);

    const far = ground(() => 0).b;
    far.spawn(vec3(10, 0.5, 10), 0, 'test', 'runner');
    expect(far.fallenLog(0, 0, 0, 0, LOG_HALF_LENGTH, LOG_RADIUS)).toBe(true);
  });
});

describe('fallen logs on the shipped maps', () => {
  it('every log lies down and rests on the ground under it, on every map', () => {
    const ray = makeRaycastResult();
    const down = vec3(0, -1, 0);
    let total = 0;
    for (const { id } of listLevels()) {
      const level = buildLevel(id);
      const logs = level.colliders.filter(isLog);
      total += logs.length;
      for (const log of logs) {
        // Long and round: a log, not a post — which is what the jungle's six used to collide as.
        expect(log.half.x, `${id} log ${log.id}`).toBeGreaterThanOrEqual(3 * log.half.y);
        expect(log.half.z).toBe(log.half.y);
        const others = new PhysicsWorld(level.colliders.filter((c) => c !== log));
        const bottom = log.center.y - log.half.y;
        for (const p of footprint(log)) {
          others.raycast(ray, vec3(p.x, bottom + log.half.y * 2 + 0.3, p.z), down, log.half.y * 2 + 2);
          expect(ray.hit, `${id} log ${log.id} at ${p.x.toFixed(1)},${p.z.toFixed(1)}`).toBe(true);
          // Not visibly in the air anywhere: the builder samples, and terrain can dip between samples.
          expect(ray.point.y, `${id} log ${log.id}`).toBeGreaterThanOrEqual(bottom - 0.01);
          expect(ray.point.y - bottom, `${id} log ${log.id}`).toBeLessThanOrEqual(log.half.y / 3 + 1e-3);
        }
      }
    }
    expect(total).toBeGreaterThan(30);
  });

  it("the jungle's six district logs are all laid, and the outback's fallen gum is its old box", () => {
    const jungle = buildLevel('jungle-world').colliders.filter(isLog);
    expect(jungle.filter((c) => c.half.x === LOG_HALF_LENGTH && c.half.y === LOG_RADIUS)).toHaveLength(6);
    const gum = buildLevel('outback-station').colliders.filter(isLog).filter((c) => c.half.x === 7);
    expect(gum).toHaveLength(1);
    expect(gum[0]!.center).toEqual({ x: 20, y: 1.1, z: 24 });
    expect(gum[0]!.half).toEqual({ x: 7, y: 1.1, z: 1.1 });
  });
});
