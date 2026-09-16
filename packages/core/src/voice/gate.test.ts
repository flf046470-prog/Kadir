import { describe, expect, it } from 'vitest';

import { DEFAULT_MIC_THRESHOLD, MIC_HANGOVER, MIC_RELEASE_RATIO, MicGate } from './gate.js';

const DT = 1 / 60;

function input(over: Partial<Parameters<MicGate['update']>[1]> = {}) {
  return {
    mode: 'push' as const,
    talkHeld: false,
    level: 0,
    threshold: DEFAULT_MIC_THRESHOLD,
    muted: false,
    ...over,
  };
}

/** Run the gate for `seconds` with a fixed input and report the last answer. */
function hold(gate: MicGate, seconds: number, over: Partial<Parameters<MicGate['update']>[1]>): boolean {
  let out = false;
  for (let t = 0; t < seconds; t += DT) out = gate.update(DT, input(over));
  return out;
}

describe('push to talk', () => {
  it('says nothing until the button is held', () => {
    const gate = new MicGate();
    expect(hold(gate, 1, { mode: 'push', level: 0.9 })).toBe(false);
  });

  it('opens on the first frame the button is held', () => {
    // Not after a delay: a player who presses and immediately speaks must not lose the first word.
    const gate = new MicGate();
    expect(gate.update(DT, input({ mode: 'push', talkHeld: true }))).toBe(true);
  });

  it('shuts on the very frame the button is released', () => {
    /**
     * The whole promise of push-to-talk. Someone lets go *because* they are about to say
     * something they do not want the room to hear, so even a few frames of hangover here is the
     * feature failing at the only moment it matters.
     */
    const gate = new MicGate();
    hold(gate, 2, { mode: 'push', talkHeld: true, level: 0.9 });
    expect(gate.update(DT, input({ mode: 'push', talkHeld: false, level: 0.9 }))).toBe(false);
  });

  it('ignores how loud the room is', () => {
    const gate = new MicGate();
    expect(hold(gate, 1, { mode: 'push', talkHeld: false, level: 1 })).toBe(false);
    expect(hold(gate, 1, { mode: 'push', talkHeld: true, level: 0 })).toBe(true);
  });
});

describe('open mic', () => {
  it('stays shut through a quiet room', () => {
    // Breathing, a fan, a keyboard two rooms away. This is what the threshold is for.
    const gate = new MicGate();
    expect(hold(gate, 2, { mode: 'open', level: DEFAULT_MIC_THRESHOLD * 0.4 })).toBe(false);
  });

  it('opens when someone speaks', () => {
    const gate = new MicGate();
    expect(gate.update(DT, input({ mode: 'open', level: 0.5 }))).toBe(true);
  });

  it('holds through the pause between words', () => {
    /**
     * A gate that closes the moment loudness dips clips the tail of every sentence — the failure
     * everybody recognises from cheap voice chat. Checked at 0.2 s, which is an ordinary gap
     * between words.
     */
    const gate = new MicGate();
    gate.update(DT, input({ mode: 'open', level: 0.5 }));
    expect(hold(gate, 0.2, { mode: 'open', level: 0 })).toBe(true);
  });

  it('closes once the pause becomes a silence', () => {
    const gate = new MicGate();
    gate.update(DT, input({ mode: 'open', level: 0.5 }));
    expect(hold(gate, MIC_HANGOVER + 0.1, { mode: 'open', level: 0 })).toBe(false);
  });

  it('does not chatter while a voice hovers at the threshold', () => {
    /**
     * Speech does not sit neatly above a line; it crosses it several times a second. Without
     * hysteresis the gate follows every crossing, and a mic opening and shutting five times a
     * second sounds worse than either state. Driven with a level in the release band, which a
     * single-threshold gate would treat as silence.
     */
    const gate = new MicGate();
    gate.update(DT, input({ mode: 'open', level: 0.5 }));
    const band = DEFAULT_MIC_THRESHOLD * ((1 + MIC_RELEASE_RATIO) / 2);
    expect(band).toBeLessThan(DEFAULT_MIC_THRESHOLD);
    expect(hold(gate, 3, { mode: 'open', level: band })).toBe(true);
  });

  it('still closes for a voice that trails away rather than stopping', () => {
    /**
     * The hysteresis band holds the gate open but must not *refresh* the hangover, or a level
     * parked in the band would hold the microphone open forever. Ramping down through the band to
     * silence has to end shut.
     */
    const gate = new MicGate();
    gate.update(DT, input({ mode: 'open', level: 0.5 }));
    for (let i = 0; i < 60; i++) {
      gate.update(DT, input({ mode: 'open', level: DEFAULT_MIC_THRESHOLD * (0.95 - i * 0.01) }));
    }
    expect(hold(gate, MIC_HANGOVER + 0.1, { mode: 'open', level: 0 })).toBe(false);
  });

  it('does not let the hysteresis band top the hangover back up', () => {
    /**
     * Ramping down through the band and back to silence passes whether or not the band refreshes
     * the timer, because the hangover was full when the ramp started — the first version of the
     * test above proved nothing, and a mutant that refreshed the timer in the band survived it.
     *
     * The case that separates them is a hangover already part-spent: speak, go quiet for most of
     * it, then drift *up* into the band — background noise doing what background noise does. A
     * gate that refreshes there rides that noise indefinitely, one band-level frame at a time,
     * which is the open microphone this whole class exists to prevent.
     */
    const gate = new MicGate();
    gate.update(DT, input({ mode: 'open', level: 0.5 }));
    expect(hold(gate, MIC_HANGOVER * 0.8, { mode: 'open', level: 0 })).toBe(true);

    const band = DEFAULT_MIC_THRESHOLD * ((1 + MIC_RELEASE_RATIO) / 2);
    hold(gate, 2, { mode: 'open', level: band });
    // Only the fifth of the hangover that was left may remain, not a fresh one.
    expect(hold(gate, MIC_HANGOVER * 0.35, { mode: 'open', level: 0 })).toBe(false);
  });

  it('lets the Talk button override a threshold that is too high', () => {
    /**
     * The one complaint a voice gate reliably produces is "nobody can hear me", from someone
     * softly spoken or far from their mic. Holding Talk has to work in open mode too, or the fix
     * for that is buried in a settings slider.
     */
    const gate = new MicGate();
    expect(gate.update(DT, input({ mode: 'open', talkHeld: true, level: 0, threshold: 1 }))).toBe(true);
  });

  it('treats a threshold of zero as an ungated mic', () => {
    const gate = new MicGate();
    expect(gate.update(DT, input({ mode: 'open', level: 0, threshold: 0 }))).toBe(true);
  });

  it('survives a nonsense threshold without jamming open', () => {
    // Settings are merged from storage a player can edit.
    const gate = new MicGate();
    expect(gate.update(DT, input({ mode: 'open', level: 0.5, threshold: Number.NaN }))).toBe(true);
    expect(hold(gate, 2, { mode: 'open', level: 0.5, threshold: 2 })).toBe(false);
  });
});

describe('mute', () => {
  it('beats a held Talk button', () => {
    const gate = new MicGate();
    expect(hold(gate, 1, { mode: 'push', talkHeld: true, muted: true })).toBe(false);
  });

  it('beats a loud open mic', () => {
    const gate = new MicGate();
    expect(hold(gate, 1, { mode: 'open', level: 1, muted: true })).toBe(false);
  });

  it('cuts an already-open gate immediately, hangover and all', () => {
    const gate = new MicGate();
    hold(gate, 1, { mode: 'open', level: 0.6 });
    expect(gate.update(DT, input({ mode: 'open', level: 0.6, muted: true }))).toBe(false);
    expect(gate.remainingHangover).toBe(0);
  });

  it('lets speech back through the moment it is lifted', () => {
    const gate = new MicGate();
    hold(gate, 0.5, { mode: 'open', level: 0.6, muted: true });
    expect(gate.update(DT, input({ mode: 'open', level: 0.6 }))).toBe(true);
  });
});

describe('the gate reports what it is doing', () => {
  it('agrees with the value it returned', () => {
    // The HUD reads `isOpen`; a HUD that disagrees with the microphone is worse than no HUD.
    const gate = new MicGate();
    for (const over of [
      { mode: 'push' as const, talkHeld: true },
      { mode: 'push' as const, talkHeld: false },
      { mode: 'open' as const, level: 0.9 },
      { mode: 'open' as const, level: 0 },
      { mode: 'open' as const, level: 0, muted: true },
    ]) {
      const returned = gate.update(DT, input(over));
      expect(gate.isOpen, JSON.stringify(over)).toBe(returned);
    }
  });

  it('shuts on reset', () => {
    const gate = new MicGate();
    hold(gate, 1, { mode: 'open', level: 0.9 });
    gate.reset();
    expect(gate.isOpen).toBe(false);
    expect(gate.remainingHangover).toBe(0);
  });

  it('does not run its timer backwards on a negative dt', () => {
    // `dt` comes from a frame clock, and a clock that steps backwards should not extend a gate.
    const gate = new MicGate();
    gate.update(DT, input({ mode: 'open', level: 0.9 }));
    const before = gate.remainingHangover;
    gate.update(-1, input({ mode: 'open', level: 0 }));
    expect(gate.remainingHangover).toBeLessThanOrEqual(before);
  });
});

describe('switching mode mid-sentence', () => {
  it('cuts an open-mic hangover when push-to-talk takes over', () => {
    /**
     * Changing this setting is itself a privacy action — someone switching to push-to-talk wants
     * the microphone shut *now*, not in 0.45 s.
     */
    const gate = new MicGate();
    hold(gate, 1, { mode: 'open', level: 0.9 });
    expect(gate.update(DT, input({ mode: 'push', talkHeld: false, level: 0.9 }))).toBe(false);
  });

  it('does not hand the hangover back when open mic is switched on again', () => {
    /**
     * Shutting the gate for the push frame is not enough on its own: a mutant that left the
     * hangover running survived, because the push branch forces `open` false whatever the timer
     * says. The timer only shows itself on the way back — flick to push-to-talk and back in a
     * silent room and, if it was never cleared, the microphone reopens on a sentence you finished
     * a second ago.
     */
    const gate = new MicGate();
    hold(gate, 1, { mode: 'open', level: 0.9 });
    gate.update(DT, input({ mode: 'push', talkHeld: false }));
    expect(gate.update(DT, input({ mode: 'open', level: 0 }))).toBe(false);
  });
});
