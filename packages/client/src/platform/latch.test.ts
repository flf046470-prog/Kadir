import { describe, expect, it } from 'vitest';

import { HoldOrToggle } from './latch.js';

/**
 * Hold-to-grab, or press-to-toggle.
 *
 * `controls.holdToGrab` shipped declared, documented, defaulted to true, merged from storage — and
 * read by nothing, so the setting that lets someone climb a ninety-metre route without holding a
 * mouse button the whole way did nothing at all. These pin the two failure modes that make a
 * toggle unusable rather than merely different.
 */
describe('a grab button', () => {
  it('follows the button exactly in hold mode', () => {
    const latch = new HoldOrToggle();
    expect(latch.update(true, true)).toBe(true);
    expect(latch.update(true, true)).toBe(true);
    expect(latch.update(false, true)).toBe(false);
  });

  it('latches on a press and releases on the next one', () => {
    const latch = new HoldOrToggle();
    expect(latch.update(true, false)).toBe(true);
    expect(latch.update(false, false)).toBe(true); // still held after the finger lifts
    expect(latch.update(true, false)).toBe(false);
    expect(latch.update(false, false)).toBe(false);
  });

  it('toggles once per press, not once per frame', () => {
    /**
     * The failure that makes the feature useless: reading the button's *level* rather than its
     * rising edge flips the latch sixty times a second, so a held button is a grab that strobes.
     * A thumb rests on a phone button for far longer than one sample.
     */
    const latch = new HoldOrToggle();
    latch.update(true, false);
    for (let i = 0; i < 30; i++) {
      expect(latch.update(true, false), `frame ${i} of one long press`).toBe(true);
    }
  });

  it('does not strand a grab on when the player switches back to hold', () => {
    // Changing the setting mid-session would otherwise leave the hand clamped shut with no button
    // press that can open it, because hold mode never looks at the latch.
    const latch = new HoldOrToggle();
    latch.update(true, false);
    expect(latch.update(false, false)).toBe(true);
    expect(latch.update(false, true)).toBe(false);
    // And switching back starts clean rather than resuming the old latch.
    expect(latch.update(false, false)).toBe(false);
  });

  it('drops the latch on reset', () => {
    const latch = new HoldOrToggle();
    latch.update(true, false);
    latch.reset();
    expect(latch.update(false, false)).toBe(false);
  });
});
