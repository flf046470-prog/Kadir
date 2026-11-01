/**
 * The trailer's soundtrack: the game's own score, rendered offline.
 *
 * Bundled by `pack-trailer.mjs` and run in the capture browser, because `OfflineAudioContext` is a
 * browser API. It schedules bars with the same `scheduleBar` the game plays its music with, so
 * the trailer sounds like the game rather than like a second arrangement of it.
 *
 * Only the score. The game's recorded effects and ambience beds are ElevenLabs generations, and
 * using them commercially depends on the plan the account was on (`assets/audio/provenance.json`);
 * a trailer is advertising, so it uses only sound this repository composes itself.
 */

import { scheduleBar } from '../../packages/client/src/audio/Music.js';
import type { Mood } from '../../packages/client/src/audio/score.js';

export interface MoodSpan {
  mood: Mood;
  /** Seconds into the video this mood plays until. The bar that crosses it finishes first. */
  until: number;
}

async function renderScore(plan: MoodSpan[], seconds: number, sampleRate: number): Promise<string> {
  const ctx = new OfflineAudioContext(1, Math.ceil(seconds * sampleRate), sampleRate);
  const out = ctx.createGain();
  out.gain.value = 0.28;
  out.connect(ctx.destination);
  let at = 0.05;
  for (let bar = 0; at < seconds; bar++) {
    const mood = (plan.find((span) => at < span.until) ?? plan[plan.length - 1])?.mood ?? 'match';
    at += scheduleBar(ctx, out, mood, bar, at);
  }
  const samples = (await ctx.startRendering()).getChannelData(0);
  // 16-bit PCM, base64: the cheapest way across the page boundary for a few seconds of audio.
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round((samples[i] ?? 0) * 32767)));
  const bytes = new Uint8Array(pcm.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

(globalThis as unknown as { __renderScore: typeof renderScore }).__renderScore = renderScore;
