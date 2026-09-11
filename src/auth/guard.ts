import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, resolveSession, type SessionUser } from "./session";

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

export function isUnauthorized(result: Authorized | Unauthorized): result is Unauthorized {
  return "response" in result;
}

/** Uniform error body, so handlers don't invent their own shapes. */
export function apiError(code: string, status: number, details?: unknown) {
  return NextResponse.json({ error: code, ...(details ? { details } : {}) }, { status });
}
