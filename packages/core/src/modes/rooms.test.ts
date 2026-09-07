import { describe, expect, it } from 'vitest';

import { createPlayerState } from '../player/state.js';
import type { PlayerState } from '../player/state.js';
import { vec3 } from '../math/vec3.js';
import { Simulation, TICK_DT } from '../sim/simulation.js';
import { buildJungleWorld } from '../world/jungle.js';
import { FREEZE_TAG_DEF, FreezeTagMode } from './freezetag.js';
import { HILL_DEF, HillMode } from './hill.js';
import { TRAINING_ROOM_DEF, TrainingRoomMode, VOICE_FAR, VOICE_NEAR, proximityGain } from './social.js';
import './freezetag.js';
import './hill.js';
import './social.js';

function started(modeId: string, playerCount: number, countdown: number, seed = 3) {
  const sim = new Simulation({ level: buildJungleWorld(), modeId, seed });
  for (let i = 0; i < playerCount; i++) sim.addPlayer({ id: `p${i}`, name: `P${i}` });
  sim.stepMany(Math.ceil((countdown + 0.5) / TICK_DT));
  return sim;
}

function byRole(sim: Simulation, role: PlayerState['role']): PlayerState[] {
  return [...sim.players.values()].filter((p) => p.role === role);
}

describe('freeze tag', () => {
  function frozenRound(playerCount = 5) {
    return started('freeze-tag', playerCount, FREEZE_TAG_DEF.countdownSeconds);
  }

  function tag(chaser: PlayerState, runner: PlayerState): void {
    runner.position.x = chaser.position.x + 0.4;
    runner.position.y = chaser.position.y;
    runner.position.z = chaser.position.z;
    chaser.tagCooldown = 0;
    runner.invulnTimer = 0;
  }

  it('deals chasers and runners', () => {
    const sim = frozenRound();
    expect(byRole(sim, 'chaser')).toHaveLength(1);
    expect(byRole(sim, 'runner')).toHaveLength(4);
  });

  it('freezes a tagged runner instead of turning them into the chaser', () => {
    const sim = frozenRound();
    const chaser = byRole(sim, 'chaser')[0] as PlayerState;
    const runner = byRole(sim, 'runner')[0] as PlayerState;

    tag(chaser, runner);
    sim.stepMany(2);

    expect(runner.gadgets.frozen).toBeGreaterThan(0);
    expect(runner.role).toBe('runner');
    expect(chaser.role).toBe('chaser');
  });

  it('holds the freeze open rather than letting the gadget timer expire it', () => {
    const sim = frozenRound();
    const chaser = byRole(sim, 'chaser')[0] as PlayerState;
    const runner = byRole(sim, 'runner')[0] as PlayerState;
    // Park everyone else far away so nobody accidentally performs a rescue.
    for (const other of byRole(sim, 'runner')) {
      if (other.id === runner.id) continue;
      other.position.x = 400;
      other.position.z = 400;
    }

    tag(chaser, runner);
    sim.stepMany(60 * 8);

    expect(runner.gadgets.frozen).toBeGreaterThan(0);
  });

  it('thaws a frozen player when a teammate stands with them', () => {
    const sim = frozenRound();
    const chaser = byRole(sim, 'chaser')[0] as PlayerState;
    const [runner, rescuer] = byRole(sim, 'runner') as [PlayerState, PlayerState];

    tag(chaser, runner);
    sim.stepMany(2);
    expect(runner.gadgets.frozen).toBeGreaterThan(0);

    // Walk the chaser away, then keep the rescuer beside the frozen player.
    chaser.position.x = 500;
    chaser.position.z = 500;
    for (let i = 0; i < 60 * 3; i++) {
      rescuer.position.x = runner.position.x + 1;
      rescuer.position.y = runner.position.y;
      rescuer.position.z = runner.position.z;
      sim.stepMany(1);
    }

    expect(runner.gadgets.frozen).toBe(0);
    expect(runner.invulnTimer).toBeGreaterThan(0);
  });

  it('does not thaw from across the map', () => {
    const sim = frozenRound();
    const mode = sim.mode as FreezeTagMode;
    const chaser = byRole(sim, 'chaser')[0] as PlayerState;
    const [runner, rescuer] = byRole(sim, 'runner') as [PlayerState, PlayerState];

    tag(chaser, runner);
    sim.stepMany(2);
    rescuer.position.x = runner.position.x + 40;

    sim.stepMany(60 * 3);
    expect(runner.gadgets.frozen).toBeGreaterThan(0);
    expect(mode.thawProgress(runner.id)).toBe(0);
  });

  it('a frozen runner cannot be thawed by another frozen runner', () => {
    const sim = frozenRound();
    const chaser = byRole(sim, 'chaser')[0] as PlayerState;
    const [a, b] = byRole(sim, 'runner') as [PlayerState, PlayerState];

    tag(chaser, a);
    sim.stepMany(2);
    tag(chaser, b);
    sim.stepMany(2);
    chaser.position.x = 500;

    // Stand the two frozen players together for far longer than a thaw takes.
    for (let i = 0; i < 60 * 4; i++) {
      b.position.x = a.position.x + 1;
      b.position.z = a.position.z;
      sim.stepMany(1);
    }

    expect(a.gadgets.frozen).toBeGreaterThan(0);
    expect(b.gadgets.frozen).toBeGreaterThan(0);
  });

  it('ends the round once everyone is frozen', () => {
    const sim = frozenRound(3);
    for (const runner of byRole(sim, 'runner')) runner.gadgets.frozen = 1;
    sim.stepMany(2);
    expect(sim.finished()).toBe(true);
  });
});

describe('king of the hill', () => {
  function hillRound(playerCount = 4) {
    return started('hill', playerCount, HILL_DEF.countdownSeconds);
  }

  it('puts the hill somewhere on the map', () => {
    const sim = hillRound();
    const mode = sim.mode as HillMode;
    expect(Number.isFinite(mode.hillPosition.x)).toBe(true);
    expect(mode.hillRadius).toBeGreaterThan(0);
  });

  it('scores a lone holder', () => {
    const sim = hillRound();
    const mode = sim.mode as HillMode;
    const holder = [...sim.players.values()][0] as PlayerState;

    for (let i = 0; i < 120; i++) {
      holder.position.x = mode.hillPosition.x;
      holder.position.y = mode.hillPosition.y;
      holder.position.z = mode.hillPosition.z;
      sim.stepMany(1);
    }

    const entry = sim.results().players.find((p) => p.playerId === holder.id);
    expect(entry?.score ?? 0).toBeGreaterThan(0);
  });

  it('scores nothing while the hill is contested', () => {
    const sim = hillRound();
    const mode = sim.mode as HillMode;
    const [a, b] = [...sim.players.values()] as [PlayerState, PlayerState];

    for (let i = 0; i < 120; i++) {
      for (const player of [a, b]) {
        player.position.x = mode.hillPosition.x;
        player.position.y = mode.hillPosition.y;
        player.position.z = mode.hillPosition.z;
      }
      sim.stepMany(1);
    }

    expect(mode.currentHolders.length).toBe(2);
    for (const id of [a.id, b.id]) {
      const entry = sim.results().players.find((p) => p.playerId === id);
      expect(entry?.score ?? 0, id).toBe(0);
    }
  });

  it('moves the hill on its own clock', () => {
    const sim = hillRound();
    const mode = sim.mode as HillMode;
    const first = { ...mode.hillPosition };

    sim.stepMany(Math.ceil(41 / TICK_DT));

    const moved =
      mode.hillPosition.x !== first.x || mode.hillPosition.y !== first.y || mode.hillPosition.z !== first.z;
    expect(moved).toBe(true);
  });
});

describe('the training room', () => {
  it('never ends', () => {
    const sim = started('training', 2, 0);
    sim.stepMany(60 * 60);
    expect(sim.finished()).toBe(false);
  });

  it('has no clock', () => {
    const sim = started('training', 2, 0);
    expect(sim.mode.state().timeRemaining).toBe(0);
    expect(sim.mode.state().phase).toBe('playing');
  });

  it('ignores a round-end vote rather than ejecting the room', () => {
    const sim = started('training', 2, 0);
    sim.endRound('vote');
    expect(sim.finished()).toBe(false);
  });

  it('catches anyone who falls off instead of leaving them dead', () => {
    const sim = started('training', 1, 0);
    const player = [...sim.players.values()][0] as PlayerState;
    player.position.y = sim.level.killPlaneY - 50;

    sim.stepMany(2);

    expect(player.position.y).toBeGreaterThan(sim.level.killPlaneY);
  });

  it('produces an empty result rather than crowning anybody', () => {
    const sim = started('training', 3, 0);
    const result = sim.results();
    expect(result.winnerIds).toEqual([]);
    expect(result.players).toEqual([]);
  });

  it('accepts a whole lobby', () => {
    expect(TRAINING_ROOM_DEF.maxPlayers).toBeGreaterThanOrEqual(16);
    expect(TRAINING_ROOM_DEF.minPlayers).toBe(1);
  });

  it('is a real GameMode, so nothing in the server needed a special case', () => {
    const mode = new TrainingRoomMode(TRAINING_ROOM_DEF);
    expect(typeof mode.step).toBe('function');
    expect(typeof mode.results).toBe('function');
    expect(mode.finished()).toBe(false);
  });
});

describe('proximity voice', () => {
  function at(y: number, z: number): PlayerState {
    const player = createPlayerState({ id: `p${z}`, position: vec3(0, y, z) });
    player.head.x = 0;
    player.head.y = y + 1.3;
    player.head.z = z;
    return player;
  }

  it('is full volume up close', () => {
    expect(proximityGain(at(0, 0), at(0, VOICE_NEAR - 1))).toBe(1);
  });

  it('is silent past the far limit', () => {
    expect(proximityGain(at(0, 0), at(0, VOICE_FAR + 5))).toBe(0);
  });

  it('ramps between the two', () => {
    const mid = proximityGain(at(0, 0), at(0, (VOICE_NEAR + VOICE_FAR) / 2));
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it('is symmetric — two people always hear each other equally', () => {
    const a = at(0, 0);
    const b = at(0, 12);
    expect(proximityGain(a, b)).toBeCloseTo(proximityGain(b, a), 10);
  });

  it('falls off with height too, not just along the ground', () => {
    const flat = proximityGain(at(0, 0), at(0, 10));
    const above = proximityGain(at(0, 0), at(15, 10));
    expect(above).toBeLessThan(flat);
  });
});
