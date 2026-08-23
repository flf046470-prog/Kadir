import { NextResponse, type NextRequest } from "next/server";
import { requireUser, isUnauthorized, apiError } from "@/auth/guard";
import { recordLike, type LikeKind } from "@/db/interactions";
import { passReasons, type PassReasonId } from "@/lib/domain/taxonomies";
import { likeAllowance } from "@/db/entitlements";
import { checkRateLimit } from "@/lib/rate-limit";

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

  if (typeof toUserId !== "string" || typeof kind !== "string") {
    return apiError("invalid_body", 400);
  }
  if (!VALID_KINDS.includes(kind as LikeKind)) return apiError("invalid_kind", 400);
  if (toUserId === auth.user.id) return apiError("cannot_like_self", 400);

  const passReason =
    typeof input.passReason === "string" && passReasons.includes(input.passReason as PassReasonId)
      ? (input.passReason as PassReasonId)
      : undefined;

  /**
   * The daily allowance applies to likes, never to passes.
   *
   * Checked after validation and only for the kinds it governs: charging
   * someone an allowance for saying "no" would push them towards liking
   * everything, which is exactly the behaviour the limit exists to slow.
   *
   * 402 rather than 429 — this is not a rate limit that clears in a minute,
   * it is a tier boundary, and the two want different handling in the client.
   */
  if (kind !== "pass") {
    const allowance = await likeAllowance(auth.user.id);
    if (!allowance.allowed) {
      return NextResponse.json(
        { error: "like_limit_reached", used: allowance.used, limit: allowance.limit },
        { status: 402 }
      );
    }
  }

  const result = await recordLike(auth.user.id, toUserId, kind as LikeKind, passReason);

  return NextResponse.json(result);
}
