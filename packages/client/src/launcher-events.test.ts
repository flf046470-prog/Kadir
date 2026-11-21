import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const LAUNCHER = `${ROOT}packaging/steam/main.cjs`;

/** Source with comments removed, so a comment naming an event cannot vouch for a listener. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Every `.ts` file under `packages/client/src`, excluding tests, comments stripped. */
function clientSource(): string {
  const parts: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) parts.push(stripComments(readFileSync(path, 'utf8')));
    }
  };
  walk(`${ROOT}packages/client/src`);
  return parts.join('\n');
}

/**
 * A menu item in the PC launcher that talks to the page does it by dispatching an event into it,
 * and an event nobody listens for is a menu item that does nothing — with no error anywhere,
 * because `executeJavaScript` succeeds either way. Help → Credits & licences was exactly that:
 * it dispatched `kc:credits`, nothing in the client listened, and the screen that names the
 * game's CC-BY authors could not be reached from the launcher's own Help menu.
 */
describe('events the PC launcher sends into the page', () => {
  const launcher = stripComments(readFileSync(LAUNCHER, 'utf8'));
  const sent = [...launcher.matchAll(/new (?:Custom)?Event\(\\?["']([^"'\\]+)\\?["']/g)].map((m) => m[1] as string);

  it('finds the events the launcher sends (or this guard is measuring nothing)', () => {
    expect(sent).toContain('kc:credits');
  });

  it('has a listener in the client for every one of them', () => {
    const client = clientSource();
    for (const name of sent) {
      expect(client.includes(`addEventListener('${name}'`) || client.includes(`addEventListener("${name}"`), `nothing listens for ${name}`).toBe(true);
    }
  });
});
