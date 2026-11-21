import { describe, expect, it } from 'vitest';

import { BEATS_PER_BAR, SCALE, composeBar, frequencyOf, moodSpec, secondsPerBeat } from './score.js';
import type { Mood, Note } from './score.js';

const MOODS: Mood[] = ['menu', 'match', 'chase', 'victory'];
const bars = (mood: Mood, count = 64): Note[][] => Array.from({ length: count }, (_, i) => composeBar(mood, i));

/**
 * The musical rules, checked without an `AudioContext`.
 *
 * The game shipped with no music at all: the `music` bus carried only the ambience beds, so the
 * Music slider controlled silence. Generated music can fail in ways that are obvious to a listener
 * and invisible to a type checker — a bar with nothing in it, a note that runs past the bar it was
 * scheduled in, a "chase" that is sparser than the menu — so the composition is arithmetic over a
 * seed and every one of those is an assertion here.
 */
describe('a composed bar', () => {
  it('is never empty', () => {
    // A single empty bar is a hole in the soundtrack, and at 132 bpm it goes by too fast to report
    // and too often to ignore.
    for (const mood of MOODS) {
      for (const [i, bar] of bars(mood).entries()) {
        expect(bar.length, `${mood} bar ${i}`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps every note inside the bar it belongs to', () => {
    // A note that overruns is a note the next bar's scheduler does not know about, which is how a
    // generated track ends up with a drone nobody can stop.
    for (const mood of MOODS) {
      for (const bar of bars(mood)) {
        for (const note of bar) {
          expect(note.beat).toBeGreaterThanOrEqual(0);
          expect(note.beat).toBeLessThan(BEATS_PER_BAR);
          expect(note.beat + note.length).toBeLessThanOrEqual(BEATS_PER_BAR + 1e-9);
          expect(note.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('stays in key', () => {
    /**
     * The whole reason for a pentatonic: every note has to be a scale degree of the bar's root, in
     * some octave. A generator that picks a semitone at random produces the interval that makes
     * procedural music sound broken, and it does it a few times a minute.
     */
    for (const mood of MOODS) {
      for (const bar of bars(mood)) {
        const roots = bar.filter((n) => n.voice === 'pad').map((n) => n.semitone);
        const root = Math.min(...roots);
        for (const note of bar) {
          const degree = ((((note.semitone - root) % 12) + 12) % 12) as number;
          expect(SCALE, `${note.voice} at beat ${note.beat} is off-key`).toContain(degree);
        }
      }
    }
  });

  it('never leaves a gap with nothing sounding', () => {
    // The pad is what makes this true: it covers the whole bar, so however sparse the lead gets
    // there is always something under it.
    for (const mood of MOODS) {
      for (const bar of bars(mood)) {
        const pad = bar.filter((n) => n.voice === 'pad');
        expect(pad.length, mood).toBeGreaterThan(0);
        for (const note of pad) expect(note.length).toBe(BEATS_PER_BAR);
      }
    }
  });

  it('gets busier as the game does', () => {
    /**
     * The point of having moods at all. Averaged over sixty-four bars rather than compared bar to
     * bar, because any single bar is allowed to be sparse — it is the density over a round that a
     * player feels.
     */
    const density = (mood: Mood): number => {
      const all = bars(mood);
      return all.reduce((sum, bar) => sum + bar.filter((n) => n.voice === 'lead').length, 0) / all.length;
    };
    expect(density('menu')).toBeLessThan(density('match'));
    expect(density('match')).toBeLessThan(density('chase'));
  });

  it('moves the root around rather than sitting on one chord', () => {
    // Four bars of the same root is where a generated track stops being music and becomes a drone.
    const roots = new Set(bars('match', 8).map((bar) => Math.min(...bar.filter((n) => n.voice === 'pad').map((n) => n.semitone))));
    expect(roots.size).toBeGreaterThan(1);
  });

  it('composes the same bar from the same index', () => {
    // A re-scheduled bar has to be the bar it was, or a stutter in the player becomes a stutter in
    // the music and the two are impossible to tell apart.
    for (const mood of MOODS) {
      expect(composeBar(mood, 17)).toEqual(composeBar(mood, 17));
    }
    expect(composeBar('chase', 3)).not.toEqual(composeBar('chase', 4));
  });

  it('keeps every velocity in range', () => {
    // Handed straight to a gain envelope; above one it clips, at or below zero it is silence with
    // the cost of a scheduled oscillator.
    for (const mood of MOODS) {
      for (const bar of bars(mood)) {
        for (const note of bar) {
          expect(note.velocity).toBeGreaterThan(0);
          expect(note.velocity).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('tempo and pitch', () => {
  it('runs a chase faster than a menu', () => {
    expect(moodSpec('chase').tempo).toBeGreaterThan(moodSpec('menu').tempo);
    expect(secondsPerBeat('chase')).toBeLessThan(secondsPerBeat('menu'));
  });

  it('puts concert A where it belongs and an octave where it belongs', () => {
    expect(frequencyOf(0)).toBeCloseTo(440, 6);
    expect(frequencyOf(12)).toBeCloseTo(880, 6);
    expect(frequencyOf(-12)).toBeCloseTo(220, 6);
  });

  it('never asks for a pitch outside what a speaker can render', () => {
    // The lead sits up to two octaves above a pad that is already transposed per mood; a mood added
    // with a high root could put it past anything audible.
    for (const mood of MOODS) {
      for (const bar of bars(mood)) {
        for (const note of bar) {
          const hz = frequencyOf(note.semitone);
          expect(hz, `${mood} ${note.voice}`).toBeGreaterThan(20);
          expect(hz, `${mood} ${note.voice}`).toBeLessThan(12000);
        }
      }
    }
  });
});
