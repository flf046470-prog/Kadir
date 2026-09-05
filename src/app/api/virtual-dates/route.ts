import { NextResponse, type NextRequest } from "next/server";
import { requireUser, isUnauthorized, apiError } from "@/auth/guard";
import { inviteToVirtualDate, listOpenInvites, listUpcomingDates } from "@/db/virtual-dates";
import { environmentsFor } from "@/lib/virtual-dates/environments";
import { tierOf, virtualDateAllowance } from "@/db/entitlements";
import { checkRateLimit } from "@/lib/rate-limit";
import { featureEnabled } from "@/lib/flags/server";

export const dynamic = "force-dynamic";

/**
 * The member's open virtual date invitations, the environments they may choose
 * from, and how much of their monthly allowance is left.
 *
 * The environment list travels with the invitations so a client can render a
 * picker without a second request and without knowing the tier rules. It is
 * still only advice — `inviteToVirtualDate` re-checks the tier, because a list
 * sent to a client is a list a client can edit.
 *
 * The allowance travels with them for the same reason it is shown at all: a
 * member should know they have two dates left *before* they spend one, not
 * after a 402. Only ever their own — the other side's remaining allowance is
 * their business, and the invitation reveals it soon enough by being refused.
 */
export async function GET() {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  /**
   * Off answers rather than fails, the way translation does.
   *
   * A screen that asks "are virtual dates available to me?" gets `false` and
   * renders nothing, which is a different thing from a 404 it has to treat as
   * an error. The write paths below are the ones that refuse outright.
   */
  if (!featureEnabled("virtual_dates", auth.user.id)) {
    return NextResponse.json(
      { available: false, invites: [], upcoming: [], environments: [], allowance: null },
      { headers: { "cache-control": "private, no-store" } }
    );
  }

  const [invites, upcoming, tier, allowance] = await Promise.all([
    listOpenInvites(auth.user.id),
    // What was said yes to. Without it the member who sent an invitation sees
    // it disappear on acceptance and learns nothing from the disappearance.
    listUpcomingDates(auth.user.id),
    tierOf(auth.user.id),
    virtualDateAllowance(auth.user.id)
  ]);

  return NextResponse.json(
    {
      available: true,
      invites,
      upcoming,
      environments: environmentsFor(tier).map((environment) => environment.id),
      allowance: { used: allowance.used, limit: allowance.limit }
    },
    { headers: { "cache-control": "private, no-store" } }
  );
}

/** Inviting the other member of a match to meet. */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  /**
   * A feature that is off for this member does not exist for them, so this is a
   * 404 rather than the GET's polite `available: false`. Refusing here is what
   * makes the gate real: hiding the button would leave the route open to
   * anything that can send a POST, and accepting an invitation spends a
   * member's monthly allowance on a date that has nowhere to happen.
   */
  if (!featureEnabled("virtual_dates", auth.user.id)) return apiError("not_found", 404);

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

  const result = await inviteToVirtualDate(auth.user.id, matchId, {
    environment,
    scheduledFor,
    /**
     * The rollout buckets per member, so "may this member send" and "may that
     * member receive" are different questions. Asked here rather than in the
     * db module, which keeps knowing nothing about flags.
     */
    canReceive: (partnerId) => featureEnabled("virtual_dates", partnerId)
  });

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
