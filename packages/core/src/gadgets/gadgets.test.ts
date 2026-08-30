import { beforeEach, describe, expect, it } from 'vitest';

import { Buttons, createHandIntent, createIntent } from '../input/intent.js';
import { vec3 } from '../math/vec3.js';
import { SurfaceFlags } from '../physics/types.js';
import { PhysicsWorld } from '../physics/world.js';
import { stepPlayer } from '../player/locomotion.js';
import { SimEventQueue } from '../sim/events.js';
import { createPlayerState } from '../player/state.js';
import type { PlayerState } from '../player/state.js';
import { LAUNCH_GADGETS, freeGadgetIds, getGadget, listGadgets, validateGadgets } from './catalog.js';
import { applyLoadout, canUse, grantRoleGadgets, resolveLoadout } from './loadout.js';
import { GadgetRuntime, absorbDamage, aimFrom, applyPayload, tickStatus } from './runtime.js';
import type { GadgetContext } from './runtime.js';
import { createGadgetState, cycleSelection, resetForRound, selectedGadget, setSlot } from './state.js';
import type { GadgetDef } from './types.js';

const DT = 1 / 60;

function ctx(players: PlayerState[], world = new PhysicsWorld([])): GadgetContext {
  return {
    players: new Map(players.map((p) => [p.id, p])),
    world,
    events: new SimEventQueue(),
    tick: 0,
    dt: DT,
  };
}

/** Face a player straight down +Z at a target standing `distance` away. */
function facing(id: string, x: number, z: number): PlayerState {
  const player = createPlayerState({ id, position: vec3(x, 0, z) });
  player.head.x = x;
  player.head.y = 1.3;
  player.head.z = z;
  player.yaw = 0;
  player.pitch = 0;
  return player;
}

describe('catalog', () => {
  it('passes its own validation', () => {
    expect(validateGadgets()).toEqual([]);
  });

  /**
   * The rule, as a test rather than a promise: nothing in this game costs anything. If a price
   * ever reappears on a gadget, this fails before the build does.
   */
  it('charges nothing for any gadget, in coins or in cash', () => {
    for (const def of listGadgets()) {
      expect(def.unlockCoins, `${def.id} costs coins`).toBe(0);
      expect(def.unlockCents, `${def.id} is for sale`).toBe(-1);
    }
  });

  it('hands every account every equippable gadget', () => {
    const free = freeGadgetIds();
    for (const id of ['freeze_gun', 'smoke_bomb', 'steel_vest', 'steel_helmet', 'bear_trap']) {
      expect(free, id).toContain(id);
    }
  });

  it('keeps the hunter’s issued gear out of the owned set', () => {
    // Owning it would let a survivor walk into a lobby holding a rifle.
    expect(freeGadgetIds()).not.toContain('hunter_rifle');
    expect(freeGadgetIds()).not.toContain('hunter_net');
  });

  it('reports a catalog that breaks the rules instead of shipping it', () => {
    const bad: GadgetDef = {
      ...(LAUNCH_GADGETS[0] as GadgetDef),
      id: 'pay_only',
      unlockCoins: 2500,
      unlockCents: 499,
    };
    const problems = validateGadgets([bad]);
    expect(problems.map((p) => p.problem).join(' ')).toContain('every gadget is free');
  });
});

describe('loadout', () => {
  it('applies what the player owns', () => {
    const outcome = resolveLoadout({ primary: 'freeze_gun', armour: 'steel_vest' }, ['freeze_gun', 'steel_vest']);
    expect(outcome.applied.primary).toBe('freeze_gun');
    expect(outcome.applied.armour).toBe('steel_vest');
    expect(outcome.problems).toEqual([]);
  });

  it('refuses a gadget the player does not own, and says why', () => {
    const outcome = resolveLoadout({ secondary: 'bear_trap' }, ['freeze_gun']);
    expect(outcome.applied.secondary).toBeNull();
    expect(outcome.problems).toEqual([{ slot: 'secondary', gadgetId: 'bear_trap', error: 'not-owned' }]);
  });

  it('refuses a gadget in the wrong slot', () => {
    const outcome = resolveLoadout({ primary: 'steel_vest' }, ['steel_vest']);
    expect(outcome.problems[0]?.error).toBe('wrong-slot');
  });

  it('refuses the hunter rifle even to someone who somehow owns it', () => {
    const outcome = resolveLoadout({ primary: 'hunter_rifle' }, ['hunter_rifle']);
    expect(outcome.applied.primary).toBeNull();
    expect(outcome.problems[0]?.error).toBe('role-locked');
  });

  it('issues role equipment and takes it back when the role ends', () => {
    const state = createGadgetState();
    setSlot(state, 'freeze_gun');
    grantRoleGadgets(state, 'hunter', ['hunter_rifle', 'hunter_net']);
    expect(state.slots[0]).toBe('hunter_rifle');
    expect(state.slots[1]).toBe('hunter_net');

    grantRoleGadgets(state, 'survivor', []);
    expect(state.slots[0]).toBeNull();
    expect(state.slots[1]).toBeNull();
  });

  it('will not let a survivor fire a rifle they are still somehow holding', () => {
    const state = createGadgetState();
    grantRoleGadgets(state, 'hunter', ['hunter_rifle']);
    resetForRound(state);
    expect(canUse(state, 'hunter_rifle', 'hunter')).toBe(true);
    expect(canUse(state, 'hunter_rifle', 'survivor')).toBe(false);
  });
});

describe('per-round state', () => {
  it('refills charges and re-applies armour at the bell', () => {
    const state = createGadgetState();
    applyLoadout(state, { primary: 'freeze_gun', secondary: 'smoke_bomb', armour: 'steel_vest' });
    state.charges.freeze_gun = 0;
    state.armour = 0;

    resetForRound(state, 800);

    expect(state.charges.freeze_gun).toBe(getGadget('freeze_gun')?.uses);
    expect(state.armour).toBe(60);
    expect(state.cash).toBe(800);
  });

  it('selects something firable rather than the armour slot', () => {
    const state = createGadgetState();
    applyLoadout(state, { primary: null, secondary: 'smoke_bomb', armour: 'steel_vest' });
    resetForRound(state);
    expect(selectedGadget(state)).toBe('smoke_bomb');
  });

  it('skips armour when cycling', () => {
    const state = createGadgetState();
    applyLoadout(state, { primary: 'freeze_gun', secondary: 'smoke_bomb', armour: 'steel_vest' });
    resetForRound(state);
    cycleSelection(state);
    expect(selectedGadget(state)).toBe('smoke_bomb');
    cycleSelection(state);
    expect(selectedGadget(state)).toBe('freeze_gun');
  });
});

describe('firing', () => {
  let runtime: GadgetRuntime;

  beforeEach(() => {
    runtime = new GadgetRuntime();
  });

  it('spends a charge and starts a cooldown', () => {
    const shooter = facing('a', 0, 0);
    applyLoadout(shooter.gadgets, { primary: 'freeze_gun' });
    resetForRound(shooter.gadgets);

    const used = runtime.use(shooter, ctx([shooter]));
    expect(used?.id).toBe('freeze_gun');
    expect(shooter.gadgets.charges.freeze_gun).toBe(3);
    expect(shooter.gadgets.cooldowns.freeze_gun).toBe(6);
  });

  it('refuses a second shot while the cooldown runs', () => {
    const shooter = facing('a', 0, 0);
    applyLoadout(shooter.gadgets, { primary: 'freeze_gun' });
    resetForRound(shooter.gadgets);
    const c = ctx([shooter]);

    runtime.use(shooter, c);
    expect(runtime.use(shooter, c)).toBeNull();
    expect(shooter.gadgets.charges.freeze_gun).toBe(3);
  });

  it('runs out of charges', () => {
    const shooter = facing('a', 0, 0);
    applyLoadout(shooter.gadgets, { primary: 'freeze_gun' });
    resetForRound(shooter.gadgets);
    const c = ctx([shooter]);

    for (let i = 0; i < 4; i++) {
      expect(runtime.use(shooter, c), `shot ${i}`).not.toBeNull();
      shooter.gadgets.cooldowns.freeze_gun = 0;
    }
    expect(runtime.use(shooter, c)).toBeNull();
  });

  it('freezes the player it hits and nobody else', () => {
    const shooter = facing('a', 0, 0);
    const target = facing('b', 0, 6);
    const bystander = facing('c', 20, 6);
    applyLoadout(shooter.gadgets, { primary: 'freeze_gun' });
    resetForRound(shooter.gadgets);
    const c = ctx([shooter, target, bystander]);

    runtime.use(shooter, c);
    for (let i = 0; i < 40 && target.gadgets.frozen === 0; i++) runtime.step(c);

    expect(target.gadgets.frozen).toBeGreaterThan(0);
    expect(bystander.gadgets.frozen).toBe(0);
    expect(shooter.gadgets.frozen).toBe(0);
  });

  it('does not hit the player who fired it', () => {
    const shooter = facing('a', 0, 0);
    applyLoadout(shooter.gadgets, { primary: 'freeze_gun' });
    resetForRound(shooter.gadgets);
    const c = ctx([shooter]);

    runtime.use(shooter, c);
    for (let i = 0; i < 120; i++) runtime.step(c);
    expect(shooter.gadgets.frozen).toBe(0);
  });

  it('leaves a cloud where the smoke bomb lands, and clears it after', () => {
    const thrower = facing('a', 0, 0);
    const walker = facing('b', 0, 0);
    applyLoadout(thrower.gadgets, { secondary: 'smoke_bomb' });
    resetForRound(thrower.gadgets);
    const c = ctx([thrower, walker]);

    runtime.use(thrower, c);
    // Run out the fuse. Where it lands is ballistics, which this test deliberately does not
    // assert — it walks the observer to wherever the cloud ended up and checks the *mechanic*.
    for (let i = 0; i < 120; i++) runtime.step(c);

    const cloud = runtime.entities.find((e) => e.kind === 'cloud');
    expect(cloud).toBeDefined();
    if (!cloud) return;
    expect(cloud.radius).toBe(6);

    walker.position.x = cloud.position.x;
    walker.position.y = cloud.position.y;
    walker.position.z = cloud.position.z;
    runtime.step(c);
    expect(walker.gadgets.smoked).toBeGreaterThan(0);

    // The cloud hides the thrower too — that is the trade-off it is designed around.
    thrower.position.x = cloud.position.x;
    thrower.position.y = cloud.position.y;
    thrower.position.z = cloud.position.z;
    runtime.step(c);
    expect(thrower.gadgets.smoked).toBeGreaterThan(0);

    // 10 s of cloud; run past it and the world should be clear again.
    for (let i = 0; i < 700; i++) runtime.step(c);
    expect(runtime.entities.length).toBe(0);
    expect(walker.gadgets.smoked).toBe(0);
  });

  it('arms a placed trap before it can catch anyone', () => {
    const layer = facing('a', 0, 0);
    const victim = facing('b', 0, 1.1);
    applyLoadout(layer.gadgets, { secondary: 'bear_trap' });
    resetForRound(layer.gadgets);
    const c = ctx([layer, victim]);

    runtime.use(layer, c);
    // Standing in it during the arming second must not trigger it.
    for (let i = 0; i < 30; i++) runtime.step(c);
    expect(victim.gadgets.snared).toBe(0);

    for (let i = 0; i < 60; i++) runtime.step(c);
    expect(victim.gadgets.snared).toBeGreaterThan(0);
    expect(victim.gadgets.snareSlow).toBe(0.5);
  });

  it('does not catch the player who laid it', () => {
    const layer = facing('a', 0, 0);
    applyLoadout(layer.gadgets, { secondary: 'bear_trap' });
    resetForRound(layer.gadgets);
    const c = ctx([layer]);

    runtime.use(layer, c);
    for (let i = 0; i < 200; i++) runtime.step(c);
    expect(layer.gadgets.snared).toBe(0);
  });

  it('stops a projectile at a wall instead of shooting through it', () => {
    const world = new PhysicsWorld([
      {
        kind: 'box',
        id: 0,
        center: vec3(0, 2, 3),
        half: vec3(6, 3, 0.5),
        yaw: 0,
        surface: { friction: 1, bounciness: 0, flags: 0, material: 'stone' },
      },
    ]);
    const shooter = facing('a', 0, 0);
    const target = facing('b', 0, 8);
    applyLoadout(shooter.gadgets, { primary: 'freeze_gun' });
    resetForRound(shooter.gadgets);
    const c = ctx([shooter, target], world);

    runtime.use(shooter, c);
    for (let i = 0; i < 120; i++) runtime.step(c);
    expect(target.gadgets.frozen).toBe(0);
  });
});

describe('armour', () => {
  it('absorbs damage until the pool runs out, then lets it through', () => {
    const player = facing('a', 0, 0);
    player.gadgets.armour = 60;

    expect(absorbDamage(player, 55)).toBe(0);
    expect(player.gadgets.armour).toBe(5);
    expect(absorbDamage(player, 55)).toBe(50);
    expect(player.gadgets.armour).toBe(0);
  });

  it('is spent by a rifle round rather than the health bar', () => {
    const hunter = facing('a', 0, 0);
    const survivor = facing('b', 0, 5);
    survivor.gadgets.armour = 60;
    const rifle = getGadget('hunter_rifle') as GadgetDef;

    applyPayload(rifle, survivor, hunter, ctx([hunter, survivor]));

    expect(survivor.health).toBe(100);
    expect(survivor.gadgets.armour).toBe(5);
    expect(survivor.lastTaggedBy).toBe('a');
  });

  it('does not regenerate on its own', () => {
    const state = createGadgetState();
    state.armour = 10;
    for (let i = 0; i < 600; i++) tickStatus(state, DT);
    expect(state.armour).toBe(10);
  });
});

describe('status timers', () => {
  it('counts every effect down and clears the snare multiplier with it', () => {
    const state = createGadgetState();
    state.frozen = 0.1;
    state.snared = 0.1;
    state.snareSlow = 0.5;

    for (let i = 0; i < 10; i++) tickStatus(state, DT);

    expect(state.frozen).toBe(0);
    expect(state.snared).toBe(0);
    expect(state.snareSlow).toBe(0);
  });

  it('a frozen player cannot fire their way out', () => {
    const player = facing('a', 0, 0);
    applyLoadout(player.gadgets, { primary: 'freeze_gun' });
    resetForRound(player.gadgets);
    player.gadgets.frozen = 2;

    expect(new GadgetRuntime().use(player, ctx([player]))).toBeNull();
  });
});

/**
 * The effects only matter if they reach movement. These drive the real `stepPlayer`, because a
 * freeze that the locomotion code ignores is a freeze that does nothing, and every test above
 * would still pass.
 */
describe('status effects reach movement', () => {
  function walk(player: PlayerState, ticks: number): number {
    const world = new PhysicsWorld([]);
    const loco = { world, events: new SimEventQueue(), tick: 0, killPlaneY: -100 };
    const intent = createIntent();
    intent.moveZ = 1;
    const startZ = player.position.z;
    for (let i = 0; i < ticks; i++) {
      loco.tick = i;
      stepPlayer(player, intent, loco, DT);
    }
    return player.position.z - startZ;
  }

  it('a frozen player does not move under full forward input', () => {
    const free = facing('a', 0, 0);
    const frozen = facing('b', 0, 0);
    frozen.gadgets.frozen = 5;

    expect(walk(free, 60)).toBeGreaterThan(1);
    expect(Math.abs(walk(frozen, 60))).toBeLessThan(0.01);
  });

  it('a snared player moves, but slower', () => {
    const free = facing('a', 0, 0);
    const snared = facing('b', 0, 0);
    snared.gadgets.snared = 5;
    snared.gadgets.snareSlow = 0.5;

    const freeDistance = walk(free, 60);
    const snaredDistance = walk(snared, 60);

    expect(snaredDistance).toBeGreaterThan(0);
    expect(snaredDistance).toBeLessThan(freeDistance * 0.9);
  });

  it('a frozen VR player cannot pull themselves along by their hands', () => {
    const player = facing('a', 0, 0);
    player.gadgets.frozen = 5;
    const world = new PhysicsWorld([
      {
        kind: 'box',
        id: 0,
        center: vec3(0, 2, 1),
        half: vec3(4, 3, 0.4),
        yaw: 0,
        surface: { friction: 1, bounciness: 0, flags: SurfaceFlags.Climbable, material: 'rock' },
      },
    ]);
    const loco = { world, events: new SimEventQueue(), tick: 0, killPlaneY: -100 };

    const intent = createIntent();
    intent.hands = [createHandIntent(), createHandIntent()];
    intent.buttons = Buttons.GrabLeft | Buttons.GrabRight;
    for (const hand of intent.hands) {
      hand.tracked = true;
      hand.grip = 1;
      hand.pos = vec3(0, 1.3, 0.6);
      hand.vel = vec3(0, 0, -6);
    }

    for (let i = 0; i < 60; i++) {
      loco.tick = i;
      stepPlayer(player, intent, loco, DT);
    }

    expect(player.hands[0].anchored).toBe(false);
    expect(player.hands[1].anchored).toBe(false);
    expect(Math.abs(player.position.z)).toBeLessThan(0.05);
  });
});

describe('aiming', () => {
  it('fires along the look direction from just in front of the head', () => {
    const player = facing('a', 0, 0);
    player.yaw = Math.PI / 2; // facing +X
    const muzzle = vec3();
    const dir = vec3();

    aimFrom(player, muzzle, dir);

    expect(dir.x).toBeCloseTo(1, 5);
    expect(dir.z).toBeCloseTo(0, 5);
    expect(muzzle.x).toBeCloseTo(0.45, 5);
    expect(muzzle.y).toBeCloseTo(player.head.y, 5);
  });

  it('aims upward when the player looks up', () => {
    const player = facing('a', 0, 0);
    player.pitch = -0.5; // looking up
    const muzzle = vec3();
    const dir = vec3();

    aimFrom(player, muzzle, dir);
    expect(dir.y).toBeGreaterThan(0);
  });
});
