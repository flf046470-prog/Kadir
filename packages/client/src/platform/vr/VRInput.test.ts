import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  Buttons,
  DEFAULT_SETTINGS,
  LevelBuilder,
  PhysicsWorld,
  Rand,
  SimEventQueue,
  createIntent,
  createPlayerState,
  stepPlayer,
  vec3,
} from '@kc/core';
import type { InputIntent, LocomotionContext, PlayerState, Settings } from '@kc/core';

import type { Renderer } from '../../render/Renderer.js';
import { VRInput } from './VRInput.js';

/**
 * The VR input, from the controller to the simulation.
 *
 * Two defects lived in the space between them, where neither half's own tests could see:
 *
 * - **The magnet.** `VRInput` set the Grab bits whenever a hand was squeezed. A tracked hand never
 *   reads them — `locomotion.ts` closes it on its own grip value — so the only thing they drove was
 *   the assisted climb, PC's stick climb, which grabs any wall within 1.35 m. A fist closed in the
 *   air a metre from a wall held the player there: no fall in 2 s, where the same fist falls 6 m.
 * - **The trigger was a grip.** The grip sent was the larger of the squeeze and the trigger, and the
 *   trigger is the gadget. Firing it closed the hand on whatever it was near: a hand anchored to a
 *   wall on 60 ticks of 60 while the freeze gun fired.
 *
 * So these drive the real `VRInput` over stand-ins for three.js's XR spaces and feed its intent to
 * the real `stepPlayer`. What they do not cover is a runtime: the poses here are set by hand.
 */

const DT = 1 / 60;
/** The wall's face, at x = 5.4. */
const WALL_FACE = 5.4;

function rig(): LocomotionContext {
  const b = new LevelBuilder(new Rand(1));
  b.box(vec3(0, -1, 0), vec3(60, 1, 60), 'dirt', 0, 'test');
  b.box(vec3(WALL_FACE + 0.6, 15, 0), vec3(0.6, 15, 8), 'rock', 0, 'test');
  b.spawn(vec3(0, 0.5, 0), 0, 'test', 'start');
  const level = b.build({
    id: 'grab-rig',
    name: 'grab rig',
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

type Pad = { buttons: { value: number; pressed: boolean }[]; axes: number[] };

/**
 * Enough of three.js's WebXR manager for `VRInput` to run: real groups for each controller's
 * target-ray, grip and hand spaces, parented to the rig as three.js parents them, and a camera for
 * the head. `connected` is dispatched on the controller space, as three.js does.
 */
function headset(sources: ('pad' | 'hand')[] = ['pad', 'pad']) {
  const controllers = [new THREE.Group(), new THREE.Group()];
  const grips = [new THREE.Group(), new THREE.Group()];
  const hands = [new THREE.Group(), new THREE.Group()];
  const camera = new THREE.PerspectiveCamera();
  const body = new THREE.Group();
  const renderer = {
    renderer: {
      xr: {
        isPresenting: false,
        getController: (i: number) => controllers[i],
        getControllerGrip: (i: number) => grips[i],
        getHand: (i: number) => hands[i],
        getCamera: () => camera,
      },
    },
    rig: body,
    setDisplayRate: () => {},
  } as unknown as Renderer;
  const input = new VRInput(renderer);
  const pads: (Pad | null)[] = (['left', 'right'] as const).map((handedness, i) => {
    const gamepad: Pad | null =
      sources[i] === 'pad'
        ? { buttons: Array.from({ length: 6 }, () => ({ value: 0, pressed: false })), axes: [0, 0, 0, 0] }
        : null;
    controllers[i]!.dispatchEvent({ type: 'connected', data: gamepad ? { handedness, gamepad } : { handedness } } as never);
    return gamepad;
  });
  return { input, camera, body, grips, hands, pads };
}
type Headset = ReturnType<typeof headset>;

function setButton(pad: Pad | null, index: number, value: number): void {
  const button = pad!.buttons[index]!;
  button.value = value;
  button.pressed = value > 0.5;
}
const TRIGGER = 0;
const SQUEEZE = 1;

/** Close a bare hand's thumb onto its index finger (`readPinch`), or open it. */
function pinch(set: Headset, i: number, closed: boolean): void {
  const thumb = new THREE.Object3D();
  const index = new THREE.Object3D();
  index.position.set(closed ? 0.01 : 0.08, 0, 0);
  Object.assign(set.hands[i]!, { joints: { 'thumb-tip': thumb, 'index-finger-tip': index } });
}

function settingsWith(comfort: Partial<Settings['comfort']>): Settings {
  return { ...DEFAULT_SETTINGS, comfort: { ...DEFAULT_SETTINGS.comfort, ...comfort } };
}

/**
 * One frame: the headset at the player's body facing `yaw`, each hand at a body-local
 * `[right, up, forward]`, then `updateTracking` and `sample` as `GameClient` calls them.
 */
function frame(set: Headset, player: PlayerState, yaw: number, hands: [number, number, number][], settings: Settings): InputIntent {
  const { x, y, z } = player.position;
  set.body.position.set(x, y, z);
  // The head as three.js poses its XR camera: in the reference space the rig carries, standing,
  // and looking down its own -z — so a head facing the game's `yaw` is turned half a turn from it.
  set.camera.position.set(0, 1.6, 0);
  set.camera.quaternion.setFromEuler(new THREE.Euler(0, yaw + Math.PI, 0, 'YXZ'));
  for (let i = 0; i < 2; i++) {
    const [right, up, forward] = hands[i]!;
    // Rig-relative, the space XR poses arrive in; the simulation's own body-local mapping.
    set.grips[i]!.position.set(
      -Math.cos(yaw) * right + Math.sin(yaw) * forward,
      up,
      Math.sin(yaw) * right + Math.cos(yaw) * forward,
    );
  }
  set.input.updateTracking(DT, settings);
  const intent = createIntent();
  set.input.sample(intent, DT, settings);
  return intent;
}

/** Facing the wall (+x). */
const FACING_WALL = Math.PI / 2;
/** Fists in front of the chest, short of anything. */
const FISTS: [number, number, number][] = [
  [-0.25, 1.2, 0.3],
  [0.25, 1.2, 0.3],
];

function run(set: Headset, player: PlayerState, hands: [number, number, number][], settings: Settings, ticks: number) {
  const ctx = rig();
  let grabBits = 0;
  let climbing = 0;
  let gadget = 0;
  let anchored = 0;
  for (let i = 0; i < ticks; i++) {
    const intent = frame(set, player, FACING_WALL, hands, settings);
    grabBits |= intent.buttons & (Buttons.GrabLeft | Buttons.GrabRight);
    if (intent.buttons & Buttons.UseGadget) gadget++;
    ctx.tick++;
    stepPlayer(player, intent, ctx, DT);
    if (player.climbing) climbing++;
    if (player.hands[1].anchored) anchored++;
  }
  return { grabBits, climbing, gadget, anchored };
}

describe('a VR grab', () => {
  it('holds nobody to a wall a closed fist is not touching', () => {
    const set = headset();
    for (const pad of set.pads) setButton(pad, SQUEEZE, 1);
    const player = createPlayerState({ id: 'vr', position: vec3(WALL_FACE - 1.4, 6, 0) });
    const { grabBits, climbing } = run(set, player, FISTS, DEFAULT_SETTINGS, 120);
    expect(grabBits, 'arms-first sent the assisted climb its Grab bits').toBe(0);
    expect(climbing).toBe(0);
    expect(6 - player.position.y, 'held in the air by a wall the hands never touched').toBeGreaterThan(5);
  });

  it('still hangs from a fist that closes on the wall', () => {
    const set = headset();
    for (const pad of set.pads) setButton(pad, SQUEEZE, 1);
    const player = createPlayerState({ id: 'vr', position: vec3(WALL_FACE - 0.8, 6, 0) });
    const onTheWall: [number, number, number][] = [
      [-0.25, 1.2, 0.78],
      [0.25, 1.2, 0.78],
    ];
    const { anchored } = run(set, player, onTheWall, DEFAULT_SETTINGS, 120);
    expect(anchored).toBe(120);
    expect(Math.abs(6 - player.position.y)).toBeLessThan(0.2);
  });

  it('keeps the assisted climb in assisted mode, closing at the same squeeze as the hand', () => {
    // The stick climb is that mode's accessibility path (seated play, limited reach): it is what
    // PC and mobile climb with, and it is slower than climbing with your arms.
    const assisted = settingsWith({ vrLocomotion: 'assisted' });
    const held = headset();
    for (const pad of held.pads) setButton(pad, SQUEEZE, 1);
    const player = createPlayerState({ id: 'vr', position: vec3(WALL_FACE - 1.4, 6, 0) });
    const { grabBits } = run(held, player, FISTS, assisted, 120);
    expect(grabBits).toBe(Buttons.GrabLeft | Buttons.GrabRight);
    expect(Math.abs(6 - player.position.y)).toBeLessThan(0.5);

    // The bit closes where the hand does, not on a lighter squeeze of its own.
    for (const [squeeze, sent] of [
      [0.5, false],
      [0.6, true],
    ] as const) {
      const set = headset();
      setButton(set.pads[1]!, SQUEEZE, squeeze);
      const intent = frame(set, createPlayerState({ id: 'vr', position: vec3(0, 0, 0) }), 0, FISTS, assisted);
      expect((intent.buttons & Buttons.GrabRight) !== 0, `squeeze ${squeeze}`).toBe(sent);
    }
  });

  it('fires the gadget with the trigger without closing the hand', () => {
    const set = headset();
    setButton(set.pads[1]!, TRIGGER, 1);
    const player = createPlayerState({ id: 'vr', position: vec3(WALL_FACE - 0.8, 0, 0) });
    const nearTheWall: [number, number, number][] = [
      [-0.25, 0.9, 0.2],
      [0.25, 1.2, 0.78],
    ];
    const { gadget, anchored } = run(set, player, nearTheWall, DEFAULT_SETTINGS, 60);
    expect(gadget).toBe(60);
    expect(anchored, 'the trigger closed the right hand on the wall').toBe(0);
  });

  it('closes a bare hand on a pinch', () => {
    // A hand-tracking source has no gamepad at all; the pinch is its grip.
    const set = headset(['hand', 'hand']);
    pinch(set, 1, true);
    pinch(set, 0, false);
    const ctx = rig();
    const player = createPlayerState({ id: 'vr', position: vec3(0, 0, 0) });
    const intent = frame(set, player, 0, FISTS, DEFAULT_SETTINGS);
    stepPlayer(player, intent, ctx, DT);
    expect(player.hands[1].gripHeld).toBe(true);
    expect(player.hands[0].gripHeld).toBe(false);
  });

  it('closes the hand where the grab sensitivity says, not at a fixed squeeze', () => {
    // The slider used to move the magnet's threshold and no hand's. The simulation closes every
    // tracked hand at one `gripThreshold`; the sensitivity reshapes the grip it is sent.
    const cases: [sensitivity: number, squeeze: number, closes: boolean][] = [
      [1, 0.5, false],
      [1, 0.6, true],
      [3, 0.15, false],
      [3, 0.2, true],
      [0.2, 0.85, false],
      [0.2, 0.92, true],
    ];
    for (const [sensitivity, squeeze, closes] of cases) {
      const set = headset();
      setButton(set.pads[1]!, SQUEEZE, squeeze);
      const player = createPlayerState({ id: 'vr', position: vec3(0, 0, 0) });
      const intent = frame(set, player, 0, FISTS, settingsWith({ grabSensitivity: sensitivity }));
      stepPlayer(player, intent, rig(), DT);
      expect(player.hands[1].gripHeld, `sensitivity ${sensitivity}, squeeze ${squeeze}`).toBe(closes);
    }
  });
});

/**
 * The assisted-mode stick, read whole (`platform/stick.ts`). Per axis, a stick pushed within 6.9°
 * of an axis ran along it, and the first speed past the dead zone was an eighth of full.
 */
describe('the assisted-mode stick', () => {
  const assisted = settingsWith({ vrLocomotion: 'assisted' });
  const pushed = (x: number, y: number, settings: Settings) => {
    const set = headset();
    const axes = set.pads[0]!.axes;
    axes[2] = x;
    axes[3] = y;
    return frame(set, createPlayerState({ id: 'vr', position: vec3(0, 0, 0) }), 0, FISTS, settings);
  };

  it('moves at the heading the stick is pushed', () => {
    const angle = (5 * Math.PI) / 180;
    const intent = pushed(Math.sin(angle), -Math.cos(angle), assisted);
    expect(Math.atan2(intent.moveX, intent.moveZ)).toBeCloseTo(angle, 6);
  });

  it('starts from standing at the edge of the dead zone', () => {
    const intent = pushed(0, -0.13, assisted);
    expect(intent.moveZ).toBeGreaterThan(0);
    expect(intent.moveZ).toBeLessThan(0.01);
  });

  it('is off entirely in arms-first', () => {
    const intent = pushed(0, -1, DEFAULT_SETTINGS);
    expect(intent.moveX).toBe(0);
    expect(intent.moveZ).toBe(0);
  });
});

/**
 * Head height is the head above the floor the player stands on, wherever that floor is.
 *
 * It was the XR camera's pose less the rig's height, and the pose is already relative to the rig
 * (three.js poses the XR camera in the reference space and keeps it out of the scene graph), so it
 * measured the head against the world's y = 0. Found by the desktop simulator: standing in the
 * jungle cave, 4 m down, a standing player's head read 5.6 m and a ducked one 5.0 — crouch, which
 * in VR is ducking, could not happen there, and on a ledge it could not stop.
 */
describe('the head height', () => {
  const heightOn = (floor: number, eye: number) => {
    const set = headset();
    const player = createPlayerState({ id: 'vr', position: vec3(3, floor, -2) });
    const intent = createIntent();
    set.body.position.set(3, floor, -2);
    set.camera.position.set(0, eye, 0);
    set.input.updateTracking(DT, DEFAULT_SETTINGS);
    set.input.sample(intent, DT, DEFAULT_SETTINGS);
    expect(player.position.y).toBe(floor);
    return intent.headHeight;
  };

  it('is the same standing in a pit, on the ground and on a ledge', () => {
    for (const floor of [-4, 0, 1.5, 3]) expect(heightOn(floor, 1.6), `on a floor at ${floor} m`).toBeCloseTo(1.6, 6);
  });

  it('drops below the crouch line when the player ducks, wherever they stand', () => {
    // `locomotion.ts` crouches a tracked player whose head is below 1.15 m.
    for (const floor of [-4, 0, 3]) expect(heightOn(floor, 1.0), `on a floor at ${floor} m`).toBeLessThan(1.15);
  });
});

/**
 * The body faces where the head looks.
 *
 * A WebXR viewer looks down -z and the game's yaw faces +z, and the body yaw was the head's yaw
 * unchanged — so the body faced the player's back. Measured with the desktop simulator: the stick
 * pushed forward walked -1.00 along the view. The harness above had assumed the same, which is why
 * every other test here passed.
 */
describe('the body yaw', () => {
  const lookingAlong = (dx: number, dz: number) => {
    const set = headset();
    set.camera.position.set(0, 1.6, 0);
    // A camera turned so its -z points along (dx, dz).
    set.camera.quaternion.setFromEuler(new THREE.Euler(0, Math.atan2(-dx, -dz), 0, 'YXZ'));
    // Both hands 0.4 m in front of the face, the way the head is looking.
    for (const grip of set.grips) grip.position.set(dx * 0.4, 1.3, dz * 0.4);
    set.input.updateTracking(DT, DEFAULT_SETTINGS);
    const intent = createIntent();
    set.input.sample(intent, DT, DEFAULT_SETTINGS);
    return intent;
  };

  it('faces the way the head looks', () => {
    for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-0.6, 0.8]] as const) {
      const intent = lookingAlong(dx, dz);
      expect(Math.sin(intent.lookYaw), `looking along (${dx}, ${dz})`).toBeCloseTo(dx, 6);
      expect(Math.cos(intent.lookYaw), `looking along (${dx}, ${dz})`).toBeCloseTo(dz, 6);
    }
  });

  it('puts the hands held in front of the face in front of the body', () => {
    const intent = lookingAlong(0, -1);
    for (const hand of intent.hands ?? []) expect(hand.pos.z).toBeCloseTo(0.4, 6);
  });

  it('walks the way the head looks with the stick pushed forward', () => {
    const set = headset();
    set.camera.position.set(0, 1.6, 0);
    set.camera.quaternion.setFromEuler(new THREE.Euler(0, 0, 0, 'YXZ')); // looking down -z
    set.pads[0]!.axes[3] = -1; // the left stick, pushed forward
    const player = createPlayerState({ id: 'vr', position: vec3(0, 0, 0) });
    const ctx = rig();
    const settings = settingsWith({ vrLocomotion: 'assisted' });
    for (let i = 0; i < 30; i++) {
      set.input.updateTracking(DT, settings);
      const intent = createIntent();
      set.input.sample(intent, DT, settings);
      ctx.tick++;
      stepPlayer(player, intent, ctx, DT);
    }
    expect(player.position.z).toBeLessThan(-0.3);
  });
});
