import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { AssetLibrary } from './AssetLibrary.js';
import { existsSync, readFileSync } from 'node:fs';

import { EMOTE_CLIPS } from '@kc/core';
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

/**
 * Emotes, and where they sit in the order of precedence.
 *
 * The rule is that an emote loses to everything that is not standing still. Being hit, leaving the
 * ground or moving are all things a player can see happening to their body, and a gesture that
 * played through them would read as the avatar ignoring the game. It is also the only way to stop
 * one early: there is no cancel button, and being stuck in a three-second nap while a kangaroo
 * closes in is the kind of thing a player never forgives.
 */
describe('clipFor with an emote playing', () => {
  const still = { grounded: true, speed: 0, hitTimer: 0 };

  it('plays the emote in place of idle', () => {
    expect(clipFor({ ...still, emoteId: 1 })).toBe('emote_wave');
    expect(clipFor({ ...still, emoteId: 6 })).toBe('emote_sleep');
  });

  it('still idles when nothing is playing', () => {
    expect(clipFor({ ...still, emoteId: 0 })).toBe('idle');
    expect(clipFor(still)).toBe('idle');
  });

  it('is cancelled by moving, jumping or being hit', () => {
    expect(clipFor({ ...still, emoteId: 2, speed: 1.5 })).toBe('walk');
    expect(clipFor({ ...still, emoteId: 2, speed: 6.5 })).toBe('run');
    expect(clipFor({ ...still, emoteId: 2, grounded: false })).toBe('jump');
    expect(clipFor({ ...still, emoteId: 2, hitTimer: 0.3 })).toBe('hit');
  });

  it('ignores an id no animation exists for', () => {
    // Snapshots come off the wire as a byte. An id nobody has must fall back to idle rather than
    // asking the mixer for a clip that is not there.
    expect(clipFor({ ...still, emoteId: 99 })).toBe('idle');
    expect(clipFor({ ...still, emoteId: -1 })).toBe('idle');
  });

  it('names every emote in the renderer’s clip list', () => {
    // `CLIP_NAMES` is what `Avatar` asks a loaded model for. An emote missing from it is an emote
    // the mixer never binds, so the button would work and nothing would move.
    for (const clip of EMOTE_CLIPS) expect(CLIP_NAMES).toContain(clip);
  });
});

/**
 * The clip names are a contract with the model generator, and nothing enforced it.
 *
 * `tools/blender/characters.py` bakes a fixed list of animations into every animal, and
 * `AssetLibrary.findClip` tolerates a missing one by leaving the avatar on the nearest clip it
 * has. That is the right behaviour at runtime and a silent failure here: a renderer asking for an
 * emote the generator stopped producing would show nothing, on a button, for a cosmetic somebody
 * unlocked — which is exactly the state the whole emote system was in.
 *
 * The generator is the source of truth and it is checked in; the .glb files are generated output
 * and are not (`.gitignore` excludes `packages/client/public/models/`), so the contract is tested
 * against the Python. The built files are then checked too when they are present, which they are
 * after `npm run assets:build`.
 */
describe('the clip contract with tools/blender/characters.py', () => {
  const generator = readFileSync(
    new URL('../../../../tools/blender/characters.py', import.meta.url).pathname,
    'utf8',
  );

  /** The clip names the generator writes, read out of its own CLIPS and EMOTES declarations. */
  function generatorClips(): string[] {
    const base = generator.match(/^CLIPS = \(([^)]*)\)/m);
    const emotes = generator.match(/^EMOTES = \(([^)]*)\)/m);
    expect(base, 'no CLIPS tuple in characters.py').not.toBeNull();
    expect(emotes, 'no EMOTES tuple in characters.py').not.toBeNull();
    const names = (text: string) => [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
    return [...names(base?.[1] ?? ''), ...names(emotes?.[1] ?? '').map((n) => `emote_${n}`)];
  }

  it('produces every clip the renderer asks for', () => {
    const produced = generatorClips();
    for (const wanted of CLIP_NAMES) {
      expect(produced, `characters.py does not bake ${wanted}`).toContain(wanted);
    }
  });

  it('produces nothing the renderer never asks for', () => {
    // The other direction, so a clip added to the generator and forgotten in the renderer shows up
    // as dead weight in every model rather than as nothing at all.
    for (const produced of generatorClips()) {
      expect(CLIP_NAMES as readonly string[], `${produced} is baked but never played`).toContain(produced);
    }
  });

  it('gives every emote a frame count', () => {
    // A clip with no entry in LENGTHS raises a KeyError during the build; better to catch it here.
    for (const clip of EMOTE_CLIPS) {
      expect(generator, `no LENGTHS entry covering ${clip}`).toMatch(
        new RegExp(`LENGTHS\\[\\s*"${clip}"|f"emote_\\{name\\}"`),
      );
    }
  });
});

/**
 * And the built models, when they have been built.
 *
 * Generated output is not committed, so this checks whatever is on disk rather than requiring it.
 * A directory holding some of the animals but not all of them is a failed or interrupted build and
 * is treated as an error — that is the state that would ship one animal unable to wave.
 */
describe('the built models', () => {
  const MODELS = ['kangaroo', 'human', 'wolf', 'fox', 'tiger', 'frog', 'penguin'];
  const dir = new URL('../../public/models/', import.meta.url).pathname;
  const present = MODELS.filter((name) => existsSync(`${dir}${name}.glb`));

  /** Pull the animation names straight out of the .glb's JSON chunk. */
  function clipsIn(file: string): string[] {
    const buffer = readFileSync(file);
    expect(buffer.subarray(0, 4).toString('ascii'), `${file} is not a glb`).toBe('glTF');
    let offset = 12;
    while (offset < buffer.length) {
      const length = buffer.readUInt32LE(offset);
      const type = buffer.readUInt32LE(offset + 4);
      if (type === 0x4e4f534a) {
        const json = JSON.parse(buffer.subarray(offset + 8, offset + 8 + length).toString('utf8'));
        return (json.animations ?? []).map((a: { name?: string }) => a.name ?? '');
      }
      offset += 8 + length + ((4 - (length % 4)) % 4);
    }
    return [];
  }

  it('is either a complete set or an empty one', () => {
    expect(present.length === 0 || present.length === MODELS.length, `only ${present.join(", ")} were built`).toBe(
      true,
    );
  });

  it.runIf(present.length === MODELS.length)('carry every clip the renderer asks for', () => {
    for (const name of present) {
      const clips = clipsIn(`${dir}${name}.glb`);
      for (const wanted of CLIP_NAMES) {
        expect(clips, `${name}.glb is missing ${wanted}`).toContain(wanted);
      }
    }
  });
});
