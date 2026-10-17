import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FEEL_BAND, listAnimals, listGadgets, listLevels, listModes } from '@kc/core';
// @ts-expect-error — a plain .mjs module with no type declarations, like png.mjs.
import { claimsIn, copyLength, parseListing, pastedText, readNumber } from './copy.mjs';

/**
 * Store copy against the game it describes. See `copy.mjs` for why: Meta's long description had
 * grown 27 characters past the form's limit under a hand-written count that still said it fitted,
 * and claimed half the players per room the server allows.
 */

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (file: string): string => readFileSync(root + file, 'utf8');

/** Every store doc whose fenced blocks are pasted into a store's form. */
const LISTINGS = ['docs/META_LISTING.md', 'docs/PC_LISTINGS.md'];

interface Section {
  heading: string;
  text: string;
  length: number;
  stated: number | null;
  limit: number | null;
}

/** What the copy may claim, read from the code that decides it — never typed in a second time. */
function facts(): Record<string, number> {
  const config = read('packages/server/src/config.ts').match(/int\('KC_MAX_PLAYERS', (\d+)\)/);
  if (!config) throw new Error('KC_MAX_PLAYERS default not found in packages/server/src/config.ts');
  return {
    modes: listModes().length,
    animals: listAnimals().length,
    worlds: listLevels().length,
    gadgets: listGadgets().length,
    playersPerRoom: Number(config[1]),
    feelBandPercent: Math.round(FEEL_BAND * 100),
  };
}

describe('reading store copy', () => {
  it('pastes wrapped lines as one, keeps list items and paragraphs', () => {
    expect(pastedText('One line\nwrapped.\n\n- a\n  b\n- c\n\nEnd.')).toBe('One line wrapped.\n\n- a b\n- c\n\nEnd.');
  });

  it('counts code points, and a line break as two', () => {
    expect(copyLength('a — b')).toBe(5);
    expect(copyLength('a\n\nb')).toBe(6);
  });

  it('reads numbers as digits or words', () => {
    expect(readNumber('16')).toBe(16);
    expect(readNumber('Sixteen')).toBe(16);
    expect(readNumber('thirty-two')).toBe(32);
    expect(readNumber('forty')).toBe(40);
    expect(readNumber('many')).toBeNull();
  });

  it('finds every phrasing of a claim', () => {
    const claims = claimsIn('Ten modes, 16 playable animals, THREE WORLDS, up to thirty-two people, within 3% of it.');
    expect(claims.map((c: { claim: string; value: number }) => [c.claim, c.value])).toEqual([
      ['modes', 10],
      ['animals', 16],
      ['worlds', 3],
      ['playersPerRoom', 32],
      ['feelBandPercent', 3],
    ]);
  });

  it("takes a section's block and its count, never a later section's", () => {
    const sections = parseListing(
      '## Name\n\nNo block here.\n\n## Short\n\n12 of a maximum 50 characters.\n\n```\nHello there.\n```\n',
    ) as Section[];
    expect(sections.map((s) => s.heading)).toEqual(['Short']);
    expect(sections[0]).toMatchObject({ text: 'Hello there.', length: 12, stated: 12, limit: 50 });
  });
});

describe('every store listing', () => {
  const truth = facts();

  for (const file of LISTINGS) {
    const sections = parseListing(read(file)) as Section[];
    const limited = sections.filter((s) => s.limit !== null);

    it(`${file} has copy to check`, () => {
      // An instrument that finds nothing passes everything: prove there is something to measure.
      expect(limited.length).toBeGreaterThan(1);
      expect(sections.flatMap((s) => claimsIn(s.text)).length).toBeGreaterThan(2);
    });

    for (const section of limited) {
      it(`${file} — "${section.heading}" fits its limit and says how long it is`, () => {
        expect(section.length, 'over the store limit').toBeLessThanOrEqual(section.limit as number);
        expect(section.stated, 'the count written beside it').toBe(section.length);
        // Steam refuses links in its descriptions, and no store's form turns them into one.
        expect(section.text).not.toMatch(/https?:\/\/|www\./i);
      });
    }

    it(`${file} claims only what the game has`, () => {
      for (const section of sections) {
        for (const claim of claimsIn(section.text) as { claim: string; value: number; phrase: string }[]) {
          expect(claim.value, `"${claim.phrase}" in ${section.heading}`).toBe(truth[claim.claim]);
        }
      }
    });
  }
});
