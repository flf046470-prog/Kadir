import { and, desc, eq } from "drizzle-orm";
import { db } from "./client";
import { pushTokens } from "./schema";

/**
 * Push device registration.
 *
 * Nothing here sends anything. Delivery needs credentials for Firebase Cloud
 * Messaging and the Apple Push Notification service, which belong to the
 * account that publishes the app; until those exist this is the half that can
 * be built and tested — the devices are recorded, moved and forgotten
 * correctly, and a sender later reads this table.
 */

export type PushPlatform = "ios" | "android";

export function isPushPlatform(value: string): value is PushPlatform {
  return value === "ios" || value === "android";
}

/**
 * Records a device against a member, or moves it if it was somebody else's.
 *
 * The move is the point. Tokens are issued per app installation, not per
 * account: if someone signs out and a flatmate signs in, the provider hands
 * back the *same* token. Inserting would collide; ignoring the collision would
 * leave the notification addressed to the previous member. So the conflict
 * updates the owner.
 */
export async function registerPushToken(
  userId: string,
  token: string,
  platform: PushPlatform,
  now: Date = new Date()
): Promise<void> {
  await db
    .insert(pushTokens)
    .values({ token, userId, platform, createdAt: now, lastSeenAt: now })
    .onConflictDoUpdate({
      target: pushTokens.token,
      set: { userId, platform, lastSeenAt: now }
    });
}

/**
 * Forgets a device.
 *
 * Scoped to the member as well as the token: a signed-in caller may retire
 * their own device, never one that has since been claimed by somebody else.
 */
export async function unregisterPushToken(userId: string, token: string): Promise<boolean> {
  const removed = await db
    .delete(pushTokens)
    .where(and(eq(pushTokens.token, token), eq(pushTokens.userId, userId)))
    .returning({ token: pushTokens.token });

  return removed.length > 0;
}

export type Device = { token: string; platform: PushPlatform; lastSeenAt: Date };

/** Every device this member is currently signed in on, most recent first. */
export async function devicesFor(userId: string): Promise<Device[]> {
  const rows = await db
    .select({
      token: pushTokens.token,
      platform: pushTokens.platform,
      lastSeenAt: pushTokens.lastSeenAt
    })
    .from(pushTokens)
    .where(eq(pushTokens.userId, userId))
    .orderBy(desc(pushTokens.lastSeenAt));

  return rows
    .filter((row) => isPushPlatform(row.platform))
    .map((row) => ({
      token: row.token,
      platform: row.platform as PushPlatform,
      lastSeenAt: row.lastSeenAt
    }));
}
