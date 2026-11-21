import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { LAUNCH_ANIMALS, SnapFlags } from '@kc/core';
import type { PlayerSnapshot } from '@kc/core';

import {
  Avatar,
  GAIT_FLIGHT,
  PLANTED_RUN_RAMP,
  PLANTED_WALK_FULL,
  WALK_CADENCE_MAX,
  WALK_FULL,
  WALK_START,
  measureBound,
  measureGait,
  plantedBlend,
  plantedRate,
  plantedRunStart,
} from './Avatar.js';
import type { GaitCycle } from './Avatar.js';
import type { LoadedModel } from './AssetLibrary.js';

/**
 * Every animal that does not bound walks and runs with its feet planted: the generator keys the
 * stance (`stride_gait` in `tools/blender/characters.py`) and the avatar places it by distance.
 * These hold the half with a right answer and no GPU — the blend and the clock, the strides read
 * out of the real clips, and the real animals' feet staying where they land.
 */

async function load(id: string): Promise<LoadedModel> {
  const bytes = readFileSync(new URL(`../../public/models/${id}.glb`, import.meta.url));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>((resolve, reject) =>
    new GLTFLoader().parse(buffer, '', resolve as never, reject),
  );
  return { scene: gltf.scene, clips: gltf.animations } as LoadedModel;
}

function moving(animalId: string, z: number, speed: number): PlayerSnapshot {
  return {
    id: 'p1', name: 'Tester', animalId,
    x: 0, y: 0, z,
    vx: 0, vy: 0, vz: speed,
    yaw: 0, pitch: 0, headY: 1.32,
    flags: SnapFlags.Grounded | SnapFlags.Alive,
    role: 'runner',
    health: 100, stamina: 1, score: 0, emoteId: 0, armour: 0,
    voice: 0, gadgetId: '', hands: null,
  };
}

const clip = (model: LoadedModel, name: string): THREE.AnimationClip =>
  model.clips.find((c) => c.name.toLowerCase().endsWith(name)) as THREE.AnimationClip;

describe('the planted blend and its clock', () => {
  it('walks almost at once, and turns to the run over a short ramp where the animal says', () => {
    for (const v of [0, 0.3, 0.6, 0.8, 1.5, 2.6, 3.0, 9]) {
      const w = plantedBlend(v, 1.8);
      expect(w.idle + w.walk + w.run, `${v} m/s`).toBeCloseTo(1, 9);
    }
    expect(plantedBlend(WALK_START).idle).toBe(1);
    expect(plantedBlend(PLANTED_WALK_FULL).walk).toBe(1);
    expect(plantedBlend(1.8, 1.8)).toEqual({ idle: 0, walk: 1, run: 0 });
    expect(plantedBlend(1.8 + PLANTED_RUN_RAMP / 2, 1.8).run).toBeCloseTo(0.5, 9);
    expect(plantedBlend(1.8 + PLANTED_RUN_RAMP, 1.8)).toEqual({ idle: 0, walk: 0, run: 1 });
    expect(plantedBlend(Number.NaN).idle).toBe(1);
  });

  it('breaks into a run where the walk would step faster than a walk does, within the walk band', () => {
    // A penguin's walk covers 0.18 m a stride: walking to 2.4 m/s would be fourteen steps a second.
    expect(plantedRunStart(0.18, 0.94)).toBe(PLANTED_WALK_FULL);
    expect(plantedRunStart(0.7, 1)).toBeCloseTo(WALK_CADENCE_MAX * 0.7, 9);
    expect(plantedRunStart(2, 1)).toBe(WALK_FULL);
    expect(plantedRunStart(0, 1)).toBe(WALK_FULL);
  });

  it('moves a blended planted foot back exactly as fast as the body goes', () => {
    const walk: GaitCycle = { distance: 0.7, airborne: [] };
    const run: GaitCycle = { distance: 1.6, airborne: [[0.33, 0.5], [0.83, 1]] };
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const weights = { idle: 0, walk: 1 - t, run: t };
      const v = 3;
      // While both gaits have the foot down, it is drawn back by their strides weighted as drawn.
      const rate = plantedRate(0.1, v, weights, walk, run, 1.1);
      const footBack = rate * ((1 - t) * walk.distance + t * run.distance) * 1.1;
      expect(footBack, `run weight ${t}`).toBeCloseTo(v, 9);
    }
  });

  it("goes through the run's flights by time once the run is most of what is drawn", () => {
    const walk: GaitCycle = { distance: 0.7, airborne: [] };
    const run: GaitCycle = { distance: 1.6, airborne: [[0.33, 0.5], [0.83, 1]] };
    const runOnly = { idle: 0, walk: 0, run: 1 };
    expect(plantedRate(0.4, 7, runOnly, walk, run, 1)).toBeCloseTo(0.17 / GAIT_FLIGHT, 9);
    expect(plantedRate(0.9, 2, runOnly, walk, run, 1)).toBeCloseTo(0.17 / GAIT_FLIGHT, 9);
    expect(plantedRate(0.4, 7, { idle: 0, walk: 0.7, run: 0.3 }, walk, run, 1)).toBeCloseTo(7 / (0.7 * 0.7 + 0.3 * 1.6), 9);
    expect(plantedRate(0.4, 0, runOnly, walk, run, 1)).toBe(0);
    expect(plantedRate(0.4, Number.NaN, runOnly, walk, run, 1)).toBe(0);
  });
});

/** Every shipped animal that does not bound: the bounders' runs are `Avatar.bound.test.ts`'s. */
async function walkers(): Promise<string[]> {
  const ids: string[] = [];
  for (const animal of LAUNCH_ANIMALS) {
    const model = await load(animal.id);
    if (measureBound(model.scene, clip(model, 'run')) === null) ids.push(animal.id);
  }
  return ids;
}

describe('the planted strides in the shipped models', () => {
  it('reads a stride out of every walking animal’s walk and run', async () => {
    const ids = await walkers();
    expect(ids.length).toBeGreaterThanOrEqual(13);
    for (const id of ids) {
      const model = await load(id);
      const walk = measureGait(model.scene, clip(model, 'walk'));
      const run = measureGait(model.scene, clip(model, 'run'));
      expect(walk, `${id} walk`).not.toBeNull();
      expect(run, `${id} run`).not.toBeNull();
      // A walk always has a foot down; a run has two flights a cycle; a run's stride is longer.
      expect(walk?.airborne, `${id} walk`).toEqual([]);
      expect(run?.airborne.length, `${id} run`).toBe(2);
      expect((run as GaitCycle).distance, id).toBeGreaterThan((walk as GaitCycle).distance);
    }
  });

  it('keeps every walking animal’s feet where they land, at a natural cadence, up to a sprint', async () => {
    const FEET = ['footL', 'footR', 'frontpawL', 'frontpawR', 'backpawL', 'backpawR'];
    const failures: string[] = [];
    const report: string[] = [];
    for (const id of await walkers()) {
      // 7.2 m/s is the run and 9.7 the sprint (`maxSpeed` × `sprintMultiplier`).
      for (const speed of [1.5, 2.4, 4, 7.2, 9.7]) {
        const model = await load(id);
        const runStride = (measureGait(model.scene, clip(model, 'run')) as GaitCycle).distance;
        const avatar = new Avatar(id, false);
        avatar.attachModel(model);
        const longLegged = runStride * (avatar as unknown as { bodyScale: THREE.Object3D }).bodyScale.scale.z >= 0.5;
        const feet = FEET.map((n) => avatar.group.getObjectByName(n)).filter((f): f is THREE.Object3D => !!f);
        const eye = new THREE.Vector3(0, 1.5, -6);
        // Finely: a short-legged animal's sprinting stance is a few hundredths of a second.
        const dt = speed > 7.2 ? 1 / 960 : 1 / 240;
        let z = 0;
        let footfalls = 0;
        const tracks = feet.map(() => [] as THREE.Vector3[]);
        for (let i = 0; i < 4 / dt; i++) {
          z += speed * dt;
          avatar.update(moving(id, z, speed), dt, eye);
          avatar.group.updateMatrixWorld(true);
          if (i * dt > 1) {
            feet.forEach((f, k) => tracks[k]?.push(f.getWorldPosition(new THREE.Vector3())));
            footfalls += avatar.takeFootfalls();
          } else {
            avatar.takeFootfalls();
          }
        }
        const slips: number[] = [];
        // How far a foot slides over the whole of one stance: what a viewer can actually see.
        const slides: number[] = [];
        let landings = 0;
        const touchdowns: number[] = [];
        for (const track of tracks) {
          // Down: on the lowest this foot goes, and neither coming down onto it nor lifting off it.
          // Not a share of the samples: a short-legged animal's sprinting stance is a few per cent
          // of its cycle, and a quantile then lands on the foot coming in to land.
          const ground = Math.min(...track.map((p) => p.y));
          // A stance starts when a foot that was well clear (2 cm) comes down to the ground. And it
          // lands drawn back under the body, as the bound's do, not carried in at the body's speed
          // and stopped dead: the landing is played by distance, like the stance it starts.
          let clear = false;
          for (let i = 1; i < track.length; i++) {
            const a = track[i - 1] as THREE.Vector3;
            const p = track[i] as THREE.Vector3;
            if (p.y - ground > 0.02) clear = true;
            else if (clear && p.y - ground < 0.004) {
              clear = false;
              landings++;
              touchdowns.push(Math.hypot(p.x - a.x, p.z - a.z) / dt);
            }
          }
          let slide = -1;
          for (let i = 1; i < track.length; i++) {
            const a = track[i - 1] as THREE.Vector3;
            const b = track[i] as THREE.Vector3;
            if (a.y - ground < 0.004 && b.y - ground < 0.004 && Math.abs(b.y - a.y) / dt < 0.15) {
              slips.push(Math.hypot(b.x - a.x, b.z - a.z) / dt);
              slide = Math.max(0, slide) + Math.hypot(b.x - a.x, b.z - a.z);
            } else if (slide >= 0) {
              slides.push(slide);
              slide = -1;
            }
          }
        }
        slides.sort((a, b) => a - b);
        const perStance = slides[slides.length >> 1] ?? Number.NaN;
        slips.sort((a, b) => a - b);
        const median = slips[slips.length >> 1] ?? Number.NaN;
        // Two footfalls a stride, the feet of a pair landing together counted once.
        const strides = footfalls / 2 / 3;
        if (!(slips.length > 10)) failures.push(`${id} at ${speed} m/s: no foot is ever down`);
        // The sine cycles these replaced moved the down foot at about the body's own speed. At a
        // sprint a short-legged animal's stance is over in 16 ms, and its rate is the wrong
        // question: measured 0.12–0.23 m/s, which is 3–4 mm in a stance.
        if (speed <= 7.2 && !(median < 0.1)) failures.push(`${id} at ${speed} m/s: median slip ${median.toFixed(2)} m/s`);
        if (!(perStance < 0.01)) failures.push(`${id} at ${speed} m/s: a stance slides ${(perStance * 1000).toFixed(1)} mm`);
        // Stances per foot per second, walking or running: a penguin walked to 2.4 m/s took fourteen.
        const stepping = landings / feet.length / 3;
        if (!(stepping < 4.5)) failures.push(`${id} at ${speed} m/s: ${stepping.toFixed(1)} strides a second`);
        touchdowns.sort((a, b) => a - b);
        const touchdown = touchdowns[touchdowns.length >> 1] ?? Number.NaN;
        // Landing drawn back under the body, as the bound's are (median over the run's landings). Not
        // asked of a short-legged animal (a run stride under half a metre): at a sprint its swing
        // is over in a few hundredths of a second, too short to draw a foot back in, and a penguin
        // lands at 11 m/s whichever way the landing is played. That is the next job, not this one.
        if (speed >= 7.2 && longLegged && !(touchdown < 0.7 * speed)) failures.push(`${id} at ${speed} m/s: lands at ${touchdown.toFixed(1)} m/s`);
        if (speed >= 4 && !(strides > 1)) failures.push(`${id} at ${speed} m/s: ${strides.toFixed(1)} footfalls a stride, so its run is silent`);
        report.push(`${id} ${speed}: ${median.toFixed(2)} m/s, ${(perStance * 1000).toFixed(1)} mm a stance, ${stepping.toFixed(1)} strides/s, ${strides.toFixed(1)} footfall pairs/s, lands ${touchdown.toFixed(1)} m/s`);
        avatar.dispose();
      }
    }
    if (process.env.KC_GAIT_REPORT) console.log(report.join('\n'));
    expect(failures).toEqual([]);
  }, 300_000);
});
