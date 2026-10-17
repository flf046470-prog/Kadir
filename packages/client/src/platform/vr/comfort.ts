/**
 * VR comfort and feedback maths.
 *
 * Kept pure and free of three.js and WebXR so it can be unit tested. There is no headset in CI,
 * and these are exactly the values that are miserable to tune by guesswork on hardware: a
 * vignette that never opens, a pinch that will not release, a haptic that buzzes continuously.
 */

/** A hand joint position, in metres, in whatever space the caller is working in. */
export interface JointPos {
  x: number;
  y: number;
  z: number;
}

export function distance(a: JointPos, b: JointPos): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Pinch is fully closed at or below this thumb-to-index distance, on an adult-sized hand. */
const PINCH_CLOSED_M = 0.02;
/** And fully open at or above this. Between them the grip ramps, so a partial grab is possible. */
const PINCH_OPEN_M = 0.055;

/**
 * Grip strength from a hand-tracked pinch, 0..1.
 *
 * Controllers report a grip axis directly; bare hands do not, and an `XRInputSource` in
 * hand-tracking mode has **no gamepad at all** — which is why reading `gamepad.buttons` leaves
 * hand tracking looking connected but unable to grab anything.
 *
 * `handScale` normalises for hand size (children's hands are markedly smaller, and a fixed
 * threshold makes the game unplayable for them). Pass the wrist-to-middle-metacarpal length
 * divided by the adult reference; 1 disables scaling.
 */
export function pinchStrength(thumbTip: JointPos, indexTip: JointPos, handScale = 1): number {
  const scale = handScale > 0.2 ? handScale : 1;
  const d = distance(thumbTip, indexTip) / scale;
  if (d <= PINCH_CLOSED_M) return 1;
  if (d >= PINCH_OPEN_M) return 0;
  return (PINCH_OPEN_M - d) / (PINCH_OPEN_M - PINCH_CLOSED_M);
}

/** The trigger/pinch threshold at the default `grabSensitivity` of 1 — unchanged from before this existed. */
const GRAB_THRESHOLD_BASE = 0.4;
const GRAB_THRESHOLD_MIN = 0.12;
const GRAB_THRESHOLD_MAX = 0.6;

/**
 * How much grip (0..1, from `pinchStrength` or a controller trigger) is needed to start a grab,
 * from the player's `comfort.grabSensitivity`.
 *
 * `Settings.comfort` shipped this as `sensitivity`, read only as `settings.comfort.sensitivity *
 * 0.4` — so turning the number *up* raised the threshold and made a grab *harder* to trigger,
 * backwards from what "sensitivity" means to anyone reading it. It also had no slider anywhere in
 * the Settings menu, so nobody could have discovered the inversion by using it. Division rather
 * than multiplication fixes the direction; clamping keeps the result inside grip's own 0..1 range
 * at the extremes so a low setting never makes grabbing outright impossible.
 */
export function grabThresholdFor(sensitivity: number): number {
  const s = Number.isFinite(sensitivity) && sensitivity > 0 ? sensitivity : 1;
  return Math.min(GRAB_THRESHOLD_MAX, Math.max(GRAB_THRESHOLD_MIN, GRAB_THRESHOLD_BASE / s));
}

/** Adult wrist-to-middle-metacarpal length, the reference `pinchStrength` scales against. */
const REFERENCE_PALM_M = 0.09;

export function handScaleFrom(wrist: JointPos, middleMetacarpal: JointPos): number {
  const palm = distance(wrist, middleMetacarpal);
  if (!Number.isFinite(palm) || palm <= 0.01) return 1;
  // Clamped: a tracking glitch reporting a 3 cm or 30 cm palm must not make grabbing impossible.
  return Math.min(1.6, Math.max(0.6, palm / REFERENCE_PALM_M));
}

/** Below this speed there is no vection to counteract, so the vignette stays fully open. */
const VIGNETTE_START_SPEED = 2.2;
/** At and above this, it is as closed as the player's comfort setting allows. */
const VIGNETTE_FULL_SPEED = 9;

export interface VignetteInput {
  /** Horizontal speed in m/s. Vertical motion is self-inflicted and reads as far less nauseating. */
  speed: number;
  /** True while a smooth turn is in progress — rotation is the worst offender for sim sickness. */
  turning: boolean;
  /** True when the player is airborne; a hop is expected motion and should not close the view. */
  airborne: boolean;
  /** The player's comfort setting, 0 (off) to 1 (strongest). */
  strength: number;
}

/**
 * How closed the comfort vignette should be, 0..1.
 *
 * Restricting peripheral vision during motion is the one intervention with consistent evidence
 * behind it for reducing sim sickness. It is also actively unpleasant when it triggers on
 * ordinary play, so hops are excluded and the ramp starts above walking pace.
 *
 * At `strength` 0 this always returns 0: a player who turned it off must never see it.
 */
export function vignetteIntensity(input: VignetteInput): number {
  const strength = Math.min(1, Math.max(0, input.strength));
  if (strength === 0) return 0;

  let motion = 0;
  if (!input.airborne && input.speed > VIGNETTE_START_SPEED) {
    motion = (input.speed - VIGNETTE_START_SPEED) / (VIGNETTE_FULL_SPEED - VIGNETTE_START_SPEED);
    motion = Math.min(1, motion);
  }
  // Turning alone justifies a vignette even when standing still.
  if (input.turning) motion = Math.max(motion, 0.75);

  return motion * strength;
}

/**
 * A move of the body this far in one frame is a teleport — a respawn, a round's kickoff position —
 * not motion, and it is covered with a blink rather than shown.
 */
export const TELEPORT_DISTANCE = 2;
/** Time constant for easing out a vertical snap the body's own velocity does not explain. */
export const STEP_EASE_SECONDS = 0.12;
/** The eased head never trails the body by more than this: one full step-up (0.45 m), not a lag. */
export const STEP_EASE_LIMIT = 0.6;

export interface RigHeightState {
  y: number;
  ready: boolean;
}

/**
 * Where to put the VR rig vertically this frame.
 *
 * The headset view used to be bolted to the capsule, so every vertical discontinuity reached the
 * eyes in one frame: stepping onto a ledge or a stair, being pushed out of a collider. Measured
 * walking the glacier with the stick, one such frame reached 264 m/s² of vertical acceleration —
 * motion the inner ear never feels, which is the textbook recipe for simulator sickness.
 *
 * The rig follows the body's *velocity* exactly, so a hop, a fall and a climb are shown as they
 * happen and never lag; only the part of a move that velocity does not explain — a snap — is
 * eased, over `STEP_EASE_SECONDS`, and never by more than `STEP_EASE_LIMIT`. A jump of more than
 * `TELEPORT_DISTANCE` is a teleport and is taken at once (and blinked by the caller).
 */
export function easeRigHeight(state: RigHeightState, bodyY: number, bodyVy: number, dt: number): number {
  if (!state.ready || dt <= 0 || Math.abs(bodyY - state.y) > TELEPORT_DISTANCE) {
    state.y = bodyY;
    state.ready = true;
    return state.y;
  }
  const predicted = state.y + bodyVy * dt;
  const error = bodyY - predicted;
  const eased = predicted + error * (1 - Math.exp(-dt / STEP_EASE_SECONDS));
  state.y = Math.min(bodyY + STEP_EASE_LIMIT, Math.max(bodyY - STEP_EASE_LIMIT, eased));
  return state.y;
}

/** Did the body move further in one frame than it could have by moving? */
export function isTeleport(dx: number, dy: number, dz: number, speed: number, dt: number): boolean {
  return Math.hypot(dx, dy, dz) > Math.max(TELEPORT_DISTANCE, speed * dt * 3);
}

/** Smooth the vignette so it fades rather than snapping, which is itself uncomfortable. */
export function approach(current: number, target: number, dt: number, perSecond = 6): number {
  if (dt <= 0) return current;
  const t = Math.min(1, dt * perSecond);
  return current + (target - current) * t;
}

export type HapticEvent =
  | 'grab'
  | 'release'
  | 'land'
  | 'hardLand'
  | 'punch'
  | 'tagged'
  | 'tag'
  | 'ui'
  /** Recoil, in the hand that fired. */
  | 'gadgetFire'
  /** A gadget landed on you. */
  | 'gadgetHit'
  /** You have been frozen or snared and are about to stop responding to your own input. */
  | 'frozen';

export interface HapticPulse {
  intensity: number;
  durationMs: number;
}

/**
 * Feedback strength per event.
 *
 * Deliberately short. A long pulse on a frequent event (landing, which happens every hop) turns
 * into a continuous buzz that players disable entirely, taking the useful feedback with it.
 */
const HAPTICS: Record<HapticEvent, HapticPulse> = {
  grab: { intensity: 0.45, durationMs: 25 },
  release: { intensity: 0.15, durationMs: 15 },
  land: { intensity: 0.3, durationMs: 20 },
  hardLand: { intensity: 0.75, durationMs: 60 },
  punch: { intensity: 0.9, durationMs: 55 },
  tagged: { intensity: 1, durationMs: 120 },
  tag: { intensity: 0.8, durationMs: 80 },
  ui: { intensity: 0.2, durationMs: 12 },
  gadgetFire: { intensity: 0.7, durationMs: 40 },
  gadgetHit: { intensity: 0.85, durationMs: 70 },
  // The longest pulse in the table, and deliberately so: it is the only one that fires while the
  // player's own input has stopped working, so it has to outlast the confusion rather than the
  // moment. Still well under the freeze itself.
  frozen: { intensity: 1, durationMs: 160 },
};

export function hapticFor(event: HapticEvent, scale = 1): HapticPulse {
  const base = HAPTICS[event];
  const clamped = Math.min(1, Math.max(0, scale));
  return { intensity: Math.min(1, base.intensity * clamped), durationMs: base.durationMs };
}
