import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGES = fileURLToPath(new URL('../../../', import.meta.url));
const EVENTS_TS = `${PACKAGES}core/src/sim/events.ts`;

/** The members of the `SimEventType` union, read out of the source that declares them. */
function eventTypes(): string[] {
  const text = readFileSync(EVENTS_TS, 'utf8');
  const start = text.indexOf('export type SimEventType');
  const end = text.indexOf(';', start);
  const body = text.slice(start, end);
  return [...body.matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1] as string);
}

/** Every `.ts` file under `packages/client/src`, excluding tests. */
function clientSources(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        walk(path);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        out.push({ path, text: readFileSync(path, 'utf8') });
      }
    }
  };
  walk(`${PACKAGES}client/src`);
  return out;
}

/**
 * An event the simulation emits and the client throws away.
 *
 * `AudioSystem.handleEvent` and `playHaptics` are both a `switch` ending in `default: break`, so an
 * event nobody wrote a case for is silently discarded — the code looks complete and the player
 * gets nothing. Five were being dropped at once, and together they were the entire gadget layer:
 * firing a freeze gun made no sound, being hit by one made no sound, and being **frozen in place
 * for three seconds** produced no cue at all, which does not read as a game mechanic so much as
 * the game having stopped responding. `roundState` took Conversion Duel's bell with it — the whole
 * premise of the mode is that a catch starts a fistfight, and the fight started in silence.
 *
 * Found by counting consumers per event type rather than by playing, because a missing sound is
 * invisible in a code review and inaudible in a headless test.
 */
describe('every event the simulation emits', () => {
  const types = eventTypes();
  const files = clientSources();

  it('found both sides to compare', () => {
    // Either half resolving to nothing turns the real assertion green.
    expect(types).toContain('jump');
    expect(types).toContain('gadgetUse');
    expect(types.length).toBeGreaterThan(15);
    expect(files.some((f) => f.path.endsWith('/audio/AudioSystem.ts'))).toBe(true);
    expect(files.some((f) => f.path.endsWith('/game/GameClient.ts'))).toBe(true);
  });

  it('reaches the player as sound, feel, or something on screen', () => {
    /**
     * Deliberately "somewhere, in some channel". Which events deserve a sound, a pulse, both or
     * neither is a judgement — `chat` wants no haptic and `gadgetExpire` no pulse — so a rule
     * demanding both would be wrong far more often than it was right.
     *
     * The honest limit, measured by deleting things: dropping the `gadgetUse` *sound* while its
     * haptic case remains still passes here. What cannot pass is an event with no consumer at
     * all, which is the shape all five of these actually had.
     */
    const unhandled: string[] = [];
    for (const type of types) {
      // A `case 'x':` in a switch over `event.type`, or any other mention outside the test tree.
      const handled = files.some((f) => f.text.includes(`'${type}'`));
      if (!handled) unhandled.push(type);
    }
    expect(unhandled, `the client drops these on the floor: ${unhandled.join(', ')}`).toEqual([]);
  });
});
