/**
 * Every tunable that shapes how the game feels. One struct, no magic numbers scattered through
 * the movement code, so designers (and the animal system) can adjust behaviour from data.
 *
 * Units: metres, seconds, radians.
 */
export interface MovementConfig {
  // --- body ---
  radius: number;
  standHeight: number;
  crouchHeight: number;
  /** Eye/head height as a fraction of current capsule height (non-VR avatars). */
  headHeightRatio: number;

  // --- core physical movement ---
  maxSpeed: number;
  acceleration: number;
  /** Ground deceleration when there is no input, scaled by the surface's friction. */
  friction: number;
  gravity: number;
  /** VR hand push scaling: how much hand motion converts into body velocity. */
  pushForce: number;
  jumpForce: number;
  /** 0..1 — how much of `acceleration` applies while airborne. */
  airControl: number;
  /** Impulse gained by shoving off a wall with a hand (VR) or wall-jumping (PC/Mobile). */
  wallPush: number;
  /** Global multiplier on surface friction values. */
  surfaceFriction: number;

  // --- kangaroo character ---
  sprintMultiplier: number;
  /** Seconds of holding jump for a fully charged hop. */
  maxChargeTime: number;
  /** Extra vertical impulse at full charge (multiplier on jumpForce). */
  chargeJumpBoost: number;
  /** Extra forward impulse at full charge, scaled by current horizontal speed. */
  longJumpBoost: number;
  /** Speed at which a wall contact converts into an automatic bounce. */
  wallBounceMinSpeed: number;
  wallBounceRestitution: number;
  wallJumpForce: number;
  wallJumpHorizontal: number;
  /** Grace period after leaving the ground during which jump still works. */
  coyoteTime: number;
  /** Jump pressed slightly before landing is remembered for this long. */
  jumpBufferTime: number;
  /** 0..1 — tail balance. Higher means shorter stagger after a hard landing. */
  tailBalance: number;
  /** Landing speed above which the player staggers. */
  staggerLandingSpeed: number;
  staggerDuration: number;
  /** Movement authority retained while staggered (0..1). */
  staggerControl: number;

  // --- climbing ---
  /** How far from the chest a grip may be acquired (PC/Mobile auto-grab). */
  gripReach: number;
  climbSpeed: number;
  /** Impulse when jumping off a grip. */
  climbLaunchForce: number;
  /** Analogue grip value treated as "holding". */
  gripThreshold: number;

  // --- VR hands ---
  handGrabRadius: number;
  /** Multiplier when both hands are anchored — two hands really are stronger. */
  handTwoHandMultiplier: number;
  /** Maximum body correction applied by hands in a single tick (anti-teleport). */
  maxHandCorrection: number;
  /** Palm push (no grip) force scaling. */
  handPushForce: number;

  // --- limits (also used as server-side anti-cheat clamps) ---
  terminalVelocity: number;
  maxHorizontalSpeed: number;
}

/** Baseline kangaroo. Every animal is a bounded variation of this. */
export const DEFAULT_MOVEMENT: MovementConfig = {
  radius: 0.35,
  standHeight: 1.5,
  crouchHeight: 0.9,
  headHeightRatio: 0.88,

  maxSpeed: 7.2,
  acceleration: 42,
  friction: 14,
  gravity: 24,
  pushForce: 1.0,
  jumpForce: 8.2,
  airControl: 0.42,
  wallPush: 6.5,
  surfaceFriction: 1,

  sprintMultiplier: 1.35,
  maxChargeTime: 0.55,
  chargeJumpBoost: 0.75,
  longJumpBoost: 0.55,
  wallBounceMinSpeed: 6,
  wallBounceRestitution: 0.55,
  wallJumpForce: 7.4,
  wallJumpHorizontal: 5.5,
  coyoteTime: 0.12,
  jumpBufferTime: 0.15,
  tailBalance: 0.75,
  staggerLandingSpeed: 17,
  staggerDuration: 0.5,
  staggerControl: 0.35,

  gripReach: 1.35,
  climbSpeed: 3.1,
  climbLaunchForce: 7.0,
  gripThreshold: 0.55,

  handGrabRadius: 0.28,
  handTwoHandMultiplier: 1.3,
  maxHandCorrection: 0.55,
  handPushForce: 1.15,

  terminalVelocity: 55,
  maxHorizontalSpeed: 26,
};

export function cloneMovementConfig(config: MovementConfig): MovementConfig {
  return { ...config };
}

/**
 * Fields an animal is allowed to nudge, and by how much (fractional). Anything outside this
 * list is identical for every animal — that is the technical guarantee behind
 * "premium animals are cosmetic".
 */
export const FEEL_BAND = 0.03;

export const FEEL_FIELDS = [
  'maxSpeed',
  'acceleration',
  'jumpForce',
  'airControl',
  'friction',
  'tailBalance',
] as const satisfies readonly (keyof MovementConfig)[];

export type FeelField = (typeof FEEL_FIELDS)[number];

/** Fractional modifiers, e.g. `{ maxSpeed: 0.02 }` = +2 %. Clamped to ±FEEL_BAND on load. */
export type FeelProfile = Partial<Record<FeelField, number>>;

export function clampFeelProfile(profile: FeelProfile): FeelProfile {
  const out: FeelProfile = {};
  for (const field of FEEL_FIELDS) {
    const value = profile[field];
    if (value === undefined) continue;
    if (!Number.isFinite(value)) continue;
    out[field] = Math.max(-FEEL_BAND, Math.min(FEEL_BAND, value));
  }
  return out;
}

export function applyFeelProfile(base: MovementConfig, profile: FeelProfile): MovementConfig {
  const clamped = clampFeelProfile(profile);
  const out = cloneMovementConfig(base);
  for (const field of FEEL_FIELDS) {
    const mod = clamped[field];
    if (mod === undefined) continue;
    out[field] = base[field] * (1 + mod);
  }
  return out;
}
