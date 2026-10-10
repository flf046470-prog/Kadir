/** One row of the in-round scoreboard. */
export interface ScoreRow {
  label: string;
  score: number;
}

/**
 * The scoreboard's rows, highest first: the local player as "You", everyone else by the name drawn
 * over their head.
 *
 * It used to print the player *id*. In solo practice that is `bot0`…`bot4` beside avatars labelled
 * Bounce and Digger; online it is the first seven characters of an account id, so nobody could tell
 * from the board who was winning. Both showed in the Steam screenshots.
 *
 * `nameOf` answers from the roster. A player the roster has not reached yet keeps the shortened id
 * rather than a blank row, which is what a score for nobody would look like.
 */
export function scoreRows(
  scores: Readonly<Record<string, number>>,
  localId: string,
  nameOf: (id: string) => string | undefined,
  limit: number,
): ScoreRow[] {
  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, score]) => ({ label: id === localId ? 'You' : nameOf(id) || shortId(id), score }));
}

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 7)}…` : id;
}
