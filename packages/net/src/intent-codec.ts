import type { InputIntent } from '@kc/core';
import { createHandIntent } from '@kc/core';
import { ByteReader, ByteWriter, dequantize, quantize } from './binary.js';
import { ANGLE_SCALE, HAND_SCALE, MsgType, VEL_SCALE } from './constants.js';

/**
 * Intent frame: ~13 bytes without hands, ~29 with both hands tracked.
 * At 60 Hz that is roughly 0.8–1.8 KB/s upstream per player.
 */
export function encodeIntent(intent: InputIntent): Uint8Array {
  const w = new ByteWriter(32);
  w.u8(MsgType.Intent);
  w.u32(intent.tick);
  w.i8(Math.round(intent.moveX * 127));
  w.i8(Math.round(intent.moveZ * 127));
  w.i16(quantize(intent.lookYaw, ANGLE_SCALE));
  w.i16(quantize(intent.lookPitch, ANGLE_SCALE));
  w.u16(intent.buttons);
  w.u8(Math.round(Math.max(0, Math.min(2.55, intent.headHeight)) * 100));
  // One byte of mic loudness. 1/255 precision is far finer than a jaw can show, and it costs
  // less than the float it replaces.
  w.u8(Math.round(Math.max(0, Math.min(1, intent.voice)) * 255));

  let mask = 0;
  if (intent.hands) {
    if (intent.hands[0].tracked) mask |= 1;
    if (intent.hands[1].tracked) mask |= 2;
  }
  w.u8(mask);

  if (intent.hands) {
    for (let i = 0; i < 2; i++) {
      if ((mask & (1 << i)) === 0) continue;
      const hand = intent.hands[i];
      if (!hand) continue;
      w.i16(quantize(hand.pos.x, HAND_SCALE));
      w.i16(quantize(hand.pos.y, HAND_SCALE));
      w.i16(quantize(hand.pos.z, HAND_SCALE));
      w.i16(quantize(hand.vel.x, VEL_SCALE));
      w.i16(quantize(hand.vel.y, VEL_SCALE));
      w.i16(quantize(hand.vel.z, VEL_SCALE));
      w.u8(Math.round(hand.grip * 255));
    }
  }
  return w.finish();
}

export function decodeIntent(data: Uint8Array, out: InputIntent): InputIntent {
  const r = new ByteReader(data);
  const type = r.u8();
  if (type !== MsgType.Intent) throw new Error(`not an intent frame: ${type}`);
  out.tick = r.u32();
  out.moveX = r.i8() / 127;
  out.moveZ = r.i8() / 127;
  out.lookYaw = dequantize(r.i16(), ANGLE_SCALE);
  out.lookPitch = dequantize(r.i16(), ANGLE_SCALE);
  out.buttons = r.u16();
  out.headHeight = r.u8() / 100;
  out.voice = r.u8() / 255;

  const mask = r.u8();
  if (mask === 0) {
    out.hands = null;
    return out;
  }
  if (!out.hands) out.hands = [createHandIntent(), createHandIntent()];
  for (let i = 0; i < 2; i++) {
    const hand = out.hands[i];
    if (!hand) continue;
    if ((mask & (1 << i)) === 0) {
      hand.tracked = false;
      hand.grip = 0;
      continue;
    }
    hand.tracked = true;
    hand.pos.x = dequantize(r.i16(), HAND_SCALE);
    hand.pos.y = dequantize(r.i16(), HAND_SCALE);
    hand.pos.z = dequantize(r.i16(), HAND_SCALE);
    hand.vel.x = dequantize(r.i16(), VEL_SCALE);
    hand.vel.y = dequantize(r.i16(), VEL_SCALE);
    hand.vel.z = dequantize(r.i16(), VEL_SCALE);
    hand.grip = r.u8() / 255;
  }
  return out;
}
