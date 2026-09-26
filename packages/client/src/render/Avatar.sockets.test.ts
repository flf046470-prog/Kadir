import { LAUNCH_ANIMALS, SnapFlags, registerAnimals } from '@kc/core';
import type { AnimalDef } from '@kc/core';
import type { PlayerSnapshot } from '@kc/core';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';

import { Avatar } from './Avatar.js';
import type { LoadedModel } from './AssetLibrary.js';

/**
 * A cosmetic has to hang off the body that is on screen.
 *
 * Sockets are built from the procedural rig. `attachModel` used to hide the procedural meshes and
 * leave the sockets where they were, on the claim that their positions were "still the right place
 * to hang a hat". Measured against the real art, they were not: the procedural body plan in
 * `PLANS` and the bone coordinates in `tools/blender/characters.py` are two independent
 * implementations of the same body plan in two languages, and nothing asserted they agree.
 * Procedural hat socket versus each model's own bounding box, before the fix:
 *
 *   penguin −0.400 m   panda −0.385 m   fox −0.370 m   bear −0.335 m   wolf −0.280 m
 *
 * — a penguin's hat at about chest height — while a human's and a lion's sat above their model
 * entirely. The waddlers are worst because `PLANS.waddler` drops the hip to 0.29 m and shortens
 * the legs while `build_upright(wide=True)` keeps a normal upright's bone heights and only widens
 * the body, so the procedural penguin is 1.167 m tall and `penguin.glb` is 1.540 m.
 *
 * No GL context is needed for the half of this that has a right answer, which is the same split
 * `LevelRenderer.water.test.ts` and `GadgetEntities.test.ts` already use: a stand-in rig with the
 * bone names the Blender pipeline writes stands in for a real load.
 */

/** A rig shaped like the generated ones: named bones, a skull well above the head joint. */
function stubModel(headY = 1.2, crownY = 1.66): LoadedModel {
  const scene = new THREE.Object3D();
  scene.name = 'stub';

  const hips = new THREE.Object3D();
  hips.name = 'hips';
  hips.position.y = 0.86;
  scene.add(hips);

  const spine = new THREE.Object3D();
  spine.name = 'spine';
  spine.position.y = 0.16;
  hips.add(spine);

  const head = new THREE.Object3D();
  head.name = 'head';
  head.position.y = headY - 0.86 - 0.16;
  spine.add(head);

  const tail = new THREE.Object3D();
  // three.js strips the dot from the glTF `tail.1`, so the loaded name really is `tail1`.
  tail.name = 'tail1';
  hips.add(tail);

  // Something with actual extent, so `Box3.setFromObject` has a crown to find. An Object3D with
  // no geometry contributes nothing to a bounding box, which would make the assertion vacuous.
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4));
  skull.position.y = crownY - headY - 0.2;
  head.add(skull);

  return { scene, clips: [] };
}

function standing(id: string): PlayerSnapshot {
  return {
    id, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0,
    flags: SnapFlags.Grounded, voice: 0, hands: null,
  } as unknown as PlayerSnapshot;
}

function posed(id: string): Avatar {
  const avatar = new Avatar(id, false);
  const snapshot = standing(id);
  for (let i = 0; i < 120; i++) avatar.update(snapshot, 1 / 60, new THREE.Vector3(0, 1.5, 4));
  return avatar;
}

function sockets(avatar: Avatar): Record<string, THREE.Object3D> {
  return (avatar as unknown as { sockets: Record<string, THREE.Object3D> }).sockets;
}

function worldY(object: THREE.Object3D): number {
  // Upward as well as downward: a socket's own `updateMatrixWorld` composes against whatever its
  // ancestors last held, which reads as 0 on an avatar nobody has updated from the root yet.
  object.updateWorldMatrix(true, true);
  return new THREE.Vector3().setFromMatrixPosition(object.matrixWorld).y;
}

beforeAll(() => {
  registerAnimals(LAUNCH_ANIMALS);
});

describe('cosmetic sockets once an authored model arrives', () => {
  it('re-parents every socket onto the model rather than leaving it on the hidden rig', () => {
    const avatar = posed('penguin');
    const model = stubModel();
    avatar.attachModel(model);

    for (const slot of ['head', 'face', 'back', 'tail']) {
      const socket = sockets(avatar)[slot];
      expect(socket, slot).toBeDefined();
      // Walking up from the socket must reach the model, not the procedural body.
      let node: THREE.Object3D | null = socket;
      let reached = false;
      while (node) {
        if (node === model.scene) { reached = true; break; }
        node = node.parent;
      }
      expect(reached, `${slot} socket is still on the procedural rig`).toBe(true);
    }
    avatar.dispose();
  });

  it('puts the hat on the model crown, not at the procedural skull height', () => {
    const before = posed('penguin');
    const proceduralHat = worldY(sockets(before).head);
    before.dispose();

    const avatar = posed('penguin');
    const model = stubModel(1.2, 1.66);
    avatar.attachModel(model);
    avatar.group.updateMatrixWorld(true);
    const attachedHat = worldY(sockets(avatar).head);

    // The crown is measured in world space *after* attaching, not from the stub's own 1.66,
    // because `bodyScale` scales the body by `visual.scale` — a penguin's 0.94 puts the visible
    // crown at 1.5604. Asserting the unscaled number would be asserting that the hat ignores the
    // animal's size, which is the opposite of what this socket is for.
    const crown = new THREE.Box3().setFromObject(model.scene).max.y;
    expect(crown).toBeLessThan(1.66); // the scale really is being applied
    expect(attachedHat).toBeCloseTo(crown, 2);
    // And that is genuinely somewhere else, so the assertion above is not trivially satisfied by
    // the procedural placement happening to be right.
    expect(Math.abs(proceduralHat - crown)).toBeGreaterThan(0.2);
    avatar.dispose();
  });

  it('leaves a socket alone when the model has no bone of that name', () => {
    // An art pack is allowed to ship a rig that is missing bones; that must degrade to the
    // procedural placement rather than dropping the cosmetic on the floor at the model origin.
    const avatar = posed('penguin');
    const bare = new THREE.Object3D();
    bare.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4)));
    const tailBefore = worldY(sockets(avatar).tail);
    avatar.attachModel({ scene: bare, clips: [] });
    avatar.group.updateMatrixWorld(true);
    expect(worldY(sockets(avatar).tail)).toBeCloseTo(tailBefore, 5);
    avatar.dispose();
  });

  it('keeps working for a quadruped, whose head bone sits on a rotated neck', () => {
    // The quadruped rigs carry the head forward along a horizontal spine — measured on the real
    // art, `wolf.glb`'s head bone is at (0, 1.18, −0.48) rather than straight above the hips. A
    // hand-written local offset would have to know which body plan it was on; converting a world
    // crown height through `worldToLocal` does not.
    const avatar = posed('wolf');
    const neck = new THREE.Object3D();
    neck.name = 'spine';
    neck.rotation.x = Math.PI / 3;
    const head = new THREE.Object3D();
    head.name = 'head';
    head.position.y = 0.5;
    neck.add(head);
    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4));
    skull.position.y = 0.3;
    head.add(skull);
    const scene = new THREE.Object3D();
    neck.position.y = 0.9;
    scene.add(neck);

    avatar.attachModel({ scene, clips: [] });
    avatar.group.updateMatrixWorld(true);
    scene.updateMatrixWorld(true);
    const crown = new THREE.Box3().setFromObject(scene).max.y;
    expect(worldY(sockets(avatar).head)).toBeCloseTo(crown, 2);
    avatar.dispose();
  });
});

describe('authored socket nodes', () => {
  /**
   * A rig like the generated ones: the head bone points forward along the neck, the way the
   * quadrupeds' does, and a `socket_head` node sits on the crown under it.
   */
  function authoredModel(socketName = 'socket_head'): { model: LoadedModel; socket: THREE.Object3D } {
    const scene = new THREE.Object3D();
    const neck = new THREE.Object3D();
    neck.name = 'spine';
    neck.position.set(0, 1.0, 0.2);
    neck.rotation.x = -1.1; // bone +Y leaning forward, as a quadruped's head bone does
    scene.add(neck);
    const head = new THREE.Object3D();
    head.name = 'head';
    head.position.y = 0.4;
    neck.add(head);
    const socket = new THREE.Object3D();
    socket.name = socketName;
    socket.position.set(0, 0.12, -0.05);
    head.add(socket);
    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4));
    head.add(skull);
    return { model: { scene, clips: [] }, socket };
  }

  it('hangs the hat on the socket node the generator wrote, not on the bounding-box top', () => {
    const avatar = posed('wolf');
    const { model, socket } = authoredModel();
    avatar.attachModel(model);
    avatar.group.updateWorldMatrix(true, true);
    const want = socket.getWorldPosition(new THREE.Vector3());
    const got = sockets(avatar).head.getWorldPosition(new THREE.Vector3());
    expect(got.distanceTo(want)).toBeLessThan(1e-6);
    // And that is genuinely not the bounding-box answer, or this test would pass on the fallback.
    const top = new THREE.Box3().setFromObject(model.scene).max.y;
    expect(Math.abs(got.y - top)).toBeGreaterThan(0.05);
    avatar.dispose();
  });

  it('keeps a hat upright on a bone that points forward', () => {
    // Without the correction the hat inherits the head bone's ~60° forward lean.
    const avatar = posed('wolf');
    const { model } = authoredModel();
    avatar.attachModel(model);
    avatar.group.updateWorldMatrix(true, true);
    const body = (avatar as unknown as { body: THREE.Object3D }).body;
    const hat = sockets(avatar).head.getWorldQuaternion(new THREE.Quaternion());
    const upright = body.getWorldQuaternion(new THREE.Quaternion());
    expect(hat.angleTo(upright)).toBeLessThan(1e-4);
    avatar.dispose();
  });

  it('follows a rename declared on the animal', () => {
    // `AnimalModelRef.sockets` was declared, documented and read by nothing; this is its reader.
    const base = LAUNCH_ANIMALS.find((a) => a.id === 'wolf')!;
    const renamed: AnimalDef = {
      ...base,
      id: 'wolf_renamed_sockets',
      model: { ...base.model!, sockets: { head: 'HatMount' } },
    };
    registerAnimals([renamed]);
    const avatar = posed('wolf_renamed_sockets');
    const { model, socket } = authoredModel('HatMount');
    avatar.attachModel(model);
    avatar.group.updateWorldMatrix(true, true);
    const got = sockets(avatar).head.getWorldPosition(new THREE.Vector3());
    expect(got.distanceTo(socket.getWorldPosition(new THREE.Vector3()))).toBeLessThan(1e-6);
    avatar.dispose();
  });
});
