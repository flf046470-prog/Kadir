/**
 * Which map a practice round plays.
 *
 * Practice used to play whatever map was loaded, and nothing offline ever loaded another: the map
 * picker lived on the private-room screen, shown only online, and a map only changed when a server
 * room said so. So offline — which is every Steam install until online play has a hosted server —
 * two of the three maps could not be reached at all.
 *
 * `choice` is the picker's value: a level id, or `''` when nothing was picked. Nothing picked keeps
 * the map that is loaded. It briefly meant "a different map each time", as it does for a private
 * room, and CI's smoke test went red: "Practice with bots" from the main menu then rebuilt the
 * world inside the click handler — new level, new renderer, new textures — and the click had not
 * returned 30 s later. A map is changed when a player asks for one, not on every press of Play.
 *
 * An id this build does not know also keeps the current map, rather than reaching `buildLevel`,
 * whose fallback for an unknown id is the jungle: a stale id from an older build would otherwise
 * look like a choice that worked.
 */
export function practiceLevelFor(choice: string, known: readonly string[], current: string): string {
  return known.includes(choice) ? choice : current;
}
