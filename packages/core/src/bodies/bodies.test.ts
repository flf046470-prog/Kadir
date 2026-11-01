import { describe, expect, it } from 'vitest';
// The package entry, not the modules: levels and modes register themselves when it loads.
import { BODY_DEFS, BODY_ID_BASE, Buttons, MAX_THROW_SPEED, Simulation, buildLevel, createHandIntent, createIntent } from '../index.js';
import type { Body, InputIntent } from '../index.js';

const MAPS = ['jungle-world', 'glacier-world', 'outback-station'] as const;

function sim(level = 'jungle-world'): Simulation {
  return new Simulation({ level: buildLevel(level), modeId: 'training', seed: 3 });
}

function speed(body: Body): number {
  return Math.hypot(body.velocity.x, body.velocity.y, body.velocity.z);
}

describe('loose bodies on every map', () => {
  for (const id of MAPS) {
    it(`${id}: every ball settles on a floor, out of the geometry, and goes to sleep`, () => {
      const s = sim(id);
      expect(s.level.id).toBe(id);
      expect(s.bodies.bodies.length).toBeGreaterThanOrEqual(3);
      for (let i = 0; i < 60 * 4; i++) s.step();
      for (const body of s.bodies.bodies) {
        const r = BODY_DEFS[body.kind].radius;
        // Settled: resting on something within a hand's width of where it was authored.
        expect(body.position.y, `${body.kind} y`).toBeGreaterThan(body.home.y - 1);
        expect(body.sleeping, `${body.kind} sleeping`).toBe(true);
        // Not inside anything solid: the point a radius above its centre is open air.
        expect(s.world.isPointInsideSolid({ x: body.position.x, y: body.position.y + r * 0.5, z: body.position.z })).toBe(false);
      }
    });
  }
});

describe('kicking, catching and throwing', () => {
  function runInto(s: Simulation, target: Body): { playerId: string; intent: InputIntent } {
    const player = s.addPlayer({ id: 'p', name: 'P' });
    // Stand two metres behind the ball on the side away from the lobby, facing it.
    const yaw = 0;
    player.position.x = target.position.x;
    player.position.z = target.position.z - 2.2;
    player.position.y = target.home.y - 0.3;
    const intent = createIntent();
    intent.lookYaw = yaw;
    intent.moveZ = 1;
    return { playerId: 'p', intent };
  }

  it('running into a ball kicks it forward, faster than the kangaroo was moving', () => {
    const s = sim();
    for (let i = 0; i < 120; i++) s.step();
    const ball = s.bodies.bodies.find((b) => b.kind === 'football') as Body;
    const startZ = ball.position.z;
    const { playerId, intent } = runInto(s, ball);
    let kicked = 0;
    let top = 0;
    for (let i = 0; i < 90; i++) {
      intent.tick = s.tick + 1;
      s.setIntent(playerId, intent, false);
      s.step();
      for (const e of s.events.drain()) if (e.type === 'bodyHit' && e.data === 'kick') kicked++;
      top = Math.max(top, speed(ball));
    }
    expect(kicked).toBeGreaterThan(0);
    expect(ball.position.z).toBeGreaterThan(startZ + 2);
    const runner = s.players.get(playerId);
    expect(top).toBeGreaterThan(Math.hypot(runner?.velocity.x ?? 0, runner?.velocity.z ?? 0) * 0.8);
  });

  it('PC: the grab button picks up a ball in reach and letting go throws it where you look', () => {
    const s = sim();
    for (let i = 0; i < 120; i++) s.step();
    const ball = s.bodies.bodies.find((b) => b.kind === 'football') as Body;
    const player = s.addPlayer({ id: 'p', name: 'P' });
    player.position.x = ball.position.x;
    player.position.z = ball.position.z - 0.9;
    player.position.y = ball.home.y - 0.3;
    const intent = createIntent();
    intent.lookYaw = 0;
    intent.lookPitch = 0.3;
    const drive = (buttons: number, ticks: number): void => {
      for (let i = 0; i < ticks; i++) {
        intent.buttons = buttons;
        intent.tick = s.tick + 1;
        s.setIntent('p', intent, false);
        s.step();
      }
    };
    drive(0, 10);
    drive(Buttons.GrabRight, 20);
    expect(ball.holder).toBe('p');
    // Held in front of the chest, off the ground.
    expect(ball.position.y).toBeGreaterThan(player.position.y + 0.6);
    drive(0, 1);
    expect(ball.holder).toBeNull();
    expect(ball.velocity.z).toBeGreaterThan(5);
    expect(ball.velocity.y).toBeGreaterThan(2);
    const events = s.events.drain().filter((e) => e.type === 'bodyHit').map((e) => e.data);
    expect(events).toContain('catch');
    expect(events).toContain('throw');
  });

  it('VR: a closed hand holds the ball at the hand, and a throw takes the hand’s own speed', () => {
    const s = sim();
    for (let i = 0; i < 120; i++) s.step();
    const ball = s.bodies.bodies.find((b) => b.kind === 'beachball') as Body;
    s.addPlayer({ id: 'v', name: 'V' });
    const intent = createIntent();
    intent.hands = [createHandIntent(), createHandIntent()];
    const right = intent.hands[1];
    right.tracked = true;
    right.pos = { x: 0.25, y: 1.2, z: 0.35 };
    const tick = (): void => {
      intent.tick = s.tick + 1;
      s.setIntent('v', intent, false);
      s.step();
    };
    for (let i = 0; i < 5; i++) tick();
    const hand = s.players.get('v')!.hands[1];
    // Put the ball in the open hand, then close it.
    ball.position = { ...hand.world };
    ball.sleeping = false;
    right.grip = 1;
    tick();
    expect(ball.holder).toBe('v');
    // Swing forward over a few ticks, then open.
    for (let i = 0; i < 6; i++) {
      right.pos = { x: 0.25, y: 1.2 + i * 0.04, z: 0.35 + i * 0.09 };
      tick();
    }
    expect(Math.hypot(ball.position.x - hand.world.x, ball.position.y - hand.world.y, ball.position.z - hand.world.z)).toBeLessThan(0.01);
    const handVelocity = { ...hand.velocity };
    right.grip = 0;
    tick();
    expect(ball.holder).toBeNull();
    // The server's own hand velocity (never a client number), up to a sane ceiling.
    expect(Math.abs(ball.velocity.z - handVelocity.z)).toBeLessThan(1.5);
    expect(Math.hypot(ball.velocity.x, ball.velocity.y, ball.velocity.z)).toBeLessThanOrEqual(MAX_THROW_SPEED + 1e-6);
  });

  it('a ball lost off the world goes home', () => {
    const s = sim();
    const ball = s.bodies.bodies[0] as Body;
    ball.position = { x: ball.position.x, y: s.level.killPlaneY - 5, z: ball.position.z };
    ball.sleeping = false;
    s.step();
    expect(ball.position).toEqual(ball.home);
  });

  it('is in every snapshot as a body entity, clear of gadget ids', () => {
    const s = sim();
    s.step();
    const bodies = s.snapshot().entities.filter((e) => e.kind === 'body');
    expect(bodies).toHaveLength(s.bodies.bodies.length);
    expect(bodies.every((e) => e.id >= BODY_ID_BASE && (e.gadgetId === 'football' || e.gadgetId === 'beachball'))).toBe(true);
  });

  it('costs almost nothing when nobody touches the balls', () => {
    const s = sim('outback-station');
    for (let i = 0; i < 300; i++) s.step();
    const t0 = performance.now();
    for (let i = 0; i < 600; i++) s.bodies.step(s.players.values(), 1 / 60, s.tick, s.events, s.level.killPlaneY);
    const perTick = (performance.now() - t0) / 600;
    expect(perTick).toBeLessThan(0.05);
  });
});
