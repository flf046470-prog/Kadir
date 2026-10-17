import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Buttons, DEFAULT_SETTINGS, createIntent } from '@kc/core';
import { PCInput } from './PCInput.js';

/**
 * Mouse look when the browser refuses pointer lock.
 *
 * The game is embedded in a frame more often than it looks: an artifact viewer, an itch.io page,
 * a store's web preview. A sandboxed frame without `allow-pointer-lock` throws on
 * `requestPointerLock()`, and the locked-only look path then leaves the player able to walk and
 * hop but never to turn around — which reads as a broken game rather than a blocked permission.
 *
 * These tests pin the fallback: look still works by dragging, a drag does not throw punches, and
 * a click that barely moves still does.
 */

type Handler = (event: unknown) => void;

/** A canvas and a document, only as far as PCInput actually touches them. */
function fakeDom(options: { lockThrows?: boolean } = {}) {
  const listeners = new Map<string, Handler[]>();
  const add = (type: string, fn: Handler): void => {
    const list = listeners.get(type) ?? [];
    list.push(fn);
    listeners.set(type, list);
  };

  const canvas = {
    addEventListener: add,
    removeEventListener: () => {},
    requestPointerLock: (): void => {
      if (options.lockThrows) throw new Error('Blocked pointer lock: frame is sandboxed');
    },
  };

  // PCInput listens on `globalThis` for keys and on `document` for pointer-lock changes, and the
  // test environment is plain Node, so both have to exist before `start()` is called.
  const host = globalThis as Record<string, unknown>;
  const saved = { document: host.document, add: host.addEventListener, remove: host.removeEventListener };
  host.document = { addEventListener: add, removeEventListener: () => {}, pointerLockElement: null };
  host.addEventListener = add;
  host.removeEventListener = (): void => {};

  return {
    canvas: canvas as unknown as HTMLElement,
    fire(type: string, event: Record<string, unknown>): void {
      for (const fn of listeners.get(type) ?? []) fn(event);
    },
    restore(): void {
      host.document = saved.document;
      host.addEventListener = saved.add;
      host.removeEventListener = saved.remove;
    },
  };
}

function look(input: PCInput, settings = DEFAULT_SETTINGS): { yaw: number; pitch: number; buttons: number } {
  const out = createIntent();
  input.sample(out, 1 / 60, settings);
  return { yaw: out.lookYaw, pitch: out.lookPitch, buttons: out.buttons };
}

function withLook(lookSensitivity: number, invertY = false) {
  return { ...DEFAULT_SETTINGS, controls: { ...DEFAULT_SETTINGS.controls, lookSensitivity, invertY } };
}

describe('mouse look without pointer lock', () => {
  let dom: ReturnType<typeof fakeDom>;
  let input: PCInput;

  beforeEach(() => {
    dom = fakeDom({ lockThrows: true });
    input = new PCInput(dom.canvas);
    input.start();
  });

  afterEach(() => {
    input.stop();
    dom.restore();
  });

  it('does not throw when the browser refuses pointer lock', () => {
    expect(() => dom.fire('mousedown', { button: 0, target: null })).not.toThrow();
    expect(input.isDragLooking).toBe(true);
  });

  it('turns the player when the mouse is dragged', () => {
    dom.fire('mousedown', { button: 0, target: null });
    dom.fire('mousemove', { movementX: 100, movementY: 0 });

    // Dragging right turns right, which is a decreasing yaw — same sign as the locked path.
    expect(look(input).yaw).toBeLessThan(0);
  });

  it('ignores mouse movement when no button is held, since the cursor cannot be recentred', () => {
    dom.fire('mousemove', { movementX: 100, movementY: 0 });
    expect(look(input).yaw).toBe(0);
  });

  it('keeps pitch inside the neck-breaking limits', () => {
    dom.fire('mousedown', { button: 0, target: null });
    for (let i = 0; i < 50; i++) dom.fire('mousemove', { movementX: 0, movementY: -100 });
    expect(look(input).pitch).toBeLessThanOrEqual(1.45);

    for (let i = 0; i < 100; i++) dom.fire('mousemove', { movementX: 0, movementY: 100 });
    expect(look(input).pitch).toBeGreaterThanOrEqual(-1.45);
  });

  it('a short click still punches', () => {
    dom.fire('mousedown', { button: 0, target: null });
    dom.fire('mousemove', { movementX: 2, movementY: 1 });
    expect(look(input).buttons & Buttons.PunchRight).toBeTruthy();
  });

  it('a drag looks instead of punching', () => {
    dom.fire('mousedown', { button: 0, target: null });
    dom.fire('mousemove', { movementX: 40, movementY: 0 });

    const sampled = look(input);
    expect(sampled.buttons & Buttons.PunchRight).toBe(0);
    expect(sampled.yaw).not.toBe(0);
  });

  it('a drag with the right button looks instead of grabbing', () => {
    dom.fire('mousedown', { button: 2, target: null });
    dom.fire('mousemove', { movementX: 40, movementY: 0 });
    expect(look(input).buttons & Buttons.GrabRight).toBe(0);
  });

  it('stops looking once the button is released', () => {
    dom.fire('mousedown', { button: 0, target: null });
    dom.fire('mousemove', { movementX: 30, movementY: 0 });
    const turned = look(input).yaw;

    dom.fire('mouseup', { button: 0 });
    dom.fire('mousemove', { movementX: 300, movementY: 0 });
    expect(look(input).yaw).toBe(turned);
  });

  it('does not steal the mouse while the player is typing a name', () => {
    dom.fire('mousedown', { button: 0, target: { tagName: 'INPUT' } });
    dom.fire('mousemove', { movementX: 50, movementY: 0 });
    expect(look(input).yaw).toBe(0);
  });

  /**
   * Mouse-look hardcoded its own sensitivity constant and never read `controls.lookSensitivity`
   * or `.invertY` at all — only the optional gamepad-look path did. On the platform most players
   * use a mouse, not a pad, so both sliders in the Settings menu did nothing for them, locked or
   * dragging alike (the fix is one shared `sensitivity`/`dy` computation for both branches).
   */
  it('scales drag-look by controls.lookSensitivity instead of a fixed constant', () => {
    look(input, withLook(0.5)); // cache the low sensitivity before dragging
    dom.fire('mousedown', { button: 0, target: null });
    dom.fire('mousemove', { movementX: 100, movementY: 0 });
    const afterLow = look(input, withLook(0.5)).yaw;
    dom.fire('mouseup', { button: 0 });

    look(input, withLook(2)); // cache the high sensitivity before the second drag
    dom.fire('mousedown', { button: 0, target: null });
    dom.fire('mousemove', { movementX: 100, movementY: 0 });
    const afterHigh = look(input, withLook(2)).yaw;

    const deltaLow = Math.abs(afterLow);
    const deltaHigh = Math.abs(afterHigh - afterLow);
    expect(deltaHigh).toBeGreaterThan(deltaLow * 3);
  });

  it('flips drag-look pitch when invertY is on, without touching yaw', () => {
    look(input, withLook(1, false));
    dom.fire('mousedown', { button: 0, target: null });
    dom.fire('mousemove', { movementX: 20, movementY: 40 });
    const normal = look(input, withLook(1, false));
    dom.fire('mouseup', { button: 0 });

    look(input, withLook(1, true));
    dom.fire('mousedown', { button: 0, target: null });
    dom.fire('mousemove', { movementX: 20, movementY: 40 });
    const inverted = look(input, withLook(1, true));

    expect(normal.pitch).not.toBe(0);
    expect(Math.sign(inverted.pitch - normal.pitch)).toBe(-Math.sign(normal.pitch));
    // Same movementX, same sensitivity, both drags — yaw must not react to invertY at all.
    expect(inverted.yaw - normal.yaw).toBeCloseTo(normal.yaw, 5);
  });

  /**
   * The tutorial has to describe the controls the player actually has.
   *
   * "How to play" is the screen someone opens *because* the camera would not turn, so telling
   * them "Look: Mouse" there is worse than saying nothing at all.
   */
  it('tells the player to drag once pointer lock has been refused', () => {
    const look = () => input.controlHints.find((h) => h.action === 'Look')?.hint;

    // Before the first click nothing has been refused yet, so the normal hint stands.
    expect(look()).toBe('Mouse');

    dom.fire('mousedown', { button: 0, target: null });
    expect(look()).toMatch(/drag/i);
  });

  it('keeps every other control row unchanged', () => {
    dom.fire('mousedown', { button: 0, target: null });
    const hints = input.controlHints;
    expect(hints.find((h) => h.action === 'Move')?.hint).toBe('W A S D');
    expect(hints.find((h) => h.action === 'Punch')?.hint).toBe('Left mouse');
    expect(hints.find((h) => h.action === 'Push to talk')?.hint).toBe('V');
  });

  it('keyboard movement is unaffected — walking never depended on the pointer', () => {
    dom.fire('keydown', { code: 'KeyW', repeat: false, target: null, preventDefault: () => {} });
    dom.fire('keydown', { code: 'Space', repeat: false, target: null, preventDefault: () => {} });

    const out = createIntent();
    input.sample(out, 1 / 60, DEFAULT_SETTINGS);
    expect(out.moveZ).toBe(1);
    expect(out.buttons & Buttons.Jump).toBeTruthy();
  });
});

/** Stand a gamepad in front of `navigator` with exactly one button held down. */
function withPadButton(index: number, run: () => void): void {
  const host = globalThis as Record<string, unknown>;
  const saved = Object.getOwnPropertyDescriptor(host, 'navigator');
  const pad = {
    connected: true,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === index })),
  };
  Object.defineProperty(host, 'navigator', {
    value: { getGamepads: () => [pad] },
    configurable: true,
    writable: true,
  });
  try {
    run();
  } finally {
    if (saved) Object.defineProperty(host, 'navigator', saved);
    else delete host.navigator;
  }
}

/**
 * One pad button, one action.
 *
 * Gadget fire used to sit on button 5 alongside the right-hand grab, so the two fired together and
 * nothing in the mapping said so — you read the two lines eleven apart and they look fine. What it
 * cost was measured in the simulation: holding that bumper for two seconds in the Training Room
 * emitted a `gadgetUse` and took the freeze gun from 4 charges to 3, while a grab on its own spent
 * nothing. A quarter of the round's ammunition per ledge, in a game where climbing *is* the
 * movement.
 *
 * Asserted over the whole pad rather than on that one pair, because the failure is a property of
 * the mapping — any future control dropped onto an occupied index fails here the same way. Two
 * buttons sharing an *action* is fine and deliberate (L3 and the left trigger both sprint); the
 * invariant runs the other way.
 */
describe('the gamepad mapping', () => {
  let dom: ReturnType<typeof fakeDom>;
  let input: PCInput;

  beforeEach(() => {
    dom = fakeDom();
    input = new PCInput(dom.canvas);
    input.start();
  });

  afterEach(() => {
    input.stop();
    dom.restore();
  });

  /** The button mask a single held pad button produces. */
  const maskFor = (index: number): number => {
    let mask = 0;
    withPadButton(index, () => {
      const out = createIntent();
      input.sample(out, 1 / 60, DEFAULT_SETTINGS);
      mask = out.buttons;
    });
    return mask;
  };

  it('never makes one button do two things at once', () => {
    for (let index = 0; index < 17; index++) {
      const mask = maskFor(index);
      const bits = mask.toString(2).split('').filter((c) => c === '1').length;
      expect(bits, `pad button ${index} produced mask 0b${mask.toString(2)}`).toBeLessThanOrEqual(1);
    }
  });

  it('keeps grabbing and firing on separate buttons', () => {
    // The regression itself, named: the bumper climbs and nothing else.
    expect(maskFor(5)).toBe(Buttons.GrabRight);
    expect(maskFor(2)).toBe(Buttons.UseGadget);
  });

  it('still reaches every control the keyboard has', () => {
    // A mapping with no collisions is easy to get by deleting bindings, so pin the coverage too.
    const reachable = Array.from({ length: 17 }, (_, i) => maskFor(i)).reduce((a, b) => a | b, 0);
    for (const action of ['Jump', 'Sprint', 'Crouch', 'GrabLeft', 'GrabRight', 'PunchRight', 'Emote', 'UseGadget', 'CycleGadget', 'Shop', 'Talk'] as const) {
      expect(reachable & Buttons[action], `${action} is unreachable on a gamepad`).toBeTruthy();
    }
  });
});
