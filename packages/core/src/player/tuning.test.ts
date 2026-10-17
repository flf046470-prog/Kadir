import { describe, expect, it } from 'vitest';

import { listAnimals } from '../content/animals.js';
import { createPlayerState } from './state.js';
import { DEFAULT_MOVEMENT, FEEL_BAND, FEEL_FIELDS, applyFeelProfile } from './config.js';
import {
  TUNABLES,
  applyTuning,
  clampTunable,
  formatTuningExport,
  quantise,
  sanitiseOverrides,
  tunableFor,
  tuningDiff,
} from './tuning.js';

const pushForce = tunableFor('pushForce');
if (!pushForce) throw new Error('pushForce must be tunable');

describe('tunable definitions', () => {
  it('names only real MovementConfig fields', () => {
    for (const tunable of TUNABLES) {
      expect(DEFAULT_MOVEMENT[tunable.field], `${tunable.field} is not in MovementConfig`).toBeTypeOf('number');
    }
  });

  it('brackets the shipped default inside every range', () => {
    // A default outside its own slider means the panel opens showing a value it cannot return
    // to, and the first drag silently changes the game.
    for (const tunable of TUNABLES) {
      const value = DEFAULT_MOVEMENT[tunable.field];
      expect(value, `${tunable.field} default ${value} < min ${tunable.min}`).toBeGreaterThanOrEqual(tunable.min);
      expect(value, `${tunable.field} default ${value} > max ${tunable.max}`).toBeLessThanOrEqual(tunable.max);
    }
  });

  it('gives every tunable a positive step that fits its range', () => {
    for (const tunable of TUNABLES) {
      expect(tunable.step, `${tunable.field} step`).toBeGreaterThan(0);
      expect(tunable.max - tunable.min, `${tunable.field} range`).toBeGreaterThan(tunable.step);
    }
  });

  it('explains what each one does, so a headset session needs no source dive', () => {
    for (const tunable of TUNABLES) {
      expect(tunable.label.length, tunable.field).toBeGreaterThan(0);
      expect(tunable.effect.length, tunable.field).toBeGreaterThan(20);
    }
  });

  it('lists no duplicates', () => {
    const fields = TUNABLES.map((t) => t.field);
    expect(new Set(fields).size).toBe(fields.length);
  });

  /**
   * Which sliders do anything without a headset.
   *
   * The obvious guess — that everything with "hand" in its name is VR-only — is wrong, and that
   * is why this is written down rather than left to a reader. PC and mobile players go through
   * the same hand-anchor machinery: the client places their hands procedurally and the grab
   * button sets the grip, so `pushForce`, `handGrabRadius`, `maxHandCorrection` and
   * `handTwoHandMultiplier` are all live on a keyboard.
   *
   * `handPushForce` is the single exception, because `applyPalmPush` skips any hand that is not
   * really tracked and a procedurally placed hand never is. A slider that cannot move anything
   * is worse than an absent one, so the panel hides it off a headset — and this pins the list it
   * hides by, so a future field that needs tracking has to declare itself.
   */
  it('marks exactly the field that needs real tracked hands', () => {
    const vrOnly = TUNABLES.filter((t) => 'vrOnly' in t && t.vrOnly).map((t) => t.field);
    expect(vrOnly).toEqual(['handPushForce']);
  });

  it('leaves the other hand-named fields available on every platform', () => {
    for (const field of ['pushForce', 'handGrabRadius', 'maxHandCorrection', 'handTwoHandMultiplier']) {
      const tunable = TUNABLES.find((t) => t.field === field);
      expect(tunable, `${field} should still be tunable`).toBeDefined();
      expect('vrOnly' in (tunable as object) && (tunable as { vrOnly?: boolean }).vrOnly, field).toBeFalsy();
    }
  });

  it('still offers a usable panel with no headset', () => {
    // Whatever gets marked VR-only later, a desktop session must not be left with a handful of
    // sliders — the panel is how the feel gets found in the first place.
    const flat = TUNABLES.filter((t) => !('vrOnly' in t && t.vrOnly));
    expect(flat.length).toBeGreaterThanOrEqual(TUNABLES.length - 2);
  });

  /**
   * `friction` and `airControl` are both tunable and inside the animal feel band, which is fine
   * and worth pinning down rather than assuming: the band is applied multiplicatively
   * (`base * (1 + mod)`), so retuning the baseline moves every animal together and the spread
   * between them stays ±FEEL_BAND of whatever the new baseline is.
   *
   * If the band ever became additive, tuning `friction` down would turn a ±3 % difference into
   * a large one and premium animals would stop being cosmetic. That is what this catches.
   */
  it('keeps the animal spread at ±FEEL_BAND of the tuned baseline, not the shipped one', () => {
    const tuned = applyTuning(DEFAULT_MOVEMENT, { friction: 4, airControl: 0.9, gravity: 12 });

    for (const animal of listAnimals()) {
      const withFeel = applyFeelProfile(tuned, animal.feel);
      for (const field of FEEL_FIELDS) {
        const ratio = withFeel[field] / tuned[field];
        expect(Math.abs(ratio - 1), `${animal.id}.${field} drifted from the tuned baseline`).toBeLessThanOrEqual(
          FEEL_BAND + 1e-9,
        );
      }
    }
  });
});

describe('clamping and quantising', () => {
  it('holds a value inside its range', () => {
    expect(clampTunable(pushForce, 99)).toBe(pushForce.max);
    expect(clampTunable(pushForce, -5)).toBe(pushForce.min);
  });

  it('falls back to the shipped default for a non-number', () => {
    expect(clampTunable(pushForce, Number.NaN)).toBe(DEFAULT_MOVEMENT.pushForce);
    expect(clampTunable(pushForce, Number.POSITIVE_INFINITY)).toBe(DEFAULT_MOVEMENT.pushForce);
  });

  it('snaps to the step without floating-point residue', () => {
    // 1.05 + 0.05 in binary is 1.1000000000000001; the panel must not display that.
    const value = quantise(pushForce, 1.05 + 0.05);
    expect(value).toBe(1.1);
    expect(String(value)).toBe('1.1');
  });
});

describe('sanitiseOverrides', () => {
  it('keeps known numeric fields and clamps them', () => {
    expect(sanitiseOverrides({ pushForce: 99 })).toEqual({ pushForce: pushForce.max });
  });

  it('drops unknown fields, non-numbers and junk input', () => {
    // This is the trust boundary for localStorage, including a hand-edited value.
    expect(sanitiseOverrides({ notAField: 1 })).toEqual({});
    expect(sanitiseOverrides({ pushForce: 'fast' })).toEqual({});
    expect(sanitiseOverrides({ radius: 50 })).toEqual({});
    expect(sanitiseOverrides(null)).toEqual({});
    expect(sanitiseOverrides('nonsense')).toEqual({});
  });
});

describe('applyTuning', () => {
  it('applies overrides without mutating the base', () => {
    const base = { ...DEFAULT_MOVEMENT };
    const tuned = applyTuning(base, { pushForce: 2 });
    expect(tuned.pushForce).toBe(2);
    expect(base.pushForce).toBe(DEFAULT_MOVEMENT.pushForce);
  });

  it('leaves untouched fields exactly as they were', () => {
    const tuned = applyTuning(DEFAULT_MOVEMENT, { pushForce: 2 });
    expect(tuned.gravity).toBe(DEFAULT_MOVEMENT.gravity);
    expect(tuned.radius).toBe(DEFAULT_MOVEMENT.radius);
  });

  it('clamps an out-of-range override rather than trusting it', () => {
    expect(applyTuning(DEFAULT_MOVEMENT, { gravity: 1000 }).gravity).toBe(tunableFor('gravity')?.max);
  });
});

describe('round trip', () => {
  it('diffs back to exactly what was applied', () => {
    const overrides = { pushForce: 1.4, gravity: 20 };
    expect(tuningDiff(applyTuning(DEFAULT_MOVEMENT, overrides))).toEqual(overrides);
  });

  it('reports no diff for an untouched config', () => {
    expect(tuningDiff(DEFAULT_MOVEMENT)).toEqual({});
  });

  it('exports pasteable source naming the file it belongs in', () => {
    const text = formatTuningExport({ pushForce: 1.4, gravity: 20 });
    expect(text).toContain('config.ts');
    expect(text).toContain('pushForce: 1.4,');
    expect(text).toContain('gravity:');
  });

  it('says so plainly when nothing changed', () => {
    expect(formatTuningExport({})).toContain('no changes');
  });
});

/**
 * Runtime tuning writes to `player.config`, which only stays safe because every player owns its
 * own copy. Before that clone existed, players created without an explicit config all aliased
 * the module-level DEFAULT_MOVEMENT, so one write would have rewritten the defaults for every
 * player in the process — on a server, across every room, until restart.
 */
describe('per-player config isolation', () => {
  it('gives each player its own config object', () => {
    const a = createPlayerState({ id: 'a' });
    const b = createPlayerState({ id: 'b' });
    expect(a.config).not.toBe(b.config);
    expect(a.config).not.toBe(DEFAULT_MOVEMENT);
  });

  it("does not let one player's tuning reach another, or the shipped defaults", () => {
    const baselineGravity = DEFAULT_MOVEMENT.gravity;
    const a = createPlayerState({ id: 'a' });
    const b = createPlayerState({ id: 'b' });

    a.config.gravity = 99;

    expect(b.config.gravity).toBe(baselineGravity);
    expect(DEFAULT_MOVEMENT.gravity).toBe(baselineGravity);
  });

  it("copies an explicitly supplied config rather than holding the caller's object", () => {
    const shared = applyTuning(DEFAULT_MOVEMENT, { gravity: 15 });
    const a = createPlayerState({ id: 'a', config: shared });
    const b = createPlayerState({ id: 'b', config: shared });

    a.config.gravity = 99;
    expect(b.config.gravity).toBe(15);
    expect(shared.gravity).toBe(15);
  });
});
