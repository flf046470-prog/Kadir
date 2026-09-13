import { NextResponse, type NextRequest } from "next/server";
import { requireUser, isUnauthorized, apiError } from "@/auth/guard";
import { cancelInvite, respondToInvite } from "@/db/virtual-dates";
import { checkRateLimit } from "@/lib/rate-limit";
import { featureEnabled } from "@/lib/flags/server";

export const dynamic = "force-dynamic";

/** Accepting or declining an invitation addressed to you. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ inviteId: string }> }
) {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  const limit = checkRateLimit(`vdate-respond:${auth.user.id}`, { max: 30, windowMs: 60_000 });
  if (!limit.allowed) return apiError("rate_limited", 429);

  let body: { response?: unknown };
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_body", 400);
  }

  const response = body.response;
  if (response !== "accept" && response !== "decline") return apiError("invalid_body", 400);

  /**
   * With the feature off, an invitation can still be turned down but not taken
   * up.
   *
   * Accepting is the half that creates something: it spends both allowances and
   * agrees to meet somewhere that, while this flag is off, does not exist.
   * Declining only closes a row. Blocking both would mean a kill switch flipped
   * during an incident leaves people holding invitations they cannot answer for
   * a week, which is a worse outcome than the one the switch was thrown for.
   */
  if (response === "accept" && !featureEnabled("virtual_dates", auth.user.id)) {
    return apiError("not_found", 404);
  }

  const { inviteId } = await params;
  const result = await respondToInvite(auth.user.id, inviteId, response);

  if (!result.ok) {
    if (result.reason === "not_found") return apiError("not_found", 404);
    if (result.reason === "not_yours") return apiError(result.reason, 403);
    /**
     * Either side being out of dates blocks the room, and the client is told
     * which — "you have no dates left this month" and "they have none left"
     * lead to completely different next steps.
     */
    if (result.reason === "no_dates_left") {
      return NextResponse.json(
        { error: result.reason, who: result.who, limit: result.limit },
        { status: 402 }
      );
    }
    return apiError(result.reason, 409);
  }

  return NextResponse.json(result);
}

/** Withdrawing an invitation you sent. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ inviteId: string }> }
) {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  const { inviteId } = await params;
  const result = await cancelInvite(auth.user.id, inviteId);

  if (!result.ok) {
    if (result.reason === "not_found") return apiError("not_found", 404);
    return apiError(result.reason, 409);
  }

  return NextResponse.json(result);
}
