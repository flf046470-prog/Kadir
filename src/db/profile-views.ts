import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./client";
import { profileViews } from "./schema";
import { entitlementsOf } from "./entitlements";
import { eitherBlocked } from "./interactions";

/**
 * Profile visitors — a VIP surface.
 *
 * Two rules shape this file, and they point in opposite directions on purpose.
 *
 * **Recording is unconditional.** Every viewer is recorded, whatever they pay.
 * A log that only captured paying viewers would answer "who looked at me?"
 * with a filtered list while presenting it as the whole one, and a member
 * could browse invisibly by not subscribing. What the tier buys is reading the
 * list; nobody buys their way out of appearing on someone else's.
 *
 * **Reading is gated and never leaks.** The gate lives here rather than in the
 * route, so there is one place to be wrong. A blocked pair is filtered on read
 * rather than deleted on block, because unblocking should not silently
 * resurrect a visit — and because a block is not a claim that the visit did
 * not happen.
 */

const LIST_LIMIT = 50;

/**
 * Records that `viewerId` opened `subjectId`'s profile.
 *
 * Self-views are dropped: everyone looks at their own profile, and a list that
 * says so is noise. Upserts rather than appends — see the schema comment for
 * why one row per pair.
 */
export async function recordProfileView(subjectId: string, viewerId: string): Promise<void> {
  if (subjectId === viewerId) return;

  await db
    .insert(profileViews)
    .values({ subjectUserId: subjectId, viewerUserId: viewerId })
    .onConflictDoUpdate({
      target: [profileViews.subjectUserId, profileViews.viewerUserId],
      set: {
        viewCount: sql`${profileViews.viewCount} + 1`,
        lastViewedAt: new Date()
      }
    });
}

export type ProfileVisitor = {
  userId: string;
  viewCount: number;
  lastViewedAt: Date;
};

export type VisitorList =
  /** The member may see the list. */
  | { locked: false; visitors: ProfileVisitor[]; total: number }
  /**
   * The member may not. The count still comes back — knowing that eleven
   * people looked is the reason to upgrade, and withholding it would make the
   * upsell an assertion rather than a fact about their own account.
   */
  | { locked: true; visitors: []; total: number };

/**
 * Who has looked at this member's profile.
 *
 * Free and PLUS get the count; VIP gets the names. The count is not gated
 * because it is the member's own data in aggregate, and because an upsell that
 * cannot show you anything real is indistinguishable from an invented one.
 */
export async function visitorsOf(userId: string, now: Date = new Date()): Promise<VisitorList> {
  const [{ entitlements }, rows] = await Promise.all([
    entitlementsOf(userId, now),
    db
      .select({
        userId: profileViews.viewerUserId,
        viewCount: profileViews.viewCount,
        lastViewedAt: profileViews.lastViewedAt
      })
      .from(profileViews)
      .where(eq(profileViews.subjectUserId, userId))
      .orderBy(desc(profileViews.lastViewedAt))
      .limit(LIST_LIMIT)
  ]);

  // Blocks are applied on read. Doing it in SQL would need a join against both
  // directions of `blocks`; at fifty rows the round trips are cheaper than the
  // query is to get right.
  const visible: ProfileVisitor[] = [];
  for (const row of rows) {
    if (await eitherBlocked(userId, row.userId)) continue;
    visible.push(row);
  }

  if (!entitlements.profileVisitors) {
    return { locked: true, visitors: [], total: visible.length };
  }

  return { locked: false, visitors: visible, total: visible.length };
}

/** How many distinct people have looked, ignoring the tier gate. */
export async function visitorCount(userId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(profileViews)
    .where(eq(profileViews.subjectUserId, userId));

  return rows[0]?.count ?? 0;
}

/** Whether a specific member has looked — used by the conversation header. */
export async function hasViewed(subjectId: string, viewerId: string): Promise<boolean> {
  const rows = await db
    .select({ viewCount: profileViews.viewCount })
    .from(profileViews)
    .where(
      and(eq(profileViews.subjectUserId, subjectId), eq(profileViews.viewerUserId, viewerId))
    )
    .limit(1);

  return rows.length > 0;
}
