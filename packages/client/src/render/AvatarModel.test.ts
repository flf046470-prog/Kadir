import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SnapFlags } from '@kc/core';
import type { PlayerSnapshot } from '@kc/core';

import { Avatar } from './Avatar.js';
import type { LoadedModel } from './AssetLibrary.js';

/**
 * The model path, driven the way the game drives it.
 *
 * The browser measurement proves a model is *rendered* — draw calls per frame fall from 132 to 44
 * the moment the files exist. What it cannot show is whether the skeleton is actually moving, and
 * a rigged model that never animates is the exact failure this whole pipeline was built to end:
 * it looks perfectly fine in a screenshot and reads as a statue sliding around the map.
 *
 * So this drives a real `AnimationMixer` over a real clip and asserts the bone moved.
 */

function snapshot(over: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  // Spelled out in full rather than cast: a cast would keep compiling if the snapshot grew a
  // field the avatar reads, and the test would then be driving a shape the game never sends.
  return {
    id: 'p1',
    name: 'Tester',
    animalId: 'kangaroo',
    x: 0, y: 0, z: 0,
    vx: 0, vy: 0, vz: 0,
    yaw: 0, pitch: 0, headY: 1.32,
    flags: SnapFlags.Grounded | SnapFlags.Alive,
    role: 'runner',
    health: 100, stamina: 1, score: 0, emoteId: 0, armour: 0,
    voice: 0,
    gadgetId: '',
    hands: null,
    ...over,
  };
}

/**
 * A stand-in for a generated animal: one bone, and a clip per name the renderer asks for.
 *
 * Built by hand rather than loaded from a .glb so the test states its own inputs and does not
 * depend on the generator having been run — CI has no Blender.
 */
function fakeModel(): LoadedModel {
  const root = new THREE.Object3D();
  root.name = 'root';
  const bone = new THREE.Object3D();
  bone.name = 'spine';
  root.add(bone);
  const jaw = new THREE.Object3D();
  jaw.name = 'jaw';
  root.add(jaw);

  const clips = ['idle', 'walk', 'run', 'jump', 'hit'].map((name, i) =>
    new THREE.AnimationClip(name, 1, [
      // Each clip rotates the spine to a different, non-zero angle, so "which clip is playing"
      // is readable from the bone itself and not only from the avatar's own bookkeeping.
      new THREE.QuaternionKeyframeTrack(
        'spine.quaternion',
        [0, 0.5, 1],
        [
          0, 0, 0, 1,
          ...new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3 + i * 0.2, 0, 0)).toArray(),
          0, 0, 0, 1,
        ],
      ),
    ]),
  );
  return { scene: root, clips };
}

describe('Avatar with an authored model', () => {
  it('reports no model until one is attached', () => {
    const avatar = new Avatar('kangaroo', false);
    expect(avatar.hasModel).toBe(false);
    expect(avatar.playingClip).toBeNull();
    avatar.dispose();
  });

  it('attaches the model, hides the procedural meshes and starts idling', () => {
    const avatar = new Avatar('kangaroo', false);
    const before: THREE.Mesh[] = [];
    avatar.body.traverse((n) => {
      if ((n as THREE.Mesh).isMesh) before.push(n as THREE.Mesh);
    });
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((m) => m.visible)).toBe(true);

    avatar.attachModel(fakeModel());

    expect(avatar.hasModel).toBe(true);
    expect(avatar.playingClip).toBe('idle');
    // The procedural body must be hidden, not deleted: disposal and the cosmetic sockets still
    // walk it, and a second body showing through the model is the bug this prevents.
    expect(before.some((m) => m.visible)).toBe(false);
    avatar.dispose();
  });

  it('actually poses the skeleton — the statue test', () => {
    const avatar = new Avatar('kangaroo', false);
    const model = fakeModel();
    avatar.attachModel(model);
    const spine = model.scene.getObjectByName('spine') as THREE.Object3D;
    const rest = spine.quaternion.clone();

    // A quarter of a second of idle, in the same sized steps the render loop uses.
    for (let i = 0; i < 15; i++) avatar.update(snapshot(), 1 / 60, new THREE.Vector3(0, 0, 5));

    expect(spine.quaternion.angleTo(rest)).toBeGreaterThan(0.01);
    avatar.dispose();
  });

  it('switches clip as the player speeds up, jumps and is tagged', () => {
    const avatar = new Avatar('kangaroo', false);
    avatar.attachModel(fakeModel());
    const cam = new THREE.Vector3(0, 0, 5);

    avatar.update(snapshot(), 1 / 60, cam);
    expect(avatar.playingClip).toBe('idle');

    avatar.update(snapshot({ vx: 2 }), 1 / 60, cam);
    expect(avatar.playingClip).toBe('walk');

    avatar.update(snapshot({ vx: 6.5 }), 1 / 60, cam);
    expect(avatar.playingClip).toBe('run');

    avatar.update(snapshot({ vx: 6.5, flags: SnapFlags.Alive }), 1 / 60, cam);
    expect(avatar.playingClip).toBe('jump');

    avatar.update(snapshot({ flags: SnapFlags.Grounded | SnapFlags.Alive | SnapFlags.Staggered }), 1 / 60, cam);
    expect(avatar.playingClip).toBe('hit');
    avatar.dispose();
  });

  it('leaves the hit reaction instead of flinching forever', () => {
    // The stagger flag is a level, not an edge, and stays set on later snapshots. Timing the
    // reaction from the rising edge is what stops a stunned player looping the flinch.
    const avatar = new Avatar('kangaroo', false);
    avatar.attachModel(fakeModel());
    const cam = new THREE.Vector3(0, 0, 5);
    const tagged = snapshot({ flags: SnapFlags.Grounded | SnapFlags.Alive | SnapFlags.Staggered });

    avatar.update(tagged, 1 / 60, cam);
    expect(avatar.playingClip).toBe('hit');
    for (let i = 0; i < 60; i++) avatar.update(tagged, 1 / 60, cam);
    expect(avatar.playingClip).toBe('idle');
    avatar.dispose();
  });

  it('drives the jaw from the replicated mic level', () => {
    const avatar = new Avatar('kangaroo', false);
    const model = fakeModel();
    avatar.attachModel(model);
    const jaw = model.scene.getObjectByName('jaw') as THREE.Object3D;
    expect(jaw.rotation.x).toBe(0);

    for (let i = 0; i < 30; i++) avatar.update(snapshot({ voice: 1 }), 1 / 60, new THREE.Vector3(0, 0, 5));
    expect(jaw.rotation.x).toBeGreaterThan(0.1);
    avatar.dispose();
  });

  it('survives a model with no clips and no jaw', () => {
    // A third-party pack is not obliged to have either, and neither may throw.
    const avatar = new Avatar('kangaroo', false);
    avatar.attachModel({ scene: new THREE.Object3D(), clips: [] });
    expect(avatar.hasModel).toBe(true);
    expect(avatar.playingClip).toBeNull();
    expect(() => avatar.update(snapshot({ voice: 0.5 }), 1 / 60, new THREE.Vector3())).not.toThrow();
    avatar.dispose();
  });

  it('ignores a second model rather than stacking two bodies', () => {
    const avatar = new Avatar('kangaroo', false);
    const first = fakeModel();
    avatar.attachModel(first);
    avatar.attachModel(fakeModel());
    let roots = 0;
    avatar.body.children.forEach((c) => {
      if (c === first.scene || c.name === 'root') roots++;
    });
    expect(roots).toBe(1);
    avatar.dispose();
  });

  it('stops the mixer on disposal', () => {
    const avatar = new Avatar('kangaroo', false);
    const model = fakeModel();
    avatar.attachModel(model);
    avatar.update(snapshot(), 1 / 60, new THREE.Vector3());
    avatar.dispose();
    expect(avatar.hasModel).toBe(false);
    expect(avatar.playingClip).toBeNull();
    // A disposed avatar can still be handed a frame by a loop that has not noticed yet.
    expect(() => avatar.update(snapshot(), 1 / 60, new THREE.Vector3())).not.toThrow();
  });
});
