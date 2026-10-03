/**
 * Which map a practice round plays.
 *
 * Practice used to play whatever map was loaded, and nothing offline ever loaded another: the map
 * picker lived on the private-room screen, shown only online, and a map only changed when a server
 * room said so. So offline — which is every Steam install until online play has a hosted server —
 * two of the three maps could not be reached at all.
 *
 * `choice` is the picker's value: a level id, or `''` for "Surprise me", which means here what it
 * means for a private room — a different map each time. An id this build does not know keeps the
 * current map rather than reaching `buildLevel`, whose fallback for an unknown id is the jungle: a
 * stale id from an older build would otherwise look like a choice that worked.
 */
export function practiceLevelFor(
  choice: string,
  known: readonly string[],
  current: string,
  random: () => number = Math.random,
): string {
  if (choice === '') {
    if (known.length === 0) return current;
    return known[Math.min(known.length - 1, Math.floor(random() * known.length))] as string;
  }
  return known.includes(choice) ? choice : current;
}
