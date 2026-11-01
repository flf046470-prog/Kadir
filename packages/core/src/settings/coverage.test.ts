import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from './index.js';

const PACKAGES = fileURLToPath(new URL('../../../', import.meta.url));
const DECLARATION = 'core/src/settings/index.ts';

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

function sources(): { path: string; text: string }[] {
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
  walk(PACKAGES);
  return out;
}

/** Every leaf field in `Settings`, as `section.field` or a bare top-level name. */
function fields(): string[] {
  const names: string[] = [];
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const leaf of Object.keys(value)) names.push(leaf);
    } else {
      names.push(key);
    }
  }
  return names;
}

/**
 * A setting that changes nothing.
 *
 * Five shipped this way: `spatialVoice`, `holdToGrab`, `hapticStrength`, `colorblindSafe` and
 * `locale` were each declared, given a default, merged from storage and clamped — every ceremony
 * a working setting performs — and then read by nothing at all. Two of them were the accessibility
 * controls: the haptic strength a player reaches for when a headset's rumble is too much, and the
 * switch for the one channel that tells you who is chasing you.
 *
 * It is the same shape as `Buttons.Interact` and the five dropped sim events, and it is invisible
 * the same way: the declaration looks complete, so nothing in review or in a type checker objects.
 * Only counting consumers finds it.
 */
describe('every setting the game offers', () => {
  const files = sources();
  const names = fields();

  it('found the source tree and the settings to check', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(names).toContain('shadows');
    expect(names).toContain('crossPlay');
    expect(files.some((f) => f.path.endsWith('/render/Renderer.ts'))).toBe(true);
  });

  it('is read by something other than the file that declares it', () => {
    const readers = files.filter((f) => !f.path.endsWith(DECLARATION));
    const dead: string[] = [];
    for (const name of names) {
      // `.field` rather than the bare name: a setting is always reached through its object, and a
      // bare match would let an unrelated local variable of the same name vouch for it.
      if (!readers.some((f) => f.text.includes(`.${name}`))) dead.push(name);
    }
    expect(dead, `declared, defaulted, persisted — and read by nothing: ${dead.join(', ')}`).toEqual([]);
  });
});
