import type { PlayerSnapshot, Snapshot } from '@kc/core';
import { ByteReader, ByteWriter, dequantize, quantize } from './binary.js';
import {
  ALL_FIELDS,
  ANGLE_SCALE,
  Field,
  HAND_SCALE,
  HEAD_SCALE,
  MsgType,
  POS_SCALE,
  VEL_SCALE,
  roleIndex,
  roleName,
} from './constants.js';

/** Maps stable player ids to compact slot numbers so snapshots never carry strings. */
export class SlotTable {
  private idToSlot = new Map<string, number>();
  private slotToId: (string | undefined)[] = [];

  assign(id: string): number {
    const existing = this.idToSlot.get(id);
    if (existing !== undefined) return existing;
    let slot = this.slotToId.indexOf(undefined);
    if (slot < 0) slot = this.slotToId.length;
    this.slotToId[slot] = id;
    this.idToSlot.set(id, slot);
    return slot;
  }

  release(id: string): void {
    const slot = this.idToSlot.get(id);
    if (slot === undefined) return;
    this.idToSlot.delete(id);
    this.slotToId[slot] = undefined;
  }

  slotOf(id: string): number | undefined {
    return this.idToSlot.get(id);
  }

  idOf(slot: number): string | undefined {
    return this.slotToId[slot];
  }

  entries(): [string, number][] {
    return [...this.idToSlot.entries()];
  }
}

export interface EncodeOptions {
  /** Snapshot the client has acknowledged; fields equal to it are omitted. */
  baseline?: Snapshot | null;
  /** Players further than this from `viewer` are sent without hands. */
  viewerId?: string;
  nearDistance?: number;
  /** Players to skip entirely this frame (interest management / far-rate throttling). */
  skip?: Set<string>;
}

/**
 * Delta snapshot encoder.
 *
 * Each player carries a 16-bit dirty mask; unchanged fields cost nothing. A resting player is
 * 3 bytes, a sprinting VR player with both hands is ~30 bytes. That is what keeps a 16-player
 * room around 6–10 KB/s down.
 */
export function encodeSnapshot(snapshot: Snapshot, slots: SlotTable, options: EncodeOptions = {}): Uint8Array {
  const baseline = options.baseline ?? null;
  const baseMap = new Map<string, PlayerSnapshot>();
  if (baseline) for (const p of baseline.players) baseMap.set(p.id, p);

  const viewer = options.viewerId ? snapshot.players.find((p) => p.id === options.viewerId) : undefined;
  const nearDistance = options.nearDistance ?? Infinity;

  const w = new ByteWriter(512);
  w.u8(MsgType.Snapshot);
  w.u32(snapshot.tick);
  w.u32(baseline ? baseline.tick : 0);

  const included = snapshot.players.filter((p) => !options.skip?.has(p.id));
  w.u8(included.length);

  for (const player of included) {
    const slot = slots.assign(player.id);
    const base = baseMap.get(player.id);
    const far =
      viewer !== undefined &&
      viewer.id !== player.id &&
      Math.hypot(player.x - viewer.x, player.y - viewer.y, player.z - viewer.z) > nearDistance;

    let mask = base ? diffMask(base, player) : ALL_FIELDS;
    if (far) mask &= ~Field.Hands;

    w.u8(slot);
    w.u16(mask);

    if (mask & Field.Position) {
      w.i16(quantize(player.x, POS_SCALE));
      w.i16(quantize(player.y, POS_SCALE));
      w.i16(quantize(player.z, POS_SCALE));
    }
    if (mask & Field.Velocity) {
      w.i16(quantize(player.vx, VEL_SCALE));
      w.i16(quantize(player.vy, VEL_SCALE));
      w.i16(quantize(player.vz, VEL_SCALE));
    }
    if (mask & Field.Look) {
      w.i16(quantize(player.yaw, ANGLE_SCALE));
      w.i16(quantize(player.pitch, ANGLE_SCALE));
      w.u8(Math.round(Math.max(0, Math.min(2.55, player.headY)) * HEAD_SCALE));
    }
    if (mask & Field.Flags) w.u16(player.flags);
    if (mask & Field.Vitals) {
      w.u8(Math.round(Math.max(0, Math.min(255, player.health))));
      w.u8(Math.round(Math.max(0, Math.min(255, player.stamina))));
    }
    if (mask & Field.Score) w.u16(Math.max(0, Math.min(65535, Math.round(player.score))));
    if (mask & Field.Emote) w.u8(player.emoteId & 0xff);
    if (mask & Field.Role) w.u8(roleIndex(player.role));
    if (mask & Field.Hands) {
      const hands = player.hands;
      w.u8(hands ? 1 : 0);
      if (hands) {
        for (const hand of hands) {
          w.i16(quantize(hand.x, HAND_SCALE));
          w.i16(quantize(hand.y, HAND_SCALE));
          w.i16(quantize(hand.z, HAND_SCALE));
        }
      }
    }
  }
  return w.finish();
}

function diffMask(base: PlayerSnapshot, next: PlayerSnapshot): number {
  let mask = 0;
  if (
    quantize(base.x, POS_SCALE) !== quantize(next.x, POS_SCALE) ||
    quantize(base.y, POS_SCALE) !== quantize(next.y, POS_SCALE) ||
    quantize(base.z, POS_SCALE) !== quantize(next.z, POS_SCALE)
  ) {
    mask |= Field.Position;
  }
  if (
    quantize(base.vx, VEL_SCALE) !== quantize(next.vx, VEL_SCALE) ||
    quantize(base.vy, VEL_SCALE) !== quantize(next.vy, VEL_SCALE) ||
    quantize(base.vz, VEL_SCALE) !== quantize(next.vz, VEL_SCALE)
  ) {
    mask |= Field.Velocity;
  }
  if (
    quantize(base.yaw, ANGLE_SCALE) !== quantize(next.yaw, ANGLE_SCALE) ||
    quantize(base.pitch, ANGLE_SCALE) !== quantize(next.pitch, ANGLE_SCALE) ||
    Math.round(base.headY * HEAD_SCALE) !== Math.round(next.headY * HEAD_SCALE)
  ) {
    mask |= Field.Look;
  }
  if (base.flags !== next.flags) mask |= Field.Flags;
  if (Math.round(base.health) !== Math.round(next.health) || Math.round(base.stamina) !== Math.round(next.stamina)) {
    mask |= Field.Vitals;
  }
  if (Math.round(base.score) !== Math.round(next.score)) mask |= Field.Score;
  if (base.emoteId !== next.emoteId) mask |= Field.Emote;
  if (base.role !== next.role) mask |= Field.Role;
  if (handsDiffer(base.hands, next.hands)) mask |= Field.Hands;
  return mask;
}

function handsDiffer(a: PlayerSnapshot['hands'], b: PlayerSnapshot['hands']): boolean {
  if (a === null || b === null) return a !== b;
  for (let i = 0; i < 2; i++) {
    const x = a[i];
    const y = b[i];
    if (!x || !y) return true;
    if (
      quantize(x.x, HAND_SCALE) !== quantize(y.x, HAND_SCALE) ||
      quantize(x.y, HAND_SCALE) !== quantize(y.y, HAND_SCALE) ||
      quantize(x.z, HAND_SCALE) !== quantize(y.z, HAND_SCALE)
    ) {
      return true;
    }
  }
  return false;
}

export interface DecodedSnapshot {
  tick: number;
  baseTick: number;
  players: PlayerSnapshot[];
}

/**
 * Decode a delta against the client's copy of the baseline. Fields absent from the delta are
 * carried over, which is exactly what makes the encoding safe to apply repeatedly.
 */
export function decodeSnapshot(
  data: Uint8Array,
  slots: SlotTable,
  baseline: Map<string, PlayerSnapshot>,
): DecodedSnapshot {
  const r = new ByteReader(data);
  const type = r.u8();
  if (type !== MsgType.Snapshot) throw new Error(`not a snapshot frame: ${type}`);
  const tick = r.u32();
  const baseTick = r.u32();
  const count = r.u8();
  const players: PlayerSnapshot[] = [];

  for (let i = 0; i < count; i++) {
    const slot = r.u8();
    const mask = r.u16();
    const id = slots.idOf(slot) ?? `slot${slot}`;
    const prev = baseline.get(id);
    const player: PlayerSnapshot = prev
      ? { ...prev, hands: prev.hands ? [{ ...prev.hands[0] }, { ...prev.hands[1] }] : null }
      : blankSnapshot(id);

    if (mask & Field.Position) {
      player.x = dequantize(r.i16(), POS_SCALE);
      player.y = dequantize(r.i16(), POS_SCALE);
      player.z = dequantize(r.i16(), POS_SCALE);
    }
    if (mask & Field.Velocity) {
      player.vx = dequantize(r.i16(), VEL_SCALE);
      player.vy = dequantize(r.i16(), VEL_SCALE);
      player.vz = dequantize(r.i16(), VEL_SCALE);
    }
    if (mask & Field.Look) {
      player.yaw = dequantize(r.i16(), ANGLE_SCALE);
      player.pitch = dequantize(r.i16(), ANGLE_SCALE);
      player.headY = r.u8() / HEAD_SCALE;
    }
    if (mask & Field.Flags) player.flags = r.u16();
    if (mask & Field.Vitals) {
      player.health = r.u8();
      player.stamina = r.u8();
    }
    if (mask & Field.Score) player.score = r.u16();
    if (mask & Field.Emote) player.emoteId = r.u8();
    if (mask & Field.Role) player.role = roleName(r.u8());
    if (mask & Field.Hands) {
      const has = r.u8();
      if (has) {
        player.hands = [
          { x: dequantize(r.i16(), HAND_SCALE), y: dequantize(r.i16(), HAND_SCALE), z: dequantize(r.i16(), HAND_SCALE) },
          { x: dequantize(r.i16(), HAND_SCALE), y: dequantize(r.i16(), HAND_SCALE), z: dequantize(r.i16(), HAND_SCALE) },
        ];
      } else {
        player.hands = null;
      }
    }
    players.push(player);
  }
  return { tick, baseTick, players };
}

function blankSnapshot(id: string): PlayerSnapshot {
  return {
    id,
    name: '',
    animalId: 'kangaroo',
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    pitch: 0,
    headY: 1.3,
    flags: 0,
    role: 'idle',
    health: 100,
    stamina: 100,
    score: 0,
    emoteId: 0,
    hands: null,
  };
}
