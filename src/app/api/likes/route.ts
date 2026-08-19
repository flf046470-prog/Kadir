import { NextResponse, type NextRequest } from "next/server";
import { requireUser, isUnauthorized, apiError } from "@/auth/guard";
import { recordLike, type LikeKind } from "@/db/interactions";
import { passReasons, type PassReasonId } from "@/lib/domain/taxonomies";
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

  const result = await recordLike(auth.user.id, toUserId, kind as LikeKind, passReason);

  return NextResponse.json(result);
}
