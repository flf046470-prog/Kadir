import { lerpAngle } from '@kc/core';
import type { InputIntent } from '@kc/core';

/**
 * A headset's poses, resampled to the simulation's own tick times.
 *
 * The simulation steps at 60 Hz and a headset draws at 72–144 Hz, so a tick falls somewhere
 * between two frames. Handing every tick the pose sampled at the *frame* makes the hand's motion
 * per tick uneven: at 72 Hz most ticks get one frame's worth of movement and one in five gets two.
 * A climb's release speed is the mean of the last few ticks of hand motion, so it came out up to
 * 13.9 % off what the same pull gives at 60 Hz, depending on where the release fell (measured,
 * `.probe/rate.ts`; 5.2 % at 144 Hz). Read at the tick's own time — between the previous frame's
 * sample and this one's — every rate gives the 60 Hz answer.
 *
 * Only where the body is is resampled: hand positions, the head's yaw (the frame tracked hands
 * are expressed in) and its height. The grip, the sticks and the buttons are the latest sample:
 * nothing says where between two frames a hand opened, and blending the grip was measured to
 * change no release speed (its mutation survived the test that holds them).
 */
interface HandSample {
  tracked: boolean;
  x: number;
  y: number;
  z: number;
}

interface PoseSample {
  yaw: number;
  head: number;
  hands: HandSample[];
}

export class TickResampler {
  private readonly prev: PoseSample & { valid: boolean } = { valid: false, yaw: 0, head: 0, hands: [] };
  private readonly cur: PoseSample = { yaw: 0, head: 0, hands: [] };

  /** Call once per frame, right after the platform has written this frame's sample into `intent`. */
  capture(intent: InputIntent): void {
    copyInto(this.cur, intent);
  }

  /**
   * Write into `intent` the pose at `alpha` of the way from the previous frame's sample to this
   * one's (0 = the previous frame, 1 = this frame). Without a previous frame, or for a hand that
   * was not tracked in both, this frame's sample stands.
   */
  apply(intent: InputIntent, alpha: number): void {
    const a = Math.max(0, Math.min(1, alpha));
    if (!this.prev.valid) return;
    intent.lookYaw = lerpAngle(this.prev.yaw, this.cur.yaw, a);
    intent.headHeight = this.prev.head + (this.cur.head - this.prev.head) * a;
    const hands = intent.hands;
    if (!hands) return;
    for (let i = 0; i < hands.length; i++) {
      const hand = hands[i]!;
      const was = this.prev.hands[i];
      const now = this.cur.hands[i];
      if (!was?.tracked || !now?.tracked) continue;
      hand.pos.x = was.x + (now.x - was.x) * a;
      hand.pos.y = was.y + (now.y - was.y) * a;
      hand.pos.z = was.z + (now.z - was.z) * a;
    }
  }

  /** Call once per frame after the ticks: this frame's sample becomes the previous one. */
  endFrame(intent: InputIntent): void {
    // Leave the intent holding this frame's own sample, not the last tick's blend of two.
    copyBack(intent, this.cur);
    this.prev.valid = true;
    this.prev.yaw = this.cur.yaw;
    this.prev.head = this.cur.head;
    this.prev.hands.length = this.cur.hands.length;
    for (let i = 0; i < this.cur.hands.length; i++) this.prev.hands[i] = { ...this.cur.hands[i]! };
  }

  /** Forget the previous frame (a session starting or ending, a pause): the next tick takes its sample as is. */
  reset(): void {
    this.prev.valid = false;
  }
}

/**
 * How far between the previous frame and this one a tick falls. `dt` is this frame's length and
 * `remaining` what is left in the accumulator after the tick has taken its step: the tick happened
 * `remaining` seconds before this frame.
 */
export function tickAlpha(dt: number, remaining: number): number {
  if (dt <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - remaining / dt));
}

function copyInto(out: PoseSample, intent: InputIntent): void {
  out.yaw = intent.lookYaw;
  out.head = intent.headHeight;
  const hands = intent.hands ?? [];
  out.hands.length = hands.length;
  for (let i = 0; i < hands.length; i++) {
    const h = hands[i]!;
    out.hands[i] = { tracked: h.tracked, x: h.pos.x, y: h.pos.y, z: h.pos.z };
  }
}

function copyBack(intent: InputIntent, from: PoseSample): void {
  intent.lookYaw = from.yaw;
  intent.headHeight = from.head;
  const hands = intent.hands;
  if (!hands) return;
  for (let i = 0; i < hands.length && i < from.hands.length; i++) {
    const h = hands[i]!;
    const s = from.hands[i]!;
    h.pos.x = s.x;
    h.pos.y = s.y;
    h.pos.z = s.z;
  }
}
