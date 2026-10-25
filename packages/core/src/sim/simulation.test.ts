import { describe, expect, it, beforeEach } from 'vitest';
import { Simulation, TICK_RATE } from './simulation.js';
import { buildJungleWorld } from '../world/jungle.js';
import { levelFingerprint, levelStats } from '../world/level.js';
import { createIntent, Buttons } from '../input/intent.js';
import type { InputIntent } from '../input/intent.js';
import type { PlayerState } from '../player/state.js';
import { DEFAULT_COMBAT } from '../player/combat.js';
import '../modes/index.js';

const level = buildJungleWorld();

function runTicks(sim: Simulation, ticks: number, intents?: Map<string, InputIntent>): void {
  for (let i = 0; i < ticks; i++) {
    if (intents) for (const [id, intent] of intents) sim.setIntent(id, intent);
    sim.step();
  }
}

function place(player: PlayerState, x: number, y: number, z: number): void {
  player.position.x = x;
  player.position.y = y;
  player.position.z = z;
  player.velocity.x = 0;
  player.velocity.y = 0;
  player.velocity.z = 0;
}

describe('Jungle World level', () => {
  it('builds deterministically from its seed', () => {
    const a = buildJungleWorld();
    const b = buildJungleWorld();
    expect(levelFingerprint(a)).toBe(levelFingerprint(b));
    expect(levelFingerprint(buildJungleWorld(12345))).not.toBe(levelFingerprint(a));
  });

  it('has the districts, spawns and a parkour route the modes rely on', () => {
    const stats = levelStats(level);
    expect(stats.colliders).toBeGreaterThan(150);
    expect(stats.props).toBeGreaterThan(150);
    expect(stats.grips).toBeGreaterThan(30);
    expect(level.zones.map((z) => z.name).toSorted()).toEqual(['canyon', 'cave', 'jungle']);
    expect(level.spawns.filter((s) => s.tag === 'chaser').length).toBeGreaterThan(0);
    expect(level.checkpoints.length).toBeGreaterThanOrEqual(6);
    expect(level.checkpoints.at(-1)?.finish).toBe(true);
  });
});

describe('Simulation', () => {
  let sim: Simulation;

  beforeEach(() => {
    sim = new Simulation({ level, modeId: 'kangaroo-chase', seed: 7 });
  });

  it('spawns players on solid, uncrowded ground', () => {
    const a = sim.addPlayer({ id: 'a', name: 'A' });
    const b = sim.addPlayer({ id: 'b', name: 'B' });
    expect(a.position.y).toBeGreaterThan(-30);
    expect(Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z)).toBeGreaterThan(1.5);
    runTicks(sim, 60);
    expect(a.alive).toBe(true);
    expect(a.grounded || a.position.y > -30).toBe(true);
  });

  it('produces snapshots that round-trip through the mode view', () => {
    sim.addPlayer({ id: 'a' });
    runTicks(sim, 10);
    const snap = sim.snapshot();
    expect(snap.tick).toBe(10);
    expect(snap.players).toHaveLength(1);
    expect(snap.mode.modeId).toBe('kangaroo-chase');
    expect(Number.isFinite(snap.players[0]?.x)).toBe(true);
  });

  it('sanitises hostile intents', () => {
    const player = sim.addPlayer({ id: 'cheater' });
    const evil = createIntent();
    evil.moveX = 900;
    evil.moveZ = Number.NaN;
    evil.lookPitch = 99;
    sim.setIntent('cheater', evil);
    const stored = sim.getIntent('cheater');
    expect(stored?.moveX).toBe(1);
    expect(stored?.moveZ).toBe(0);
    expect(Math.abs(stored?.lookPitch ?? 9)).toBeLessThan(1.6);
    runTicks(sim, 30);
    expect(Math.hypot(player.velocity.x, player.velocity.z)).toBeLessThan(player.config.maxHorizontalSpeed);
  });
});

describe('Kangaroo Chase mode', () => {
  it('runs a full round: countdown, roles, tagging, scoring, winner', () => {
    const sim = new Simulation({ level, modeId: 'kangaroo-chase', seed: 11 });
    const ids = ['p1', 'p2', 'p3', 'p4'];
    for (const id of ids) sim.addPlayer({ id, name: id.toUpperCase() });

    expect(sim.mode.state().phase).toBe('waiting');
    runTicks(sim, 2);
    expect(sim.mode.state().phase).toBe('countdown');

    runTicks(sim, TICK_RATE * 6);
    expect(sim.mode.state().phase).toBe('playing');

    const players = ids.map((id) => sim.players.get(id) as PlayerState);
    const chasers = players.filter((p) => p.role === 'chaser');
    expect(chasers).toHaveLength(1);

    const chaser = chasers[0] as PlayerState;
    const runner = players.find((p) => p.role === 'runner') as PlayerState;

    // Put them on top of each other on flat ground: the server must resolve the tag.
    place(chaser, 0, 1, 40);
    place(runner, 0.6, 1, 40);
    chaser.invulnTimer = 0;
    runner.invulnTimer = 0;
    chaser.tagCooldown = 0;

    runTicks(sim, 4);
    expect(runner.role).toBe('chaser');
    expect(chaser.role).toBe('runner');
    expect(sim.mode.state().scores[chaser.id]).toBeGreaterThan(0);

    // Runners accumulate score over time.
    const before = sim.mode.state().scores[chaser.id] ?? 0;
    runTicks(sim, 120);
    expect(sim.mode.state().scores[chaser.id]).toBeGreaterThan(before);

    const results = sim.results();
    expect(results.modeId).toBe('kangaroo-chase');
    expect(results.players).toHaveLength(4);
    expect(results.players[0]?.placement).toBe(1);
  });

  it('does not allow instant tag-backs', () => {
    const sim = new Simulation({ level, modeId: 'kangaroo-chase', seed: 3 });
    for (const id of ['a', 'b']) sim.addPlayer({ id });
    runTicks(sim, TICK_RATE * 7);
    const players = [...sim.players.values()];
    const chaser = players.find((p) => p.role === 'chaser') as PlayerState;
    const runner = players.find((p) => p.role === 'runner') as PlayerState;
    place(chaser, 0, 1, 40);
    place(runner, 0.5, 1, 40);
    chaser.invulnTimer = 0;
    runner.invulnTimer = 0;
    runTicks(sim, 2);
    expect(runner.role).toBe('chaser');
    // Immediately after the swap the new chaser is immune-blocked from tagging back.
    runTicks(sim, 10);
    expect(chaser.role).toBe('runner');
  });
});

describe('Infection mode', () => {
  it('infects on contact and ends when nobody is left', () => {
    const sim = new Simulation({ level, modeId: 'infection', seed: 5 });
    for (const id of ['a', 'b', 'c']) sim.addPlayer({ id });
    runTicks(sim, TICK_RATE * 8);
    expect(sim.mode.state().phase).toBe('playing');

    const players = [...sim.players.values()];
    const infected = players.find((p) => p.role === 'infected') as PlayerState;
    const survivors = players.filter((p) => p.role === 'runner');
    expect(survivors).toHaveLength(2);

    for (const survivor of survivors) {
      place(infected, 0, 1, 40);
      place(survivor, 0.5, 1, 40);
      infected.invulnTimer = 0;
      infected.tagCooldown = 0;
      survivor.invulnTimer = 0;
      runTicks(sim, 3);
    }

    expect(sim.finished()).toBe(true);
    const results = sim.results();
    expect(results.winnerIds.length).toBeGreaterThan(0);
    expect(results.players.some((p) => p.tags > 0)).toBe(true);
  });
});

describe('Parkour mode', () => {
  it('records checkpoints in order and finishes a lap', () => {
    const sim = new Simulation({ level, modeId: 'parkour', seed: 2 });
    const player = sim.addPlayer({ id: 'racer' });
    runTicks(sim, TICK_RATE * 6);
    expect(sim.mode.state().phase).toBe('playing');

    for (const cp of level.checkpoints) {
      place(player, cp.position.x, cp.position.y + 0.2, cp.position.z);
      runTicks(sim, 2);
    }

    expect(player.checkpointIndex).toBe(level.checkpoints.length - 1);
    expect(player.bestLapTicks).toBeGreaterThan(0);
    expect(sim.finished()).toBe(true);
    const results = sim.results();
    expect(results.players[0]?.won).toBe(true);
    expect(results.players[0]?.bestLapTicks).toBeGreaterThan(0);
  });

  it('ignores checkpoints taken out of order', () => {
    const sim = new Simulation({ level, modeId: 'parkour', seed: 2 });
    const player = sim.addPlayer({ id: 'racer' });
    runTicks(sim, TICK_RATE * 6);
    // The racer spawns on the start line, so checkpoint 0 is taken legitimately.
    expect(player.checkpointIndex).toBe(0);
    const third = level.checkpoints[3];
    if (!third) throw new Error('level needs 4+ checkpoints');
    place(player, third.position.x, third.position.y + 0.2, third.position.z);
    runTicks(sim, 3);
    expect(player.checkpointIndex).toBe(0); // skipping 1 and 2 does not count
  });
});

describe('Boxing mode', () => {
  it('lands a physical punch and deals damage', () => {
    const sim = new Simulation({ level, modeId: 'boxing', seed: 9 });
    const a = sim.addPlayer({ id: 'a' });
    const b = sim.addPlayer({ id: 'b' });
    runTicks(sim, TICK_RATE * 6);
    expect(sim.mode.state().phase).toBe('playing');

    // B stands at A's right: A faces +z, so its right is -x.
    place(a, 0, 1, 40);
    place(b, -0.7, 1, 40);
    b.invulnTimer = 0;

    // Drive A's right hand into B at punch speed, the way the VR platform layer would.
    const intent = createIntent();
    // No velocity is sent — the punch comes from `hand.pos` moving between ticks below, which is
    // the only way hand speed is ever established. See `HandIntent`.
    intent.hands = [
      { tracked: false, pos: { x: 0, y: 0, z: 0 }, grip: 0 },
      { tracked: true, pos: { x: 0.2, y: 1.1, z: 0.1 }, grip: 0 },
    ];
    const health = b.health;
    for (let i = 0; i < 8; i++) {
      const hand = intent.hands[1];
      hand.pos.x = 0.2 + i * 0.09;
      sim.setIntent('a', intent);
      sim.step();
      place(a, 0, 1, 40);
      place(b, -0.7, 1, 40);
    }
    expect(b.health).toBeLessThan(health);
  });

  it('exposes punch buttons for non-VR platforms', () => {
    const intent = createIntent();
    intent.buttons = Buttons.PunchRight;
    expect(intent.buttons & Buttons.PunchRight).toBeTruthy();
  });
});

/**
 * What is *not* a punch. Every case here landed hits before `punchSpeedOf` (see `combat.ts`):
 * turning swung the hands through an arc that read as punch speed, and a hand teleported across
 * its reach envelope every tick read as any speed it liked.
 */
type Pose = (tick: number, intent: InputIntent) => void;

/**
 * Toe to toe for `seconds`: `a` at z 40 facing +z, `b` 0.7 m in front of it. The victim is healed
 * every tick so the count is never cut short. `defend` poses `b`, idle by default; `onHit` sees the
 * attacker on each tick one of its punches lands.
 */
function fight(
  pose: Pose,
  seconds = 10,
  defend?: Pose,
  onHit?: (attacker: PlayerState, at: { x: number; y: number; z: number }) => void,
): { hits: number; worst: number; damage: number; heads: number; blocked: number } {
  const sim = new Simulation({ level, modeId: 'boxing', seed: 9 });
  const a = sim.addPlayer({ id: 'a' });
  const b = sim.addPlayer({ id: 'b' });
  runTicks(sim, TICK_RATE * 6);
  sim.events.drain();
  const intent = createIntent();
  const guard = createIntent();
  let hits = 0;
  let worst = 0;
  let damage = 0;
  let heads = 0;
  let blocked = 0;
  for (let t = 0; t < TICK_RATE * seconds; t++) {
    place(a, 0, 1, 40);
    place(b, 0, 1, 40.7);
    b.health = 100;
    b.alive = true;
    pose(t, intent);
    defend?.(t, guard);
    sim.setIntent('a', intent);
    sim.setIntent('b', guard);
    sim.step();
    for (const event of sim.events.drain()) {
      if (event.type !== 'punchHit' || event.playerId !== 'a') continue;
      onHit?.(a, event.position);
      hits++;
      worst = Math.max(worst, event.magnitude);
      damage += event.magnitude;
      if (event.data === 'head') heads++;
      if (event.data === 'guard') blocked++;
    }
  }
  return { hits, worst, damage, heads, blocked };
}

const tracked = (x: number, y: number, z: number) => ({ tracked: true, pos: { x, y, z }, grip: 0 });

describe('punch speed', () => {

  it('is not turning: a PC flick beside an opponent lands nothing', () => {
    // Measured before the fix: 58 hits in 20 s, punch button never pressed.
    const flick = fight((t, intent) => {
      intent.hands = null;
      intent.buttons = 0;
      intent.lookYaw = Math.floor(t / 10) % 2 ? Math.PI / 2 : 0;
    });
    expect(flick.hits).toBe(0);
  });

  it('is not turning: a VR snap turn with the hands out lands nothing', () => {
    const snap = fight((t, intent) => {
      intent.hands = [tracked(-0.25, 1.1, 0.35), tracked(0.25, 1.1, 0.35)];
      intent.lookYaw = Math.floor(t / 10) % 2 ? Math.PI / 4 : 0;
    });
    expect(snap.hits).toBe(0);
  });

  it('is not a glance: a VR head turn with the hands still in the room lands nothing', () => {
    // Tracked hands arrive relative to the head's yaw, so a head turn moves them through the
    // body's frame while they stay put in the world. Speed in that frame alone would punch.
    const room = [
      { x: -0.25, z: 0.35 },
      { x: 0.25, z: 0.35 },
    ];
    const glance = fight((t, intent) => {
      const yaw = Math.sin(t / 6) * 0.9;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      intent.lookYaw = yaw;
      // `room` is the body frame at yaw 0, where right is -x: in the world each hand sits at
      // (-x, z). Its body-local position at `yaw` is that point read against right (-c, 0, s)
      // and forward (s, 0, c).
      intent.hands = room.map((h) => tracked(h.x * c + h.z * s, 1.1, h.z * c - h.x * s)) as InputIntent['hands'];
    });
    expect(glance.hits).toBe(0);
  });

  it('is not a controller losing tracking: the jump to the procedural pose lands nothing', () => {
    const flicker = fight((t, intent) => {
      // Tracked inside the opponent's head, then lost: the procedural pose is half a metre away.
      intent.hands = [tracked(0, 1.45, 0.7), tracked(0, 1.45, 0.7)];
      if (t % 2 === 1) for (const hand of intent.hands) hand.tracked = false;
    });
    expect(flicker.hits).toBe(0);
  });

  it('is not a hand teleported across its reach every tick: that is a pose jump and lands nothing', () => {
    // A modified client. It used to land at `maxSpeed`; faster than any hand moves, it is now read
    // as a pose jump (`HandState.jumped`), the same as a controller coming back from lost tracking.
    const spoof = fight((t, intent) => {
      const out = t % 2 === 0 ? 0.7 : -0.5;
      intent.hands = [tracked(0, 1.1, -out + 0.2), tracked(0, 1.1, out)];
    });
    expect(spoof.hits).toBe(0);
  });

  it('is no faster than a human hand, whatever a client sends', () => {
    // The best a spoof can still do: move the hand just under a pose jump every tick, 11.4 m/s.
    const spoof = fight((t, intent) => {
      const out = t % 2 === 0 ? 0.69 : 0.5;
      intent.hands = [tracked(0, 0, 0), tracked(0, 1.1, out)];
      intent.hands[0].tracked = false;
    });
    expect(spoof.hits).toBeGreaterThan(0);
    // A head hit at full stamina and `maxSpeed` — the best a perfect human can do.
    expect(spoof.worst).toBeLessThanOrEqual(DEFAULT_COMBAT.baseDamage * DEFAULT_COMBAT.headMultiplier + 1e-6);
  });

  it('is not a flail: spinning the hands at your own guard does a fraction of a jab', () => {
    // Measured before it counted only the speed a glove closes on its target: a 12 cm, 14 Hz flail
    // that never left the guard did 32.8 damage a second against a committed 8 m/s jab's 14.6. The
    // complaint that took The Thrill of the Fight 2 to 3.1 stars on the Meta store. Now 4.9, and
    // an 8 cm flail lands nothing.
    const circle = (r: number, hz: number) => (t: number, intent: InputIntent) => {
      const a = (t / TICK_RATE) * hz * Math.PI * 2;
      intent.hands = [
        tracked(-0.18 + r * Math.cos(a), 1.2 + r * Math.sin(a), 0.2),
        tracked(0.18 + r * Math.cos(a + 1.6), 1.2 + r * Math.sin(a + 1.6), 0.2),
      ];
    };
    const jab = fight((t, intent) => {
      const k = t % 30;
      const z = k < 3 ? 0.2 + 0.4 * (k / 3) : k < 13 ? 0.6 - 0.04 * (k - 3) : 0.2;
      intent.hands = [tracked(-0.18, 1.2, 0.2), tracked(0.18, 1.2, z)];
    });
    const fast = fight(circle(0.12, 14));
    const small = fight(circle(0.08, 12));
    expect(jab.hits).toBeGreaterThan(5);
    expect(fast.damage).toBeLessThan(jab.damage * 0.5);
    expect(small.hits).toBe(0);
  });

  it('scores a body shot as a body shot, even with the glove inside the head’s reach', () => {
    // A level punch into the stomach passes within the head's generous hit zone on the way. What it
    // lands on is what it is closing on; it used to take the head's 1.6 for being nearby.
    const dig = fight((t, intent) => {
      const k = t % 30;
      const z = k < 3 ? 0.2 + 0.3 * (k / 3) : k < 13 ? 0.5 - 0.03 * (k - 3) : 0.2;
      intent.hands = [tracked(-0.15, 0.8, 0.2), tracked(0.15, 0.8, z)];
    });
    expect(dig.hits).toBeGreaterThan(5);
    expect(dig.heads).toBe(0);
  });

  it('lands a button punch on its way out, and only then', () => {
    // A button throw is judged by what it is closing on, like a glove, now that it counts only on
    // the way out (`HandState.striking`). It used to be exempt, and it landed on the way back: 72 of
    // 74 hits toe to toe, at 18.6 a second, which is most of why judging it by closing lost two
    // thirds of that (6.3). Thrown level it is a body shot at 11.0 a second, looking up a head
    // shot at 23.6.
    let back = 0;
    const straight = fight(
      (_t, intent) => {
        intent.hands = null;
        intent.buttons = Buttons.PunchRight;
      },
      10,
      undefined,
      (a, at) => {
        // Either fist: a held button falls back to the free one once the other has thrown.
        const hand = a.hands.find((h) => Math.hypot(h.world.x - at.x, h.world.y - at.y, h.world.z - at.z) < 1e-6);
        if (!hand || hand.local.z <= hand.prevLocal.z) back++;
      },
    );
    expect(straight.hits).toBeGreaterThan(20);
    expect(back, 'a punch landed while the glove was coming back').toBe(0);
    expect(straight.heads, 'a punch thrown level at the chest scored as a head shot').toBe(0);
    expect(straight.damage / 10).toBeGreaterThan(9);

    const up = fight((_t, intent) => {
      intent.hands = null;
      intent.buttons = Buttons.PunchRight;
      intent.lookPitch = 0.5;
    });
    expect(up.heads).toBe(up.hits);
    expect(up.damage).toBeGreaterThan(straight.damage * 1.6);
  });

  it('throws a fist looking up in a straight line, no faster than one thrown level', () => {
    // The aim grows with the throw. Switched on whole as a throw started, it moved the fist 13 cm
    // in its first tick looking up: 10.8 m/s against the throw's own 7.6, damage from a step in the
    // code rather than from the punch. A straight line up is still a little longer than one level
    // (0.80 m against 0.67 in the same time), so it is a little faster, and no more.
    const peak = (pitch: number): number => {
      const sim = new Simulation({ level, modeId: 'boxing', seed: 9 });
      const p = sim.addPlayer({ id: 'p' });
      runTicks(sim, TICK_RATE * 6);
      const intent = createIntent();
      let fastest = 0;
      for (let t = 0; t < TICK_RATE * 3; t++) {
        place(p, 0, 1, 40);
        intent.hands = null;
        intent.buttons = Buttons.PunchRight;
        intent.lookPitch = pitch;
        sim.setIntent('p', intent);
        sim.step();
        for (const hand of p.hands) fastest = Math.max(fastest, Math.hypot(hand.localVelocity.x, hand.localVelocity.y, hand.localVelocity.z));
      }
      return fastest;
    };
    expect(peak(0.5)).toBeLessThan(peak(0) * 1.25);
  });

  it('is not grabbing: toggling the grab lands nothing', () => {
    // A grab pulls the placed hands out to climbing reach in one tick, past `punchSpeed`. Toe to
    // toe, toggling it every tick landed 40.9 damage a second without the punch button: more than
    // twice what the punch button does.
    const toggle = fight((t, intent) => {
      intent.hands = null;
      intent.buttons = t % 2 ? Buttons.GrabLeft | Buttons.GrabRight : 0;
      intent.lookPitch = 0.5;
    });
    expect(toggle.hits).toBe(0);
  });

  it('still lands an honest jab at its true speed', () => {
    // 0.1 m a tick for five ticks: a 6 m/s jab, then back.
    const jab = fight((t, intent) => {
      const k = t % 36;
      const z = k < 5 ? 0.15 + 0.1 * k : k < 25 ? 0.65 - 0.025 * (k - 5) : 0.15;
      intent.hands = [tracked(0, 0, 0), tracked(0, 1.1, z)];
      intent.hands[0].tracked = false;
    });
    expect(jab.hits).toBeGreaterThan(5);
    const expected = DEFAULT_COMBAT.baseDamage * (6 / DEFAULT_COMBAT.maxSpeed) * DEFAULT_COMBAT.headMultiplier;
    expect(jab.worst).toBeCloseTo(expected, 1);
  });
});

/**
 * A27: a glove in the way takes the punch.
 *
 * Gloves stopped nothing before this: a VR player holding a textbook guard took a jab to the face
 * at full damage, and PC and mobile players had no hands to raise at all. `b` faces `a` here.
 */
describe('the guard', () => {
  /** A 6 m/s jab at the face of a standing VR player, whose head is at 1.6 m. */
  const jab: Pose = (t, intent) => {
    const k = t % 36;
    const z = k < 5 ? 0.15 + 0.1 * k : k < 25 ? 0.65 - 0.025 * (k - 5) : 0.15;
    intent.hands = [tracked(0, 0, 0), tracked(0, 1.55, z)];
    intent.hands[0].tracked = false;
  };
  /** VR, both hands where the defender puts them, facing the attacker. */
  const vr =
    (left: [number, number, number], right: [number, number, number]): Pose =>
    (_t, intent) => {
      intent.lookYaw = Math.PI;
      intent.headHeight = 1.6;
      intent.hands = [tracked(...left), tracked(...right)];
    };
  const raised = vr([-0.1, 1.53, 0.24], [0.1, 1.53, 0.24]);
  const lowered = vr([-0.3, 1.0, 0.1], [0.3, 1.0, 0.1]);

  it('takes most of a jab into raised gloves, and none into an open face', () => {
    const open = fight(jab, 10, lowered);
    const guarded = fight(jab, 10, raised);
    expect(open.hits).toBeGreaterThan(5);
    expect(open.blocked).toBe(0);
    expect(guarded.blocked).toBe(guarded.hits);
    expect(guarded.damage).toBeLessThan(open.damage * DEFAULT_COMBAT.guardShare * 1.05);
  });

  it('is not an arm held out: gloves at arm’s length cover nothing', () => {
    const out = fight(jab, 10, vr([-0.1, 1.53, 0.6], [0.1, 1.53, 0.6]));
    expect(out.hits).toBeGreaterThan(5);
    expect(out.blocked).toBe(0);
  });

  it('covers the face from the front, so a hook from the side gets round it', () => {
    // Across the side of the head, level with its centre: right to left at 6 m/s.
    const hook: Pose = (t, intent) => {
      const k = t % 36;
      const x = k < 5 ? 0.6 - 0.1 * k : k < 25 ? 0.1 + 0.025 * (k - 5) : 0.6;
      intent.hands = [tracked(0, 0, 0), tracked(x, 1.59, 0.7)];
      intent.hands[0].tracked = false;
    };
    const round = fight(hook, 10, raised);
    expect(round.hits).toBeGreaterThan(5);
    expect(round.blocked).toBe(0);
  });

  it('gives PC and mobile a guard button, which raises the gloves the game places', () => {
    const up = (_t: number, intent: InputIntent) => {
      intent.hands = null;
      intent.buttons = Buttons.PunchRight;
      intent.lookPitch = 0.5;
    };
    const facing = (buttons: number): Pose => (_t, intent) => {
      intent.hands = null;
      intent.lookYaw = Math.PI;
      intent.buttons = buttons;
    };
    const open = fight(up, 10, facing(0));
    const guarded = fight(up, 10, facing(Buttons.Guard));
    expect(open.heads).toBe(open.hits);
    expect(guarded.blocked).toBe(guarded.hits);
    expect(guarded.damage).toBeLessThan(open.damage * DEFAULT_COMBAT.guardShare * 1.05);
  });

  it('guards the face, so a body shot goes under it', () => {
    const level: Pose = (_t, intent) => {
      intent.hands = null;
      intent.buttons = Buttons.PunchRight;
      intent.lookPitch = 0;
    };
    const guarded = fight(level, 10, (_t, intent) => {
      intent.hands = null;
      intent.lookYaw = Math.PI;
      intent.buttons = Buttons.Guard;
    });
    expect(guarded.hits).toBeGreaterThan(5);
    expect(guarded.blocked).toBe(0);
  });

  it('is a raised guard, not a hand that happens to be in the way', () => {
    // A placed glove is at the chest whether or not anyone is defending, and out on the centre line
    // whenever its owner throws. Toe to toe, two PC players trading punches with no guard held block
    // nothing.
    const trade: Pose = (_t, intent) => {
      intent.hands = null;
      intent.buttons = Buttons.PunchRight;
      intent.lookPitch = 0.5;
    };
    const exchange = fight(trade, 10, (t, intent) => {
      trade(t, intent);
      intent.lookYaw = Math.PI;
    });
    expect(exchange.hits).toBeGreaterThan(5);
    expect(exchange.blocked).toBe(0);
  });

  it('still punches from the guard: the other glove stays up', () => {
    const fromGuard = fight((_t, intent) => {
      intent.hands = null;
      intent.buttons = Buttons.PunchRight | Buttons.Guard;
      intent.lookPitch = 0.5;
    });
    expect(fromGuard.heads).toBeGreaterThan(20);
  });
});

/**
 * A punch has to be thrown on purpose.
 *
 * `punchHit` fires only when a punch *connects*, so a swing that missed used to reach the player
 * through no channel at all — measured toe to toe over 20 s, 87 swings thrown and 3 landed. The
 * fix emits `punch` where a throw is deliberately started, in `startPunchThrows`.
 *
 * The tempting alternative was `resolvePunches`, at the moment hand speed crosses
 * `DEFAULT_COMBAT.punchSpeed` — and that is not a punch. Measured over 60 s of boxing with the
 * punch buttons masked off entirely, a player's procedurally-placed hands cross that threshold
 * **1056 times**, purely from hopping; masking the buttons changed the count by zero, which is
 * what proved the crossings had nothing to do with punching. A cue there is a seventeen-a-second
 * buzz for a player who never pressed anything.
 *
 * This runs the whole `Simulation.step`, not just `stepPlayer`, because that is the only level at
 * which both candidate sites actually execute — a guard in `locomotion.test.ts` alone cannot see
 * an emit added to `resolvePunches` and would pass while the buzz shipped.
 */
describe('the punch cue', () => {
  it('stays silent for a player who is only hopping in a combat mode', () => {
    const sim = new Simulation({ level, modeId: 'boxing', seed: 5 });
    sim.addPlayer({ id: 'hopper' });
    sim.addPlayer({ id: 'bystander' });
    runTicks(sim, TICK_RATE * 6);
    sim.events.drain();

    const hop = createIntent();
    const still = createIntent();
    const seen: string[] = [];
    for (let i = 0; i < TICK_RATE * 6; i++) {
      hop.buttons = i % 30 === 0 ? Buttons.Jump : 0;
      sim.setIntent('hopper', hop);
      sim.setIntent('bystander', still);
      sim.step();
      for (const event of sim.events.drain()) seen.push(event.type);
    }

    // Without this the test could pass by never making anyone hop at all.
    expect(seen).toContain('jump');
    expect(seen).toContain('land');
    expect(seen).not.toContain('punch');
  });

  it('fires once a punch button is actually held', () => {
    const sim = new Simulation({ level, modeId: 'boxing', seed: 5 });
    sim.addPlayer({ id: 'boxer' });
    runTicks(sim, TICK_RATE * 6);
    sim.events.drain();

    const punching = createIntent();
    punching.buttons = Buttons.PunchRight;
    let thrown = 0;
    for (let i = 0; i < TICK_RATE; i++) {
      sim.setIntent('boxer', punching);
      sim.step();
      for (const event of sim.events.drain()) if (event.type === 'punch') thrown++;
    }
    // A throw takes 0.22 s, so a second of holding is a handful of swings — never one per tick.
    expect(thrown).toBeGreaterThan(2);
    expect(thrown).toBeLessThan(8);
  });
});
