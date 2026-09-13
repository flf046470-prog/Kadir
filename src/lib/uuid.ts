/**
 * Whether a string is a uuid, checked before it reaches a uuid column.
 *
 * Postgres rejects a bad cast with a database error and a foreign key rejects
 * a well-formed id that names nobody, and both arrive at the client as a 500 —
 * the caller is told the server broke when what happened is that they sent a
 * bad id. Every route that takes a member or row id from a request body checks
 * this first, so a malformed one is answered as the bad request it is.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
