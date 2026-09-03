import { NextResponse, type NextRequest } from "next/server";
import { requireUser, isUnauthorized, apiError } from "@/auth/guard";
import { inviteToVirtualDate, listOpenInvites } from "@/db/virtual-dates";
import { environmentsFor } from "@/lib/virtual-dates/environments";
import { tierOf } from "@/db/entitlements";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * The member's open virtual date invitations, and the environments they may
 * choose from.
 *
 * The environment list travels with the invitations so a client can render a
 * picker without a second request and without knowing the tier rules. It is
 * still only advice — `inviteToVirtualDate` re-checks the tier, because a list
 * sent to a client is a list a client can edit.
 */
export async function GET() {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  const [invites, tier] = await Promise.all([
    listOpenInvites(auth.user.id),
    tierOf(auth.user.id)
  ]);

  return NextResponse.json(
    { invites, environments: environmentsFor(tier).map((environment) => environment.id) },
    { headers: { "cache-control": "private, no-store" } }
  );
}

/** Inviting the other member of a match to meet. */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  // Tighter than messaging: an invitation interrupts the other person, and a
  // burst of them across many matches is the shape unwanted attention takes.
  const limit = checkRateLimit(`vdate-invite:${auth.user.id}`, { max: 10, windowMs: 60_000 });
  if (!limit.allowed) return apiError("rate_limited", 429);

  let body: { matchId?: unknown; environment?: unknown; scheduledFor?: unknown };
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_body", 400);
  }

  const matchId = typeof body.matchId === "string" ? body.matchId.trim() : "";
  if (!matchId) return apiError("invalid_body", 400);

  const environment = typeof body.environment === "string" ? body.environment : null;

  let scheduledFor: Date | null = null;
  if (typeof body.scheduledFor === "string") {
    scheduledFor = new Date(body.scheduledFor);
    if (Number.isNaN(scheduledFor.getTime())) return apiError("invalid_body", 400);
  }

  const result = await inviteToVirtualDate(auth.user.id, matchId, { environment, scheduledFor });

  if (!result.ok) {
    if (result.reason === "not_a_match") return apiError("not_found", 404);
    /**
     * Out of dates is a 402, not a 400.
     *
     * The request was well formed and the member is who they say they are;
     * what is missing is allowance. A client can tell that apart from a bug,
     * and the ceiling travels with it so the message can name the number.
     */
    if (result.reason === "no_dates_left") {
      return NextResponse.json({ error: result.reason, limit: result.limit }, { status: 402 });
    }
    if (result.reason === "already_pending") {
      return apiError(result.reason, 409);
    }
    return apiError(result.reason, 400);
  }

  return NextResponse.json(result, { status: 201 });
}
