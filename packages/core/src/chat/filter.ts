/**
 * Text filtering for chat and display names.
 *
 * The hard part of a profanity filter is not the word list, it is that people evade it: `f u c k`,
 * `fuuuck`, `f*ck`, `phuck`, full-width forms. So the matcher normalises aggressively first —
 * case, accents, full-width forms, common letter/digit substitutions, repeated letters, and every
 * separator between letters — and only then looks for a word. That catches evasion at the cost of
 * occasionally catching an innocent string, which for a game rated for teenagers is the right way
 * round.
 *
 * The list itself is injectable, and deliberately short in the default. A shipped game needs a
 * maintained, localised list (this game's players are largely Turkish-speaking, and an
 * English-only list would be theatre), plus human review — `MemorySanctionStore` and the report
 * queue exist for that. This module's job is to make the *mechanism* correct and testable, not to
 * pretend a word list is moderation.
 */

/** Fold a string down to the form the matcher compares against. */
export function normaliseForMatch(input: string): string {
  return (
    input
      .normalize('NFKD')
      // Strip combining marks, so an accented evasion folds onto its plain form.
      .replace(/\p{M}+/gu, '')
      .toLowerCase()
      .replace(/[0@]/g, 'o')
      .replace(/[1!|]/g, 'i')
      .replace(/3/g, 'e')
      .replace(/4/g, 'a')
      .replace(/[5$]/g, 's')
      .replace(/7/g, 't')
      .replace(/ph/g, 'f')
      // Everything that is not a letter is a separator, including the ones used to break words up.
      .replace(/[^\p{L}]+/gu, '')
      // Collapse runs, so "fuuuck" and "fuck" become the same string.
      .replace(/(\p{L})\1+/gu, '$1')
  );
}

/** The default list. Short on purpose — see the module comment. */
export const DEFAULT_BLOCKLIST = [
  'fuck',
  'shit',
  'bitch',
  'cunt',
  'nigger',
  'faggot',
  'retard',
  'whore',
  'amcik',
  'orospu',
  'siktir',
  'yarrak',
] as const;

export interface FilterOptions {
  /** Words to reject, matched against the normalised form. */
  blocklist?: readonly string[];
  /** Words that would fold into a blocked one but are fine ("Scunthorpe"). */
  allowlist?: readonly string[];
}

/**
 * Does this text contain a blocked word?
 *
 * Substring rather than whole-word, because normalisation has already thrown away the separators
 * that would let us find word boundaries — and "yourefuckingdead" has to be caught.
 */
export function containsBlockedWord(text: string, options: FilterOptions = {}): boolean {
  const blocklist = options.blocklist ?? DEFAULT_BLOCKLIST;
  let normalised = normaliseForMatch(text);
  if (!normalised) return false;

  // Allowlisted words are removed before matching, so a legitimate word that happens to contain
  // a blocked one does not trip the filter.
  for (const allowed of options.allowlist ?? []) {
    const folded = normaliseForMatch(allowed);
    if (folded) normalised = normalised.split(folded).join('');
  }

  return blocklist.some((word) => {
    const folded = normaliseForMatch(word);
    return folded.length > 0 && normalised.includes(folded);
  });
}

/**
 * Control characters, zero-width characters and bidirectional overrides.
 *
 * Stripped rather than escaped: they cannot be rendered usefully, and an RTL override in
 * particular is how one chat line rewrites the lines around it in someone else's client.
 */
const INVISIBLE =
  // eslint-disable-next-line no-control-regex -- removing control characters is the point
  /[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/g;

/** Clean a chat line before anyone sees it. */
export function sanitiseChatText(input: string, maxLength = 140): string {
  return input.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}
