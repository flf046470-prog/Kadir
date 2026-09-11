import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { authenticate, normalizeEmail } from "@/auth/accounts";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/auth/session";
import { apiError } from "@/auth/guard";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_body", 400);
  }

  const input = body as Record<string, unknown>;
  if (typeof input.email !== "string" || typeof input.password !== "string") {
    return apiError("invalid_body", 400);
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  // Limited per IP *and* per account: the first stops one host stuffing many
  // accounts, the second stops a distributed attack on one account.
  const byIp = checkRateLimit(`login:ip:${ip}`, { max: 10, windowMs: 60_000 });
  /**
   * Keyed with the *same* normaliser the lookup uses.
   *
   * `toLowerCase()` alone left whitespace in the key while `authenticate`
   * trims it, so " victim@example.com" and "victim@example.com " were separate
   * buckets pointing at one account — a fresh five attempts per variant, and
   * unlimited variants. The per-account limit was decoration.
   */
  const byAccount = checkRateLimit(`login:acct:${normalizeEmail(input.email)}`, {
    max: 5,
    windowMs: 300_000
  });

  if (!byIp.allowed || !byAccount.allowed) return apiError("rate_limited", 429);

  const result = await authenticate(input.email, input.password);
  if (!result) {
    // One message for every failure — wrong password, unknown email, and
    // deleted account must be indistinguishable to a caller.
    return apiError("invalid_credentials", 401);
  }

  const session = await createSession(result.userId);
  const store = await cookies();
  store.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));

  return NextResponse.json({ ok: true });
}
