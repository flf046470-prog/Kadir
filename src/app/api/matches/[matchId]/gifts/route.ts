import { NextResponse, type NextRequest } from "next/server";
import { requireUser, isUnauthorized, apiError } from "@/auth/guard";
import { giftAllowance, sendGift } from "@/db/gifts";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Gifts on one conversation.
 *
 * There is no GET — gifts ride along with the message poll, because they are
 * part of the same timeline and a second poll would double the conversation's
 * request rate to fetch something that changes less often than the messages do.
 */

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  const limit = checkRateLimit(`gifts:${auth.user.id}`, { max: 20, windowMs: 60_000 });
  if (!limit.allowed) return apiError("rate_limited", 429);

  const { matchId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_body", 400);
  }

  const giftId = (body as Record<string, unknown>).giftId;
  if (typeof giftId !== "string") return apiError("invalid_body", 400);

  const result = await sendGift(auth.user.id, matchId, giftId);

  if (!result.ok) {
    if (result.reason === "not_a_match") return apiError("not_found", 404);
    // 402 rather than 429: a tier boundary, not a rate limit that clears in a
    // minute, and the client shows a different thing for each.
    if (result.reason === "allowance_reached") {
      const allowance = await giftAllowance(auth.user.id);
      return NextResponse.json(
        { error: "allowance_reached", used: allowance.used, limit: allowance.limit },
        { status: 402 }
      );
    }
    return apiError(result.reason, 400);
  }

  return NextResponse.json({ ok: true, id: result.giftRowId }, { status: 201 });
}
