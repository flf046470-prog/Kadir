import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { BUTTON_MASK, Buttons, createIntent, sanitizeIntent } from './intent.js';

const PACKAGES = fileURLToPath(new URL('../../../', import.meta.url));

/** Every `.ts` file under `packages/`, excluding builds and tests. */
function sources(): { path: string; text: string }[] {
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
  walk(PACKAGES);
  return out;
}

/**
 * A control that is advertised and read by nobody.
 *
 * `Buttons.Interact` shipped on three platforms — `KeyE`, gamepad button 2, and a `USE` button
 * sitting in the middle of the phone's thumb cluster — and was consumed by precisely nothing.
 * Holding it for nine hundred ticks in four different modes moved no position, no health, no
 * stamina, no gadget charge, and emitted not one event. It is the worst shape a bug can take,
 * because everything about it looks finished: the bit is defined, the platforms set it, the
 * tutorial lists it, and the player is the only one who ever finds out.
 *
 * Nothing in a unit test can see that, so this reads the source. A button has to be *produced*
 * somewhere and *read* somewhere else, and the two sets must not be the same file — otherwise the
 * code that sends the bit vouches for it itself, which is the exact circle that let this sit here.
 *
 * Producers are the input layer and the AI. The AI counts because it is a real producer and not a
 * courtesy: `Buttons.PunchLeft` is set by no platform at all — PC and mobile have one punch button
 * and it says right — and the bot's coin flip between the two fists is the only thing that ever
 * sends it. Writing this test against platforms alone said `PunchLeft` was dead, which was wrong,
 * and the true finding underneath was better: a left fist that only the AI could throw.
 */
describe('every button the game offers', () => {
  const files = sources();
  const named = Object.keys(Buttons).filter((name) => name !== 'None');
  const isProducer = (path: string): boolean => path.includes('/platform/') || path.includes('/ai/');
  const rel = (path: string): string => path.slice(PACKAGES.length);

  it('found the source tree to scan', () => {
    // A path that quietly resolves to nothing turns every assertion below green.
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.path.includes('/platform/pc/PCInput.ts'))).toBe(true);
    expect(files.some((f) => f.path.includes('/sim/simulation.ts'))).toBe(true);
    expect(files.some((f) => f.path.includes('/player/locomotion.ts'))).toBe(true);
  });

  it('is actually sent by something', () => {
    const producers = files.filter((f) => isProducer(f.path));
    for (const name of named) {
      const senders = producers.filter((f) => f.text.includes(`Buttons.${name}`));
      expect(senders.length, `nothing ever sets Buttons.${name}`).toBeGreaterThan(0);
    }
  });

  it('is read by something other than whatever sent it', () => {
    const readers = files.filter((f) => !isProducer(f.path) && !f.path.endsWith('/input/intent.ts'));
    for (const name of named) {
      const consumers = readers.filter((f) => f.text.includes(`Buttons.${name}`));
      expect(
        consumers.map((f) => rel(f.path)),
        `Buttons.${name} is advertised to players and read by nothing`,
      ).not.toHaveLength(0);
    }
  });
});

describe('sanitising an intent from the wire', () => {
  it('derives its mask from the button table rather than a literal', () => {
    // The old `0x1fff` came with a comment telling the next person to widen it by hand. A button
    // added without that edit would be stripped from every intent that crossed the wire and the
    // control would simply never fire — silently, and for everyone.
    for (const [name, bit] of Object.entries(Buttons)) {
      expect(BUTTON_MASK & bit, `${name} would be sanitised away`).toBe(bit);
    }
  });

  it('keeps every real button a client can press', () => {
    const intent = createIntent();
    intent.buttons = BUTTON_MASK;
    expect(sanitizeIntent(intent).buttons).toBe(BUTTON_MASK);
  });

  it('strips bits no button claims, including the hole Interact left', () => {
    // Bit 5 is vacant. `buttons` is relayed to every other player, so a modified client setting a
    // bit the game does not define must not have it carried anywhere.
    const intent = createIntent();
    intent.buttons = 0xffff;
    const kept = sanitizeIntent(intent).buttons;
    expect(kept & (1 << 5), 'the vacated Interact bit survived sanitisation').toBe(0);
    expect(kept).toBe(BUTTON_MASK);
  });

  it('survives a button mask that is not an integer', () => {
    const intent = createIntent();
    intent.buttons = Number.NaN;
    expect(sanitizeIntent(intent).buttons).toBe(0);
  });
});
