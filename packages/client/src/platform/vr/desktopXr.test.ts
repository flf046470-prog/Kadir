import { afterEach, describe, expect, it } from 'vitest';

import {
  DesktopXr,
  DUCK_DROP,
  HAND_REST,
  JAB_REACH,
  SIM_BUTTON_KEYS,
  SQUEEZE,
  STAND_HEIGHT,
  TRIGGER,
  lookQuaternion,
  rotateByLook,
  simControls,
} from './desktopXr.js';
import { startDesktopXr, wantsDesktopXr, withoutDesktopXr } from './desktopXrRuntime.js';
import { VR_BINDINGS } from './VRInput.js';
import { platformFromQuery, withPlatform } from '../detect.js';

/** Rotate a vector by a quaternion (x, y, z, w), the way WebXR applies a pose. */
function rotate(q: readonly number[], v: readonly number[]): number[] {
  const [qx, qy, qz, qw] = q as [number, number, number, number];
  const [vx, vy, vz] = v as [number, number, number];
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [vx + qw * tx + (qy * tz - qz * ty), vy + qw * ty + (qz * tx - qx * tz), vz + qw * tz + (qx * ty - qy * tx)];
}

const FORWARD = [0, 0, -1];

describe('the desktop VR simulator controls', () => {
  it('reaches every controller button the game binds', () => {
    // The same property the gamepad test pins for PC: a mapping with no collisions is easy to get
    // by leaving bindings out, so coverage is asserted too.
    for (const binding of VR_BINDINGS) {
      const hands = binding.hand === 'both' ? ['left', 'right'] : [binding.hand];
      for (const hand of hands) {
        const key = SIM_BUTTON_KEYS.find((k) => k.hand === hand && k.button === binding.button);
        expect(key, `${binding.action} on the ${hand} controller has no key`).toBeTruthy();
      }
    }
    // And both grips, which the game reads as a hold rather than through VR_BINDINGS.
    expect(SIM_BUTTON_KEYS.some((k) => k.hand === 'left' && k.button === SQUEEZE)).toBe(true);
    expect(SIM_BUTTON_KEYS.some((k) => k.hand === 'right' && k.button === SQUEEZE)).toBe(true);
  });

  it('gives every key one button', () => {
    const codes = SIM_BUTTON_KEYS.map((k) => k.code);
    expect(new Set(codes).size).toBe(codes.length);
    const slots = SIM_BUTTON_KEYS.map((k) => `${k.hand}:${k.button}`);
    expect(new Set(slots).size).toBe(slots.length);
  });

  it('presses exactly the button a key names, on the hand it names', () => {
    const sim = new DesktopXr();
    sim.keyDown('KeyE');
    let state = sim.step(1 / 60);
    expect(state.controllers.left.buttons[SQUEEZE]).toBe(1);
    expect(state.controllers.left.buttons.filter((v) => v > 0)).toHaveLength(1);
    expect(state.controllers.right.buttons.every((v) => v === 0)).toBe(true);
    sim.keyUp('KeyE');
    sim.mouseButton(0, true);
    state = sim.step(1 / 60);
    expect(state.controllers.right.buttons[TRIGGER]).toBe(1);
    expect(state.controllers.left.buttons.every((v) => v === 0)).toBe(true);
    // The middle button is not a controller button.
    expect(sim.mouseButton(1, true)).toBe(false);
  });

  it('turns the head the way the mouse moves', () => {
    const sim = new DesktopXr();
    sim.mouseMove(200, 0);
    const right = rotate(sim.step(1 / 60).head.quaternion, FORWARD);
    expect(right[0]).toBeGreaterThan(0.4);
    sim.reset();
    sim.yaw = 0;
    sim.mouseMove(0, -200);
    const up = rotate(sim.step(1 / 60).head.quaternion, FORWARD);
    expect(up[1]).toBeGreaterThan(0.4);
    // Never over the top.
    sim.mouseMove(0, -100000);
    expect(sim.pitch).toBeLessThanOrEqual(1.45);
  });

  it('builds the head quaternion and the hand offsets from the same rotation', () => {
    for (const [yaw, pitch] of [[0.7, -0.3], [-2.1, 0.9], [3, 0]] as const) {
      const viaQuaternion = rotate(lookQuaternion(yaw, pitch), [0.2, -0.3, -0.4]);
      const viaRotation = rotateByLook([0.2, -0.3, -0.4], yaw, pitch);
      for (let i = 0; i < 3; i++) expect(viaQuaternion[i]).toBeCloseTo(viaRotation[i] as number, 9);
    }
  });

  it('carries the hands with the head, in front of it', () => {
    const sim = new DesktopXr();
    sim.yaw = Math.PI / 2; // facing -x
    const state = sim.step(1 / 60);
    const [x, y, z] = state.controllers.right.position;
    expect(x).toBeCloseTo(HAND_REST.right[2], 6); // forward is -x now
    expect(z).toBeCloseTo(-HAND_REST.right[0], 6);
    expect(y).toBeCloseTo(STAND_HEIGHT + HAND_REST.right[1], 6);
  });

  it('moves a hand instead of the head while 1 or 2 is held', () => {
    const sim = new DesktopXr();
    sim.keyDown('Digit1');
    sim.mouseMove(100, 50);
    expect(sim.yaw).toBe(0);
    expect(sim.pitch).toBe(0);
    const left = sim.step(1 / 60).controllers.left.position;
    expect(left[0]).toBeCloseTo(HAND_REST.left[0] + 0.2, 6);
    expect(left[1]).toBeCloseTo(STAND_HEIGHT + HAND_REST.left[1] - 0.1, 6);
    // The wheel pushes it out, scrolling away from you.
    expect(sim.wheel(-100)).toBe(true);
    expect(sim.step(1 / 60).controllers.left.position[2]).toBeCloseTo(HAND_REST.left[2] - 0.1, 6);
    sim.keyUp('Digit1');
    expect(sim.wheel(-100)).toBe(false);
    // An arm, not a telescope.
    sim.keyDown('Digit2');
    sim.mouseMove(1e6, 0);
    expect(sim.step(1 / 60).controllers.right.position[0]).toBeLessThanOrEqual(0.9 + 1e-9);
  });

  it('jabs at a real punch speed and comes back', () => {
    const sim = new DesktopXr();
    const dt = 1 / 240;
    let previous = sim.step(dt).controllers.right.position;
    let peak = 0;
    let furthest = 0;
    sim.keyDown('KeyK');
    for (let t = 0; t < 0.4; t += dt) {
      const now = sim.step(dt).controllers.right.position;
      peak = Math.max(peak, Math.hypot(now[0] - previous[0], now[1] - previous[1], now[2] - previous[2]) / dt);
      furthest = Math.max(furthest, HAND_REST.right[2] - now[2]);
      previous = now;
    }
    // Over the game's 3.4 m/s punch threshold with room to spare, under its 12 m/s ceiling.
    expect(peak).toBeGreaterThan(6);
    expect(peak).toBeLessThan(12);
    expect(furthest).toBeCloseTo(JAB_REACH, 2);
    expect(previous[2]).toBeCloseTo(HAND_REST.right[2], 6);
    // A held key is one jab, not a stream of them.
    expect(sim.step(dt).controllers.right.position[2]).toBeCloseTo(HAND_REST.right[2], 6);
  });

  it('ducks the head below the height the game crouches a tracked player at', () => {
    const sim = new DesktopXr();
    sim.keyDown('KeyC');
    const y = sim.step(1 / 60).head.position[1];
    expect(y).toBeCloseTo(STAND_HEIGHT - DUCK_DROP, 6);
    expect(y).toBeLessThan(1.15);
  });

  it('reads the sticks the WebXR way round, and never past the rim', () => {
    const sim = new DesktopXr();
    sim.keyDown('KeyW');
    expect(sim.step(1 / 60).controllers.left.stick).toEqual([0, -1]);
    sim.keyDown('KeyD');
    const [x, y] = sim.step(1 / 60).controllers.left.stick;
    expect(Math.hypot(x, y)).toBeCloseTo(1, 9);
    sim.keyDown('ArrowRight');
    expect(sim.step(1 / 60).controllers.right.stick[0]).toBe(1);
  });

  it('lets go of everything when the window loses focus', () => {
    const sim = new DesktopXr();
    sim.keyDown('KeyE');
    sim.mouseButton(2, true);
    sim.releaseAll();
    const state = sim.step(1 / 60);
    expect(state.controllers.left.buttons.every((v) => v === 0)).toBe(true);
    expect(state.controllers.right.buttons.every((v) => v === 0)).toBe(true);
  });

  it('describes each button by the action the game gives it', () => {
    const text = simControls().map((line) => `${line.keys} ${line.does}`).join('\n');
    for (const binding of VR_BINDINGS) expect(text).toContain(binding.action);
    expect(text).toContain('Right grip');
  });
});

describe('turning the simulator and the desktop fallback on and off', () => {
  const host = globalThis as Record<string, unknown>;
  const saved = Object.getOwnPropertyDescriptor(host, 'navigator');
  afterEach(() => {
    if (saved) Object.defineProperty(host, 'navigator', saved);
    else delete host.navigator;
  });

  it('starts only when the page asks', () => {
    expect(wantsDesktopXr('?xrsim')).toBe(true);
    expect(wantsDesktopXr('?xrsim=1&level=x')).toBe(true);
    expect(wantsDesktopXr('')).toBe(false);
    expect(wantsDesktopXr('?xrsim=0')).toBe(false);
    expect(withoutDesktopXr('http://a.test/play/x?xrsim=1&level=y')).toBe('http://a.test/play/x?level=y');
  });

  it('stays off over a real headset', async () => {
    // Shadowing a device that can present would leave a player in a headset looking at an
    // emulated one. The refusal comes before IWER is ever loaded.
    Object.defineProperty(host, 'navigator', {
      value: { xr: { isSessionSupported: async (mode: string) => mode === 'immersive-vr' } },
      configurable: true,
      writable: true,
    });
    const result = await startDesktopXr();
    expect(result.active).toBe(false);
    expect(result.active === false && result.reason).toBe('native-headset');
  });

  it('forces a platform from the query, and takes it off again', () => {
    expect(platformFromQuery('?platform=pc')).toBe('pc');
    expect(platformFromQuery('?platform=desk')).toBe(null);
    expect(platformFromQuery('')).toBe(null);
    expect(withPlatform('http://a.test/?xrsim', 'pc')).toBe('http://a.test/?xrsim=&platform=pc');
    expect(withPlatform('http://a.test/?platform=pc&level=y', null)).toBe('http://a.test/?level=y');
  });
});
