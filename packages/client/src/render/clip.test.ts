import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { AssetLibrary } from './AssetLibrary.js';
import { CLIP_NAMES, clipFor } from './Avatar.js';

/**
 * Clip selection, tested as arithmetic.
 *
 * This is the part of the model path worth pinning: it decides what every player on screen looks
 * like they are doing, it is pure, and every way it can be wrong states in one sentence — "runs
 * while standing still", "never leaves the jump", "flinch overrides everything forever".
 */
describe('clipFor', () => {
  const still = { grounded: true, speed: 0, hitTimer: 0 };

  it('stands still when standing still', () => {
    expect(clipFor(still)).toBe('idle');
  });

  it('walks, then runs, as speed climbs', () => {
    expect(clipFor({ ...still, speed: 1.5 })).toBe('walk');
    expect(clipFor({ ...still, speed: 6.5 })).toBe('run');
  });

  it('ignores the twitch of a player who is meant to be standing still', () => {
    // Interpolated snapshots never settle to exactly zero, so a threshold of 0 would leave every
    // idle player shuffling on the spot.
    expect(clipFor({ ...still, speed: 0.3 })).toBe('idle');
  });

  it('jumps whenever airborne, at any speed', () => {
    expect(clipFor({ grounded: false, speed: 0, hitTimer: 0 })).toBe('jump');
    expect(clipFor({ grounded: false, speed: 9, hitTimer: 0 })).toBe('jump');
  });

  it('lets the hit reaction win, but only while it lasts', () => {
    expect(clipFor({ grounded: false, speed: 9, hitTimer: 0.2 })).toBe('hit');
    expect(clipFor({ grounded: false, speed: 9, hitTimer: 0 })).toBe('jump');
  });

  it('only ever names a clip the generator writes', () => {
    const cases = [
      still,
      { grounded: true, speed: 99, hitTimer: 0 },
      { grounded: false, speed: -1, hitTimer: 0 },
      { grounded: true, speed: NaN, hitTimer: 0 },
      { grounded: false, speed: 3, hitTimer: 5 },
    ];
    for (const c of cases) expect(CLIP_NAMES).toContain(clipFor(c));
  });
});

/**
 * Clip lookup across exporters.
 *
 * Blender writes the action name; other tools prefix the armature or object (`rig|Walk`). A pack
 * that has to be re-authored before it can be used is a pack nobody uses.
 */
describe('AssetLibrary.findClip', () => {
  const clip = (name: string) => new THREE.AnimationClip(name, 1, []);

  it('matches exactly, ignoring case', () => {
    const clips = [clip('Walk'), clip('idle')];
    expect(AssetLibrary.findClip(clips, 'walk')?.name).toBe('Walk');
    expect(AssetLibrary.findClip(clips, 'idle')?.name).toBe('idle');
  });

  it('sees past an exporter prefix', () => {
    const clips = [clip('Armature|Run'), clip('rig:Idle'), clip('Body/Jump')];
    expect(AssetLibrary.findClip(clips, 'run')?.name).toBe('Armature|Run');
    expect(AssetLibrary.findClip(clips, 'idle')?.name).toBe('rig:Idle');
    expect(AssetLibrary.findClip(clips, 'jump')?.name).toBe('Body/Jump');
  });

  it('prefers an exact tail over a partial match', () => {
    // "run" appears inside "running_start", but a clip actually called Run is the better answer.
    const clips = [clip('running_start'), clip('Run')];
    expect(AssetLibrary.findClip(clips, 'run')?.name).toBe('Run');
  });

  it('returns null rather than the wrong clip', () => {
    expect(AssetLibrary.findClip([clip('Walk')], 'swim')).toBeNull();
    expect(AssetLibrary.findClip([], 'walk')).toBeNull();
  });
});
