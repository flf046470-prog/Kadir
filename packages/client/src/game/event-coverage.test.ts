import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGES = fileURLToPath(new URL('../../../', import.meta.url));
const EVENTS_TS = `${PACKAGES}core/src/sim/events.ts`;

/**
 * Source with its comments removed.
 *
 * Without this the scan is defeated by prose: the doc comment explaining why a setting must be
 * read contains the setting's name, so deleting the code that reads it still passes. Measured —
 * removing the only read of `hapticStrength` left the guard green because the comment above it
 * said the word. A comment must never vouch for the code it describes.
 *
 * `//` is only treated as a line comment when it is not preceded by a colon, so a `https://` URL
 * inside a string does not swallow the rest of its line.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

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
        out.push({ path, text: stripComments(readFileSync(path, 'utf8')) });
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

/**
 * The `case 'x':` labels inside one named function, found by walking its braces.
 *
 * Anchored on the declaration rather than the name, because the name also appears at every call
 * site: a marker of `playHaptics(` matched `this.playHaptics(event, isLocal)` first and walked
 * the wrong block, which reported zero cases and looked exactly like a function with none.
 */
function casesIn(path: string, declaration: string): Set<string> {
  const text = stripComments(readFileSync(path, 'utf8'));
  const at = text.indexOf(declaration);
  if (at < 0) return new Set();
  let depth = 0;
  let end = text.length;
  for (let i = text.indexOf('{', at); i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) {
      end = i;
      break;
    }
  }
  return new Set([...text.slice(at, end).matchAll(/case '([a-zA-Z]+)'/g)].map((m) => m[1] as string));
}

/**
 * What a headset can receive.
 *
 * The HUD is DOM. An immersive WebXR session does not composite the page — no `dom-overlay`
 * feature is requested anywhere in this client, and on `immersive-vr` it would not be honoured
 * if it were — so every toast, badge and pill the HUD draws is invisible the moment a player
 * puts the headset on. Sound and haptics are the two channels that survive.
 *
 * Hence the rule: **if the HUD thought an event was worth telling the player about, a headset
 * player has to be told too.** Mechanical, with no hand-maintained list of "important" events to
 * rot — the HUD's own switch is the list.
 *
 * `roleChange` is what this was written for. It had a toast ("You are now KANGAROO"), no audio
 * case and no haptic case, and the local avatar's group — role ring included — is hidden in VR,
 * so in a headset *nothing* said what you were. Measured with six bots over 90 s on
 * `jungle-world`: 6 silent role changes at every round start in every mode, 24 of 24 silent in
 * Conversion Duel, 6 of 32 in Kangaroo Chase uncovered by even a same-tick `tag`.
 */
describe('an event the HUD announces', () => {
  const hudCases = casesIn(`${PACKAGES}client/src/ui/Hud.ts`, 'handleEvent(event: SimEvent, localId: string)');
  const audioCases = casesIn(`${PACKAGES}client/src/audio/AudioSystem.ts`, 'handleEvent(event: SimEvent, isLocalPlayer: boolean)');
  const hapticCases = casesIn(`${PACKAGES}client/src/game/GameClient.ts`, 'private playHaptics(event: SimEvent, isLocal: boolean)');

  it('found all three switches', () => {
    // Any of them resolving to an empty set turns the real assertion green. This has happened:
    // a marker that matched a call site rather than the declaration reported no cases at all.
    expect([...hudCases].length).toBeGreaterThan(3);
    expect([...audioCases].length).toBeGreaterThan(10);
    expect([...hapticCases].length).toBeGreaterThan(5);
  });

  it('also reaches a player who cannot see the HUD', () => {
    const domOnly = [...hudCases].filter((type) => !audioCases.has(type) && !hapticCases.has(type));
    expect(
      domOnly,
      `the HUD announces these and a headset gets nothing: ${domOnly.join(', ')}`,
    ).toEqual([]);
  });
});
