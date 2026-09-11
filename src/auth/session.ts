import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { eq, and, gt, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { sessions, users } from "@/db/schema";

/**
 * Session management.
 *
 * The raw session token exists in exactly two places: the member's cookie, and
 * memory for the duration of the request that created it. The database stores
 * only its SHA-256. A leaked database backup therefore does not hand an
 * attacker usable sessions.
 *
 * SHA-256 is the right primitive here rather than a password hash: the token is
 * 256 bits of CSPRNG output, so it has no guessable structure to slow down.
 */

export const SESSION_COOKIE = "fm_session";
export const SESSION_TTL_DAYS = 30;

const TOKEN_BYTES = 32;

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    userId,
    expiresAt
  });

  return { token, expiresAt };
}

export type SessionUser = {
  id: string;
  email: string;
  displayName: string;
  locale: string;
};

/**
 * Resolves a cookie token to a member. Returns null for anything that isn't a
 * live session on a live account — expired, revoked, or a deleted user.
 */
export async function resolveSession(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      locale: users.locale,
      deletedAt: users.deletedAt,
      suspendedAt: users.suspendedAt
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  // A member who requested deletion must not be able to keep using the account.
  if (row.deletedAt) return null;
  /**
   * Nor a suspended one, and this is the check that was missing.
   *
   * `authenticate` refuses a suspended member at the login form, which reads as
   * complete but only stops *new* sessions. Suspension does not destroy the
   * ones that exist, so somebody a moderator suspended kept full access —
   * messaging, Discover, everything — for up to the thirty days their cookie
   * had left. On a dating product the reason for a suspension is usually that
   * they are doing something to another member, and the suspension was
   * silently not stopping it.
   *
   * Checked here rather than by deleting sessions at suspension time, so it
   * holds however the flag comes to be set — an admin action, a migration, a
   * future automated rule — and so lifting a suspension restores access without
   * forcing a re-login.
   */
  if (row.suspendedAt) return null;

  return { id: row.id, email: row.email, displayName: row.displayName, locale: row.locale };
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

/** Logs a member out everywhere — used on password change and deletion. */
export async function destroyAllSessions(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/** Housekeeping, for a scheduled job. */
export async function purgeExpiredSessions(): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

/** Cookie options. `secure` is off only for local http development. */
export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt
  };
}

/**
 * Constant-time comparison, for anywhere a caller compares a secret it received
 * against one it holds. Length is compared first because `timingSafeEqual`
 * throws on differing lengths.
 */
export function safeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
