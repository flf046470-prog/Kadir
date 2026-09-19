import { BEATS_PER_BAR, composeBar, frequencyOf, secondsPerBeat } from './score.js';
import type { Mood, Note } from './score.js';

/**
 * Turns composed bars into sound.
 *
 * Deliberately thin: every decision about *what* to play is in `score.ts`, where it is arithmetic
 * over a seed and unit tested. This file only knows how to make a note audible, which is the part
 * that cannot be tested without a browser and therefore should hold as little judgement as
 * possible.
 *
 * Scheduled ahead rather than per frame. WebAudio runs on its own clock and a note queued with
 * `start(when)` lands exactly on time even if the render thread stalls — which on a Quest holding
 * 72 Hz with a room full of avatars, it will. Driving notes from `requestAnimationFrame` would put
 * the music's timing at the mercy of the frame rate, and a soundtrack that stutters when the scene
 * gets busy is worse than no soundtrack.
 */

/** How far ahead notes are queued. Long enough to ride out a stalled frame, short enough to switch mood quickly. */
const LOOKAHEAD_SECONDS = 1.2;
/** How often the scheduler wakes. Must be well under the lookahead or notes are queued late. */
const TICK_MS = 250;

export class MusicPlayer {
  private ctx: AudioContext;
  private bus: GainNode;
  /** Everything the music makes hangs off this, so one disconnect stops all of it. */
  private out: GainNode;
  private timer: ReturnType<typeof setInterval> | null = null;
  private mood: Mood = 'menu';
  /** Context time the next unscheduled bar begins at. */
  private nextBarAt = 0;
  private bar = 0;
  private running = false;

  constructor(ctx: AudioContext, bus: GainNode) {
    this.ctx = ctx;
    this.bus = bus;
    this.out = ctx.createGain();
    this.out.gain.value = 0.28;
    this.out.connect(this.bus);
  }

  get currentMood(): Mood {
    return this.mood;
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.nextBarAt = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.pump(), TICK_MS);
    this.pump();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Change what is playing.
   *
   * Takes effect at the next bar rather than immediately: cutting mid-bar leaves the pad's chord
   * hanging under a new root, which is the one thing in this system that sounds like a mistake
   * rather than a choice. A bar is under two seconds even at the menu's tempo.
   */
  setMood(mood: Mood): void {
    this.mood = mood;
  }

  /** Queue every bar that starts inside the lookahead window. */
  private pump(): void {
    if (!this.running) return;
    const horizon = this.ctx.currentTime + LOOKAHEAD_SECONDS;
    // Bounded, so a tab that was backgrounded for a minute does not try to catch up by scheduling
    // four hundred bars into a context whose clock ran on without it.
    for (let guard = 0; this.nextBarAt < horizon && guard < 8; guard++) {
      if (this.nextBarAt < this.ctx.currentTime) this.nextBarAt = this.ctx.currentTime + 0.05;
      const mood = this.mood;
      const beat = secondsPerBeat(mood);
      for (const note of composeBar(mood, this.bar)) {
        this.play(note, this.nextBarAt + note.beat * beat, note.length * beat);
      }
      this.nextBarAt += BEATS_PER_BAR * beat;
      this.bar++;
    }
  }

  private play(note: Note, at: number, seconds: number): void {
    const ctx = this.ctx;
    const gain = ctx.createGain();
    const frequency = frequencyOf(note.semitone);

    // One envelope shape per voice. The pad breathes in, the bass thumps, the lead plucks — which
    // is most of what makes three oscillators sound like three instruments.
    const attack = note.voice === 'pad' ? 0.35 : note.voice === 'bass' ? 0.01 : 0.008;
    const release = note.voice === 'pad' ? 0.9 : note.voice === 'bass' ? 0.18 : 0.25;
    const peak = Math.max(0.0002, note.velocity * (note.voice === 'pad' ? 0.35 : 1));

    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(attack + 0.05, seconds) + release);

    const voices: OscillatorNode[] = [];
    const make = (type: OscillatorType, detune: number): void => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = frequency;
      osc.detune.value = detune;
      voices.push(osc);
    };

    if (note.voice === 'pad') {
      // Two saws a few cents apart: the beating between them is the whole character of the pad,
      // and it costs one extra oscillator rather than a reverb.
      make('sawtooth', -6);
      make('sawtooth', 6);
    } else if (note.voice === 'bass') {
      make('triangle', 0);
    } else {
      make('square', 0);
    }

    // Rolled off hard. Square and saw at full bandwidth are fatiguing over a five-minute round,
    // and on a headset's speakers they are the first thing a player turns down.
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = note.voice === 'lead' ? 2600 : note.voice === 'pad' ? 1200 : 420;
    filter.Q.value = 0.7;

    for (const osc of voices) {
      osc.connect(filter);
      osc.start(at);
      osc.stop(at + Math.max(attack + 0.05, seconds) + release + 0.05);
    }
    filter.connect(gain).connect(this.out);
  }

  /** Free the graph. The scheduled notes stop themselves; this stops anything new reaching the bus. */
  dispose(): void {
    this.stop();
    this.out.disconnect();
  }
}
