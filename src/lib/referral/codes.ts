/**
 * Referral codes, using Crockford Base32.
 *
 * Codes get read aloud, typed on phone keyboards, and screenshotted, so the
 * alphabet matters. Crockford Base32 is the established convention for exactly
 * this: it omits I, L, O, and U — the first three because they are confusable
 * with 1 and 0, and U so that codes cannot accidentally spell obscenities —
 * and it defines how to fold the confusable characters back on input.
 *
 * Using a documented scheme rather than an ad-hoc alphabet means the decode
 * rules are unambiguous and someone typing "O" for "0" still succeeds instead
 * of seeing a spurious "invalid code".
 */

/** Crockford Base32: digits plus A–Z excluding I, L, O, U. */
const CHARS = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const CODE_LENGTH = 8;

/** Crockford's decode folding: O→0, and I/L→1. */
const CONFUSABLES: Record<string, string> = {
  O: "0",
  I: "1",
  L: "1"
};

export type RandomSource = () => number;

/**
 * Generates a code. Collision handling belongs to the caller, which knows what
 * is already stored; at 32^8 (~1.1e12) combinations a retry loop on the unique
 * index is sufficient.
 */
export function generateCode(random: RandomSource = Math.random): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    const index = Math.floor(random() * CHARS.length);
    // Guard against a random source returning exactly 1.
    code += CHARS[Math.min(index, CHARS.length - 1)];
  }
  return code;
}

/**
 * Normalises user input: strips spacing and separators, upper-cases, and folds
 * confusable characters. Returns null when the result cannot be a valid code.
 */
export function normalizeCode(input: string): string | null {
  const folded = input
    .toUpperCase()
    .replace(/[\s\-_.]/g, "")
    .split("")
    .map((char) => CONFUSABLES[char] ?? char)
    .join("");

  if (folded.length !== CODE_LENGTH) return null;
  if (![...folded].every((char) => CHARS.includes(char))) return null;

  return folded;
}

export function isValidCode(input: string): boolean {
  return normalizeCode(input) !== null;
}

/** Builds the shareable link for a code. */
export function referralLink(code: string, baseUrl: string, locale: string): string {
  return `${baseUrl}/${locale}/register?ref=${encodeURIComponent(code)}`;
}
