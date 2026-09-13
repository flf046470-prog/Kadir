/**
 * How long the pieces of an invitation last.
 *
 * Here rather than in `db/virtual-dates.ts` because both sides need them and
 * only one side can import that file: the browser would drag the whole database
 * layer in with it. A screen that stops someone choosing a date the server will
 * refuse, and a server that refuses it anyway, have to be counting the same
 * days — two sevens in two files eventually become a seven and a fourteen.
 */

/**
 * How long an invitation waits for an answer, and the furthest ahead a date can
 * be set.
 *
 * One number for both, because they are the same rule seen from either end: an
 * invitation has to still be answerable when the date it proposes arrives.
 * Letting someone schedule a date for three weeks out would have the invitation
 * expire two weeks before it — a date on both their screens that quietly stops
 * existing — and letting them schedule it for three *years* out would park a
 * pending invitation in the conversation for that long, since only one can be
 * open at a time.
 */
export const INVITE_TTL_DAYS = 7;

/**
 * How long an accepted date with no agreed time stays on screen.
 *
 * "Yes, let's" is news for about a day. Nothing can observe whether the date
 * happened — there is no session to end — so without an expiry the row would
 * sit there permanently, which is indistinguishable from being stuck.
 */
export const UNSCHEDULED_DATE_HOURS = 24;
