/**
 * Shared helper for the product-safety copy guards.
 *
 * The guards exist to catch copy that *makes* a forbidden claim ("this profile
 * is 100% safe"). Copy that explicitly *disclaims* it ("there is no safety
 * score", "FioreMatch is not an emergency service") is exactly what we want to
 * ship, so a plain substring match would flag our best wording.
 *
 * `matchesUnnegated` therefore ignores a hit when a negator appears shortly
 * before it. This is a heuristic, not a parser — it is here to catch drift in
 * review, and every guard is paired with tests for both the affirmative form it
 * must catch and the negated form it must allow.
 */

const NEGATORS = [
  "not",
  "n't",
  "never",
  "no ",
  "cannot",
  "without",
  "avoid",
  "refuse",
  "does not",
  "do not"
];

/** How far back to look for a negator, in characters. */
const NEGATION_WINDOW = 60;

/**
 * Looks for a negator in the window before the hit *and* inside the hit itself,
 * since a pattern anchored on the subject ("FioreMatch … monitors your date")
 * swallows the "is not" that negates it.
 */
function isNegated(haystack: string, matchIndex: number, matchText = ""): boolean {
  const start = Math.max(0, matchIndex - NEGATION_WINDOW);
  const scope = (haystack.slice(start, matchIndex) + matchText).toLowerCase();
  return NEGATORS.some((negator) => scope.includes(negator));
}

/** True when `needle` appears at least once without a nearby negator. */
export function containsUnnegated(text: string, needle: string): boolean {
  const lower = text.toLowerCase();
  const target = needle.toLowerCase();

  let index = lower.indexOf(target);
  while (index !== -1) {
    if (!isNegated(lower, index)) return true;
    index = lower.indexOf(target, index + target.length);
  }
  return false;
}

/** True when `pattern` matches at least once without a nearby negator. */
export function matchesUnnegated(text: string, pattern: RegExp): boolean {
  const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);

  let match: RegExpExecArray | null;
  while ((match = global.exec(text)) !== null) {
    if (!isNegated(text, match.index, match[0])) return true;
    if (match.index === global.lastIndex) global.lastIndex++;
  }
  return false;
}
