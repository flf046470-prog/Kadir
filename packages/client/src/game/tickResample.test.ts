import { describe, expect, it } from 'vitest';

import { DEFAULT_SURFACE, PhysicsWorld, SimEventQueue, TICK_DT, createHandIntent, createIntent, createPlayerState, stepPlayer, vec3 } from '@kc/core';
import type { Collider } from '@kc/core';

import { TickResampler, tickAlpha } from './tickResample.js';

/**
 * A headset at 72–144 Hz drives a 60 Hz simulation. Run a steady 2 m/s climbing pull through the
 * same loop `GameClient.frame` runs — frames sampled at the display's rate, ticks taken from an
 * accumulator — and let go at many moments and frame phases. The speed kept on letting go must be
 * what the same pull gives at 60 Hz.
 */
const world = new PhysicsWorld([
  { kind: 'box', id: 0, center: vec3(0, -2, 0), half: vec3(60, 2, 60), yaw: 0, surface: { ...DEFAULT_SURFACE } },
  { kind: 'box', id: 1, center: vec3(6, 15, 0), half: vec3(0.6, 15, 8), yaw: 0, surface: { ...DEFAULT_SURFACE } },
] as Collider[]);

function releaseSpeed(hz: number, phase: number, releaseAt: number, resampled: boolean): number {
  const ctx = { world, events: new SimEventQueue(), tick: 0, killPlaneY: -40 };
  const player = createPlayerState({ id: 'v', position: vec3(4.8, 3, 0) });
  const intent = createIntent();
  intent.hands = [createHandIntent(), createHandIntent()];
  intent.headHeight = 1.6;
  intent.lookYaw = Math.PI / 2;
  const hand = intent.hands[1];
  hand.tracked = true;
  hand.pos = { x: 0, y: 1.6, z: 0.62 };
  const step = (): void => {
    ctx.tick++;
    stepPlayer(player, intent, ctx, TICK_DT);
  };
  hand.grip = 1;
  for (let i = 0; i < 30; i++) step();

  const resampler = new TickResampler();
  const frame = 1 / hz;
  let t = (phase * frame) % frame;
  let accumulator = t;
  for (let guard = 0; guard < 1000; guard++) {
    // What the platform samples at this frame: the hand pulled down at 2 m/s, open after `releaseAt`.
    hand.pos.y = 1.6 - 2 * Math.min(t, 0.3);
    hand.grip = t < releaseAt ? 1 : 0;
    if (resampled) resampler.capture(intent);
    while (accumulator >= TICK_DT) {
      accumulator -= TICK_DT;
      if (resampled) resampler.apply(intent, tickAlpha(frame, accumulator));
      step();
      // Let go as the simulation decides it, at its own grip threshold.
      if (!player.hands[1].gripHeld) return player.velocity.y;
    }
    if (resampled) resampler.endFrame(intent);
    t += frame;
    accumulator += frame;
  }
  throw new Error('never let go');
}

function worstOff(hz: number, resampled: boolean): number {
  const reference = releaseSpeed(60, 0, 0.2, false);
  let worst = 0;
  for (let phase = 0; phase < 1; phase += 0.1) {
    for (const at of [0.18, 0.2, 0.213, 0.227]) {
      worst = Math.max(worst, Math.abs(releaseSpeed(hz, phase, at, resampled) / reference - 1));
    }
  }
  return worst;
}

describe('headset poses resampled to tick time', () => {
  it('lets go of a climb at the 60 Hz speed whatever the headset draws at', () => {
    for (const hz of [72, 80, 90, 120, 144]) expect(worstOff(hz, true), `${hz} Hz`).toBeLessThan(0.02);
  });

  it('is needed: sampled at frame time, a 72 Hz headset is well off', () => {
    expect(worstOff(72, false)).toBeGreaterThan(0.08);
  });

  it('places a tick between two frames by where it falls in the accumulator', () => {
    expect(tickAlpha(1 / 72, 0)).toBe(1);
    expect(tickAlpha(1 / 72, 1 / 144)).toBeCloseTo(0.5, 9);
    expect(tickAlpha(1 / 72, 1)).toBe(0);
    expect(tickAlpha(0, 0)).toBe(1);
  });

  it('turns the head the short way round, and leaves the intent holding the frame’s own sample', () => {
    const r = new TickResampler();
    const intent = createIntent();
    intent.hands = [createHandIntent(), createHandIntent()];
    intent.hands[0].tracked = true;
    intent.lookYaw = 3;
    r.capture(intent);
    r.endFrame(intent);
    intent.lookYaw = -3;
    intent.hands[0].pos.x = 1;
    r.capture(intent);
    r.apply(intent, 0.5);
    // 3 and -3 are 0.28 rad apart across ±π, not 6 rad apart through 0.
    expect(Math.abs(Math.abs(intent.lookYaw) - Math.PI)).toBeLessThan(0.01);
    expect(intent.hands[0].pos.x).toBeCloseTo(0.5, 9);
    r.endFrame(intent);
    expect(intent.lookYaw).toBe(-3);
    expect(intent.hands[0].pos.x).toBe(1);
  });

  it('does not blend a hand from where it was before tracking began', () => {
    const r = new TickResampler();
    const intent = createIntent();
    intent.hands = [createHandIntent(), createHandIntent()];
    intent.hands[0].pos.x = 5; // untracked: a stale pose
    r.capture(intent);
    r.endFrame(intent);
    intent.hands[0].tracked = true;
    intent.hands[0].pos.x = 0.3;
    r.capture(intent);
    r.apply(intent, 0.5);
    expect(intent.hands[0].pos.x).toBe(0.3);
  });
});
