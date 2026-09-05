import { NextResponse, type NextRequest } from "next/server";
import { requireUser, isUnauthorized, apiError } from "@/auth/guard";
import { recordLike, type LikeKind } from "@/db/interactions";
import { passReasons, type PassReasonId } from "@/lib/domain/taxonomies";
import { checkRateLimit } from "@/lib/rate-limit";
import { isUuid } from "@/lib/uuid";

const VALID_KINDS: LikeKind[] = ["like", "pass", "super_like"];

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  // Bounds automated swiping without getting in a real member's way.
  const limit = checkRateLimit(`likes:${auth.user.id}`, { max: 200, windowMs: 60_000 });
  if (!limit.allowed) return apiError("rate_limited", 429);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_body", 400);
  }

  const input = body as Record<string, unknown>;
  const toUserId = input.toUserId;
  const kind = input.kind;

  if (typeof toUserId !== "string" || !isUuid(toUserId) || typeof kind !== "string") {
    return apiError("invalid_body", 400);
  }
  if (!VALID_KINDS.includes(kind as LikeKind)) return apiError("invalid_kind", 400);
  if (toUserId === auth.user.id) return apiError("cannot_like_self", 400);

  const passReason =
    typeof input.passReason === "string" && passReasons.includes(input.passReason as PassReasonId)
      ? (input.passReason as PassReasonId)
      : undefined;

  const result = await recordLike(auth.user.id, toUserId, kind as LikeKind, passReason);

  /**
   * The daily allowance is spent inside `recordLike`, not read here.
   *
   * Reading it here and writing there was a check-then-act over two
   * connections: two hundred parallel requests — which the rate limit above
   * permits — all read the same "one left" and all recorded a like, so the cap
   * that PLUS is sold to remove could be stepped over by anyone willing to open
   * two hundred sockets. The count and the insert are now one transaction.
   *
   * 402 rather than 429 — this is not a rate limit that clears in a minute, it
   * is a tier boundary, and the two want different handling in the client.
   */
  if (result.refusal) {
    return NextResponse.json(
      {
        error: result.refusal.reason,
        used: result.refusal.used,
        limit: result.refusal.limit
      },
      { status: 402 }
    );
  }

  return NextResponse.json({ matched: result.matched, matchId: result.matchId });
}
