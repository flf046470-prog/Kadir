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
/**
 * The jaw's rest orientation in every generated animal, read out of the shipped files.
 *
 * Measured, not chosen: all seven .glb files carry a non-identity jaw rest rotation — the upright,
 * hopper and waddler plans at (-0.74, 0, 0, 0.6726) and the quadrupeds at (-0.3126, 0, 0, 0.9499),
 * which is -95.5 and -36.4 degrees. A fake jaw parked at identity cannot show a lip sync that
 * *replaces* the rest pose rather than opening from it, and that is precisely the bug that shipped.
 */
const JAW_REST_X = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(-0.74, 0, 0, 0.6726)).x;

function fakeModel(): LoadedModel {
  const root = new THREE.Object3D();
  root.name = 'root';
  const bone = new THREE.Object3D();
  bone.name = 'spine';
  root.add(bone);
  const jaw = new THREE.Object3D();
  jaw.name = 'jaw';
  jaw.rotation.x = JAW_REST_X;
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
      /**
       * The jaw, keyed by the clip — because that is what the real files do.
       *
       * Measured across all seven generated animals: every one of the five clips keys the jaw's
       * translation, rotation *and* scale, even though the generator never poses it. Blender's
       * exporter writes a channel for every bone in the armature, so the rest pose ships as
       * constant keys on a track that runs every frame.
       *
       * That matters because it puts the AnimationMixer and the lip sync on the same property.
       * Without this track the fake model was quieter than any real one and the jaw test passed
       * against a bone nothing else was writing to — it could not have caught a mixer that
       * overwrites the mouth, which is the only way lip sync actually breaks here.
       */
      new THREE.QuaternionKeyframeTrack(
        'jaw.quaternion',
        [0, 1],
        [-0.74, 0, 0, 0.6726, -0.74, 0, 0, 0.6726],
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

  /** How far the jaw has swung from where the rig left it, in degrees. */
  const swungFromRest = (jaw: THREE.Object3D): number =>
    (new THREE.Quaternion().setFromEuler(new THREE.Euler(JAW_REST_X, 0, 0)).angleTo(jaw.quaternion) * 180) / Math.PI;

  it('leaves the jaw on its rig pose while nobody is speaking', () => {
    /**
     * The bug this exists for: lip sync wrote `jaw.rotation.x = mouthOpen * 0.5`, an absolute
     * angle in the parent's frame. With `mouthOpen` at zero that is not "do nothing", it is
     * "force the jaw to zero" — and the rig's rest pose is -95.5 degrees. So every animal in the
     * game stood with its jaw dislocated by 95.5 degrees, in silence, on every frame, whether or
     * not voice chat was even enabled. Measured before the fix: drift 95.5 degrees at voice 0 and
     * 124.1 degrees at voice 1.
     */
    const avatar = new Avatar('kangaroo', false);
    const model = fakeModel();
    avatar.attachModel(model);
    const jaw = model.scene.getObjectByName('jaw') as THREE.Object3D;

    for (let i = 0; i < 30; i++) avatar.update(snapshot({ voice: 0 }), 1 / 60, new THREE.Vector3(0, 0, 5));
    expect(swungFromRest(jaw)).toBeLessThan(1);
    avatar.dispose();
  });

  it('drives the jaw from the replicated mic level', () => {
    const avatar = new Avatar('kangaroo', false);
    const model = fakeModel();
    avatar.attachModel(model);
    const jaw = model.scene.getObjectByName('jaw') as THREE.Object3D;
    expect(swungFromRest(jaw)).toBeLessThan(1);

    for (let i = 0; i < 30; i++) avatar.update(snapshot({ voice: 1 }), 1 / 60, new THREE.Vector3(0, 0, 5));
    // Open, and open by a mouth's worth rather than by a whole rig's worth: 29 degrees is the
    // full swing, and anything near 95 means the rest pose has been thrown away again.
    const open = swungFromRest(jaw);
    expect(open).toBeGreaterThan(10);
    expect(open).toBeLessThan(40);
    avatar.dispose();
  });

  it('closes the mouth again when the speaker stops', () => {
    // The smoothing runs both ways, and a jaw that opens but never shuts is the same defect
    // wearing a different face.
    const avatar = new Avatar('kangaroo', false);
    const model = fakeModel();
    avatar.attachModel(model);
    const jaw = model.scene.getObjectByName('jaw') as THREE.Object3D;

    for (let i = 0; i < 30; i++) avatar.update(snapshot({ voice: 1 }), 1 / 60, new THREE.Vector3(0, 0, 5));
    expect(swungFromRest(jaw)).toBeGreaterThan(10);
    for (let i = 0; i < 60; i++) avatar.update(snapshot({ voice: 0 }), 1 / 60, new THREE.Vector3(0, 0, 5));
    expect(swungFromRest(jaw)).toBeLessThan(1);
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

/**
 * Legs off, for anyone wearing a headset.
 *
 * A headset tracks a head and two hands and nothing below. Simulated legs on a VR player are a
 * guess made from where their body slid, and they are the one part of yourself you see by looking
 * down — which is why Gorilla Tag, Rec Room and VRChat without full-body tracking all end the body
 * at the waist.
 */
describe('Avatar legs', () => {
  it('keeps its legs by default', () => {
    const avatar = new Avatar('kangaroo', false);
    expect(avatar.isLegless).toBe(false);
    avatar.dispose();
  });

  it('hides the procedural legs when asked', () => {
    const avatar = new Avatar('kangaroo', false);
    const hips = avatar.body.getObjectByName('hip.l');
    expect(hips).toBeDefined();
    expect(hips?.visible).toBe(true);

    avatar.setLegless(true);
    expect(avatar.isLegless).toBe(true);
    expect(avatar.body.getObjectByName('hip.l')?.visible).toBe(false);
    expect(avatar.body.getObjectByName('hip.r')?.visible).toBe(false);
    avatar.dispose();
  });

  it('puts them back', () => {
    // Not a one-way switch: a player can change platform between rounds on the same account.
    const avatar = new Avatar('kangaroo', false);
    avatar.setLegless(true);
    avatar.setLegless(false);
    expect(avatar.body.getObjectByName('hip.l')?.visible).toBe(true);
    avatar.dispose();
  });

  it('collapses the model leg bones, and never to exactly zero', () => {
    /**
     * The authored animals export as a single skinned mesh — one mesh, four primitives — so there
     * is no leg object to hide and the bones have to do it. Zero is the trap: a zero-scale bone
     * has no invertible matrix, and the NaN three.js writes back lands on every vertex weighted to
     * it, which deletes the whole animal rather than its legs.
     */
    const avatar = new Avatar('kangaroo', false);
    const model = fakeModel();
    const thigh = new THREE.Object3D();
    thigh.name = 'thigh.L';
    const other = new THREE.Object3D();
    other.name = 'thigh.R';
    model.scene.add(thigh, other);

    avatar.setLegless(true);
    avatar.attachModel(model);

    for (const bone of [thigh, other]) {
      expect(bone.scale.x).toBeLessThan(0.01);
      expect(bone.scale.x).toBeGreaterThan(0);
      expect(Number.isFinite(bone.scale.x)).toBe(true);
    }
    avatar.dispose();
  });

  it('applies to a model that arrives after the decision', () => {
    // The authored body downloads seconds after the procedural one it replaces, so the flag has to
    // survive the swap rather than being lost with the mesh it was set on.
    const avatar = new Avatar('kangaroo', false);
    avatar.setLegless(true);
    const model = fakeModel();
    const thigh = new THREE.Object3D();
    thigh.name = 'thigh.L';
    model.scene.add(thigh);
    avatar.attachModel(model);
    expect(thigh.scale.x).toBeLessThan(0.01);
    avatar.dispose();
  });

  it('leaves a model with no leg bones alone rather than throwing', () => {
    // A third-party pack is not obliged to name its rig the way the generator does.
    const avatar = new Avatar('kangaroo', false);
    avatar.setLegless(true);
    expect(() => avatar.attachModel(fakeModel())).not.toThrow();
    avatar.dispose();
  });
});
