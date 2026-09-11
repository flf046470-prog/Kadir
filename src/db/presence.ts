import { and, eq, ne } from "drizzle-orm";
import { db } from "./client";
import { matchPresence } from "./schema";
import { resolveMatchFor } from "./messaging";

/**
 * Typing indicators and "last seen in this conversation".
 *
 * Both sides of this are polled rather than pushed, which shapes the design:
 *
 *  - **Typing expires on read, not on a timer.** Nothing has to clean up after
 *    a member who closed the tab mid-sentence; a `typingAt` older than the
 *    window simply stops counting as typing. There is no state to leak.
 *  - **Membership is resolved through `resolveMatchFor`**, the same single
 *    gate the messages go through, so presence cannot be written to or read
 *    from a conversation that is not yours.
 *  - **A poll is not a read.** Marking a conversation seen because the client
 *    asked for messages would make the receipt a lie: a tab left open in the
 *    background reads nothing. The client says when it is genuinely visible.
 */

/**
 * How long a keystroke counts for. Long enough to bridge the gap between
 * polls, short enough that "typing…" disappears when someone walks away
 * mid-sentence rather than hanging there indefinitely.
 */
export const TYPING_WINDOW_MS = 8000;

/** Throttle the client should honour, so a fast typist is not one write per key. */
export const TYPING_PING_MS = 3000;

export type Presence = {
  /** True when the partner has typed within the window. */
  partnerTyping: boolean;
  /** When the partner last had this conversation on screen. */
  partnerLastSeenAt: Date | null;
};

/**
 * Records that this member is present, and optionally that they are typing.
 *
 * `typing: false` deliberately clears the timestamp rather than leaving it to
 * expire — sending a message should stop the indicator at once, not up to
 * eight seconds later.
 */
export async function touchPresence(
  userId: string,
  matchId: string,
  options: { typing?: boolean } = {}
): Promise<boolean> {
  const match = await resolveMatchFor(userId, matchId);
  if (!match) return false;

  const now = new Date();
  const typingAt = options.typing === undefined ? undefined : options.typing ? now : null;

  await db
    .insert(matchPresence)
    .values({ matchId, userId, lastSeenAt: now, typingAt: typingAt ?? null })
    .onConflictDoUpdate({
      target: [matchPresence.matchId, matchPresence.userId],
      set: {
        lastSeenAt: now,
        // Omitting `typing` leaves the existing value alone, so a plain
        // heartbeat neither starts nor stops the indicator.
        ...(typingAt === undefined ? {} : { typingAt })
      }
    });

  return true;
}

/** What the other side is doing. Returns null when the match is not this member's. */
export async function presenceFor(userId: string, matchId: string): Promise<Presence | null> {
  const match = await resolveMatchFor(userId, matchId);
  if (!match) return null;

  const rows = await db
    .select({ typingAt: matchPresence.typingAt, lastSeenAt: matchPresence.lastSeenAt })
    .from(matchPresence)
    .where(and(eq(matchPresence.matchId, matchId), ne(matchPresence.userId, userId)))
    .limit(1);

  const row = rows[0];
  if (!row) return { partnerTyping: false, partnerLastSeenAt: null };

  return {
    partnerTyping:
      row.typingAt !== null && Date.now() - row.typingAt.getTime() < TYPING_WINDOW_MS,
    partnerLastSeenAt: row.lastSeenAt
  };
}
