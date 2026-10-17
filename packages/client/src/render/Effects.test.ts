import { describe, expect, it } from 'vitest';
import type { SimEvent } from '@kc/core';
import {
  FX_RANGE,
  LAND_FX_MIN_SPEED,
  ParticlePool,
  WorldEffects,
  fadeAt,
  recipeFor,
  seededRandom,
  type ParticleSpec,
} from './Effects.js';

function event(partial: Partial<SimEvent> & Pick<SimEvent, 'type'>): SimEvent {
  return { playerId: 'p1', position: { x: 0, y: 0, z: 0 }, magnitude: 0, tick: 1, ...partial };
}

function spec(partial: Partial<ParticleSpec> = {}): ParticleSpec {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, size: 0.2, grow: 0, alpha: 1, color: 0xffffff, gravity: 0, drag: 0, ...partial };
}

describe('ParticlePool', () => {
  it('keeps live particles packed and drops the dead', () => {
    const pool = new ParticlePool(8);
    pool.spawn(spec({ life: 0.1, x: 1 }));
    pool.spawn(spec({ life: 1, x: 2 }));
    pool.spawn(spec({ life: 0.1, x: 3 }));
    expect(pool.count).toBe(3);
    pool.update(0.2);
    expect(pool.count).toBe(1);
    // The survivor was swapped into slot 0, so the draw range [0, count) is exactly the live set.
    expect(pool.position[0]).toBeCloseTo(2);
  });

  it('refuses new particles when full rather than stealing a live one', () => {
    const pool = new ParticlePool(4);
    for (let i = 0; i < 6; i++) pool.spawn(spec({ x: i }));
    expect(pool.count).toBe(4);
    expect(Array.from(pool.position.filter((_, i) => i % 3 === 0))).toEqual([0, 1, 2, 3]);
  });

  it('integrates gravity and drag, and grows size over life', () => {
    const pool = new ParticlePool(2);
    pool.spawn(spec({ vx: 4, gravity: 10, drag: 1, grow: 1, size: 0.1, life: 2 }));
    for (let i = 0; i < 30; i++) pool.update(1 / 60);
    // Half a second: falling, slowed horizontally, and bigger.
    expect(pool.position[1]).toBeLessThan(-1);
    expect(pool.position[0]).toBeLessThan(4 * 0.5);
    expect(pool.position[0]).toBeGreaterThan(1);
    expect(pool.size[0]).toBeCloseTo(0.6, 1);
  });

  it('fades in, then out, and is never visible at birth or death', () => {
    expect(fadeAt(0)).toBe(0);
    expect(fadeAt(1)).toBe(0);
    expect(fadeAt(0.12)).toBeCloseTo(1);
    expect(fadeAt(0.5)).toBeGreaterThan(fadeAt(0.8));
  });
});

describe('recipeFor', () => {
  const land = (material: SimEvent['material'], magnitude: number): ReturnType<typeof recipeFor> =>
    recipeFor(event({ type: 'land', material, magnitude }), seededRandom(7));

  it('kicks up nothing for a step, something for a hop, more for a crash', () => {
    expect(land('dirt', LAND_FX_MIN_SPEED - 0.1).soft).toHaveLength(0);
    const hop = land('dirt', 6).soft.length;
    const crash = land('dirt', 18).soft.length;
    expect(hop).toBeGreaterThan(4);
    expect(crash).toBeGreaterThan(hop);
  });

  it('makes each ground look like itself', () => {
    const biggest = (list: ParticleSpec[]): number => Math.max(...list.map((p) => p.size));
    const snow = land('snow', 8).soft;
    const rock = land('rock', 8).soft;
    const red = land('redEarth', 8).soft;
    const water = land('water', 8).soft;
    // Snow is a big, dense white cloud that hangs; rock is mostly grit that drops.
    expect(snow.length).toBeGreaterThan(rock.length);
    expect(biggest(snow)).toBeGreaterThan(biggest(rock) * 1.2);
    expect(Math.min(...snow.map((p) => p.gravity))).toBeLessThan(1);
    expect(rock.filter((p) => p.gravity > 9).length).toBeGreaterThan(rock.length / 2);
    // Red earth's dust is red: more red than green, well beyond the jitter.
    const puff = red[0]!;
    expect((puff.color >> 16) & 0xff).toBeGreaterThan(((puff.color >> 8) & 0xff) * 1.15);
    // Water throws droplets that go up and come straight back down.
    expect(water.some((p) => p.vy > 2 && p.gravity > 9)).toBe(true);
  });

  it('draws dust paler than the ground it comes off', async () => {
    // Measured: a cloud coloured like its surface vanished into it in a render of the outback.
    const { MATERIAL_COLORS } = await import('./LevelRenderer.js');
    const { Color } = await import('three');
    const lightness = (hex: number): number => {
      const hsl = { h: 0, s: 0, l: 0 };
      new Color(hex).getHSL(hsl);
      return hsl.l;
    };
    for (const material of ['dirt', 'redEarth', 'sand', 'rock', 'redRock'] as const) {
      const puff = land(material, 8).soft.find((p) => p.size > 0.2)!;
      expect(lightness(puff.color), material).toBeGreaterThan(lightness(MATERIAL_COLORS[material]) + 0.08);
    }
  });

  it('throws metal sparks as light, not dust', () => {
    const metal = land('metal', 8);
    expect(metal.soft).toHaveLength(0);
    expect(metal.glow.length).toBeGreaterThan(0);
  });

  it('takes a jump off the ground the player last landed on', () => {
    const snow = recipeFor(event({ type: 'jump', magnitude: 0 }), seededRandom(3), 'snow').soft;
    const dirt = recipeFor(event({ type: 'jump', magnitude: 0 }), seededRandom(3), 'dirt').soft;
    expect(snow.length).toBeGreaterThan(0);
    expect(snow[0]!.color).not.toBe(dirt[0]!.color);
    expect(recipeFor(event({ type: 'jump', data: 'wall', magnitude: 1 }), seededRandom(3)).soft).toHaveLength(0);
  });

  it('bursts on a tag, a punch, a freeze and a respawn, above the ground', () => {
    for (const e of [
      event({ type: 'tag', magnitude: 1 }),
      event({ type: 'punchHit', magnitude: 12, position: { x: 0, y: 1.2, z: 0 } }),
      event({ type: 'status', data: 'frozen', magnitude: 3 }),
      event({ type: 'respawn', data: 'fall' }),
    ]) {
      const r = recipeFor(e, seededRandom(1));
      const all = [...r.soft, ...r.glow];
      expect(all.length, e.type).toBeGreaterThan(5);
      expect(Math.max(...all.map((p) => p.y)), e.type).toBeGreaterThan(0.3);
    }
  });
});

describe('WorldEffects', () => {
  it('draws one burst for a projectile that reports its hit twice', () => {
    const fx = new WorldEffects(1, 5);
    const hit = { type: 'gadgetHit' as const, playerId: 'shooter', otherId: 'victim', data: 'freeze_gun', tick: 40 };
    fx.handleEvent(event({ ...hit, magnitude: 1 }));
    const once = fx.glow.count;
    fx.handleEvent(event({ ...hit, magnitude: 20, position: { x: 0.4, y: 0, z: 0 } }));
    expect(once).toBeGreaterThan(0);
    expect(fx.glow.count).toBe(once);
    // The next tick is a new hit.
    fx.handleEvent(event({ ...hit, tick: 41, magnitude: 1 }));
    expect(fx.glow.count).toBeGreaterThan(once);
    fx.dispose();
  });

  it('spawns nothing out of range of the camera', () => {
    const fx = new WorldEffects(1, 5);
    const camera = { x: 0, y: 1.6, z: 0 };
    fx.handleEvent(event({ type: 'land', material: 'dirt', magnitude: 10, position: { x: FX_RANGE + 5, y: 0, z: 0 } }), camera);
    expect(fx.soft.count).toBe(0);
    fx.handleEvent(event({ type: 'land', material: 'dirt', magnitude: 10, position: { x: 10, y: 0, z: 0 } }), camera);
    expect(fx.soft.count).toBeGreaterThan(0);
    fx.dispose();
  });

  it('draws exactly the live particles, and clears between maps', () => {
    const fx = new WorldEffects(1, 5);
    fx.handleEvent(event({ type: 'land', material: 'sand', magnitude: 12 }));
    fx.update(1 / 60);
    const points = fx.group.children as unknown as { geometry: { drawRange: { count: number } } }[];
    expect(points[0]!.geometry.drawRange.count).toBe(fx.soft.count);
    expect(fx.soft.count).toBeGreaterThan(0);
    for (let i = 0; i < 240; i++) fx.update(1 / 60);
    expect(fx.soft.count).toBe(0);
    expect(points[0]!.geometry.drawRange.count).toBe(0);
    fx.handleEvent(event({ type: 'tag', magnitude: 1 }));
    fx.clear();
    expect(fx.soft.count + fx.glow.count).toBe(0);
    fx.dispose();
  });

  it('thins bursts on a reduced budget', () => {
    const full = new WorldEffects(1, 9);
    const thin = new WorldEffects(0.5, 9);
    for (let i = 0; i < 10; i++) {
      const e = event({ type: 'land', material: 'dirt', magnitude: 10, tick: i });
      full.handleEvent(e);
      thin.handleEvent(e);
    }
    expect(thin.soft.count).toBeLessThan(full.soft.count * 0.75);
    expect(thin.soft.count).toBeGreaterThan(0);
    full.dispose();
    thin.dispose();
  });
});
