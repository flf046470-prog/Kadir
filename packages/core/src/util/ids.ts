import { Rand } from '../math/rand.js';

const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/1/I: read aloud in voice chat

/**
 * Room codes look like `KANG-4821`. Ambiguous glyphs are excluded because players read these
 * out loud to friends.
 */
export function generateRoomCode(rand: Rand, prefix = 'KANG'): string {
  let code = '';
  for (let i = 0; i < 4; i++) code += ROOM_CODE_ALPHABET[rand.int(0, ROOM_CODE_ALPHABET.length)];
  return `${prefix}-${code}`;
}

export function isValidRoomCode(code: string): boolean {
  return /^[A-Z]{4}-[2-9A-HJ-NP-Z]{4}$/.test(code);
}

export function normalizeRoomCode(input: string): string {
  const cleaned = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length <= 4) return cleaned;
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 8)}`;
}

let counter = 0;

/** Process-unique id. Not a security token — never use for auth. */
export function nextLocalId(prefix: string): string {
  counter = (counter + 1) % 0xffffff;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`;
}
