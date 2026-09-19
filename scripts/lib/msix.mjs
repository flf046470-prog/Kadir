/**
 * Build an MSIX package without the Windows SDK.
 *
 * `makeappx.exe` is the usual way to do this and it only runs on Windows, which would leave the
 * one artifact a Windows submission needs unbuildable on the machine that builds everything else.
 * It is not a deep format: an MSIX is an OPC package — an ordinary ZIP carrying the app manifest,
 * a content-type map, and a block map of SHA-256 hashes over the payload. All three are written
 * here, from `node:zlib` and `node:crypto` alone.
 *
 * Everything is *stored*, not deflated. The payload is PNG tile art and one small XML manifest;
 * PNG is already compressed so deflating it saves nothing, and storing removes the whole
 * per-block compressed-size bookkeeping the block map would otherwise have to carry. `makeappx`
 * itself offers this as `/nc`, so it is a supported shape rather than a shortcut.
 *
 * What this deliberately does NOT do is sign. A Store submission must be unsigned: Partner Center
 * re-signs with its own certificate and rejects a package signed by anyone else.
 */

import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';

/** The block size the MSIX block map is defined in terms of. Not ours to choose. */
export const BLOCK_SIZE = 64 * 1024;

/**
 * Files that live in a package but never appear in its block map.
 *
 * The block map is what the block map cannot describe: itself, the signature computed over it,
 * and the content-type map that names it.
 */
const FOOTPRINT = new Set(['[Content_Types].xml', 'AppxBlockMap.xml', 'AppxSignature.p7x']);

/**
 * A fixed timestamp, so the same inputs produce a byte-identical package.
 * 2020-01-01 00:00, in the DOS date format ZIP has carried since 1980.
 */
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;
const DOS_TIME = 0;

const CONTENT_TYPES = {
  png: 'image/png',
  xml: 'application/octet-stream',
  json: 'application/json',
  svg: 'image/svg+xml',
  txt: 'text/plain',
};

function xmlEscape(text) {
  return String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/**
 * The OPC content-type map.
 *
 * Extensions get a default; the two XML parts Windows looks for by name get an override, because
 * they share the `.xml` extension with nothing else in particular and are not generic XML to the
 * package reader.
 */
export function contentTypesXml(names) {
  const extensions = new Set();
  for (const name of names) {
    const ext = name.split('.').pop()?.toLowerCase();
    if (ext && ext !== name.toLowerCase()) extensions.add(ext);
  }

  const defaults = [...extensions]
    .sort()
    .map((ext) => `<Default Extension="${ext}" ContentType="${CONTENT_TYPES[ext] ?? 'application/octet-stream'}"/>`)
    .join('');

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    defaults +
    `<Override PartName="/AppxManifest.xml" ContentType="application/vnd.ms-appx.manifest+xml"/>` +
    `<Override PartName="/AppxBlockMap.xml" ContentType="application/vnd.ms-appx.blockmap+xml"/>` +
    `<Override PartName="/AppxSignature.p7x" ContentType="application/vnd.ms-appx.signature"/>` +
    `</Types>`
  );
}

/** SHA-256 of each 64KiB block of a file, base64, in order. An empty file has no blocks. */
export function blocksOf(data) {
  const blocks = [];
  for (let offset = 0; offset < data.length; offset += BLOCK_SIZE) {
    blocks.push(createHash('sha256').update(data.subarray(offset, offset + BLOCK_SIZE)).digest('base64'));
  }
  return blocks;
}

/**
 * The block map: what Windows verifies the package against before it will install or update it.
 *
 * `LfhSize` is the size of the ZIP local file header for the entry, which is how a reader finds
 * the start of the file data without parsing the header again. It depends on the name length, not
 * on where in the archive the entry ended up, so it can be computed before anything is written.
 */
export function blockMapXml(files) {
  const entries = files
    .filter((f) => !FOOTPRINT.has(f.name))
    .map((f) => {
      // The block map speaks Windows paths; the ZIP entries around it speak POSIX ones.
      const name = xmlEscape(f.name.replaceAll('/', '\\'));
      const lfhSize = 30 + Buffer.byteLength(f.name, 'utf8');
      const blocks = blocksOf(f.data)
        .map((hash) => `<Block Hash="${hash}"/>`)
        .join('');
      return `<File Name="${name}" Size="${f.data.length}" LfhSize="${lfhSize}">${blocks}</File>`;
    })
    .join('');

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="no"?>` +
    `<BlockMap xmlns="http://schemas.microsoft.com/appx/2010/blockmap" HashMethod="http://www.w3.org/2001/04/xmlenc#sha256">` +
    entries +
    `</BlockMap>`
  );
}

/**
 * A minimal ZIP writer: stored entries only, no data descriptors, no Zip64.
 *
 * Written rather than pulled in because the package has to be exactly what the block map says it
 * is, down to the local header size, and that is easier to guarantee than to verify.
 */
export function zip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const sum = crc32(file.data) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0, which is all a stored entry asks for
    local.writeUInt16LE(0, 6); // flags: no data descriptor, so sizes are known up front
    local.writeUInt16LE(0, 8); // method 0: stored
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(file.data.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // no extra field: LfhSize in the block map assumes none
    chunks.push(local, name, file.data);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(DOS_TIME, 12);
    header.writeUInt16LE(DOS_DATE, 14);
    header.writeUInt32LE(sum, 16);
    header.writeUInt32LE(file.data.length, 20);
    header.writeUInt32LE(file.data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);

    offset += 30 + name.length + file.data.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, directory, end]);
}

/**
 * Assemble a package from its payload.
 *
 * `payload` is every file that belongs to the app, `AppxManifest.xml` included; the content-type
 * map and the block map are produced here. `[Content_Types].xml` goes first so a reader can
 * resolve part types while streaming, and the block map goes last, next to where a signature
 * would sit if the Store had added one yet.
 */
export function buildMsix(payload) {
  if (!payload.some((f) => f.name === 'AppxManifest.xml')) {
    throw new Error('a package needs an AppxManifest.xml');
  }

  const blockMap = { name: 'AppxBlockMap.xml', data: Buffer.from(blockMapXml(payload), 'utf8') };
  const types = { name: '[Content_Types].xml', data: Buffer.from(contentTypesXml(payload.map((f) => f.name)), 'utf8') };
  return zip([types, ...payload, blockMap]);
}

/**
 * Read a ZIP back through its central directory.
 *
 * Used to check the package this module just wrote, so it walks the archive the way a reader
 * does — from the end — rather than trusting the offsets it had in hand a moment ago.
 */
export function readZip(buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('not a ZIP: no end-of-central-directory record');

  const count = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  const files = [];

  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error(`central directory entry ${i} is malformed`);
    const method = buffer.readUInt16LE(cursor + 10);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const local = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);

    if (method !== 0) throw new Error(`${name} is compressed; this reader only stores`);
    const dataStart = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    files.push({ name, data: buffer.subarray(dataStart, dataStart + size) });

    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}
