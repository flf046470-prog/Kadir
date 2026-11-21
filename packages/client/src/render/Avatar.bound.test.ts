import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { SnapFlags } from '@kc/core';
import type { PlayerSnapshot } from '@kc/core';

import { Avatar, BOUND_FLIGHT, BOUND_STANCE, advanceBound, measureBound } from './Avatar.js';
import type { LoadedModel } from './AssetLibrary.js';

/**
 * A hopper's run is a bound: feet planted while the body passes over them, then a flight. These
 * hold the half that has a right answer without a GPU — the clock, the stride read out of the real
 * clip, and the real kangaroo's feet staying where they land at every running speed.
 */

async function load(id: string): Promise<LoadedModel> {
  const bytes = readFileSync(new URL(`../../public/models/${id}.glb`, import.meta.url));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>((resolve, reject) =>
    new GLTFLoader().parse(buffer, '', resolve as never, reject),
  );
  return { scene: gltf.scene, clips: gltf.animations } as LoadedModel;
}

function running(z: number, speed: number): PlayerSnapshot {
  return {
    id: 'p1', name: 'Tester', animalId: 'kangaroo',
    x: 0, y: 0, z,
    vx: 0, vy: 0, vz: speed,
    yaw: 0, pitch: 0, headY: 1.32,
    flags: SnapFlags.Grounded | SnapFlags.Alive,
    role: 'runner',
    health: 100, stamina: 1, score: 0, emoteId: 0, armour: 0,
    voice: 0, gadgetId: '', hands: null,
  };
}

describe('advanceBound', () => {
  const dt = 1 / 240;
  it('goes through the stance by distance: one stride of travel at any speed', () => {
    for (const speed of [1.5, 4, 7.2, 11]) {
      let phase = 0;
      let travelled = 0;
      while (phase < BOUND_STANCE) {
        phase = advanceBound(phase, speed, dt, 0.6).phase;
        travelled += speed * dt;
      }
      expect(travelled, `${speed} m/s`).toBeCloseTo(0.6, 1);
      expect(Math.abs(travelled - 0.6)).toBeLessThan(speed * dt + 1e-9);
    }
  });

  it('goes through the flight by time, as a fall does, and lands once', () => {
    for (const speed of [1.5, 11]) {
      let phase = BOUND_STANCE;
      let time = 0;
      let touchdowns = 0;
      while (touchdowns === 0) {
        const step = advanceBound(phase, speed, dt, 0.6);
        phase = step.phase;
        time += dt;
        if (step.touchdown) touchdowns++;
      }
      expect(time, `${speed} m/s`).toBeCloseTo(BOUND_FLIGHT, 2);
      expect(phase).toBe(0);
    }
  });

  it('holds a stance when standing, finishes a flight, and survives bad input', () => {
    expect(advanceBound(0.1, 0, 1 / 60, 0.6)).toEqual({ phase: 0.1, touchdown: false });
    let phase = 0.6;
    let landed = false;
    for (let i = 0; i < 60 && !landed; i++) ({ phase, touchdown: landed } = advanceBound(phase, 0, 1 / 60, 0.6));
    expect(landed).toBe(true);
    expect(advanceBound(Number.NaN, 5, 1 / 60, 0.6).phase).toBeGreaterThan(0);
    expect(advanceBound(0.1, 5, 1 / 60, 0).phase).toBe(0.1);
  });
});

describe('the bound in the shipped models', () => {
  it('reads each stride out of the clip, and no stride out of a run that is not a bound', async () => {
    const stride = async (id: string): Promise<number | null> => {
      const model = await load(id);
      const run = model.clips.find((c) => c.name.toLowerCase().endsWith('run'));
      return measureBound(model.scene, run as THREE.AnimationClip);
    };
    // The generator shortens the 0.6 m stride to what each rig's legs reach on every frame.
    const kangaroo = await stride('kangaroo');
    expect(kangaroo).toBeGreaterThanOrEqual(0.45);
    expect(kangaroo).toBeLessThanOrEqual(0.6 + 1e-6);
    expect(await stride('frog')).toBeGreaterThan(0.2);
    // The raptor stands mid-stride with one foot off the ground and cannot bound; nor can a wolf.
    expect(await stride('raptor')).toBeNull();
    expect(await stride('wolf')).toBeNull();
  });

  it("keeps the kangaroo's feet where they land, at every running speed, and lifts them clear between", async () => {
    const model = await load('kangaroo');
    const stride = measureBound(model.scene, model.clips.find((c) => c.name.toLowerCase().endsWith('run')) as THREE.AnimationClip) as number;
    for (const speed of [3, 5, 7.2]) {
      const avatar = new Avatar('kangaroo', false);
      avatar.attachModel(await load('kangaroo'));
      const eye = new THREE.Vector3(0, 1.5, -6);
      const foot = avatar.group.getObjectByName('footL') as THREE.Object3D;
      expect(foot).toBeDefined();
      const dt = 1 / 120;
      let z = 0;
      const track: THREE.Vector3[] = [];
      let footfalls = 0;
      for (let i = 0; i < 4 / dt; i++) {
        z += speed * dt;
        avatar.update(running(z, speed), dt, eye);
        avatar.group.updateMatrixWorld(true);
        footfalls += avatar.takeFootfalls();
        if (i * dt > 1) track.push(foot.getWorldPosition(new THREE.Vector3()));
      }
      const lowest = Math.min(...track.map((p) => p.y));
      const highest = Math.max(...track.map((p) => p.y));
      // Slip: how fast the ankle moves over the ground while it rests on it — down, and neither
      // coming down onto it nor lifting off it.
      const slips: number[] = [];
      for (let i = 1; i < track.length; i++) {
        const a = track[i - 1] as THREE.Vector3;
        const b = track[i] as THREE.Vector3;
        if (a.y - lowest < 0.005 && b.y - lowest < 0.005 && Math.abs(b.y - a.y) / dt < 0.15) {
          slips.push(Math.hypot(b.x - a.x, b.z - a.z) / dt);
        }
      }
      // And landing: the foot is drawn back under the body before it meets the ground, rather than
      // carried in at the body's full speed and stopped dead. Measured 0.62 / 1.38 / 4.46 m/s at
      // 3 / 5 / 7.2; without the draw-back, 3.43 / 5.45 / 7.45 — the speed of the body.
      for (let i = 1; i < track.length; i++) {
        const a = track[i - 1] as THREE.Vector3;
        const b = track[i] as THREE.Vector3;
        if (a.y - lowest >= 0.005 && b.y - lowest < 0.005) {
          expect(Math.hypot(b.x - a.x, b.z - a.z) / dt, `${speed} m/s: the foot lands`).toBeLessThan(0.7 * speed);
        }
      }
      slips.sort((a, b) => a - b);
      expect(slips.length, `${speed} m/s: the foot is down at all`).toBeGreaterThan(10);
      // Measured 0.01–0.02 m/s on the median and 0.06 at worst; the gait this replaced moved the
      // down foot at 7.2–13.8 m/s at 7.2 m/s.
      expect(slips[slips.length >> 1] as number, `${speed} m/s median slip`).toBeLessThan(0.1);
      expect(slips[Math.floor(slips.length * 0.9)] as number, `${speed} m/s slip, 90th percentile`).toBeLessThan(0.5);
      expect(highest - lowest, `${speed} m/s: the feet leave the ground`).toBeGreaterThan(0.25);
      // A stance by distance and a flight by time: 2.4 hops a second at 3 m/s, 3.1 at 7.2.
      const expected = 4 / (stride / speed + BOUND_FLIGHT);
      expect(Math.abs(footfalls - expected), `${speed} m/s: ${footfalls} footfalls`).toBeLessThanOrEqual(1.5);
      avatar.dispose();
    }
  });
});
