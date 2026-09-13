import { NextResponse, type NextRequest } from "next/server";
import { requireUser, isUnauthorized, apiError } from "@/auth/guard";
import { linkPlatformAccount, unlinkPlatformAccount } from "@/db/platform-accounts";
import { isPlatform, platformLinkingEnabled, platformVerifier } from "@/lib/platforms/verifier";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Linking this account to a platform identity.
 *
 * The body carries a *ticket* the platform issued, never an id. A client
 * claiming to be Steam user 76561… proves nothing — that string is public and
 * typeable — so the verifier turns the ticket into an identity and only the
 * verifier's answer is stored.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
) {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  const { platform } = await params;
  if (!isPlatform(platform)) return apiError("unknown_platform", 400);

  // Linking is where an attacker would grind tickets, so it is limited harder
  // than reading is.
  const limit = checkRateLimit(`platform-link:${auth.user.id}`, { max: 10, windowMs: 60_000 });
  if (!limit.allowed) return apiError("rate_limited", 429);

  /**
   * No driver is configured for any platform yet, so this answers "not open"
   * rather than accepting an unverified claim. Said plainly, in the shape the
   * purchase route uses, so a client can tell "not available here" from "your
   * ticket was refused".
   */
  if (!platformLinkingEnabled(platform)) {
    return NextResponse.json({ available: false, platform }, { status: 503 });
  }

  let body: { ticket?: unknown };
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_body", 400);
  }

  const ticket = typeof body.ticket === "string" ? body.ticket.trim() : "";
  if (!ticket) return apiError("invalid_body", 400);

  let identity;
  try {
    identity = await platformVerifier(platform).verify(ticket);
  } catch {
    // The platform could not be reached. Worth retrying, unlike a refusal.
    return apiError("verification_unavailable", 502);
  }

  if (!identity) return apiError("invalid_ticket", 401);

  const result = await linkPlatformAccount(auth.user.id, identity);
  if (!result.ok) return apiError(result.reason, 409);

  return NextResponse.json({ ok: true, platform });
}

/** Unlinking. Does not touch the subscription — that was paid for. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
) {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  const { platform } = await params;
  if (!isPlatform(platform)) return apiError("unknown_platform", 400);

  const result = await unlinkPlatformAccount(auth.user.id, platform);
  if (!result.ok) return apiError("not_found", 404);

  return NextResponse.json({ ok: true, platform });
}
