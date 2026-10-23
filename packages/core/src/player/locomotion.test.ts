import { beforeEach, describe, expect, it } from 'vitest';
import { PhysicsWorld } from '../physics/world.js';
import { SurfaceFlags, DEFAULT_SURFACE } from '../physics/types.js';
import type { Collider } from '../physics/types.js';
import { v3length, vec3 } from '../math/vec3.js';
import { SimEventQueue } from '../sim/events.js';
import type { SimEventType } from '../sim/events.js';
import { createIntent, createHandIntent, Buttons } from '../input/intent.js';
import type { HandIntent, InputIntent } from '../input/intent.js';
import { createPlayerState, respawnPlayer } from './state.js';
import type { HandState, PlayerState } from './state.js';
import { stepPlayer } from './locomotion.js';
import type { LocomotionContext } from './locomotion.js';
import { DEFAULT_MOVEMENT } from './config.js';
import { DEFAULT_COMBAT } from './combat.js';

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

  it('shoves the body away from a surface with an open-palm push, without ever gripping', () => {
    // applyPalmPush had no test at all before this: it is the "shove off a wall with an open
    // hand" mechanic VRInput's own control hints advertise, reachable only by moving a tracked,
    // ungripped hand fast into geometry — exactly the case none of the anchor/pull/release tests
    // above exercise, since they all hold grip at 1.
    const player = createPlayerState({ id: 'v5', position: vec3(5.0, 3, 0) });
    const intent = vrIntent({ x: 0, y: 1.4, z: 0.3 }, 0); // grip 0: an open palm, never a grab
    intent.lookYaw = Math.PI / 2; // facing +x, toward the wall face at x = 5.4
    run(player, ctx, intent, 10); // let the hand settle before measuring
    expect(player.hands[1].anchored).toBe(false);

    const vxBefore = player.velocity.x;
    for (let i = 0; i < 10; i++) {
      ctx.tick++;
      const hand = intent.hands?.[1];
      if (hand) hand.pos.z += 0.05; // thrust the open hand further into the wall each tick
      stepPlayer(player, intent, ctx, DT);
    }
    expect(player.hands[1].anchored).toBe(false); // an open palm never grips, however hard it hits
    expect(player.velocity.x).toBeLessThan(vxBefore); // pushed back, away from the surface
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

/**
 * The Gorilla Tag lab's P0 gates for arm locomotion, measured on this game's own `stepPlayer`.
 *
 * A hand that moves faster than a hand can is not effort. Before this, every one of these moved
 * the player: a controller coming back from lost tracking (VRInput reports the last pose until
 * then) threw a player holding a wall 19 m up; a snap turn while holding on lurched the body at
 * 21 m/s; closing a hand 0.2 m short of a wall yanked the body into it at 12 m/s; and a modified
 * client yanking its hand 0.55 m a tick travelled along a wall at 17 m/s against a fast human's 5.
 */
describe('a hand that jumps is not a pull', () => {
  let world: PhysicsWorld;
  let ctx: LocomotionContext;

  beforeEach(() => {
    world = testWorld();
    ctx = makeContext(world);
  });

  function handOf(intent: InputIntent): HandIntent {
    const hand = intent.hands?.[1];
    if (!hand) throw new Error('the right hand is missing');
    return hand;
  }

  /** Holding the wall at x = 6 (face 5.4) with the given hands, settled. */
  function holding(hands: (0 | 1)[] = [1]): { player: PlayerState; intent: InputIntent } {
    const player = createPlayerState({ id: 'gt', position: vec3(4.8, 3, 0) });
    const intent = createIntent();
    intent.hands = [createHandIntent(), createHandIntent()];
    intent.headHeight = 1.6;
    intent.lookYaw = Math.PI / 2;
    for (const i of hands) {
      const hand = intent.hands[i];
      hand.tracked = true;
      hand.grip = 1;
      hand.pos = { x: i === 0 ? -0.25 : 0.25, y: 1.4, z: 0.62 };
    }
    run(player, ctx, intent, 30);
    for (const i of hands) expect(player.hands[i].anchored).toBe(true);
    return { player, intent };
  }

  function apexAfter(player: PlayerState, intent: InputIntent): number {
    const from = player.position.y;
    let apex = from;
    for (let i = 0; i < 120; i++) {
      ctx.tick++;
      stepPlayer(player, intent, ctx, DT);
      apex = Math.max(apex, player.position.y);
    }
    return apex - from;
  }

  it('does not throw a player whose controller comes back from lost tracking', () => {
    const { player, intent } = holding();
    const hand = handOf(intent);
    const y = player.position.y;
    hand.pos.y -= 0.5; // the hand moved while its pose was frozen, and arrives all at once
    run(player, ctx, intent, 1);
    expect(player.hands[1].jumped).toBe(true);
    expect(player.hands[1].anchored).toBe(true); // still on the wall, so still holding it
    expect(Math.abs(player.position.y - y)).toBeLessThan(0.02);
    hand.grip = 0;
    run(player, ctx, intent, 1);
    expect(apexAfter(player, intent)).toBeLessThan(0.1); // was 19 m
  });

  it('turns a player who snap turns while holding on, without moving them', () => {
    // Every snap angle the settings allow down to the smallest: a 15° snap swings a held hand
    // 0.17 m, under a pose jump, and only the turn rate gives it away (`HEAD_TURN_LIMIT`).
    for (const degrees of [15, 30]) {
      const { player, intent } = holding();
      const at = { ...player.position };
      intent.lookYaw += (degrees * Math.PI) / 180;
      run(player, ctx, intent, 1);
      expect(player.hands[1].anchored, `${degrees}°`).toBe(true);
      expect(Math.hypot(player.position.x - at.x, player.position.z - at.z), `${degrees}°`).toBeLessThan(0.02);
      handOf(intent).grip = 0;
      run(player, ctx, intent, 1);
      expect(Math.hypot(player.velocity.x, player.velocity.z), `${degrees}°`).toBeLessThan(1); // was 11.6 and 22.9 m/s
    }
  });

  it('does not yank the body into a wall when the hand closes short of it', () => {
    const player = createPlayerState({ id: 'gt', position: vec3(4.8, 0, 0) });
    const intent = createIntent();
    intent.hands = [createHandIntent(), createHandIntent()];
    intent.headHeight = 1.6;
    intent.lookYaw = Math.PI / 2;
    const hand = intent.hands[1];
    hand.tracked = true;
    hand.pos = { x: 0, y: 1.4, z: 0.4 }; // 0.2 m short of the wall face
    run(player, ctx, intent, 30);
    const x = player.position.x;
    hand.grip = 1;
    run(player, ctx, intent, 1);
    expect(player.hands[1].anchored).toBe(true);
    expect(Math.abs(player.position.x - x)).toBeLessThan(0.01); // was 0.2 m in one tick
  });

  it('moves nobody for a hand that is teleported to pull', () => {
    // A modified client climbing a wall sideways: reach ahead and grab, yank the hand 0.55 m back
    // in one tick, let go, repeat. It travelled at 17 m/s; every yank is now a pose jump.
    const player = createPlayerState({ id: 'gt', position: vec3(4.9, 0.5, 0) });
    const intent = createIntent();
    intent.hands = [createHandIntent(), createHandIntent()];
    intent.headHeight = 1.6;
    intent.lookYaw = 0; // facing along the wall, which is on the right
    const hand = intent.hands[1];
    hand.tracked = true;
    hand.pos = { x: 0.45, y: 1.2, z: 0 };
    run(player, ctx, intent, 20);
    const z = player.position.z;
    for (let i = 0; i < 180; i++) {
      const phase = i % 3;
      hand.grip = phase === 2 ? 0 : 1;
      hand.pos.z = phase === 0 ? 0.45 : -0.1;
      run(player, ctx, intent, 1);
    }
    expect(Math.abs(player.position.z - z)).toBeLessThan(0.3);
  });

  it('moves the body no faster than a human hand, however a client moves two of them', () => {
    const { player, intent } = holding([0, 1]);
    let fastest = 0;
    for (let i = 0; i < 12; i++) {
      for (const hand of intent.hands ?? []) hand.pos.y -= 0.19; // just under a pose jump
      run(player, ctx, intent, 1);
      fastest = Math.max(fastest, v3length(player.velocity));
    }
    // Two hands are stronger (`handTwoHandMultiplier`), but never faster than one hand can move.
    expect(fastest).toBeLessThanOrEqual(DEFAULT_MOVEMENT.maxHandSpeed + 0.5);
  });

  /** A 2 m/s pull sampled once per display frame into 60 Hz ticks, as GameClient does it. */
  function releaseSpeed(displayHz: number, stroke: (u: number) => number, seconds: number, letGoAt: number): number {
    const { player, intent } = holding();
    const hand = handOf(intent);
    const from = hand.pos.y;
    let t = 0;
    let owed = 0;
    for (;;) {
      t += 1 / displayHz;
      owed += 1 / displayHz;
      hand.pos.y = from - stroke(Math.min(t, letGoAt * seconds) / seconds);
      hand.grip = t < letGoAt * seconds ? 1 : 0;
      while (owed >= DT) {
        owed -= DT;
        run(player, ctx, intent, 1);
        if (hand.grip === 0) return player.velocity.y;
      }
    }
  }

  it('lets go at nearly the same speed whatever the headset refresh rate', () => {
    // A steady 2 m/s pull. The last tick alone read it as 0.93–2.27 m/s at 90 Hz and 21 % slow at
    // 72, because a tick holds one frame of motion or two; the mean of the last 100 ms is within
    // 10 % at every rate and phase measured. The Gorilla Tag lab asks for 5 %: what is left is the
    // frame that straddles the release, which only interpolating poses to the tick can remove.
    const steady = (u: number) => 0.5 * u;
    const at60 = releaseSpeed(60, steady, 0.25, 1);
    for (const hz of [72, 80, 90, 120, 144]) {
      for (let phase = 0; phase < 1; phase += 0.1) {
        const speed = releaseSpeed(hz, steady, 0.25 + phase / hz, 1);
        expect(Math.abs(speed - at60) / at60, `${hz} Hz, phase ${phase.toFixed(1)}`).toBeLessThan(0.1);
      }
    }
  });

  it('keeps the stroke when the hand lets go as it slows, which is when a real hand lets go', () => {
    // A 0.3 s stroke that eases in and out. Released at its end, the last tick saw a hand
    // already stopping and kept −0.28 m/s: a full stroke with nothing to show for it.
    const eased = (u: number) => (0.6 * (1 - Math.cos(Math.PI * u))) / 2;
    expect(releaseSpeed(90, eased, 0.3, 1)).toBeGreaterThan(0.8);
  });
});

/**
 * The punch button, on the two platforms that have one.
 *
 * `resolvePunches` decides a punch purely from hand velocity — it has to, because in VR the
 * tracked hand *is* the punch and there is no button to read. The comment there promised that
 * "on PC/Mobile the platform layer synthesises a hand thrust when the punch button is pressed",
 * and nothing anywhere did it: `Buttons.PunchLeft` and `Buttons.PunchRight` were set by the PC and
 * mobile input layers and read by no one.
 *
 * Measured in the real simulation before this existed — two players toe to toe for five seconds,
 * one holding the punch button — the victim finished on 100.0 of 100 health. Holding *grab*
 * instead took them to 84.3, because grab is what extends the arm. Melee on two of three platforms
 * was impossible with the button meant for it and an accident on the climbing button, in a game
 * with a boxing mode and a mode whose every catch starts a fistfight.
 */
describe('the punch button on PC and mobile', () => {
  function standing(): { player: PlayerState; ctx: LocomotionContext; intent: InputIntent } {
    const world = testWorld();
    const ctx = makeContext(world);
    const player = createPlayerState({ id: 'p', position: vec3(0, 1, 0) });
    const intent = createIntent();
    intent.headHeight = 1.6;
    // Settle onto the floor before measuring anything.
    run(player, ctx, intent, 30);
    return { player, ctx, intent };
  }

  /** Fastest the given hand moves relative to the body over `ticks` — what decides a punch. */
  function peakHandSpeed(player: PlayerState, ctx: LocomotionContext, intent: InputIntent, hand: 0 | 1, ticks: number): number {
    let peak = 0;
    for (let i = 0; i < ticks; i++) {
      ctx.tick++;
      stepPlayer(player, intent, ctx, DT);
      const h = player.hands[hand];
      if (!h) continue;
      peak = Math.max(
        peak,
        Math.hypot(h.velocity.x - player.velocity.x, h.velocity.y - player.velocity.y, h.velocity.z - player.velocity.z),
      );
    }
    return peak;
  }

  it('throws the hand fast enough to count as a punch', () => {
    const { player, ctx, intent } = standing();
    intent.buttons = Buttons.PunchRight;
    // DEFAULT_COMBAT.punchSpeed is 3.4 m/s; below it the resolver ignores the hand entirely.
    expect(peakHandSpeed(player, ctx, intent, 1, 30)).toBeGreaterThan(3.4);
  });

  it('does nothing at all without the button', () => {
    const { player, ctx, intent } = standing();
    intent.buttons = 0;
    expect(peakHandSpeed(player, ctx, intent, 1, 30)).toBeLessThan(3.4);
  });

  it('throws the hand the button asked for and not the other one', () => {
    const { player, ctx, intent } = standing();
    intent.buttons = Buttons.PunchLeft;
    const left = peakHandSpeed(player, ctx, intent, 0, 30);
    const { player: p2, ctx: c2, intent: i2 } = standing();
    i2.buttons = Buttons.PunchLeft;
    const right = peakHandSpeed(p2, c2, i2, 1, 30);
    expect(left).toBeGreaterThan(3.4);
    expect(right).toBeLessThan(3.4);
  });

  it('reaches further than a held grab, which is what used to be the only melee', () => {
    const forward = (buttons: number): number => {
      const { player, ctx, intent } = standing();
      intent.buttons = buttons;
      let furthest = 0;
      for (let i = 0; i < 30; i++) {
        ctx.tick++;
        stepPlayer(player, intent, ctx, DT);
        const h = player.hands[1];
        if (!h) continue;
        furthest = Math.max(furthest, Math.hypot(h.world.x - player.position.x, h.world.z - player.position.z));
      }
      return furthest;
    };
    expect(forward(Buttons.PunchRight)).toBeGreaterThan(forward(Buttons.GrabRight));
  });

  it('punches where the player is looking, so a non-VR player can aim for the head', () => {
    /**
     * Without this every non-VR punch is a body shot, which hands VR the 1.6x head multiplier as a
     * permanent platform advantage in the two modes built on fighting. Positive pitch is up: the
     * mouse handler accumulates `pitch - movementY`, and the camera builds its forward vector as
     * `sin(pitch)` on Y.
     */
    // The height of the fist *at full extension* — not the highest it ever gets, which is the
    // resting pose between throws and is identical whichever way the punch was aimed.
    const fistHeightAtFullReach = (pitch: number): number => {
      const { player, ctx, intent } = standing();
      intent.buttons = Buttons.PunchRight;
      intent.lookPitch = pitch;
      let furthest = 0;
      let height = 0;
      for (let i = 0; i < 30; i++) {
        ctx.tick++;
        stepPlayer(player, intent, ctx, DT);
        const h = player.hands[1];
        if (!h) continue;
        const reach = Math.hypot(h.world.x - player.position.x, h.world.z - player.position.z);
        if (reach > furthest) {
          furthest = reach;
          height = h.world.y - player.position.y;
        }
      }
      return height;
    };
    expect(fistHeightAtFullReach(0.7)).toBeGreaterThan(fistHeightAtFullReach(0));
    expect(fistHeightAtFullReach(-0.7)).toBeLessThan(fistHeightAtFullReach(0));
  });

  /**
   * A swing that misses used to be silent in every channel.
   *
   * `combat.ts` emits `punchHit` only when a punch *connects*. Measured toe to toe, holding the
   * button for 20 s: **87 swings thrown, 3 landed** — so 84 of 87 produced no sound, no pulse and
   * nothing on the HUD. On a button platform that makes a whiff indistinguishable from a button
   * that is not bound, and `GameClient.playHaptics` had carried a `case 'punch':` label for an
   * event nothing in the game ever emitted.
   */
  describe('announces the swing itself, not only the ones that land', () => {
    it('emits one punch event per throw, naming the fist', () => {
      const { player, ctx, intent } = standing();
      ctx.events.drain();
      intent.buttons = Buttons.PunchRight;
      ctx.tick++;
      stepPlayer(player, intent, ctx, DT);
      const events = ctx.events.drain().filter((e) => e.type === 'punch');
      expect(events).toHaveLength(1);
      expect(events[0]?.playerId).toBe('p');
      expect(events[0]?.data).toBe('right');
    });

    it('throws at the throw cadence, not once per tick', () => {
      // PUNCH_EXTEND + PUNCH_RETRACT is 0.22 s, so a second of holding is about 4-5 swings. A
      // per-tick emit would be 60. This is the same `ready()` gate that already makes mashing
      // pointless, which is why the cue cannot outrun the animation it belongs to.
      const { player, ctx, intent } = standing();
      ctx.events.drain();
      intent.buttons = Buttons.PunchRight;
      run(player, ctx, intent, 60);
      const thrown = ctx.events.drain().filter((e) => e.type === 'punch').length;
      expect(thrown).toBeGreaterThan(2);
      expect(thrown).toBeLessThan(8);
    });

    it('stays silent while the player is only hopping', () => {
      /**
       * The regression this exists for. The obvious place to emit was the moment hand speed
       * crosses `DEFAULT_COMBAT.punchSpeed` in `resolvePunches` — and that is not a punch:
       * measured over 60 s of boxing with the punch buttons masked off entirely, a player's
       * procedurally-placed hands cross that threshold **1056 times**, purely from hopping.
       * Masking the buttons changed the count by zero, which is what proved the crossings had
       * nothing to do with punching. A cue there would be a seventeen-a-second buzz.
       */
      const { player, ctx, intent } = standing();
      ctx.events.drain();
      let fastHandTicks = 0;
      for (let i = 0; i < 180; i++) {
        intent.buttons = i % 30 === 0 ? Buttons.Jump : 0;
        ctx.tick++;
        stepPlayer(player, intent, ctx, DT);
        for (const hand of player.hands) {
          const speed = Math.hypot(
            hand.velocity.x - player.velocity.x,
            hand.velocity.y - player.velocity.y,
            hand.velocity.z - player.velocity.z,
          );
          if (speed >= DEFAULT_COMBAT.punchSpeed) fastHandTicks++;
        }
      }
      const types = typesOf(ctx);
      expect(types).toContain('jump');
      // The hands really do outrun the punch threshold while hopping — otherwise this test would
      // pass for the wrong reason, proving only that the probe never provoked the case.
      expect(fastHandTicks).toBeGreaterThan(0);
      expect(types).not.toContain('punch');
    });

    it('stays silent for a VR player, whose arm is the punch', () => {
      // `startPunchThrows` returns early on tracked hands, so there is no button press to
      // announce. A headset player already knows they swung: they swung.
      const { player, ctx, intent } = standing();
      ctx.events.drain();
      intent.hands = [createHandIntent(), createHandIntent()];
      for (const hand of intent.hands) {
        hand.tracked = true;
        hand.pos.x = 0.3;
        hand.pos.y = 1;
        hand.pos.z = 0.2;
      }
      intent.buttons = Buttons.PunchRight;
      run(player, ctx, intent, 30);
      expect(typesOf(ctx)).not.toContain('punch');
    });
  });

  it('leaves a VR player’s tracked hands alone', () => {
    /**
     * A headset punches by moving its arm. Synthesising a thrust on top of that would let a VR
     * player punch with a button *and* their hand, which is both a cross-play fairness problem and
     * a hand that visibly teleports away from the controller.
     */
    const { player, ctx, intent } = standing();
    intent.hands = [createHandIntent(), createHandIntent()];
    for (const hand of intent.hands) {
      hand.tracked = true;
      hand.pos.x = 0.3;
      hand.pos.y = 1;
      hand.pos.z = 0.2;
    }
    intent.buttons = Buttons.PunchRight;
    run(player, ctx, intent, 20);
    const h = player.hands[1] as NonNullable<(typeof player.hands)[1]>;
    expect(h.tracked).toBe(true);
    // No throw is even armed, which matters beyond the pose: a controller is allowed to drop out
    // mid-press (asleep, or out of the headset's view), and a throw armed while tracked would fire
    // itself on the frame the hand goes untracked.
    expect(h.punchThrow).toBe(0);
    // Still exactly where the controller says it is, 0.2 m in front at the pose given.
    expect(Math.hypot(h.world.x - player.position.x, h.world.z - player.position.z)).toBeCloseTo(
      Math.hypot(0.3, 0.2),
      4,
    );
  });

  /**
   * One punch button has to reach both fists.
   *
   * PC and mobile have a single punch button and the bit it sends says `PunchRight`, so a held
   * button used to fight one-handed and stand idle through every cooldown, while a headset player
   * throws with two tracked hands and a bot flips a coin between its own. Measured toe to toe over
   * eight seconds in the real simulation: one hand landed **13** punches, two landed **20** — a
   * matchup decided by which device someone owns, in the two modes built entirely on punching.
   * Over forty seconds after this, all three input styles land exactly 102.
   */
  it('keeps punching with the other fist while the named one recovers', () => {
    const { player, ctx, intent } = standing();
    const [left, right] = player.hands as [HandState, HandState];

    // `punchCooldown` is set by `combat.ts` when a punch resolves, never by locomotion, so a
    // recovering fist only exists here if it is put there.
    right.punchCooldown = 0.3;
    intent.buttons = Buttons.PunchRight;
    run(player, ctx, intent, 1);

    expect(right.punchThrow, 'the recovering fist threw anyway').toBe(0);
    expect(left.punchThrow, 'the free fist stood idle through the whole cooldown').toBeGreaterThan(0);
  });

  it('throws one fist at a time rather than windmilling both', () => {
    /**
     * The first version of the fallback fired the moment the named hand was *unavailable*, which
     * included being mid-throw. Measured in the real simulation, that put both arms out one tick
     * apart and kept them out for as long as the button was held — `R@0 L@1`, a two-fisted
     * windmill and nothing like a boxer. Waiting for the named fist to finish its throw is what
     * makes it a jab: the same measurement then reads `R@0 L@98 R@113 L@129`, one arm at a time.
     */
    const { player, ctx, intent } = standing();
    const [left, right] = player.hands as [HandState, HandState];

    intent.buttons = Buttons.PunchRight;
    run(player, ctx, intent, 1);
    expect(right.punchThrow, 'the named fist did not throw').toBeGreaterThan(0);

    // Still extending. The other fist must wait its turn rather than join in.
    run(player, ctx, intent, 1);
    expect(left.punchThrow, 'the second fist joined a throw already in flight').toBe(0);
  });
});

/**
 * `HandState.world`/`prevWorld` default to the world origin and were left untouched by a
 * respawn, so the tick a hand's pose is first computed — at spawn, and again the tick right
 * after every respawn, since falling and respawning is normal and constant in this game — used
 * to read as `(new position − stale position) / dt`: hundreds of metres per second from nothing
 * but a teleport, with no player input at all. That trivially cleared `resolvePunches`' 3.4 m/s
 * punch threshold and `applyPalmPush`'s launch-off-a-wall trigger. `HandState.posed` snaps
 * `prevWorld` to the freshly computed `world` on that one tick instead, and `respawnPlayer`
 * clears it so the guard re-arms on every respawn, not only the first spawn.
 */
describe('hand velocity does not spike across a teleport', () => {
  it('reads as stationary on the very first tick a hand is ever posed, far from the origin', () => {
    const world = testWorld();
    const ctx = makeContext(world);
    const player = createPlayerState({ id: 'h1', position: vec3(40, 10, -30) });
    const intent = createIntent();
    intent.headHeight = 1.6;
    stepPlayer(player, intent, ctx, DT);
    for (const hand of player.hands) {
      expect(Math.hypot(hand.velocity.x, hand.velocity.y, hand.velocity.z)).toBeLessThan(1);
    }
  });

  it('reads as stationary on the tick right after a respawn teleports the body away', () => {
    const world = testWorld();
    const ctx = makeContext(world);
    const player = createPlayerState({ id: 'h2', position: vec3(0, 0.5, 0) });
    const intent = createIntent();
    intent.headHeight = 1.6;
    run(player, ctx, intent, 10); // settle normally, so `posed` is already true on both hands

    respawnPlayer(player, vec3(-40, 12, 35), ctx.tick); // a real respawn: far away, instantly
    ctx.tick++;
    stepPlayer(player, intent, ctx, DT);
    for (const hand of player.hands) {
      expect(Math.hypot(hand.velocity.x, hand.velocity.y, hand.velocity.z)).toBeLessThan(1);
    }
  });

  it('never reads a post-respawn tick as a punch', () => {
    // The concrete failure mode: a phantom full-power hit on anyone standing near the new spawn
    // point, through no action of the respawning player at all.
    const world = testWorld();
    const ctx = makeContext(world);
    const player = createPlayerState({ id: 'h3', position: vec3(0, 0.5, 0) });
    const intent = createIntent();
    intent.headHeight = 1.6;
    run(player, ctx, intent, 10);

    respawnPlayer(player, vec3(-40, 12, 35), ctx.tick);
    ctx.tick++;
    stepPlayer(player, intent, ctx, DT);
    const hand = player.hands[0] as HandState;
    const relativeSpeed = Math.hypot(
      hand.velocity.x - player.velocity.x,
      hand.velocity.y - player.velocity.y,
      hand.velocity.z - player.velocity.z,
    );
    expect(relativeSpeed).toBeLessThan(DEFAULT_COMBAT.punchSpeed);
  });
});
