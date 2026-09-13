/**
 * Whether two members can read each other without help.
 *
 * FioreMatch lets people match across languages on purpose — that is what the
 * international modes are for — and then dropped them into a conversation
 * neither could read, with a translation control that had to be found and
 * pressed on every visit. The data to prevent that was already on both
 * profiles; nothing was asking the question.
 *
 * Deliberately not a similarity score. "Can these two read each other" is a
 * yes or no, and a probabilistic answer would sometimes leave a member staring
 * at a language they do not speak.
 */

/** Normalises `TR`, `tr-TR`, ` tr ` to `tr` — profiles are hand-entered. */
function base(tag: string): string {
  return tag.trim().toLowerCase().split(/[-_]/)[0];
}

/**
 * Languages both members list, as normalised base tags.
 *
 * Regional variants collapse to their base: someone who wrote `pt-BR` and
 * someone who wrote `pt-PT` can read each other, and treating those as
 * different languages would switch translation on for a pair who do not need
 * it — which costs money and puts a machine between two people unnecessarily.
 */
export function sharedLanguages(a: readonly string[], b: readonly string[]): string[] {
  const theirs = new Set(b.map(base).filter(Boolean));
  const shared = new Set<string>();

  for (const tag of a.map(base)) {
    if (tag && theirs.has(tag)) shared.add(tag);
  }

  return [...shared].sort();
}

/**
 * Whether translation should turn itself on for this pair.
 *
 * An empty list on either side means "unknown", not "no languages", and
 * unknown is not a reason to route someone's private messages through a
 * translation provider. A member who has not filled in their languages keeps
 * the manual control; only a *known* mismatch flips it on by itself.
 */
export function needsTranslation(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  return sharedLanguages(a, b).length === 0;
}
