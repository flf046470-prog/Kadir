import { and, eq, isNull, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { emailVerificationTokens, users } from "@/db/schema";
import { generateToken, hashToken } from "./session";
import { normalizeEmail } from "./accounts";
import { siteUrl } from "@/lib/site";
import { sendMail, type MailResult } from "@/lib/mail/mail";
import { verifyEmailMessage } from "@/lib/mail/templates";

/**
 * Email verification.
 *
 * What this is for, stated plainly because it decides the design: without it
 * anybody can create an account on an address they do not own. On a dating
 * product that is not an abstract hygiene problem — it is how somebody signs
 * another person up, and how an account that has been reported becomes three
 * accounts an hour later. The address is also the only channel we have to a
 * member who has lost access, so an unverified one makes account recovery
 * impossible to offer safely.
 *
 * The token is handled exactly as a session token is: 256 bits of CSPRNG
 * output, and only its SHA-256 is stored. Same reasoning as
 * `session.ts` — there is no guessable structure to slow an attacker down, so
 * a password hash would buy nothing, and a stolen database must not yield
 * usable links.
 */

/**
 * Twenty-four hours.
 *
 * Long enough that somebody who registers at midnight and reads their mail
 * after work still has a working link; short enough that a link sitting in a
 * breached mailbox is usually dead. The resend endpoint exists for everyone
 * outside that window, so the cost of expiring is one click rather than a lost
 * account.
 */
export const VERIFICATION_TTL_HOURS = 24;

const TTL_MS = VERIFICATION_TTL_HOURS * 60 * 60 * 1000;

/**
 * Whether an unverified member is held back from the parts of the product that
 * reach another person.
 *
 * Off by default, and that default is not laziness: development and the test
 * suite create accounts directly and must be able to exercise every feature
 * without standing up a mail provider. Production turns it on — see
 * `.env.example` — which is the same shape as `REQUIRE_PHOTO_SCREENING`, for
 * the same reason: the safe setting is the one a deployment states, not one
 * that silently depends on an unrelated service being reachable.
 *
 * Note what it does *not* gate. An unverified member can sign in, see their
 * own profile, and fill it in. Locking them out of their own account would
 * punish the single most common case — a verification mail that went to spam —
 * by making the only fix invisible. What they cannot do is appear to, or
 * contact, anybody else.
 */
export function emailVerificationRequired(): boolean {
  return process.env.REQUIRE_EMAIL_VERIFICATION === "true";
}

/**
 * The link that goes in the mail.
 *
 * Locale-prefixed because every page on this site is, and a link that lands on
 * a locale-less path would redirect — which works, but costs a round trip and
 * shows the member a flash of the wrong language in the one email where we are
 * asking them to trust us.
 */
export function verificationLink(token: string, locale: string): string {
  const base = siteUrl.replace(/\/+$/, "");
  return `${base}/${locale}/verify-email?token=${encodeURIComponent(token)}`;
}

/**
 * Issues a fresh token, invalidating any unused one the member already has.
 *
 * Previous tokens are deleted rather than left to expire, so "the most recent
 * mail is the one that works" is true by construction. Leaving them live would
 * mean a member who pressed resend three times has three valid links, each in
 * a separate mail, any one of which stays usable for a day after they stopped
 * needing it.
 *
 * **Only the unused ones.** Deleting everything for the member would also take
 * the consumed rows, which is the one record of which address was verified
 * from which mail and when — the thing that answers "we never signed up for
 * this". `purgeExpiredVerificationTokens` keeps those on purpose, and this
 * quietly undoing that is exactly the kind of disagreement between two
 * functions that nobody notices until the record is needed. A consumed token
 * cannot be replayed into anything anyway, so keeping it costs no safety.
 */
export async function issueVerificationToken(
  userId: string,
  email: string
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + TTL_MS);

  await db.transaction(async (tx) => {
    await tx
      .delete(emailVerificationTokens)
      .where(
        and(
          eq(emailVerificationTokens.userId, userId),
          isNull(emailVerificationTokens.consumedAt)
        )
      );
    await tx.insert(emailVerificationTokens).values({
      tokenHash: hashToken(token),
      userId,
      email: normalizeEmail(email),
      expiresAt
    });
  });

  return { token, expiresAt };
}

/**
 * Issues a token and mails it.
 *
 * The mail result is returned rather than swallowed. Callers need it: the
 * registration response tells the new member whether to go and look in their
 * inbox or to press resend, and that answer is only honest if it comes from
 * what the provider actually said.
 */
export async function sendVerificationEmail(input: {
  userId: string;
  email: string;
  displayName: string;
  locale: string;
}): Promise<MailResult> {
  const { token } = await issueVerificationToken(input.userId, input.email);

  return sendMail(
    verifyEmailMessage({
      to: input.email,
      displayName: input.displayName,
      link: verificationLink(token, input.locale),
      locale: input.locale,
      expiresInHours: VERIFICATION_TTL_HOURS
    })
  );
}

export type VerificationFailure = "unknown" | "expired" | "email_changed";

export type VerificationResult =
  | { ok: true; userId: string; alreadyVerified: boolean }
  | { ok: false; reason: VerificationFailure };

/**
 * Consumes a token and marks the address verified.
 *
 * `alreadyVerified` rather than an error for a token that has been used
 * before, and that is a deliberate allowance rather than sloppiness. Mail
 * clients and security gateways prefetch links, so the first request can be a
 * machine's and the member's own click can be the second one. Answering that
 * with "invalid link" would make the feature appear broken to precisely the
 * members whose employers scan their mail. A replay still cannot *do*
 * anything — the row is already consumed and the flag already set — so the
 * only thing at stake is which page the member is shown, and the honest answer
 * is that their address is verified.
 */
export async function verifyEmailToken(token: string): Promise<VerificationResult> {
  if (!token) return { ok: false, reason: "unknown" };

  const tokenHash = hashToken(token);

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        userId: emailVerificationTokens.userId,
        issuedFor: emailVerificationTokens.email,
        expiresAt: emailVerificationTokens.expiresAt,
        consumedAt: emailVerificationTokens.consumedAt,
        currentEmail: users.email,
        verifiedAt: users.emailVerifiedAt,
        deletedAt: users.deletedAt
      })
      .from(emailVerificationTokens)
      .innerJoin(users, eq(users.id, emailVerificationTokens.userId))
      .where(eq(emailVerificationTokens.tokenHash, tokenHash))
      .limit(1);

    const row = rows[0];
    // An unknown hash and a deleted account answer identically. Distinguishing
    // them would turn this endpoint into a way to ask whether an account still
    // exists.
    if (!row || row.deletedAt) return { ok: false as const, reason: "unknown" as const };

    /**
     * The address check, before the expiry check.
     *
     * Order matters for what the member is told. If they changed their address
     * and then clicked an old link, "that link was for your previous address"
     * is the useful answer; "that link expired" would send them to press
     * resend, which would mail the new address and work — but only after a
     * detour that taught them nothing.
     */
    if (row.issuedFor !== row.currentEmail) {
      return { ok: false as const, reason: "email_changed" as const };
    }

    // Already used, and the flag is set: the member is verified, whatever
    // clicked first. See the note above on prefetching.
    if (row.consumedAt) {
      return row.verifiedAt
        ? { ok: true as const, userId: row.userId, alreadyVerified: true }
        : { ok: false as const, reason: "expired" as const };
    }

    if (row.expiresAt.getTime() <= Date.now()) {
      return { ok: false as const, reason: "expired" as const };
    }

    const now = new Date();

    await tx
      .update(emailVerificationTokens)
      .set({ consumedAt: now })
      .where(eq(emailVerificationTokens.tokenHash, tokenHash));

    /**
     * `isNull` on the flag, so a second verification cannot move an earlier
     * timestamp forward. The date somebody first proved they own the address
     * is the one that matters for a dispute, and overwriting it would quietly
     * rewrite the record.
     */
    await tx
      .update(users)
      .set({ emailVerifiedAt: now })
      .where(and(eq(users.id, row.userId), isNull(users.emailVerifiedAt)));

    return {
      ok: true as const,
      userId: row.userId,
      alreadyVerified: row.verifiedAt !== null
    };
  });
}

/** Whether this member still needs to verify. Cheap enough to call per request. */
export async function emailVerified(userId: string): Promise<boolean> {
  const rows = await db
    .select({ verifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return rows[0]?.verifiedAt != null;
}

/**
 * Housekeeping, for the same scheduled job that purges expired sessions.
 *
 * Consumed rows are kept — they are the evidence that a given address was
 * verified from a given mail, which is what answers "we never signed up" — and
 * they go when the account does, by cascade. Only tokens that expired unused
 * are deleted, since they prove nothing.
 */
export async function purgeExpiredVerificationTokens(): Promise<void> {
  await db
    .delete(emailVerificationTokens)
    .where(
      and(
        lt(emailVerificationTokens.expiresAt, new Date()),
        isNull(emailVerificationTokens.consumedAt)
      )
    );
}
