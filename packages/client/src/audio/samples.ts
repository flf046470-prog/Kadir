import type { SurfaceMaterial, ZoneDef } from '@kc/core';

/**
 * Recorded sound, where synthesis was the whole story.
 *
 * Every sound in the game used to be built from oscillators and one second of white noise: a
 * landing was a low-passed noise burst, every zone's bed was filtered noise with a wandering
 * band. Honest about what it was — a room tone — and nothing like a kangaroo hitting red dirt or
 * an afternoon in the bush. The files under `public/audio/` are generated with ElevenLabs'
 * sound-effects model (provenance in `assets/audio/provenance.json`) and replace the synthesis
 * where they exist. Where they do not — a file fails to load, a surface with no recording — the
 * synthesis still plays, so a missing file is a quieter game, never a silent one.
 */

export type SampleFamily = 'dirt' | 'leaves' | 'snow' | 'hard' | 'tag';
export type LoopName = 'outback' | 'jungle' | 'glacier' | 'gorge' | 'cave';

/** Variants per family: playing the same file on every hop is what makes a sound read as a loop. */
export const SAMPLE_FILES: Record<SampleFamily, readonly string[]> = {
  dirt: ['land-dirt-1', 'land-dirt-2'],
  leaves: ['land-leaves-1', 'land-leaves-2'],
  snow: ['land-snow-1', 'land-snow-2'],
  hard: ['land-hard-1', 'land-hard-2'],
  tag: ['tag-1'],
};

export const LOOP_FILES: Record<LoopName, string> = {
  outback: 'loop-outback',
  jungle: 'loop-jungle',
  glacier: 'loop-glacier',
  gorge: 'loop-gorge',
  cave: 'loop-cave',
};

/** Impact speed above which a landing plays the heavy recording rather than the surface's own. */
export const HARD_LANDING_SPEED = 12;

/**
 * Which recording a landing on this surface plays, or null to keep the synthesised one.
 *
 * Water and metal have no recording: a splash or a clang played as a dirt thud would be worse
 * than the synthesis, which at least knows what it is not.
 */
export function landingFamily(material: SurfaceMaterial | undefined, speed: number): SampleFamily | null {
  if (material === 'water' || material === 'metal') return null;
  if (speed >= HARD_LANDING_SPEED) return 'hard';
  switch (material) {
    case 'foliage':
      return 'leaves';
    case 'snow':
    case 'ice':
      return 'snow';
    default:
      return 'dirt';
  }
}

/**
 * The bed for a zone *on a given map*.
 *
 * A zone's `ambience` says what kind of space it is, not where it is: the outback's open flat is
 * declared `jungle` (open, airy) and the glacier's rink `canyon`. Keyed on the kind alone, the
 * outback would have played rainforest birds over red dirt. The level decides the place; the kind
 * decides the room.
 */
export function loopFor(levelId: string | null, kind: ZoneDef['ambience'] | null): LoopName | null {
  if (!kind || kind === 'lobby') return null;
  if (kind === 'cave') return 'cave';
  if (levelId === 'outback-station') return kind === 'canyon' || kind === 'waterfall' ? 'gorge' : 'outback';
  if (levelId === 'glacier-world') return 'glacier';
  // The jungle, and anything else: rainforest in the open, the creek in the canyon.
  return kind === 'canyon' || kind === 'waterfall' ? 'gorge' : 'jungle';
}

/** A decoded recording, trimmed and levelled. */
export interface Sample {
  buffer: AudioBuffer;
  /** Seconds of leading silence to skip, so a landing sounds on the frame it happens. */
  offset: number;
  /** Gain that brings this file to the family's common level. */
  gain: number;
}

/**
 * Measure a decoded buffer: where the sound starts, and how loud it is.
 *
 * Generated files arrive with up to 0.4 s of silence in front (measured, `land-dirt-1` starts at
 * 0.41 s) and at levels 25× apart (the gorge bed's RMS is 0.009, the jungle's 0.047). Both are
 * fixed here rather than by hand-editing files, so a regenerated file needs no second pass.
 */
export function measure(channels: Float32Array[], sampleRate: number, loop: boolean): { offset: number; gain: number } {
  let peak = 0;
  let sum = 0;
  let first = -1;
  const length = channels[0]?.length ?? 0;
  for (let i = 0; i < length; i++) {
    let a = 0;
    for (const ch of channels) a = Math.max(a, Math.abs(ch[i] as number));
    peak = Math.max(peak, a);
    sum += a * a;
    if (first < 0 && a > 0.03) first = i;
  }
  const rms = Math.sqrt(sum / Math.max(1, length));
  // A loop is levelled by its average, a one-shot by its peak: a bed has no transient to protect,
  // an impact is nothing but one.
  const gain = loop ? Math.min(8, 0.05 / Math.max(1e-4, rms)) : Math.min(8, 0.8 / Math.max(1e-4, peak));
  const offset = loop || first < 0 ? 0 : Math.max(0, first / sampleRate - 0.005);
  return { offset, gain };
}

export class SampleBank {
  private readonly samples = new Map<string, Sample>();
  private readonly pending = new Map<string, Promise<Sample | null>>();

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly base = '/audio/',
  ) {}

  get(name: string): Sample | null {
    return this.samples.get(name) ?? null;
  }

  /** Fetch and decode, once. A file that fails stays absent and the caller falls back. */
  load(name: string, loop = false): Promise<Sample | null> {
    const existing = this.pending.get(name);
    if (existing) return existing;
    const job = (async (): Promise<Sample | null> => {
      try {
        const response = await fetch(`${this.base}${name}.mp3`);
        if (!response.ok) return null;
        const buffer = await this.ctx.decodeAudioData(await response.arrayBuffer());
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
        const sample = { buffer, ...measure(channels, buffer.sampleRate, loop) };
        this.samples.set(name, sample);
        return sample;
      } catch {
        return null;
      }
    })();
    this.pending.set(name, job);
    return job;
  }
}
