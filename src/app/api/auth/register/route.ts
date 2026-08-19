import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { register } from "@/auth/accounts";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/auth/session";
import { apiError } from "@/auth/guard";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
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

  const session = await createSession(result.userId);
  const store = await cookies();
  store.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));

  return NextResponse.json({ ok: true }, { status: 201 });
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
