import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { currentUser } from "./guard";
import type { SessionUser } from "./session";

/**
 * Moderator authorization.
 *
 * The role is read from the database on every call rather than carried in the
 * session, so revoking someone's moderator access takes effect immediately
 * instead of when their session happens to expire.
 *
 * Failures return **404, not 403**. Confirming that a moderation console exists
 * tells an attacker exactly what to target; to anyone without the role, these
 * routes simply are not there.
 */

export type ModeratorRole = "moderator" | "admin";

export type ModeratorUser = SessionUser & { role: ModeratorRole };

export async function currentModerator(): Promise<ModeratorUser | null> {
  const user = await currentUser();
  if (!user) return null;

  const rows = await db
    .select({ role: users.role, suspendedAt: users.suspendedAt })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  // A suspended account keeps no privileges, whatever its role says.
  if (row.suspendedAt) return null;
  if (row.role !== "moderator" && row.role !== "admin") return null;

  return { ...user, role: row.role };
}

export type ModeratorAuthorized = { moderator: ModeratorUser };
export type ModeratorDenied = { response: NextResponse };

export async function requireModerator(): Promise<ModeratorAuthorized | ModeratorDenied> {
  const moderator = await currentModerator();
  if (!moderator) {
    return { response: NextResponse.json({ error: "not_found" }, { status: 404 }) };
  }
  return { moderator };
}

export function isDenied(
  result: ModeratorAuthorized | ModeratorDenied
): result is ModeratorDenied {
  return "response" in result;
}
