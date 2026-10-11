import { NextResponse } from "next/server";
import { apiError, isUnauthorized, requireUser } from "@/auth/guard";
import { emailVerified, sendVerificationEmail } from "@/auth/email-verification";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Sends the verification mail again.
 *
 * Requires a session rather than taking an address in the body, and that is
 * the security decision in this file. An endpoint that accepted
 * `{ email: "..." }` would answer differently for an address that exists than
 * for one that does not — which is the user enumeration `accounts.ts` goes to
 * the trouble of equalising timings to prevent — and it would let anyone use
 * our mailer to send mail to any address they like, repeatedly, from our
 * verified domain. A member who needs this has just registered, so they have a
 * session; one who does not can log in first.
 */
export async function POST() {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  /**
   * Keyed on the member, not the IP.
   *
   * The caller is authenticated, so the account is the honest subject of the
   * limit, and it cannot be escaped by changing networks. Three an hour: enough
   * for somebody fighting a spam folder, few enough that the address cannot be
   * buried, and well under what would put our sending domain's reputation at
   * risk — a mailbox that receives forty identical messages reports them, and
   * one report against a new domain costs more than the signup is worth.
   */
  const limit = checkRateLimit(`verify-resend:${auth.user.id}`, {
    max: 3,
    windowMs: 60 * 60 * 1000
  });
  if (!limit.allowed) return apiError("rate_limited", 429);

  // Nothing to send, and saying so is not a leak: the caller is asking about
  // their own account.
  if (await emailVerified(auth.user.id)) {
    return NextResponse.json({ ok: true, alreadyVerified: true });
  }

  const result = await sendVerificationEmail({
    userId: auth.user.id,
    email: auth.user.email,
    displayName: auth.user.displayName,
    locale: auth.user.locale
  });

  /**
   * 502 when the provider refused, because that is what happened: the request
   * was valid and an upstream service failed. A 200 with `sent: false` would
   * be swallowed by every client that only checks the status, and the member
   * would be told to check an inbox nothing was sent to.
   */
  if (!result.sent) return apiError("mail_failed", 502, { reason: result.reason });

  return NextResponse.json({ ok: true });
}
