import { and, eq, ne } from "drizzle-orm";
import { db } from "./client";
import { userPlatformAccounts } from "./schema";
import type { PlatformId, VerifiedPlatformIdentity } from "@/lib/platforms/verifier";

/**
 * Linking a FioreMatch account to a platform identity.
 *
 * One account, many platforms — a member who bought VIP on their phone opens
 * the Quest app and is the same member, with the same subscription, because the
 * entitlement lives on `users` and the headset only had to prove which user it
 * is holding.
 *
 * Everything here takes an already-*verified* identity. Nothing in this file
 * accepts a platform id from a client: `PlatformVerifier` produces it, and the
 * separation is what stops "I am Steam user 76561…" from being a valid claim.
 */

export type PlatformAccount = {
  platform: PlatformId;
  createdAt: Date;
  lastLoginAt: Date | null;
};

export type LinkResult =
  | { ok: true }
  /**
   * The identity already belongs to a different FioreMatch account.
   *
   * Refused loudly rather than moved, for the reason the purchase path refuses
   * a redeemed receipt: silently re-pointing an identity would let one Steam
   * account carry its purchases onto a second FioreMatch account, and would
   * take the first member's platform login away without telling them.
   */
  | { ok: false; reason: "linked_to_another_account" };

export async function linkPlatformAccount(
  userId: string,
  identity: VerifiedPlatformIdentity,
  now: Date = new Date()
): Promise<LinkResult> {
  // Postgres' unique_violation. Matched on the code rather than the message,
  // which is localised and version-dependent.
  const isUniqueViolation = (error: unknown) =>
    typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";

  const claimed = await db
    .select({ userId: userPlatformAccounts.userId })
    .from(userPlatformAccounts)
    .where(
      and(
        eq(userPlatformAccounts.platform, identity.platform),
        eq(userPlatformAccounts.platformUserId, identity.platformUserId),
        ne(userPlatformAccounts.userId, userId)
      )
    )
    .limit(1);

  if (claimed[0]) return { ok: false, reason: "linked_to_another_account" };

  /**
   * Keyed on (user, platform), so re-linking after switching Steam accounts
   * replaces the identity rather than adding a second one.
   *
   * The other unique index — (platform, identity) — is what the check above
   * anticipates, and an upsert can only name one conflict target. The check and
   * this insert are two statements, so between them the same platform identity
   * can be claimed by somebody else: a real race, since a linking flow is
   * exactly where two devices act at once. That arrives as a constraint
   * violation meaning precisely what the check means, so it is translated into
   * the same refusal rather than surfacing as a 500.
   */
  try {
    await db
      .insert(userPlatformAccounts)
      .values({
        userId,
        platform: identity.platform,
        platformUserId: identity.platformUserId,
        lastLoginAt: now
      })
      .onConflictDoUpdate({
        target: [userPlatformAccounts.userId, userPlatformAccounts.platform],
        set: { platformUserId: identity.platformUserId, lastLoginAt: now }
      });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "linked_to_another_account" };
    throw error;
  }

  return { ok: true };
}

/** The FioreMatch account behind a verified platform identity, if it is linked. */
export async function accountForPlatformIdentity(
  identity: VerifiedPlatformIdentity
): Promise<string | null> {
  const rows = await db
    .select({ userId: userPlatformAccounts.userId })
    .from(userPlatformAccounts)
    .where(
      and(
        eq(userPlatformAccounts.platform, identity.platform),
        eq(userPlatformAccounts.platformUserId, identity.platformUserId)
      )
    )
    .limit(1);

  return rows[0]?.userId ?? null;
}

/** Records that this identity signed in, for support and for stale-link cleanup. */
export async function touchPlatformLogin(
  userId: string,
  platform: PlatformId,
  now: Date = new Date()
): Promise<void> {
  await db
    .update(userPlatformAccounts)
    .set({ lastLoginAt: now })
    .where(
      and(eq(userPlatformAccounts.userId, userId), eq(userPlatformAccounts.platform, platform))
    );
}

/**
 * A member's linked platforms.
 *
 * Deliberately does not return `platformUserId`. This is what the account
 * screen renders, and a Steam id on a dating profile screen is one screenshot
 * away from linking the two identities in public. The member does not need to
 * see the number to know they linked Steam.
 */
export async function linkedPlatforms(userId: string): Promise<PlatformAccount[]> {
  const rows = await db
    .select({
      platform: userPlatformAccounts.platform,
      createdAt: userPlatformAccounts.createdAt,
      lastLoginAt: userPlatformAccounts.lastLoginAt
    })
    .from(userPlatformAccounts)
    .where(eq(userPlatformAccounts.userId, userId));

  return rows.map((row) => ({
    platform: row.platform as PlatformId,
    createdAt: row.createdAt,
    lastLoginAt: row.lastLoginAt
  }));
}

/**
 * Unlinking.
 *
 * Does not touch the subscription. Entitlement belongs to the FioreMatch
 * account and was paid for; unlinking a platform is saying "stop signing me in
 * this way", not "refund me". The purchase's own unique reference still stops
 * the same receipt being redeemed on a second account, so a member cannot
 * unlink, re-link elsewhere and carry the purchase with them.
 */
export async function unlinkPlatformAccount(
  userId: string,
  platform: PlatformId
): Promise<{ ok: boolean }> {
  const removed = await db
    .delete(userPlatformAccounts)
    .where(
      and(eq(userPlatformAccounts.userId, userId), eq(userPlatformAccounts.platform, platform))
    )
    .returning({ id: userPlatformAccounts.id });

  return { ok: removed.length > 0 };
}
