import type { Vec3 } from '../math/vec3.js';
import { vec3 } from '../math/vec3.js';

/**
 * The single boundary between a platform and the game.
 *
 * PC, Mobile and VR each produce an `InputIntent`; nothing else about a platform reaches the
 * simulation. This is what makes cross-play possible: the server validates and simulates one
 * intent type, whatever device produced it.
 */
export const Buttons = {
  None: 0,
  Jump: 1 << 0,
  Sprint: 1 << 1,
  Crouch: 1 << 2,
  GrabLeft: 1 << 3,
  GrabRight: 1 << 4,
  Interact: 1 << 5,
  Emote: 1 << 6,
  /** Non-VR platforms map a punch button; VR derives punches from hand velocity. */
  PunchLeft: 1 << 7,
  PunchRight: 1 << 8,
} as const;

export type ButtonMask = number;

export function hasButton(mask: ButtonMask, button: number): boolean {
  return (mask & button) !== 0;
}

/** Tracked hand, expressed in body-local space (origin at the player's feet, +Z = facing). */
export interface HandIntent {
  /** False when the hand is untracked (controller asleep, hand out of view, non-VR platform). */
  tracked: boolean;
  pos: Vec3;
  vel: Vec3;
  /** 0..1 grip analogue; the sim treats >= gripThreshold as "holding". */
  grip: number;
}

export function createHandIntent(): HandIntent {
  return { tracked: false, pos: vec3(), vel: vec3(), grip: 0 };
}

export interface InputIntent {
  /** Simulation tick this intent belongs to. Server rejects intents outside its window. */
  tick: number;
  /** -1..1 strafe / forward. Joystick, WASD, or VR stick fallback. */
  moveX: number;
  moveZ: number;
  /** Absolute body yaw in radians (VR: derived from headset; PC/Mobile: accumulated look). */
  lookYaw: number;
  /** Absolute pitch in radians, clamped by the platform layer. */
  lookPitch: number;
  buttons: ButtonMask;
  /** VR only. `null` on PC/Mobile — the same movement code then simply skips hand forces. */
  hands: [HandIntent, HandIntent] | null;
  /** VR: HMD height above the play-space floor, used for crouch detection and calibration. */
  headHeight: number;
}

export function createIntent(): InputIntent {
  return {
    tick: 0,
    moveX: 0,
    moveZ: 0,
    lookYaw: 0,
    lookPitch: 0,
    buttons: 0,
    hands: null,
    headHeight: 0,
  };
}

export function copyIntent(out: InputIntent, src: InputIntent): InputIntent {
  out.tick = src.tick;
  out.moveX = src.moveX;
  out.moveZ = src.moveZ;
  out.lookYaw = src.lookYaw;
  out.lookPitch = src.lookPitch;
  out.buttons = src.buttons;
  out.headHeight = src.headHeight;
  if (src.hands) {
    if (!out.hands) out.hands = [createHandIntent(), createHandIntent()];
    for (let i = 0; i < 2; i++) {
      const s = src.hands[i] as HandIntent;
      const d = out.hands[i] as HandIntent;
      d.tracked = s.tracked;
      d.grip = s.grip;
      d.pos.x = s.pos.x;
      d.pos.y = s.pos.y;
      d.pos.z = s.pos.z;
      d.vel.x = s.vel.x;
      d.vel.y = s.vel.y;
      d.vel.z = s.vel.z;
    }
  } else {
    out.hands = null;
  }
  return out;
}

/**
 * Server-side sanitisation. Never trust a client: axes are clamped, angles wrapped, and hand
 * poses restricted to a plausible human reach envelope so a modified client cannot grab across
 * the map or teleport by sending absurd hand positions.
 */
export function sanitizeIntent(intent: InputIntent, maxHandReach = 1.2): InputIntent {
  intent.moveX = clampAxis(intent.moveX);
  intent.moveZ = clampAxis(intent.moveZ);
  intent.lookYaw = wrap(intent.lookYaw);
  intent.lookPitch = Number.isFinite(intent.lookPitch)
    ? Math.max(-1.55, Math.min(1.55, intent.lookPitch))
    : 0;
  intent.headHeight = Number.isFinite(intent.headHeight)
    ? Math.max(0.4, Math.min(2.4, intent.headHeight))
    : 1.6;
  intent.buttons = (intent.buttons | 0) & 0x1ff;
  if (intent.hands) {
    for (const hand of intent.hands) {
      hand.grip = Number.isFinite(hand.grip) ? Math.max(0, Math.min(1, hand.grip)) : 0;
      clampVec(hand.pos, maxHandReach, 2.6);
      clampVec(hand.vel, 20, 20);
      if (!Number.isFinite(hand.pos.x + hand.pos.y + hand.pos.z)) hand.tracked = false;
    }
  }
  return intent;
}

function clampAxis(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

function wrap(a: number): number {
  if (!Number.isFinite(a)) return 0;
  const TAU = Math.PI * 2;
  let x = (a + Math.PI) % TAU;
  if (x < 0) x += TAU;
  return x - Math.PI;
}

function clampVec(v: Vec3, horizontal: number, vertical: number): void {
  v.x = Number.isFinite(v.x) ? Math.max(-horizontal, Math.min(horizontal, v.x)) : 0;
  v.z = Number.isFinite(v.z) ? Math.max(-horizontal, Math.min(horizontal, v.z)) : 0;
  v.y = Number.isFinite(v.y) ? Math.max(-vertical, Math.min(vertical, v.y)) : 0;
}
