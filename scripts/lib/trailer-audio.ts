/**
 * The trailer's soundtrack, rendered offline: an outdoor bed under the real footage the trailer
 * opens on, a sweep and a hit where that footage turns into the game, and from there the game's
 * own score.
 *
 * Bundled by `pack-trailer.mjs` and run in the capture browser, because `OfflineAudioContext` is a
 * browser API. The score is scheduled with the same `scheduleBar` the game plays its music with, so
 * the trailer sounds like the game rather than like a second arrangement of it.
 *
 * Nothing recorded. The game's recorded effects and ambience beds are ElevenLabs generations, and
 * using them commercially depends on the plan the account was on (`assets/audio/provenance.json`);
 * the stock footage has no sound at all. A trailer is advertising, so it uses only sound this
 * repository makes itself, and the wind and the birds are synthesised here, from a fixed seed so
 * every render is the same.
 */

import { scheduleBar } from '../../packages/client/src/audio/Music.js';
import type { Mood } from '../../packages/client/src/audio/score.js';

export interface MoodSpan {
  mood: Mood;
  /** Seconds into the video this mood plays until. The bar that crosses it finishes first. */
  until: number;
}

export interface SoundtrackPlan {
  moods: MoodSpan[];
  /** Seconds into the video the score starts. */
  scoreFrom: number;
  /** The real footage: wind and birds until `until`, faded out over `fade` seconds after it. */
  outdoors?: { until: number; fade: number };
  /** The footage turning into the game: a rising sweep from `start`, a hit at `at`. */
  transform?: { start: number; at: number };
}

/** A small seeded generator (mulberry32): the same birds in the same places on every render. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Apply `(time, value)` points to a parameter as linear ramps, in time order. */
function automate(param: AudioParam, points: [number, number][]): void {
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  const [first] = sorted;
  if (!first) return;
  param.setValueAtTime(first[1], first[0]);
  for (const [time, value] of sorted.slice(1)) param.linearRampToValueAtTime(value, time);
}

function noiseBuffer(ctx: BaseAudioContext, seconds: number, rand: () => number, brown: boolean): AudioBuffer {
  const length = Math.max(1, Math.ceil(seconds * ctx.sampleRate));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = rand() * 2 - 1;
    // Brown noise is integrated white noise; leaky, so it cannot wander off to one side.
    last = brown ? (last + 0.02 * white) / 1.02 : white;
    data[i] = brown ? last * 3.5 : white;
  }
  return buffer;
}

/** A room of air for the birds: an impulse response of decaying noise, about a second long. */
function openAir(ctx: BaseAudioContext, rand: () => number): ConvolverNode {
  const seconds = 1.4;
  const length = Math.ceil(seconds * ctx.sampleRate);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (rand() * 2 - 1) * Math.exp((-4.5 * i) / length) * 0.35;
  const convolver = ctx.createConvolver();
  convolver.buffer = buffer;
  return convolver;
}

/**
 * Wind over open country: brown noise under a low-pass filter whose cutoff and level drift
 * together in gusts, so it breathes rather than hisses, and above it the dry grass rustling in
 * the same gusts. The body is cut below 140 Hz: wind recorded outdoors is mostly rumble down
 * there, which a phone or a laptop cannot play, and which would only spend the loudness the
 * final mix is normalised to.
 */
function wind(ctx: BaseAudioContext, out: AudioNode, rand: () => number, until: number, fade: number): void {
  const cutoff: [number, number][] = [[0, 420]];
  const body: [number, number][] = [[0, 0], [1.5, 0.5]];
  const rustle: [number, number][] = [[0, 0], [1.5, 0.05]];
  for (let t = 1.9; t < until; t += 0.9 + 1.3 * rand()) {
    const gust = rand();
    cutoff.push([t, 380 + 700 * gust]);
    body.push([t, 0.36 + 0.3 * gust]);
    rustle.push([t, 0.03 + 0.07 * gust * gust]);
  }
  body.push([until, 0.5], [until + fade, 0]);
  rustle.push([until, 0.05], [until + fade, 0]);

  const low = ctx.createBufferSource();
  low.buffer = noiseBuffer(ctx, until + fade, rand, true);
  // Two stages: brown noise falls at 6 dB an octave, and one 12 dB stage left it booming.
  const highPass = ctx.createBiquadFilter();
  highPass.type = 'highpass';
  highPass.frequency.value = 140;
  const highPass2 = ctx.createBiquadFilter();
  highPass2.type = 'highpass';
  highPass2.frequency.value = 140;
  const lowPass = ctx.createBiquadFilter();
  lowPass.type = 'lowpass';
  lowPass.Q.value = 0.6;
  automate(lowPass.frequency, cutoff);
  const bodyGain = ctx.createGain();
  automate(bodyGain.gain, body);
  low.connect(highPass).connect(highPass2).connect(lowPass).connect(bodyGain).connect(out);
  low.start(0);
  low.stop(until + fade);

  const high = ctx.createBufferSource();
  high.buffer = noiseBuffer(ctx, until + fade, rand, false);
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1700;
  band.Q.value = 0.7;
  const rustleGain = ctx.createGain();
  automate(rustleGain.gain, rustle);
  high.connect(band).connect(rustleGain).connect(out);
  high.start(0);
  high.stop(until + fade);
}

/** One note of birdsong: a sine gliding from `f0` to `f1`, shaped like a struck note. */
function chirp(ctx: BaseAudioContext, out: AudioNode, at: number, f0: number, f1: number, length: number, level: number, warble = 0): void {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(f0, at);
  osc.frequency.exponentialRampToValueAtTime(f1, at + length);
  if (warble > 0) {
    // The throaty roll of a magpie's carol: the pitch shaken thirty times a second.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 28;
    const depth = ctx.createGain();
    depth.gain.value = warble;
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(at);
    lfo.stop(at + length + 0.05);
  }
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(level, at + Math.min(0.012, length / 4));
  gain.gain.exponentialRampToValueAtTime(0.0004, at + length);
  osc.connect(gain).connect(out);
  osc.start(at);
  osc.stop(at + length + 0.05);
}

/**
 * Birds at first light, at a distance: a magpie-like carol of gliding, warbling notes now and then,
 * and the quick high calls of small birds between them. Nothing after `until`.
 */
function birds(ctx: BaseAudioContext, out: AudioNode, rand: () => number, until: number): void {
  const dry = ctx.createGain();
  dry.gain.value = 0.55;
  const air = openAir(ctx, rand);
  const wet = ctx.createGain();
  wet.gain.value = 0.5;
  // Far away: the top of the song is lost to distance.
  const distance = ctx.createBiquadFilter();
  distance.type = 'lowpass';
  distance.frequency.value = 6500;
  dry.connect(distance);
  wet.connect(air).connect(distance);
  distance.connect(out);
  const voice = ctx.createGain();
  voice.connect(dry);
  voice.connect(wet);

  // Carols: phrases of four to six notes stepping round a few pitches, each sliding into the next.
  for (let t = 0.6; t < until - 1; t += 2.2 + 1.6 * rand()) {
    const notes = 4 + Math.floor(rand() * 3);
    let pitch = 900 + 900 * rand();
    let at = t;
    for (let n = 0; n < notes && at < until - 0.3; n++) {
      const next = Math.min(2600, Math.max(700, pitch * (0.75 + 0.6 * rand())));
      const length = 0.09 + 0.12 * rand();
      chirp(ctx, voice, at, pitch, next, length, 0.1 + 0.06 * rand(), 30 + 50 * rand());
      pitch = next;
      at += length + 0.02 + 0.06 * rand();
    }
  }
  // Small birds: two to four quick falling calls, high up.
  for (let t = 1.3; t < until - 0.4; t += 0.9 + 1.4 * rand()) {
    const calls = 2 + Math.floor(rand() * 3);
    const top = 3800 + 1800 * rand();
    for (let n = 0; n < calls; n++) {
      const at = t + n * (0.08 + 0.05 * rand());
      chirp(ctx, voice, at, top, top * (0.62 + 0.12 * rand()), 0.035 + 0.03 * rand(), 0.05 + 0.04 * rand());
    }
  }
}

/** A curve that quantises a signal to a few levels: what "digital" sounds like, briefly. */
function crusher(ctx: BaseAudioContext, levels: number): WaveShaperNode {
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(4096);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.round(x * levels) / levels;
  }
  shaper.curve = curve;
  return shaper;
}

/**
 * The world turning into the game: a sweep that rises and coarsens into `at` — the middle of the
 * pixelation, where the picture is most broken up — then a low hit and a bright two-note chime as
 * the game appears.
 */
function transform(ctx: BaseAudioContext, out: AudioNode, rand: () => number, start: number, at: number): void {
  const length = at - start;
  const sweep = ctx.createGain();
  automate(sweep.gain, [[start, 0], [at - 0.02, 0.16], [at, 0]]);
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.setValueAtTime(300, start);
  tone.frequency.exponentialRampToValueAtTime(7000, at);
  for (const detune of [-9, 9]) {
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.detune.value = detune;
    saw.frequency.setValueAtTime(70, start);
    saw.frequency.exponentialRampToValueAtTime(620, at);
    saw.connect(tone);
    saw.start(start);
    saw.stop(at);
  }
  // Half of it through the crusher, so the sweep comes apart into steps as the picture does.
  const crushed = ctx.createGain();
  crushed.gain.value = 0.5;
  tone.connect(sweep);
  tone.connect(crusher(ctx, 6)).connect(crushed).connect(sweep);
  sweep.connect(out);

  const air = ctx.createBufferSource();
  air.buffer = noiseBuffer(ctx, length, rand, false);
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 1.4;
  band.frequency.setValueAtTime(500, start);
  band.frequency.exponentialRampToValueAtTime(5200, at);
  const whoosh = ctx.createGain();
  automate(whoosh.gain, [[start, 0], [at - 0.02, 0.24], [at, 0]]);
  air.connect(band).connect(whoosh).connect(out);
  air.start(start);
  air.stop(at);

  // The hit: a sub that drops in pitch, and a short burst of low noise on top of it.
  const sub = ctx.createOscillator();
  sub.frequency.setValueAtTime(82, at);
  sub.frequency.exponentialRampToValueAtTime(38, at + 0.6);
  const subGain = ctx.createGain();
  subGain.gain.setValueAtTime(0.5, at);
  subGain.gain.exponentialRampToValueAtTime(0.001, at + 1.3);
  sub.connect(subGain).connect(out);
  sub.start(at);
  sub.stop(at + 1.35);
  const thud = ctx.createBufferSource();
  thud.buffer = noiseBuffer(ctx, 0.3, rand, false);
  const thudTone = ctx.createBiquadFilter();
  thudTone.type = 'lowpass';
  thudTone.frequency.value = 900;
  const thudGain = ctx.createGain();
  thudGain.gain.setValueAtTime(0.28, at);
  thudGain.gain.exponentialRampToValueAtTime(0.001, at + 0.25);
  thud.connect(thudTone).connect(thudGain).connect(out);
  thud.start(at);
  thud.stop(at + 0.3);

  // The chime: E and the B above it, the root and fifth of the chase music that starts here
  // (`score.ts`: concert A less five semitones, minor pentatonic), so it lands in key.
  for (const [i, frequency] of [1318.5, 1975.5].entries()) {
    const ping = ctx.createOscillator();
    ping.type = 'triangle';
    ping.frequency.value = frequency;
    const gain = ctx.createGain();
    const when = at + 0.04 + i * 0.07;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(0.09, when + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0005, when + 0.6);
    ping.connect(gain).connect(out);
    ping.start(when);
    ping.stop(when + 0.65);
  }
}

async function renderSoundtrack(plan: SoundtrackPlan, seconds: number, sampleRate: number): Promise<string> {
  const ctx = new OfflineAudioContext(1, Math.ceil(seconds * sampleRate), sampleRate);
  const rand = seeded(20261115);

  if (plan.outdoors) {
    const outdoors = ctx.createGain();
    outdoors.gain.value = 0.45;
    outdoors.connect(ctx.destination);
    wind(ctx, outdoors, rand, plan.outdoors.until, plan.outdoors.fade);
    birds(ctx, outdoors, rand, plan.outdoors.until);
  }
  if (plan.transform) transform(ctx, ctx.destination, rand, plan.transform.start, plan.transform.at);

  const score = ctx.createGain();
  score.gain.value = 0.28;
  score.connect(ctx.destination);
  let at = Math.max(0.05, plan.scoreFrom);
  for (let bar = 0; at < seconds; bar++) {
    const mood = (plan.moods.find((span) => at < span.until) ?? plan.moods[plan.moods.length - 1])?.mood ?? 'match';
    at += scheduleBar(ctx, score, mood, bar, at);
  }

  const samples = (await ctx.startRendering()).getChannelData(0);
  // 16-bit PCM, base64: the cheapest way across the page boundary for a minute of audio.
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round((samples[i] ?? 0) * 32767)));
  const bytes = new Uint8Array(pcm.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

(globalThis as unknown as { __renderSoundtrack: typeof renderSoundtrack }).__renderSoundtrack = renderSoundtrack;
