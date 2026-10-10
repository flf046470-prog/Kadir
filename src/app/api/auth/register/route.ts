import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { register } from "@/auth/accounts";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/auth/session";
import { apiError } from "@/auth/guard";
import { checkRateLimit } from "@/lib/rate-limit";
import { attachReferral } from "@/db/referral";
import { signupsOpen } from "@/lib/site";
import { sendVerificationEmail } from "@/auth/email-verification";

export async function POST(request: NextRequest) {
  /**
   * Checked before anything else, and answered 503 rather than 403.
   *
   * The deployment is not accepting registrations yet; the caller has done
   * nothing wrong and there is nothing they can change to succeed. This is the
   * server-side half of the switch — the form is hidden too, but a hidden form
   * is a UI decision and this is the one that actually holds.
   */
  if (!signupsOpen()) return apiError("signups_closed", 503);

  // Registration is the cheapest endpoint to abuse for account farming.
  const limit = checkRateLimit(`register:${clientKey(request)}`, { max: 5, windowMs: 60_000 });
  if (!limit.allowed) return apiError("rate_limited", 429);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_body", 400);
  }

  const input = body as Record<string, unknown>;
  const required = ["email", "password", "displayName", "birthdate", "countryId"];
  if (required.some((field) => typeof input[field] !== "string")) {
    return apiError("invalid_body", 400);
  }

  const result = await register({
    email: input.email as string,
    password: input.password as string,
    displayName: input.displayName as string,
    birthdate: input.birthdate as string,
    countryId: input.countryId as string,
    locale: typeof input.locale === "string" ? input.locale : undefined
  });

  if (!result.ok) {
    return NextResponse.json({ error: "validation_failed", errors: result.errors }, { status: 400 });
  }

  // A referral is credited after the account exists, and never at its expense:
  // a bad code, a duplicate, or a database hiccup here must not cost someone
  // the account they just created. The outcome is not reported back either —
  // whether a code was valid is the referrer's business, not a signup error.
  if (typeof input.referralCode === "string" && input.referralCode.trim() !== "") {
    try {
      await attachReferral(result.userId, input.referralCode);
    } catch (error) {
      console.error("Referral attach failed for a new member", error);
    }
  }

  const session = await createSession(result.userId);
  const store = await cookies();
  store.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));

  /**
   * The verification mail, sent inline and reported back.
   *
   * Inline rather than queued because there is no queue, and a member staring
   * at a "check your inbox" screen is the worst audience for a job that runs
   * eventually. It costs one HTTPS round trip with a ten-second ceiling.
   *
   * Wrapped like the referral above, and for the same reason: a mail provider
   * having a bad minute must not cost somebody the account they just created,
   * which already exists and is already signed in by this point. What differs
   * is that the outcome is *returned*. A new member who was not mailed needs to
   * know that now — the screen can offer the resend button instead of telling
   * them to wait for something that is not coming — and silently claiming an
   * email was sent is exactly the failure that makes verification feel broken
   * rather than slow.
   */
  let verificationEmailSent = false;
  try {
    const mail = await sendVerificationEmail({
      userId: result.userId,
      email: input.email as string,
      displayName: input.displayName as string,
      locale: typeof input.locale === "string" ? input.locale : "en"
    });
    verificationEmailSent = mail.sent;
    if (!mail.sent) {
      console.error(`Verification mail not sent for a new member: ${mail.reason}`);
    }
  } catch (error) {
    console.error("Verification mail threw for a new member", error);
  }

  return NextResponse.json({ ok: true, verificationEmailSent }, { status: 201 });
}

/**
 * Rate-limit key. Behind a proxy the client IP is in `x-forwarded-for`; the
 * first entry is the original client. This is a best-effort throttle, not an
 * identity check — a determined attacker can rotate IPs, which is why
 * qualification and verification gate anything that actually costs us.
 */
function clientKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}
