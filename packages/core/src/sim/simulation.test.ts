import { describe, expect, it, beforeEach } from 'vitest';
import { Simulation, TICK_RATE } from './simulation.js';
import { buildJungleWorld } from '../world/jungle.js';
import { levelFingerprint, levelStats } from '../world/level.js';
import { createIntent, Buttons } from '../input/intent.js';
import type { InputIntent } from '../input/intent.js';
import type { PlayerState } from '../player/state.js';
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

    place(a, 0, 1, 40);
    place(b, 0.7, 1, 40);
    b.invulnTimer = 0;

    // Drive A's right hand into B at punch speed, the way the VR platform layer would.
    const intent = createIntent();
    intent.hands = [
      { tracked: false, pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, grip: 0 },
      { tracked: true, pos: { x: 0.2, y: 1.1, z: 0.1 }, vel: { x: 0, y: 0, z: 0 }, grip: 0 },
    ];
    const health = b.health;
    for (let i = 0; i < 8; i++) {
      const hand = intent.hands[1];
      hand.pos.x = 0.2 + i * 0.09;
      sim.setIntent('a', intent);
      sim.step();
      place(a, 0, 1, 40);
      place(b, 0.7, 1, 40);
    }
    expect(b.health).toBeLessThan(health);
  });

  it('exposes punch buttons for non-VR platforms', () => {
    const intent = createIntent();
    intent.buttons = Buttons.PunchRight;
    expect(intent.buttons & Buttons.PunchRight).toBeTruthy();
  });
});
