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

function look(input: PCInput): { yaw: number; pitch: number; buttons: number } {
  const out = createIntent();
  input.sample(out, 1 / 60, DEFAULT_SETTINGS);
  return { yaw: out.lookYaw, pitch: out.lookPitch, buttons: out.buttons };
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

  it('keyboard movement is unaffected — walking never depended on the pointer', () => {
    dom.fire('keydown', { code: 'KeyW', repeat: false, target: null, preventDefault: () => {} });
    dom.fire('keydown', { code: 'Space', repeat: false, target: null, preventDefault: () => {} });

    const out = createIntent();
    input.sample(out, 1 / 60, DEFAULT_SETTINGS);
    expect(out.moveZ).toBe(1);
    expect(out.buttons & Buttons.Jump).toBeTruthy();
  });
});
