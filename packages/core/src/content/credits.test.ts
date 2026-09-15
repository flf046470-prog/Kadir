import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { ASSET_PACK_CREDITS, ENGINE_CREDITS, listCredits, mandatoryCredits, requiresAttribution } from './credits.js';
import type { LicenceId } from './credits.js';

interface PackFile {
  install: string;
  url?: string;
  from?: string;
  sha256?: string;
}

interface Pack {
  id: string;
  title: string;
  category: string;
  author: string;
  licence: LicenceId;
  sourceUrl?: string;
  source: 'url' | 'manual';
  files: PackFile[];
}

/**
 * Marketplaces whose EULAs permit shipping assets inside a product but not a product that lets
 * end users extract them. A web build serves every file over HTTP, so we cannot claim players
 * cannot extract them — which puts these sources out of bounds here regardless of price.
 * `scripts/fetch-assets.mjs` refuses them by host; this asserts none slipped in.
 */
const REFUSED_HOSTS = ['assetstore.unity.com', 'syntystore.com', 'fab.com', 'unrealengine.com'];

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../../assets/packs.json', import.meta.url)), 'utf8'),
) as { installDir: string; packs: Pack[] };

/**
 * Shipping a CC-BY asset without naming its author is a licence breach, not a cosmetic bug, and
 * it is exactly the kind of thing that silently rots when a pack is swapped. These assert the
 * manifest and the credits registry cannot drift apart.
 */
describe('asset licensing', () => {
  it('declares a licence and, where required, an author for every pack', () => {
    expect(manifest.packs.length).toBeGreaterThan(0);
    for (const pack of manifest.packs) {
      expect(pack.licence, `${pack.id} licence`).toBeTruthy();
      if (requiresAttribution(pack.licence)) {
        expect(pack.author?.trim(), `${pack.id} must name an author under ${pack.licence}`).toBeTruthy();
      }
    }
  });

  it('credits every attribution-requiring pack in the shipped credits screen', () => {
    const credited = listCredits();
    for (const pack of manifest.packs.filter((p) => requiresAttribution(p.licence))) {
      const match = credited.find((c) => c.author === pack.author);
      expect(match, `pack "${pack.id}" is ${pack.licence} but has no entry in credits.ts`).toBeDefined();
      expect(match?.licence).toBe(pack.licence);
    }
  });

  it('pins a sha256 for every file fetched over the network', () => {
    for (const pack of manifest.packs.filter((p) => p.source === 'url')) {
      for (const file of pack.files) {
        expect(file.url, `${pack.id}/${file.install}`).toBeTruthy();
        expect(file.sha256, `${pack.id}/${file.install} must pin the bytes we vetted`).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });

  it('sources no pack from a marketplace whose EULA forbids end-user extraction', () => {
    for (const pack of manifest.packs) {
      const host = pack.sourceUrl ? new URL(pack.sourceUrl).hostname : '';
      for (const refused of REFUSED_HOSTS) {
        expect(host.endsWith(refused), `${pack.id} sources from ${host}`).toBe(false);
      }
    }
  });

  it('categorises every pack, so the roster can be reasoned about', () => {
    const allowed = new Set(['character', 'environment', 'animation', 'audio', 'ui']);
    for (const pack of manifest.packs) {
      expect(allowed.has(pack.category), `${pack.id} category "${pack.category}"`).toBe(true);
    }
    // The roster should actually cover the game, not just be a pile of models.
    const present = new Set(manifest.packs.map((p) => p.category));
    for (const needed of ['character', 'environment', 'animation', 'audio']) {
      expect(present.has(needed), `no pack covers "${needed}"`).toBe(true);
    }
  });

  it('never installs outside the declared install directory', () => {
    for (const pack of manifest.packs) {
      for (const file of pack.files) {
        expect(file.install.startsWith('/'), `${pack.id}/${file.install}`).toBe(false);
        expect(file.install.includes('..'), `${pack.id}/${file.install}`).toBe(false);
      }
    }
  });
});

describe('credits registry', () => {
  it('lists the engine dependencies that ship in the bundle', () => {
    expect(ENGINE_CREDITS.some((c) => c.work === 'three.js')).toBe(true);
    expect(listCredits().some((c) => c.work === 'three.js')).toBe(true);
  });

  it('treats CC0 as attribution-free and everything else as requiring a name', () => {
    expect(requiresAttribution('CC0-1.0')).toBe(false);
    expect(requiresAttribution('CC-BY-4.0')).toBe(true);
    expect(requiresAttribution('MIT')).toBe(true);
  });

  it('reports the credits a licence obliges us to display', () => {
    const mandatory = mandatoryCredits();
    expect(mandatory.every((c) => c.author.trim().length > 0)).toBe(true);
    expect(mandatory.some((c) => c.licence === 'CC-BY-4.0')).toBe(true);
  });

  it('records that the Fox pack is a mixed CC0 / CC-BY work', () => {
    const fox = ASSET_PACK_CREDITS.find((c) => c.work.startsWith('Fox'));
    expect(fox?.licence).toBe('CC-BY-4.0');
    expect(fox?.note).toContain('CC0-1.0');
  });

  it('is sorted and free of duplicates so the screen is stable', () => {
    const works = listCredits().map((c) => `${c.work}|${c.author}`);
    expect(new Set(works).size).toBe(works.length);
    expect([...works].sort((a, b) => a.localeCompare(b))).toEqual(works);
  });
});
