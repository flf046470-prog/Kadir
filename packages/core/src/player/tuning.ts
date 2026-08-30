import { DEFAULT_MOVEMENT } from './config.js';
import type { MovementConfig } from './config.js';

/**
 * Live tuning of the movement feel.
 *
 * The constants in `DEFAULT_MOVEMENT` decide whether the game feels good, and no amount of
 * reasoning settles them — they are found by playing, in a headset, changing one number and
 * feeling the difference. Recompiling between each change makes that loop useless, so the
 * values are adjustable at runtime and this module is the shared definition of *which* values,
 * within *what* range, and how to get the result back out as code.
 *
 * Two boundaries this deliberately does not cross:
 *
 *  - It is not a difficulty or fairness knob. Tuning applies to every player in the session
 *    equally, and the client only allows it in solo practice, where there is no one else. The
 *    server owns the config in a real match, so a tuned client cannot out-jump anyone.
 *  - It is not per-animal. Animal variation is `FEEL_FIELDS` with a ±3 % band, and that stays
 *    the only thing that differs between animals.
 */

export interface Tunable {
  field: TunableField;
  label: string;
  /** What changing it actually does, in the player's terms — shown next to the slider. */
  effect: string;
  min: number;
  max: number;
  step: number;
}

/**
 * The fields worth reaching for while wearing a headset.
 *
 * Ordered by how much they change the arms-first feel, because the panel shows them in this
 * order and the first two are the ones you reach for first. `MovementConfig` has more fields
 * than these; the rest are body dimensions and PC/mobile-only behaviour, which are not what a
 * VR tuning session is about.
 */
export const TUNABLES = [
  {
    field: 'pushForce',
    label: 'Hand push',
    effect: 'How much of your arm movement becomes body speed. The single biggest lever on feel.',
    min: 0.2,
    max: 3,
    step: 0.05,
  },
  {
    field: 'handPushForce',
    label: 'Palm shove',
    effect: 'Pushing off a surface with an open hand, without gripping it.',
    min: 0.2,
    max: 3,
    step: 0.05,
  },
  {
    field: 'friction',
    label: 'Ground friction',
    effect: 'How fast you lose speed on the ground. Lower keeps momentum through a landing.',
    min: 2,
    max: 30,
    step: 0.5,
  },
  {
    field: 'airControl',
    label: 'Air control',
    effect: 'How much you can steer while airborne. Higher is forgiving, lower rewards commitment.',
    min: 0,
    max: 1,
    step: 0.02,
  },
  {
    field: 'gravity',
    label: 'Gravity',
    effect: 'Fall speed. Raising it shortens every arc and makes the game feel heavier.',
    min: 8,
    max: 40,
    step: 0.5,
  },
  {
    field: 'handGrabRadius',
    label: 'Grab radius',
    effect: 'How near a surface your hand must be to catch it. Too small feels broken, too large feels sticky.',
    min: 0.1,
    max: 0.6,
    step: 0.01,
  },
  {
    field: 'maxHandCorrection',
    label: 'Pull limit',
    effect: 'The furthest one tick of hand-pulling may move you. The anti-teleport clamp.',
    min: 0.1,
    max: 1.5,
    step: 0.05,
  },
  {
    field: 'handTwoHandMultiplier',
    label: 'Two-hand bonus',
    effect: 'Extra strength when both hands are anchored.',
    min: 1,
    max: 2.2,
    step: 0.05,
  },
  {
    field: 'maxHorizontalSpeed',
    label: 'Speed ceiling',
    effect: 'The fastest you may travel. This is the skill ceiling — how fast an expert can fly.',
    min: 8,
    max: 45,
    step: 1,
  },
  {
    field: 'wallPush',
    label: 'Wall shove',
    effect: 'Impulse from shoving off a wall.',
    min: 1,
    max: 16,
    step: 0.5,
  },
  {
    field: 'climbLaunchForce',
    label: 'Climb launch',
    effect: 'Impulse when you let go of a grip and launch.',
    min: 1,
    max: 16,
    step: 0.5,
  },
  {
    field: 'surfaceFriction',
    label: 'Surface friction scale',
    effect: 'Global multiplier on every surface. Lower makes the whole world slipperier.',
    min: 0.2,
    max: 2,
    step: 0.05,
  },
] as const satisfies readonly {
  field: keyof MovementConfig;
  label: string;
  effect: string;
  min: number;
  max: number;
  step: number;
}[];

export type TunableField = (typeof TUNABLES)[number]['field'];

/** Sparse overrides: only the fields that were actually moved. */
export type TuningOverrides = Partial<Record<TunableField, number>>;

const BY_FIELD = new Map<string, Tunable>(TUNABLES.map((t) => [t.field, t as Tunable]));

export function tunableFor(field: string): Tunable | undefined {
  return BY_FIELD.get(field);
}

/** Round to the tunable's step so the panel never shows 1.0500000000000003. */
export function quantise(tunable: Tunable, value: number): number {
  const steps = Math.round(value / tunable.step);
  const snapped = steps * tunable.step;
  // Steps like 0.05 are not exact in binary; trim the residue rather than let it accumulate.
  return Number(snapped.toFixed(6));
}

export function clampTunable(tunable: Tunable, value: number): number {
  if (!Number.isFinite(value)) return quantise(tunable, DEFAULT_MOVEMENT[tunable.field]);
  return quantise(tunable, Math.min(tunable.max, Math.max(tunable.min, value)));
}

/**
 * Drop anything that is not a known field or a usable number.
 *
 * Overrides are persisted in browser storage, so this is also the trust boundary for whatever
 * is sitting in localStorage — including a value edited by hand.
 */
export function sanitiseOverrides(raw: unknown): TuningOverrides {
  const out: TuningOverrides = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const tunable = BY_FIELD.get(key);
    if (!tunable || typeof value !== 'number') continue;
    out[tunable.field] = clampTunable(tunable, value);
  }
  return out;
}

/** A config with the overrides applied. The base is never mutated. */
export function applyTuning(base: MovementConfig, overrides: TuningOverrides): MovementConfig {
  const out: MovementConfig = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    const tunable = BY_FIELD.get(key);
    if (!tunable || typeof value !== 'number') continue;
    out[tunable.field] = clampTunable(tunable, value);
  }
  return out;
}

/** Only the fields that differ from the baseline — what is worth saving or pasting. */
export function tuningDiff(config: MovementConfig, base: MovementConfig = DEFAULT_MOVEMENT): TuningOverrides {
  const out: TuningOverrides = {};
  for (const tunable of TUNABLES) {
    const value = config[tunable.field];
    if (value !== base[tunable.field]) out[tunable.field] = value;
  }
  return out;
}

/**
 * The tuned values as source you can paste into `DEFAULT_MOVEMENT`.
 *
 * This is the point of the whole exercise: a tuning session ends with numbers that have to
 * survive into the build, and reading them off a headset display one at a time is how they get
 * transcribed wrong.
 */
export function formatTuningExport(overrides: TuningOverrides): string {
  const entries = TUNABLES.filter((t) => overrides[t.field] !== undefined);
  if (entries.length === 0) return '// no changes from DEFAULT_MOVEMENT';
  const width = Math.max(...entries.map((t) => t.field.length));
  const lines = entries.map((t) => `  ${`${t.field}:`.padEnd(width + 1)} ${String(overrides[t.field])},`);
  return `// paste into DEFAULT_MOVEMENT in packages/core/src/player/config.ts\n${lines.join('\n')}`;
}
