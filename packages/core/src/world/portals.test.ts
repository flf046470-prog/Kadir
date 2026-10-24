import { describe, expect, it } from 'vitest';

import { Simulation } from '../sim/simulation.js';
import { buildLevel, listLevels } from './registry.js';
import { LOBBY_MODE_IDS } from './level.js';
import { listModes } from '../modes/registry.js';
import '../modes/index.js';
import './index.js';

/**
 * Doors into the modes, standing in the lobby.
 *
 * Picking a mode from a menu is the one moment this game stops being a place you are standing in.
 * A portal keeps it, and it is the only mode-select that works identically in a headset, on a
 * phone and at a desk, because walking is the one input all three already have.
 */
describe('the lobby has a door per mode', () => {
  it('rings every level with the same set of doors', () => {
    for (const entry of listLevels()) {
      const level = buildLevel(entry.id);
      expect(level.portals.length, entry.id).toBe(LOBBY_MODE_IDS.length);
      expect(level.portals.map((p) => p.modeId).sort()).toEqual([...LOBBY_MODE_IDS].sort());
    }
  });

  it('only opens doors to modes that exist', () => {
    /**
     * `LOBBY_MODE_IDS` is a plain string list, because a level is plain data and must not import
     * the gameplay modules. That is the right call and it is also exactly how a door to a mode
     * nobody registered would get built — a player would walk into it and nothing would happen.
     */
    const registered = new Set(listModes().map((m) => m.id));
    for (const modeId of LOBBY_MODE_IDS) {
      expect(registered.has(modeId), `no mode registered as ${modeId}`).toBe(true);
    }
  });

  it('has no door back into the lobby itself', () => {
    // The Training Room *is* the lobby; a door to where you are standing is furniture, not a door.
    expect([...LOBBY_MODE_IDS]).not.toContain('training');
  });

  it('spaces the doors so aiming at one does not land you in its neighbour', () => {
    const level = buildLevel('jungle');
    for (const a of level.portals) {
      for (const b of level.portals) {
        if (a === b) continue;
        const gap = Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
        expect(gap, `${a.modeId} and ${b.modeId} overlap`).toBeGreaterThan(a.radius + b.radius);
      }
    }
  });

  it('faces every arch back at the middle of the ring', () => {
    // Broadside to whoever walks out at it, rather than edge-on and invisible.
    const level = buildLevel('jungle');
    for (const portal of level.portals) {
      const towardsCentre = Math.atan2(-portal.position.x, -portal.position.z);
      const difference = Math.abs(Math.atan2(Math.sin(portal.yaw - towardsCentre), Math.cos(portal.yaw - towardsCentre)));
      expect(difference, portal.modeId).toBeLessThan(0.01);
    }
  });

  it('puts the lobby spawn inside the ring, not on top of a door', () => {
    for (const entry of listLevels()) {
      const level = buildLevel(entry.id);
      const lobby = level.spawns.filter((s) => s.tag === 'lobby');
      expect(lobby.length, `${entry.id} has no lobby spawn`).toBeGreaterThan(0);
      for (const spawn of lobby) {
        for (const portal of level.portals) {
          const gap = Math.hypot(spawn.position.x - portal.position.x, spawn.position.z - portal.position.z);
          expect(gap, `${entry.id} spawns you inside the ${portal.modeId} door`).toBeGreaterThan(portal.radius);
        }
      }
    }
  });
});

describe('walking into a door', () => {
  function lobby() {
    const level = buildLevel('jungle');
    const sim = new Simulation({ level, modeId: 'training', seed: 1 });
    const player = sim.addPlayer({ id: 'a', name: 'A' });
    sim.stepMany(10);
    sim.events.drain();
    return { level, sim, player };
  }

  /** Put the player in a portal and take one tick; return any portal events that came out. */
  function stepInto(ctx: ReturnType<typeof lobby>, modeId: string) {
    const portal = ctx.level.portals.find((p) => p.modeId === modeId);
    if (!portal) throw new Error(`no ${modeId} portal`);
    ctx.player.position.x = portal.position.x;
    ctx.player.position.z = portal.position.z;
    ctx.sim.step();
    return ctx.sim.events.drain().filter((e) => e.type === 'portal');
  }

  it('announces which mode you stepped into', () => {
    const ctx = lobby();
    const events = stepInto(ctx, 'duel');
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toBe('duel');
  });

  it('announces it once, however long you stand there', () => {
    /**
     * People loiter in the arch waiting for a friend. Firing on the level rather than the edge
     * would announce it sixty times a second for as long as they wait.
     */
    const ctx = lobby();
    expect(stepInto(ctx, 'duel')).toHaveLength(1);
    ctx.sim.stepMany(120);
    expect(ctx.sim.events.drain().filter((e) => e.type === 'portal')).toHaveLength(0);
  });

  it('announces again when you leave and come back', () => {
    const ctx = lobby();
    stepInto(ctx, 'duel');
    ctx.player.position.x = 0;
    ctx.player.position.z = 0;
    ctx.sim.step();
    ctx.sim.events.drain();
    expect(stepInto(ctx, 'duel')).toHaveLength(1);
  });

  it('announces the new one when you walk straight from one door to another', () => {
    // Without this the second door is silent, because the player never passed through "outside".
    const ctx = lobby();
    stepInto(ctx, 'duel');
    const events = stepInto(ctx, 'boxing');
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toBe('boxing');
  });

  it('says nothing while you are anywhere else in the lobby', () => {
    const ctx = lobby();
    ctx.player.position.x = 0;
    ctx.player.position.z = 0;
    ctx.sim.stepMany(60);
    expect(ctx.sim.events.drain().filter((e) => e.type === 'portal')).toHaveLength(0);
  });

  it('ignores the doors entirely in a match', () => {
    /**
     * The arches exist in every level's data, and only the lobby mode reads them. A mode that
     * triggered on them would let a player end their own round by running through the middle of
     * the map.
     */
    const level = buildLevel('jungle');
    const sim = new Simulation({ level, modeId: 'kangaroo-chase', seed: 1 });
    const player = sim.addPlayer({ id: 'a', name: 'A' });
    sim.addPlayer({ id: 'b', name: 'B' });
    sim.stepMany(60 * 8);
    sim.events.drain();

    const portal = level.portals[0];
    if (!portal) return;
    player.position.x = portal.position.x;
    player.position.z = portal.position.z;
    sim.stepMany(30);
    expect(sim.events.drain().filter((e) => e.type === 'portal')).toHaveLength(0);
  });
});

/**
 * The lobby is furniture, not terrain.
 *
 * Adding the ring of doors put a new spawn point at the middle of every map, and King of the Hill
 * picks its ring from the level's spawn points — so the hill started landing inside the lobby,
 * among eight glowing arches, at the most boringly central spot on the map. Caught by an existing
 * test going red, which is the only reason it was not shipped.
 */
describe('the lobby is not a place to put an objective', () => {
  it('never moves the hill into the ring of doors', () => {
    /**
     * Swept across seeds, because the hill samples candidates with the round's RNG: on any single
     * seed it may simply never pick the lobby, and the first version of this test used one seed
     * and survived the mutation that put the lobby spawn back in the running.
     */
    const level = buildLevel('jungle');
    const lobby = level.spawns.filter((s) => s.tag === 'lobby');
    expect(lobby.length).toBeGreaterThan(0);

    const landings: { x: number; z: number }[] = [];
    for (let seed = 0; seed < 14; seed++) {
      const sim = new Simulation({ level, modeId: 'hill', seed });
      for (let i = 0; i < 2; i++) sim.addPlayer({ id: `p${i}`, name: `P${i}` });
      // Past the countdown and one relocation, which is two draws per seed.
      for (let tick = 0; tick < 60 * 50; tick++) {
        sim.step();
        const objective = sim.mode.objectiveFor?.(sim.players.get('p0') as never);
        if (objective) landings.push({ x: objective.x, z: objective.z });
      }
    }

    expect(landings.length).toBeGreaterThan(0);
    for (const spawn of lobby) {
      for (const hill of landings) {
        const gap = Math.hypot(hill.x - spawn.position.x, hill.z - spawn.position.z);
        expect(gap, 'the hill landed on the lobby spawn').toBeGreaterThan(1);
      }
    }
  });
});
