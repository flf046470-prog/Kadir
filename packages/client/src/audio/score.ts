/**
 * The music, as data.
 *
 * The game had none. The `music` bus carried the per-zone ambience beds — filtered noise, which is
 * what a *room* sounds like — and nothing else, so a player could turn the Music slider all the way
 * up and hear no music at all.
 *
 * Composed rather than streamed, for the reasons everything else in this audio system is: a Quest
 * build has no budget to download or decode a soundtrack, and a recorded track would need a licence
 * entry in `assets/packs.json`. A generated one also cannot loop audibly, which a two-minute track
 * under a five-minute round always does.
 *
 * Split from the player on purpose. Everything here is arithmetic over a seed — no `AudioContext`,
 * no timers — so the musical rules are unit tested, while `Music.ts` only has to turn a list of
 * notes into oscillators. The rules are the part that can be wrong in a way nobody notices until a
 * player hears it.
 */

export type Mood = 'menu' | 'match' | 'chase' | 'victory';

export type Voice = 'bass' | 'pad' | 'lead';

export interface Note {
  /** Beats from the start of the bar. Always inside `[0, BEATS_PER_BAR)`. */
  beat: number;
  /** Semitones from the mood's root. */
  semitone: number;
  /** Beats the note is held for; never runs past the end of the bar. */
  length: number;
  /** 0..1, handed straight to the envelope. */
  velocity: number;
  voice: Voice;
}

export const BEATS_PER_BAR = 4;

/**
 * Minor pentatonic.
 *
 * Every pair of degrees in it is consonant, so a generator can pick at random and never produce
 * the interval that makes procedural music sound broken. The cost is that it cannot express much;
 * the progression underneath is what stops four minutes of it becoming wallpaper.
 */
export const SCALE = [0, 3, 5, 7, 10] as const;

/** Four-bar root movement, i - VI - III - VII. Minor, and it resolves without ever settling. */
const PROGRESSION = [0, -4, -9, -2] as const;

interface MoodSpec {
  /** Beats per minute. */
  tempo: number;
  /** Semitones from concert A, for the whole mood. */
  root: number;
  /** How many lead notes a bar may carry. */
  leadNotes: [min: number, max: number];
  /** Bass on every beat of this spacing. */
  bassEvery: number;
  padGain: number;
  leadGain: number;
}

const MOODS: Record<Mood, MoodSpec> = {
  // Wide and slow: the player is reading, not running.
  menu: { tempo: 76, root: -12, leadNotes: [1, 2], bassEvery: 4, padGain: 0.5, leadGain: 0.35 },
  match: { tempo: 100, root: -7, leadNotes: [2, 4], bassEvery: 2, padGain: 0.42, leadGain: 0.45 },
  // The one that has to carry a chase: quick, and the bass lands on every beat.
  chase: { tempo: 132, root: -5, leadNotes: [4, 7], bassEvery: 1, padGain: 0.3, leadGain: 0.6 },
  victory: { tempo: 96, root: 0, leadNotes: [3, 5], bassEvery: 2, padGain: 0.55, leadGain: 0.55 },
};

export function moodSpec(mood: Mood): MoodSpec {
  return MOODS[mood];
}

export function secondsPerBeat(mood: Mood): number {
  return 60 / MOODS[mood].tempo;
}

/**
 * Deterministic from `(mood, bar)`.
 *
 * A seeded generator rather than a stored sequence: the same bar index always composes the same
 * bar, so a stutter that re-schedules a bar cannot produce a different one, and a bug in the
 * player can never be mistaken for a bug in the music.
 */
function hash(a: number, b: number): () => number {
  let state = (Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca6b)) >>> 0;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

/** The notes of one bar, in the order they are played. */
export function composeBar(mood: Mood, bar: number): Note[] {
  const spec = MOODS[mood];
  const rand = hash(bar, mood.length * 31 + spec.tempo);
  const root = spec.root + (PROGRESSION[Math.abs(bar) % PROGRESSION.length] as number);
  const notes: Note[] = [];

  // Pad: one sustained chord under the whole bar, so there is never a silent moment between notes.
  for (const degree of [0, 2]) {
    notes.push({
      beat: 0,
      semitone: root + (SCALE[degree] as number),
      length: BEATS_PER_BAR,
      velocity: spec.padGain,
      voice: 'pad',
    });
  }

  // Bass: the pulse. On a chase this is every beat, which is most of why it reads as urgent.
  for (let beat = 0; beat < BEATS_PER_BAR; beat += spec.bassEvery) {
    notes.push({
      beat,
      semitone: root - 12,
      length: Math.min(spec.bassEvery, BEATS_PER_BAR - beat),
      velocity: beat === 0 ? 0.9 : 0.6,
      voice: 'bass',
    });
  }

  // Lead: the part that differs bar to bar. Placed on eighths so it stays on the grid.
  const [min, max] = spec.leadNotes;
  const count = min + Math.floor(rand() * (max - min + 1));
  const slots = BEATS_PER_BAR * 2;
  const used = new Set<number>();
  for (let i = 0; i < count; i++) {
    let slot = Math.floor(rand() * slots);
    for (let tries = 0; used.has(slot) && tries < slots; tries++) slot = (slot + 1) % slots;
    if (used.has(slot)) break;
    used.add(slot);
    const beat = slot / 2;
    // An octave above the pad, occasionally two — the only place the line gets any range.
    const octave = rand() < 0.25 ? 24 : 12;
    notes.push({
      beat,
      semitone: root + (SCALE[Math.floor(rand() * SCALE.length)] as number) + octave,
      length: Math.min(0.5, BEATS_PER_BAR - beat),
      velocity: spec.leadGain * (0.7 + rand() * 0.3),
      voice: 'lead',
    });
  }

  return notes.sort((a, b) => a.beat - b.beat);
}

/** Concert pitch for a semitone offset from A4. */
export function frequencyOf(semitone: number): number {
  return 440 * Math.pow(2, semitone / 12);
}
