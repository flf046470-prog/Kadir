import { describe, expect, it } from 'vitest';
import { Simulation, buildJungleWorld, createIntent, createHandIntent, Buttons, snapshotPlayer } from '@kc/core';
import type { PlayerSnapshot, PlayerState } from '@kc/core';
import { decodeIntent, encodeIntent } from './intent-codec.js';
import { SlotTable, decodeSnapshot, encodeSnapshot } from './snapshot-codec.js';
import { InterpolationBuffer } from './interpolation.js';
import { PredictionBuffer } from './prediction.js';
import { decodeJson, encodeJson } from './messages.js';
import { NEAR_DISTANCE } from './constants.js';

const level = buildJungleWorld();

describe('intent codec', () => {
  it('round-trips a PC intent in a dozen bytes', () => {
    const intent = createIntent();
    intent.tick = 4321;
    intent.moveX = -0.5;
    intent.moveZ = 1;
    intent.lookYaw = 1.2;
    intent.lookPitch = -0.4;
    intent.buttons = Buttons.Jump | Buttons.Sprint;
    intent.headHeight = 1.62;

    const bytes = encodeIntent(intent);
    expect(bytes.length).toBe(15); // fixed-size PC/mobile frame

    const out = createIntent();
    decodeIntent(bytes, out);
    expect(out.tick).toBe(4321);
    expect(out.moveX).toBeCloseTo(-0.5, 2);
    expect(out.moveZ).toBeCloseTo(1, 2);
    expect(out.lookYaw).toBeCloseTo(1.2, 3);
    expect(out.buttons).toBe(intent.buttons);
    expect(out.hands).toBeNull();
  });

  it('round-trips VR hands and stays small', () => {
    const intent = createIntent();
    intent.hands = [createHandIntent(), createHandIntent()];
    intent.hands[0].tracked = true;
    intent.hands[0].pos = { x: -0.3, y: 1.2, z: 0.35 };
    intent.hands[0].vel = { x: 2.5, y: -1, z: 4 };
    intent.hands[0].grip = 0.8;
    intent.hands[1].tracked = true;
    intent.hands[1].pos = { x: 0.3, y: 1.25, z: 0.4 };
    intent.hands[1].grip = 1;

    const bytes = encodeIntent(intent);
    expect(bytes.length).toBe(41); // 15 + 13 bytes per tracked hand

    const out = createIntent();
    decodeIntent(bytes, out);
    expect(out.hands?.[0].pos.y).toBeCloseTo(1.2, 3);
    expect(out.hands?.[0].vel.z).toBeCloseTo(4, 1);
    expect(out.hands?.[0].grip).toBeCloseTo(0.8, 2);
    expect(out.hands?.[1].tracked).toBe(true);
  });

  it('survives a hostile frame without throwing on the happy path', () => {
    const intent = createIntent();
    intent.moveX = 99;
    intent.lookYaw = 40;
    const out = createIntent();
    decodeIntent(encodeIntent(intent), out);
    expect(Math.abs(out.moveX)).toBeLessThanOrEqual(1.01);
    expect(Number.isFinite(out.lookYaw)).toBe(true);
  });
});

describe('snapshot codec', () => {
  function makeSim(playerCount: number): Simulation {
    const sim = new Simulation({ level, modeId: 'kangaroo-chase', seed: 4 });
    for (let i = 0; i < playerCount; i++) sim.addPlayer({ id: `p${i}`, name: `Player ${i}` });
    sim.stepMany(30);
    return sim;
  }

  it('round-trips a full snapshot', () => {
    const sim = makeSim(3);
    const slots = new SlotTable();
    const snap = sim.snapshot();
    const bytes = encodeSnapshot(snap, slots);
    const decoded = decodeSnapshot(bytes, slots, new Map());
    expect(decoded.tick).toBe(snap.tick);
    expect(decoded.players).toHaveLength(3);
    const first = decoded.players[0] as PlayerSnapshot;
    const source = snap.players.find((p) => p.id === first.id) as PlayerSnapshot;
    expect(first.x).toBeCloseTo(source.x, 1);
    expect(first.role).toBe(source.role);
  });

  it('sends far less data as a delta than as a keyframe', () => {
    const sim = makeSim(8);
    const slots = new SlotTable();
    const base = sim.snapshot();
    const keyframe = encodeSnapshot(base, slots);
    sim.stepMany(3);
    const next = sim.snapshot();
    const delta = encodeSnapshot(next, slots, { baseline: base });
    expect(delta.length).toBeLessThan(keyframe.length);

    const baseline = new Map(base.players.map((p) => [p.id, p]));
    const decoded = decodeSnapshot(delta, slots, baseline);
    expect(decoded.players).toHaveLength(8);
    for (const player of decoded.players) {
      // Unchanged fields survive the delta.
      expect(player.name).toBe(baseline.get(player.id)?.name);
    }
  });

  it('costs almost nothing for an idle room', () => {
    const sim = makeSim(16);
    sim.stepMany(240); // everyone settles on the ground
    const slots = new SlotTable();
    const base = sim.snapshot();
    encodeSnapshot(base, slots);
    sim.stepMany(3);
    const delta = encodeSnapshot(sim.snapshot(), slots, { baseline: base });
    // 16 idle players cost 3 bytes each (slot + empty dirty mask) plus a 10-byte header.
    expect(delta.length).toBeLessThan(70);
  });

  it('keeps a busy 16-player room inside the bandwidth budget', () => {
    const sim = makeSim(16);
    const slots = new SlotTable();
    const intent = createIntent();
    intent.moveZ = 1;
    intent.buttons = Buttons.Jump | Buttons.Sprint;
    intent.hands = [createHandIntent(), createHandIntent()];
    intent.hands[0].tracked = true;
    intent.hands[1].tracked = true;

    let bytes = 0;
    let base = sim.snapshot();
    for (let i = 0; i < 20; i++) {
      for (const id of sim.players.keys()) {
        intent.lookYaw += 0.05;
        intent.hands[0].pos.x = Math.sin(i * 0.3) * 0.3;
        intent.hands[1].pos.y = 1.1 + Math.cos(i * 0.3) * 0.2;
        sim.setIntent(id, intent);
      }
      sim.stepMany(3);
      const snap = sim.snapshot();
      bytes += encodeSnapshot(snap, slots, { baseline: base }).length;
      base = snap;
    }
    // 20 snapshots ≈ 1 second at 20 Hz.
    const bytesPerSecond = bytes;
    expect(bytesPerSecond).toBeLessThan(14_000);
  });

  it('drops hands for distant players (interest management)', () => {
    const sim = makeSim(2);
    const players = [...sim.players.values()] as PlayerState[];
    const a = players[0] as PlayerState;
    const b = players[1] as PlayerState;
    a.position.x = 0;
    b.position.x = NEAR_DISTANCE + 40;
    a.hands[0].tracked = true;
    b.hands[0].tracked = true;

    const slots = new SlotTable();
    const snap = { tick: 1, players: [snapshotPlayer(a), snapshotPlayer(b)], mode: sim.mode.state() };
    const near = encodeSnapshot(snap, slots, { viewerId: a.id, nearDistance: NEAR_DISTANCE });
    const all = encodeSnapshot(snap, new SlotTable(), {});
    expect(near.length).toBeLessThan(all.length);
  });

  it('reuses slots after a player leaves', () => {
    const slots = new SlotTable();
    expect(slots.assign('a')).toBe(0);
    expect(slots.assign('b')).toBe(1);
    slots.release('a');
    expect(slots.assign('c')).toBe(0);
    expect(slots.idOf(0)).toBe('c');
  });
});

describe('interpolation', () => {
  function snap(id: string, x: number): PlayerSnapshot {
    return {
      id,
      name: id,
      animalId: 'kangaroo',
      x,
      y: 0,
      z: 0,
      vx: 10,
      vy: 0,
      vz: 0,
      yaw: 0,
      pitch: 0,
      headY: 1.3,
      flags: 0,
      role: 'runner',
      health: 100,
      stamina: 100,
      score: 0,
      emoteId: 0,
      hands: null,
    };
  }

  it('renders remote players in the past, between two snapshots', () => {
    const buffer = new InterpolationBuffer({ delayMs: 100, maxExtrapolationMs: 250 });
    buffer.push(1, [snap('a', 0)], 1000);
    buffer.push(2, [snap('a', 10)], 1100);
    const sample = buffer.sample('a', 1150);
    expect(sample?.x).toBeCloseTo(5, 1);
  });

  it('extrapolates briefly, then freezes instead of guessing', () => {
    const buffer = new InterpolationBuffer({ delayMs: 100, maxExtrapolationMs: 250 });
    buffer.push(1, [snap('a', 0)], 1000);
    const short = buffer.sample('a', 1200);
    expect(short?.x).toBeCloseTo(1, 1);
    const long = buffer.sample('a', 5000);
    expect(long?.x).toBeCloseTo(2.5, 1); // capped at maxExtrapolationMs
  });

  it('returns null for unknown players', () => {
    const buffer = new InterpolationBuffer();
    expect(buffer.sample('nobody')).toBeNull();
  });
});

describe('prediction and reconciliation', () => {
  it('replays unacknowledged input after a server correction', () => {
    const sim = new Simulation({ level, modeId: 'kangaroo-chase', seed: 21 });
    const local = sim.addPlayer({ id: 'me' });
    sim.stepMany(30);

    const buffer = new PredictionBuffer();
    const intent = createIntent();
    intent.moveZ = 1;

    for (let i = 0; i < 10; i++) {
      sim.setIntent('me', intent, false);
      sim.step();
      buffer.record(sim.tick, intent);
    }
    const predicted = { ...local.position };

    // Server agrees about an earlier tick; the client rewinds and replays.
    const authoritative = snapshotPlayer(local);
    authoritative.x -= 0.5;
    const error = buffer.reconcile(sim, local, authoritative, sim.tick - 5);

    expect(error).toBeGreaterThan(0);
    expect(buffer.pending().length).toBeLessThanOrEqual(5);
    // Replaying the 5 pending inputs must move the player forward again, not leave it snapped back.
    expect(local.position.z).toBeGreaterThan(predicted.z - 1);
  });

  it('smooths small corrections and snaps big ones', () => {
    const sim = new Simulation({ level, modeId: 'kangaroo-chase', seed: 22 });
    const local = sim.addPlayer({ id: 'me' });
    sim.stepMany(20);
    const buffer = new PredictionBuffer();

    const small = snapshotPlayer(local);
    small.x += 0.3;
    buffer.reconcile(sim, local, small, sim.tick);
    expect(Math.abs(buffer.smoothingOffset.x)).toBeGreaterThan(0);
    buffer.decaySmoothing();
    expect(Math.abs(buffer.smoothingOffset.x)).toBeLessThan(0.3);

    const teleport = snapshotPlayer(local);
    teleport.x += 50;
    buffer.reconcile(sim, local, teleport, sim.tick);
    expect(buffer.smoothingOffset.x).toBe(0);
  });
});

describe('control messages', () => {
  it('round-trips and rejects malformed json', () => {
    const hello = encodeJson({
      t: 'hello',
      protocol: 1,
      name: 'Roo',
      animalId: 'kangaroo',
      cosmetics: {},
      platform: 'vr',
      crossPlay: true,
    });
    expect(decodeJson(hello)?.t).toBe('hello');
    expect(decodeJson('nonsense')).toBeNull();
    expect(decodeJson('{"no":"type"}')).toBeNull();
  });
});

describe('slot table', () => {
  it('adopts server-assigned slot numbers verbatim', () => {
    const slots = new SlotTable();
    slots.setSlot('c', 5);
    slots.setSlot('a', 0);
    expect(slots.slotOf('c')).toBe(5);
    expect(slots.idOf(5)).toBe('c');
    expect(slots.assign('b')).toBe(1); // first free slot, not 6
    slots.setSlot('d', 5); // taking an occupied slot evicts the previous owner
    expect(slots.slotOf('c')).toBeUndefined();
    expect(slots.idOf(5)).toBe('d');
  });
});
