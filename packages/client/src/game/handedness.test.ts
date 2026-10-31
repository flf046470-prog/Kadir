import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  Buttons,
  LevelBuilder,
  PhysicsWorld,
  Rand,
  SimEventQueue,
  SnapFlags,
  createHandIntent,
  createIntent,
  createPlayerState,
  stepPlayer,
  vec3,
} from '@kc/core';
import type { InputIntent, LocomotionContext, PlayerSnapshot, PlayerState } from '@kc/core';

import { toBodyLocal } from '../platform/vr/VRInput.js';
import { Avatar } from '../render/Avatar.js';

/**
 * Left and right, judged by what the player sees.
 *
 * The simulation's "right" axis was `(cos yaw, 0, -sin yaw)`, which in a right-handed, y-up world
 * is the character's **left**. Everything built on it agreed with everything else built on it, so
 * no test inside the simulation could notice: D walked left, the stick climb slid left, the right
 * fist was thrown from the left shoulder, and a test even asserted that a player facing +x has
 * their right hand at -z. It took a camera to see it — measured in the browser, D moved the PC
 * player -1.00 along the screen's right.
 *
 * So every check here takes "right" from three.js: the x axis of a camera looking where the player
 * looks, which is what the third-person camera does (`GameClient`, `cameraYaw`). That is the one
 * definition the simulation cannot share by accident.
 */

const DT = 1 / 60;
const YAWS = [0, 0.7, Math.PI / 2, 2.4, Math.PI, -1.9, -Math.PI / 2];

/** The screen's right, for a camera looking along the game's `yaw`. */
function screenRight(yaw: number): THREE.Vector3 {
  const camera = new THREE.PerspectiveCamera();
  camera.lookAt(Math.sin(yaw), 0, Math.cos(yaw));
  camera.updateMatrixWorld(true);
  return new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
}

function forwardOf(yaw: number): THREE.Vector3 {
  return new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
}

/** The wall's face, at x = 5.4, facing -x. */
const WALL_FACE = 5.4;

function rig(): LocomotionContext {
  const b = new LevelBuilder(new Rand(1));
  b.box(vec3(0, -1, 0), vec3(60, 1, 60), 'dirt', 0, 'test');
  b.box(vec3(WALL_FACE + 0.6, 15, 0), vec3(0.6, 15, 12), 'rock', 0, 'test');
  b.spawn(vec3(0, 0.5, 0), 0, 'test', 'start');
  const level = b.build({
    id: 'handedness-rig',
    name: 'handedness rig',
    version: 1,
    seed: 1,
    killPlaneY: -40,
    playRadius: 300,
    ambientColor: 0,
    skyColor: 0,
    fogDensity: 0,
  });
  return { world: new PhysicsWorld(level.colliders), events: new SimEventQueue(), tick: 0, killPlaneY: level.killPlaneY };
}

function steps(player: PlayerState, intent: InputIntent, ctx: LocomotionContext, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    ctx.tick++;
    stepPlayer(player, intent, ctx, DT);
  }
}

/** A player standing on the rig's floor, facing `yaw`, settled. */
function standingAt(yaw: number, ctx: LocomotionContext): PlayerState {
  const player = createPlayerState({ id: 'p', position: vec3(-10, 0.5, 0) });
  player.yaw = yaw;
  const still = createIntent();
  still.lookYaw = yaw;
  steps(player, still, ctx, 30);
  return player;
}

function moved(player: PlayerState, from: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3(player.position.x, 0, player.position.z).sub(new THREE.Vector3(from.x, 0, from.z));
}

describe('handedness', () => {
  it('walks a held right (D, the stick pushed right) to the right of the screen', () => {
    for (const yaw of YAWS) {
      const ctx = rig();
      const player = standingAt(yaw, ctx);
      const start = new THREE.Vector3(player.position.x, 0, player.position.z);
      const intent = createIntent();
      intent.lookYaw = yaw;
      intent.moveX = 1;
      steps(player, intent, ctx, 40);
      const step = moved(player, start);
      expect(step.length(), `yaw ${yaw.toFixed(2)}: did not move`).toBeGreaterThan(1);
      const along = step.dot(screenRight(yaw)) / step.length();
      expect(along, `yaw ${yaw.toFixed(2)}: share of the step along the screen's right`).toBeGreaterThan(0.95);
    }
  });

  it('still walks forward into the screen (the axis the fix must not touch)', () => {
    for (const yaw of YAWS) {
      const ctx = rig();
      const player = standingAt(yaw, ctx);
      const start = new THREE.Vector3(player.position.x, 0, player.position.z);
      const intent = createIntent();
      intent.lookYaw = yaw;
      intent.moveZ = 1;
      steps(player, intent, ctx, 40);
      const step = moved(player, start);
      expect(step.dot(forwardOf(yaw)) / step.length()).toBeGreaterThan(0.95);
    }
  });

  it('slides the stick climb to the right of the screen', () => {
    const ctx = rig();
    // Facing the wall (+x): the climb's sideways axis comes from the wall's normal, not the yaw.
    const yaw = Math.PI / 2;
    const player = createPlayerState({ id: 'p', position: vec3(WALL_FACE - 0.8, 3, 0) });
    player.yaw = yaw;
    const intent = createIntent();
    intent.lookYaw = yaw;
    intent.buttons = Buttons.GrabRight;
    steps(player, intent, ctx, 20);
    expect(player.climbing, 'never took hold of the wall').toBe(true);
    const start = new THREE.Vector3(player.position.x, 0, player.position.z);
    intent.moveX = 1;
    steps(player, intent, ctx, 40);
    expect(player.climbing, 'let go of the wall while sliding').toBe(true);
    const step = moved(player, start);
    expect(step.length(), 'did not slide').toBeGreaterThan(0.5);
    expect(step.dot(screenRight(yaw)) / step.length()).toBeGreaterThan(0.9);
  });

  it('throws each fist from its own shoulder, and holds each at its own side', () => {
    for (const yaw of YAWS) {
      const ctx = rig();
      const player = standingAt(yaw, ctx);
      const right = screenRight(yaw);
      const side = (i: 0 | 1) =>
        new THREE.Vector3(player.hands[i].world.x - player.position.x, 0, player.hands[i].world.z - player.position.z).dot(
          right,
        );
      expect(side(0), `yaw ${yaw.toFixed(2)}: idle left hand`).toBeLessThan(-0.1);
      expect(side(1), `yaw ${yaw.toFixed(2)}: idle right hand`).toBeGreaterThan(0.1);
      const intent = createIntent();
      intent.lookYaw = yaw;
      intent.buttons = Buttons.PunchRight;
      steps(player, intent, ctx, 3);
      // Mid-throw both shoulders swing in towards the centre line, but not across it.
      expect(side(1), `yaw ${yaw.toFixed(2)}: right fist mid-throw`).toBeGreaterThan(0);
    }
  });

  it('gives a tracked hand the same convention as a procedural one', () => {
    // A hand at the head's left, sent the way `VRInput` sends it, must land where the procedural
    // left hand would be: on the left in the world (the round trip) *and* on the same side of the
    // body frame, so anything that reads `hand.local` reads both platforms alike.
    for (const yaw of YAWS) {
      const ctx = rig();
      const procedural = standingAt(yaw, ctx);
      const origin = new THREE.Vector3(procedural.position.x, procedural.position.y, procedural.position.z);
      const world = origin
        .clone()
        .addScaledVector(screenRight(yaw), -0.3)
        .addScaledVector(forwardOf(yaw), 0.3)
        .add(new THREE.Vector3(0, 1.1, 0));
      const local = new THREE.Vector3();
      toBodyLocal(local, world, origin, yaw);

      const tracked = standingAt(yaw, rig());
      const intent = createIntent();
      intent.lookYaw = yaw;
      intent.hands = [createHandIntent(), createHandIntent()];
      intent.hands[0].tracked = true;
      intent.hands[0].pos = vec3(local.x, local.y, local.z);
      steps(tracked, intent, rig(), 1);

      const hand = tracked.hands[0];
      expect(hand.world.x - tracked.position.x).toBeCloseTo(world.x - origin.x, 4);
      expect(hand.world.z - tracked.position.z).toBeCloseTo(world.z - origin.z, 4);
      expect(Math.sign(hand.local.x), `yaw ${yaw.toFixed(2)}`).toBe(Math.sign(procedural.hands[0].local.x));
    }
  });

  it('draws a procedural avatar with its left hand on the left', () => {
    for (const yaw of YAWS) {
      const avatar = new Avatar('kangaroo', false);
      const snapshot = {
        id: 'kangaroo',
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        yaw,
        pitch: 0,
        flags: SnapFlags.Grounded,
        voice: 0,
        hands: null,
      } as unknown as PlayerSnapshot;
      for (let i = 0; i < 10; i++) avatar.update(snapshot, DT, new THREE.Vector3(0, 1.5, 4));
      avatar.group.updateMatrixWorld(true);
      const right = screenRight(yaw);
      const at = (i: 0 | 1) => avatar.hands[i].getWorldPosition(new THREE.Vector3()).setY(0).dot(right);
      expect(at(0), `yaw ${yaw.toFixed(2)}: left hand`).toBeLessThan(-0.1);
      expect(at(1), `yaw ${yaw.toFixed(2)}: right hand`).toBeGreaterThan(0.1);
    }
  });
});
