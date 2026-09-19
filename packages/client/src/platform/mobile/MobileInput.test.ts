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
});
