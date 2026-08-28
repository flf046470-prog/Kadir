import { beforeEach, describe, expect, it } from 'vitest';
import { PhysicsWorld } from '../physics/world.js';
import { SurfaceFlags, DEFAULT_SURFACE } from '../physics/types.js';
import type { Collider } from '../physics/types.js';
import { vec3 } from '../math/vec3.js';
import { SimEventQueue } from '../sim/events.js';
import type { SimEventType } from '../sim/events.js';
import { createIntent, createHandIntent, Buttons } from '../input/intent.js';
import type { InputIntent } from '../input/intent.js';
import { createPlayerState } from './state.js';
import type { PlayerState } from './state.js';
import { stepPlayer } from './locomotion.js';
import type { LocomotionContext } from './locomotion.js';
import { DEFAULT_MOVEMENT } from './config.js';

const DT = 1 / 60;

function testWorld(): PhysicsWorld {
  const colliders: Collider[] = [
    { kind: 'box', id: 0, center: vec3(0, -2, 0), half: vec3(60, 2, 60), yaw: 0, surface: { ...DEFAULT_SURFACE } },
    // Climbable wall at x = 6.
    { kind: 'box', id: 1, center: vec3(6, 6, 0), half: vec3(0.6, 6, 8), yaw: 0, surface: { ...DEFAULT_SURFACE } },
    // Bouncy mushroom.
    {
      kind: 'cylinder',
      id: 2,
      center: vec3(-8, 0.35, 0),
      radius: 1.4,
      halfHeight: 0.35,
      surface: { friction: 1, bounciness: 0.85, flags: SurfaceFlags.Bouncy | SurfaceFlags.Climbable, material: 'foliage' },
    },
  ];
  return new PhysicsWorld(colliders);
}

function makeContext(world: PhysicsWorld): LocomotionContext {
  return { world, events: new SimEventQueue(), tick: 0, killPlaneY: -40 };
}

function run(player: PlayerState, ctx: LocomotionContext, intent: InputIntent, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    ctx.tick++;
    stepPlayer(player, intent, ctx, DT);
  }
}

function typesOf(ctx: LocomotionContext): SimEventType[] {
  return ctx.events.drain().map((e) => e.type);
}

describe('locomotion — shared across platforms', () => {
  let world: PhysicsWorld;
  let ctx: LocomotionContext;
  let player: PlayerState;

  beforeEach(() => {
    world = testWorld();
    ctx = makeContext(world);
    player = createPlayerState({ id: 'p1', position: vec3(0, 0.5, 0) });
  });

  it('settles on the ground when idle', () => {
    run(player, ctx, createIntent(), 60);
    expect(player.grounded).toBe(true);
    expect(player.position.y).toBeLessThan(0.1);
  });

  it('moves forward from a stick/WASD intent', () => {
    const intent = createIntent();
    intent.moveZ = 1;
    run(player, ctx, intent, 60);
    expect(player.position.z).toBeGreaterThan(3);
    expect(Math.hypot(player.velocity.x, player.velocity.z)).toBeGreaterThan(3);
  });

  it('respects the movement speed cap', () => {
    const intent = createIntent();
    intent.moveZ = 1;
    run(player, ctx, intent, 300);
    const speed = Math.hypot(player.velocity.x, player.velocity.z);
    expect(speed).toBeLessThanOrEqual(DEFAULT_MOVEMENT.maxSpeed * 1.05);
  });

  it('sprints faster than walking but drains stamina', () => {
    const walk = createIntent();
    walk.moveZ = 1;
    run(player, ctx, walk, 120);
    const walkSpeed = Math.hypot(player.velocity.x, player.velocity.z);

    const sprinter = createPlayerState({ id: 'p2', position: vec3(0, 0.5, 0) });
    const ctx2 = makeContext(world);
    const sprint = createIntent();
    sprint.moveZ = 1;
    sprint.buttons = Buttons.Sprint;
    run(sprinter, ctx2, sprint, 120);
    const sprintSpeed = Math.hypot(sprinter.velocity.x, sprinter.velocity.z);

    expect(sprintSpeed).toBeGreaterThan(walkSpeed);
    expect(sprinter.stamina).toBeLessThan(100);
  });

  it('jumps when the jump button is released, and charging jumps higher', () => {
    const tap = createIntent();
    tap.buttons = Buttons.Jump;
    run(player, ctx, tap, 30); // settle + press
    run(player, ctx, createIntent(), 1); // release
    typesOf(ctx);
    let peakTap = player.position.y;
    for (let i = 0; i < 60; i++) {
      ctx.tick++;
      stepPlayer(player, createIntent(), ctx, DT);
      peakTap = Math.max(peakTap, player.position.y);
    }

    const charger = createPlayerState({ id: 'p3', position: vec3(0, 0.5, 0) });
    const ctx2 = makeContext(world);
    run(charger, ctx2, createIntent(), 30);
    const hold = createIntent();
    hold.buttons = Buttons.Jump;
    run(charger, ctx2, hold, 40); // full charge (0.55 s ≈ 33 ticks)
    let peakCharged = charger.position.y;
    for (let i = 0; i < 90; i++) {
      ctx2.tick++;
      stepPlayer(charger, createIntent(), ctx2, DT);
      peakCharged = Math.max(peakCharged, charger.position.y);
    }

    expect(peakTap).toBeGreaterThan(0.8);
    expect(peakCharged).toBeGreaterThan(peakTap);
  });

  it('emits a jump event and a land event across a hop', () => {
    run(player, ctx, createIntent(), 30);
    typesOf(ctx);
    const press = createIntent();
    press.buttons = Buttons.Jump;
    run(player, ctx, press, 5);
    run(player, ctx, createIntent(), 90);
    const events = typesOf(ctx);
    expect(events).toContain('jump');
    expect(events).toContain('land');
  });

  it('bounces off a bouncy surface without any input', () => {
    const bouncer = createPlayerState({ id: 'p4', position: vec3(-8, 6, 0) });
    run(bouncer, ctx, createIntent(), 120);
    expect(typesOf(ctx).filter((t) => t === 'jump').length).toBeGreaterThan(0);
    expect(bouncer.position.y).toBeGreaterThan(0.6);
  });

  it('climbs a wall on PC/Mobile by holding grab', () => {
    const climber = createPlayerState({ id: 'p5', position: vec3(4.6, 0.5, 0) });
    climber.yaw = Math.PI / 2; // face +x, toward the wall
    const intent = createIntent();
    intent.lookYaw = Math.PI / 2;
    intent.buttons = Buttons.GrabLeft;
    intent.moveZ = 1; // climb up
    run(climber, ctx, intent, 90);
    expect(climber.climbing).toBe(true);
    expect(climber.position.y).toBeGreaterThan(1.5);
    expect(typesOf(ctx)).toContain('grab');
  });

  it('launches off a grip when jumping while climbing', () => {
    const climber = createPlayerState({ id: 'p6', position: vec3(4.6, 0.5, 0) });
    const intent = createIntent();
    intent.lookYaw = Math.PI / 2;
    intent.buttons = Buttons.GrabLeft;
    intent.moveZ = 1;
    run(climber, ctx, intent, 60);
    const heightBefore = climber.position.y;
    typesOf(ctx);
    intent.buttons = Buttons.GrabLeft | Buttons.Jump;
    run(climber, ctx, intent, 2);
    expect(climber.climbing).toBe(false);
    expect(typesOf(ctx)).toContain('climbLaunch');
    expect(climber.velocity.y).toBeGreaterThan(0);
    expect(heightBefore).toBeGreaterThan(1);
  });
});

describe('VR hand physics', () => {
  let world: PhysicsWorld;
  let ctx: LocomotionContext;

  beforeEach(() => {
    world = testWorld();
    ctx = makeContext(world);
  });

  function vrIntent(handLocal: { x: number; y: number; z: number }, grip: number): InputIntent {
    const intent = createIntent();
    intent.hands = [createHandIntent(), createHandIntent()];
    const right = intent.hands[1];
    right.tracked = true;
    right.grip = grip;
    right.pos = { ...handLocal };
    intent.headHeight = 1.6;
    return intent;
  }

  it('anchors a hand to a grabbable surface and holds the player up', () => {
    const player = createPlayerState({ id: 'v1', position: vec3(4.8, 3, 0) });
    // Hand reaching toward the wall at x = 6 (wall face at x = 5.4).
    const intent = vrIntent({ x: 0, y: 1.4, z: 0.62 }, 1);
    intent.lookYaw = Math.PI / 2;
    run(player, ctx, intent, 30);
    expect(player.hands[1].anchored).toBe(true);
    const yAfterHang = player.position.y;
    run(player, ctx, intent, 60);
    // Hanging drifts slowly, it does not free-fall.
    expect(yAfterHang - player.position.y).toBeLessThan(1.2);
  });

  it('pulls the body when an anchored hand moves relative to it', () => {
    const player = createPlayerState({ id: 'v2', position: vec3(4.8, 3, 0) });
    const intent = vrIntent({ x: 0, y: 1.4, z: 0.62 }, 1);
    intent.lookYaw = Math.PI / 2;
    run(player, ctx, intent, 20);
    expect(player.hands[1].anchored).toBe(true);

    const startY = player.position.y;
    // Pull the hand down relative to the body → the body must climb.
    for (let i = 0; i < 30; i++) {
      ctx.tick++;
      const hand = intent.hands?.[1];
      if (hand) hand.pos.y = Math.max(0.4, hand.pos.y - 0.02);
      stepPlayer(player, intent, ctx, DT);
    }
    expect(player.position.y).toBeGreaterThan(startY);
  });

  it('keeps momentum after releasing the grip', () => {
    const player = createPlayerState({ id: 'v3', position: vec3(4.8, 3, 0) });
    const intent = vrIntent({ x: 0, y: 1.4, z: 0.62 }, 1);
    intent.lookYaw = Math.PI / 2;
    run(player, ctx, intent, 20);

    for (let i = 0; i < 10; i++) {
      ctx.tick++;
      const hand = intent.hands?.[1];
      if (hand) hand.pos.y -= 0.05;
      stepPlayer(player, intent, ctx, DT);
    }
    const speedWhileHeld = player.velocity.y;
    expect(speedWhileHeld).toBeGreaterThan(1);

    const release = intent.hands?.[1];
    if (release) release.grip = 0;
    ctx.tick++;
    stepPlayer(player, intent, ctx, DT);
    expect(player.hands[1].anchored).toBe(false);
    // Momentum is preserved through the release (minus one tick of gravity).
    expect(player.velocity.y).toBeGreaterThan(speedWhileHeld - 1);
  });

  it('does not let a hand grab a NoGrip surface', () => {
    const smooth = new PhysicsWorld([
      { kind: 'box', id: 0, center: vec3(0, -2, 0), half: vec3(30, 2, 30), yaw: 0, surface: { ...DEFAULT_SURFACE } },
      {
        kind: 'box',
        id: 1,
        center: vec3(6, 6, 0),
        half: vec3(0.6, 6, 8),
        yaw: 0,
        surface: { friction: 1, bounciness: 0, flags: SurfaceFlags.NoGrip, material: 'stone' },
      },
    ]);
    const ctx2 = makeContext(smooth);
    const player = createPlayerState({ id: 'v4', position: vec3(4.8, 3, 0) });
    const intent = vrIntent({ x: 0, y: 1.4, z: 0.62 }, 1);
    intent.lookYaw = Math.PI / 2;
    run(player, ctx2, intent, 30);
    expect(player.hands[1].anchored).toBe(false);
  });
});
