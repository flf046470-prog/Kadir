import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, resolveSession, type SessionUser } from "./session";
import { emailVerificationRequired, emailVerified } from "./email-verification";

/**
 * Authorization helpers for route handlers and server components.
 *
 * Every non-public route calls `requireUser`. It is deliberately the *only*
 * way to obtain a user in a handler, so "did this route check auth?" is
 * answerable by grepping for it rather than by reading each handler's logic.
 */

export async function currentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  return resolveSession(store.get(SESSION_COOKIE)?.value);
}

export type Authorized = { user: SessionUser };
export type Unauthorized = { response: NextResponse };

/**
 * Returns the signed-in member, or a 401 response to return directly.
 *
 * The union type means a handler cannot accidentally proceed with a null user:
 * it has to narrow on `"response" in result` before it can reach `.user`.
 */
export async function requireUser(): Promise<Authorized | Unauthorized> {
  const user = await currentUser();
  if (!user) {
    return {
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 })
    };
  }
  return { user };
}

/**
 * The signed-in member, but only once they have proved they own their address.
 *
 * Used by the handlers that reach another person — a like, a message, an
 * invitation. Not by the ones that only touch the member's own account, so
 * somebody whose verification mail went to spam can still sign in, see their
 * profile and press resend rather than finding a product that refuses to load.
 *
 * Returns 403 rather than 401: the session is perfectly good, and answering
 * 401 would make the client discard a valid cookie and show a login form that
 * cannot fix anything.
 *
 * A no-op where `REQUIRE_EMAIL_VERIFICATION` is unset, which is every
 * development and test environment. The flag is read per call rather than at
 * import, so a test can turn it on for one case.
 */
export async function requireVerifiedUser(): Promise<Authorized | Unauthorized> {
  const result = await requireUser();
  if (isUnauthorized(result)) return result;
  if (!emailVerificationRequired()) return result;
  if (await emailVerified(result.user.id)) return result;

  return { response: apiError("email_unverified", 403) };
}

export function isUnauthorized(result: Authorized | Unauthorized): result is Unauthorized {
  return "response" in result;
}

/** Uniform error body, so handlers don't invent their own shapes. */
export function apiError(code: string, status: number, details?: unknown) {
  return NextResponse.json({ error: code, ...(details ? { details } : {}) }, { status });
}
