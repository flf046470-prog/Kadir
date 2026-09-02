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

/** Smooth the vignette so it fades rather than snapping, which is itself uncomfortable. */
export function approach(current: number, target: number, dt: number, perSecond = 6): number {
  if (dt <= 0) return current;
  const t = Math.min(1, dt * perSecond);
  return current + (target - current) * t;
}

export type HapticEvent = 'grab' | 'release' | 'land' | 'hardLand' | 'punch' | 'tagged' | 'tag' | 'ui';

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
};

export function hapticFor(event: HapticEvent, scale = 1): HapticPulse {
  const base = HAPTICS[event];
  const clamped = Math.min(1, Math.max(0, scale));
  return { intensity: Math.min(1, base.intensity * clamped), durationMs: base.durationMs };
}
