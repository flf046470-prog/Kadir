import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32 } from 'node:zlib';

import { describe, expect, it } from 'vitest';

// @ts-expect-error — a plain .mjs helper, deliberately outside the TypeScript build.
import { BLOCK_SIZE, blockMapXml, blocksOf, buildMsix, contentTypesXml, readZip, zip } from './msix.mjs';

/**
 * The MSIX writer.
 *
 * This produces the one artifact that cannot be checked by running it: a Windows package, built
 * on Linux, uploaded to a Store that rejects the whole submission over a malformed byte. So the
 * tests check it against something other than itself — `unzip` for the archive, `node:zlib` for
 * the checksums, and a hand-computed SHA-256 for the block map — rather than reading it back with
 * the same code that wrote it.
 */

interface Entry {
  name: string;
  data: Buffer;
}

const manifest = (): Entry => ({ name: 'AppxManifest.xml', data: Buffer.from('<Package/>', 'utf8') });

function parse(xml: string): Record<string, string>[] {
  return [...xml.matchAll(/<(\w+)\s([^>]*?)\/?>/g)].map((m) => {
    const attrs: Record<string, string> = { _tag: m[1] };
    for (const a of m[2].matchAll(/(\w+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    return attrs;
  });
}

describe('block map', () => {
  it('hashes a file in 64KiB blocks', () => {
    const data = Buffer.alloc(BLOCK_SIZE * 2 + 17, 7);
    expect(blocksOf(data)).toHaveLength(3);
  });

  it('agrees with an independently computed SHA-256', () => {
    const data = Buffer.from('kangaroo');
    expect(blocksOf(data)).toEqual([createHash('sha256').update(data).digest('base64')]);
  });

  it('gives an empty file no blocks at all', () => {
    const xml = blockMapXml([{ name: 'empty.png', data: Buffer.alloc(0) }]);
    expect(xml).toContain('<File Name="empty.png" Size="0" LfhSize="39"></File>');
  });

  it('writes Windows path separators', () => {
    const xml = blockMapXml([{ name: 'images/StoreLogo.png', data: Buffer.from('x') }]);
    expect(xml).toContain('Name="images\\StoreLogo.png"');
  });

  it('records a local header size that matches the archive', () => {
    const files = [manifest(), { name: 'images/StoreLogo.png', data: Buffer.from('logo') }];
    const declared = new Map(parse(blockMapXml(files)).filter((e) => e._tag === 'File').map((e) => [e.Name, Number(e.LfhSize)]));

    const archive = zip(files);
    // Walk the local headers directly: the block map's LfhSize is a promise about these bytes.
    let offset = 0;
    for (const file of files) {
      const nameLength = archive.readUInt16LE(offset + 26);
      const extraLength = archive.readUInt16LE(offset + 28);
      expect(declared.get(file.name.replaceAll('/', '\\'))).toBe(30 + nameLength + extraLength);
      offset += 30 + nameLength + extraLength + file.data.length;
    }
  });

  it('leaves out the files it cannot describe', () => {
    const xml = blockMapXml([
      manifest(),
      { name: '[Content_Types].xml', data: Buffer.from('x') },
      { name: 'AppxBlockMap.xml', data: Buffer.from('x') },
      { name: 'AppxSignature.p7x', data: Buffer.from('x') },
    ]);
    expect(xml).toContain('AppxManifest.xml');
    expect(xml).not.toContain('Content_Types');
    expect(xml).not.toContain('AppxBlockMap');
    expect(xml).not.toContain('AppxSignature');
  });
});

describe('content types', () => {
  it('declares a default for every extension present', () => {
    const xml = contentTypesXml(['AppxManifest.xml', 'images/a.png', 'images/b.png']);
    expect(xml).toContain('<Default Extension="png" ContentType="image/png"/>');
    expect(xml).toContain('<Default Extension="xml"');
  });

  it('overrides the two parts Windows looks up by name', () => {
    const xml = contentTypesXml(['AppxManifest.xml']);
    expect(xml).toContain('PartName="/AppxManifest.xml" ContentType="application/vnd.ms-appx.manifest+xml"');
    expect(xml).toContain('PartName="/AppxBlockMap.xml" ContentType="application/vnd.ms-appx.blockmap+xml"');
  });
});

describe('zip', () => {
  it('stores checksums node:zlib agrees with', () => {
    const data = Buffer.from('a stored entry');
    const archive = zip([{ name: 'f.txt', data }]);
    expect(archive.readUInt32LE(14)).toBe(crc32(data) >>> 0);
  });

  it('round-trips through its own reader', () => {
    const files = [manifest(), { name: 'images/logo.png', data: Buffer.alloc(200, 3) }];
    const back = readZip(zip(files)) as Entry[];
    expect(back.map((f) => f.name)).toEqual(['AppxManifest.xml', 'images/logo.png']);
    expect(Buffer.compare(back[1].data, files[1].data)).toBe(0);
  });

  it('is byte-identical for identical input', () => {
    const files = [manifest(), { name: 'images/logo.png', data: Buffer.alloc(64, 1) }];
    expect(Buffer.compare(zip(files), zip(files))).toBe(0);
  });

  it('produces an archive the system unzip accepts', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'msix-'));
    const file = path.join(dir, 'p.zip');
    writeFileSync(file, zip([manifest(), { name: 'images/logo.png', data: Buffer.alloc(70_000, 9) }]));
    // -t verifies every entry's CRC. An external tool, not our own reader.
    const output = execFileSync('unzip', ['-t', file], { encoding: 'utf8' });
    expect(output).toContain('No errors detected');
  });
});

describe('buildMsix', () => {
  it('adds the block map and the content types around the payload', () => {
    const names = (readZip(buildMsix([manifest(), { name: 'images/logo.png', data: Buffer.from('x') }])) as Entry[]).map((f) => f.name);
    // Content types first so a reader can resolve part types while streaming; block map last.
    expect(names).toEqual(['[Content_Types].xml', 'AppxManifest.xml', 'images/logo.png', 'AppxBlockMap.xml']);
  });

  it('refuses a package with no app manifest', () => {
    expect(() => buildMsix([{ name: 'images/logo.png', data: Buffer.from('x') }])).toThrow(/AppxManifest/);
  });

  it('describes every payload file, and only those', () => {
    const payload = [manifest(), { name: 'images/a.png', data: Buffer.alloc(1) }, { name: 'images/b.png', data: Buffer.alloc(2) }];
    const entries = readZip(buildMsix(payload)) as Entry[];
    const map = entries.find((f) => f.name === 'AppxBlockMap.xml');
    const described = parse(map!.data.toString('utf8'))
      .filter((e) => e._tag === 'File')
      .map((e) => e.Name);
    expect(described).toEqual(['AppxManifest.xml', 'images\\a.png', 'images\\b.png']);
  });

  it('hashes what the archive actually contains', () => {
    const payload = [manifest(), { name: 'images/logo.png', data: Buffer.alloc(BLOCK_SIZE + 5, 4) }];
    const entries = readZip(buildMsix(payload)) as Entry[];
    const map = parse(entries.find((f) => f.name === 'AppxBlockMap.xml')!.data.toString('utf8'));

    // Re-hash the bytes read back out of the archive and compare against the recorded hashes.
    let file = '';
    const recorded: Record<string, string[]> = {};
    for (const node of map) {
      if (node._tag === 'File') recorded[(file = node.Name)] = [];
      if (node._tag === 'Block') recorded[file].push(node.Hash);
    }
    for (const entry of entries) {
      if (entry.name === 'AppxBlockMap.xml' || entry.name === '[Content_Types].xml') continue;
      expect(recorded[entry.name.replaceAll('/', '\\')], entry.name).toEqual(blocksOf(entry.data));
    }
    expect(recorded['images\\logo.png']).toHaveLength(2);
  });
});
