import { describe, expect, it } from 'vitest';

import { Buttons, DEFAULT_SETTINGS, createIntent } from '@kc/core';
import { MobileInput } from './MobileInput.js';

/**
 * Taps that are shorter than a frame.
 *
 * Touch buttons are read once per simulation step. A thumb that goes down and up inside the same
 * 16ms — easy to do, and unavoidable for anything driving the game programmatically — used to
 * leave no trace at all: the flag was already back to false by the time the game looked. On the
 * edge-detected buttons (shop, next gadget, punch, emote) that meant the tap did nothing, with no
 * feedback of any kind. These tests pin the latch that keeps a press alive until it is seen once.
 */

/** A surface, only as far as MobileInput actually touches it. */
function fakeSurface(): HTMLElement {
  return { addEventListener: () => {}, removeEventListener: () => {} } as unknown as HTMLElement;
}

function sampled(input: MobileInput): number {
  const intent = createIntent();
  input.sample(intent, 1 / 60, DEFAULT_SETTINGS);
  return intent.buttons;
}

describe('MobileInput button latching', () => {
  it('reports a press that was released before the next sample', () => {
    const input = new MobileInput(fakeSurface());
    input.setButton('shop', true);
    input.setButton('shop', false);
    expect(sampled(input) & Buttons.Shop).toBe(Buttons.Shop);
  });

  it('reports that press exactly once', () => {
    const input = new MobileInput(fakeSurface());
    input.setButton('shop', true);
    input.setButton('shop', false);
    sampled(input);
    // A single tap must not open the shop and close it again on the following frame.
    expect(sampled(input) & Buttons.Shop).toBe(0);
  });

  it('keeps reporting a button that is still held', () => {
    const input = new MobileInput(fakeSurface());
    input.setButton('jump', true);
    expect(sampled(input) & Buttons.Jump).toBe(Buttons.Jump);
    expect(sampled(input) & Buttons.Jump).toBe(Buttons.Jump);
    input.setButton('jump', false);
    expect(sampled(input) & Buttons.Jump).toBe(0);
  });

  it('does not report a button that was never pressed', () => {
    const input = new MobileInput(fakeSurface());
    input.setButton('punch', true);
    input.setButton('punch', false);
    expect(sampled(input) & Buttons.Emote).toBe(0);
  });

  it('latches each button independently', () => {
    const input = new MobileInput(fakeSurface());
    input.setButton('cycle', true);
    input.setButton('cycle', false);
    input.setButton('gadget', true);
    input.setButton('gadget', false);
    const buttons = sampled(input);
    expect(buttons & Buttons.CycleGadget).toBe(Buttons.CycleGadget);
    expect(buttons & Buttons.UseGadget).toBe(Buttons.UseGadget);
  });

  it('reaches Buttons.Crouch — no touch control produced it at all before', () => {
    const input = new MobileInput(fakeSurface());
    input.setButton('crouch', true);
    expect(sampled(input) & Buttons.Crouch).toBe(Buttons.Crouch);
    input.setButton('crouch', false);
    expect(sampled(input) & Buttons.Crouch).toBe(0);
  });
});

/** A surface that actually remembers listeners, so a synthetic swipe can be dispatched through it. */
function trackingSurface(): { element: HTMLElement; fire: (type: string, event: Record<string, unknown>) => void } {
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  const element = {
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    },
    removeEventListener: () => {},
  } as unknown as HTMLElement;
  return {
    element,
    fire(type, event) {
      for (const fn of listeners.get(type) ?? []) fn(event);
    },
  };
}

function withLook(lookSensitivity: number, invertY = false) {
  return { ...DEFAULT_SETTINGS, controls: { ...DEFAULT_SETTINGS.controls, lookSensitivity, invertY } };
}

function look(input: MobileInput, settings = DEFAULT_SETTINGS): { yaw: number; pitch: number } {
  const out = createIntent();
  input.sample(out, 1 / 60, settings);
  return { yaw: out.lookYaw, pitch: out.lookPitch };
}

/**
 * Swipe-look used to hardcode `0.0055 * 1` and never read `controls.lookSensitivity` or
 * `.invertY` at all — the "* 1" was the shape of a dropped `invertY` ternary. The Settings menu's
 * "Look sensitivity" and "Invert Y" sliders did nothing for a mobile player, the platform's only
 * way to look around. `sample()` now caches both from `settings` each tick, the same way it
 * already caches `stickRadius`, for the pointer-move handler to read.
 */
describe('swipe-look honours the look settings, which it used to hardcode', () => {
  it('scales yaw by controls.lookSensitivity instead of a fixed constant', () => {
    (globalThis as unknown as { innerWidth: number }).innerWidth = 800; // clientX 700 is the right half
    const { element, fire } = trackingSurface();
    const input = new MobileInput(element);
    input.start();

    look(input, withLook(0.5));
    fire('pointerdown', { pointerId: 1, clientX: 700, clientY: 300 });
    fire('pointermove', { pointerId: 1, clientX: 750, clientY: 300 });
    const afterLow = look(input, withLook(0.5)).yaw;
    fire('pointerup', { pointerId: 1 });

    look(input, withLook(2));
    fire('pointerdown', { pointerId: 1, clientX: 700, clientY: 300 });
    fire('pointermove', { pointerId: 1, clientX: 750, clientY: 300 });
    const afterHigh = look(input, withLook(2)).yaw;

    const deltaLow = Math.abs(afterLow);
    const deltaHigh = Math.abs(afterHigh - afterLow);
    expect(deltaHigh).toBeGreaterThan(deltaLow * 3);
  });

  it('flips pitch when invertY is on, without touching yaw', () => {
    (globalThis as unknown as { innerWidth: number }).innerWidth = 800;
    const { element, fire } = trackingSurface();
    const input = new MobileInput(element);
    input.start();

    look(input, withLook(1, false));
    fire('pointerdown', { pointerId: 1, clientX: 700, clientY: 300 });
    fire('pointermove', { pointerId: 1, clientX: 720, clientY: 340 }); // swipe down
    const normal = look(input, withLook(1, false));
    fire('pointerup', { pointerId: 1 });

    look(input, withLook(1, true));
    fire('pointerdown', { pointerId: 1, clientX: 700, clientY: 300 });
    fire('pointermove', { pointerId: 1, clientX: 720, clientY: 340 });
    const inverted = look(input, withLook(1, true));

    expect(normal.pitch).not.toBe(0);
    expect(Math.sign(inverted.pitch - normal.pitch)).toBe(-Math.sign(normal.pitch));
    // Same movementX, same sensitivity, both drags — yaw must not react to invertY at all.
    expect(inverted.yaw - normal.yaw).toBeCloseTo(normal.yaw, 5);
  });
});
