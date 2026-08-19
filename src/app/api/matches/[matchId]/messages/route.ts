import { NextResponse, type NextRequest } from "next/server";
import { requireUser, isUnauthorized, apiError } from "@/auth/guard";
import { listMessages, markRead, sendMessage } from "@/db/messaging";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Conversation messages.
 *
 * A member who is not part of the match gets 404, not 403 — telling a stranger
 * "this conversation exists but isn't yours" confirms a match they have no
 * business knowing about.
 */

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  const { matchId } = await params;
  const messages = await listMessages(auth.user.id, matchId);
  if (messages === null) return apiError("not_found", 404);

  await markRead(auth.user.id, matchId);

  return NextResponse.json({ messages });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  const limit = checkRateLimit(`messages:${auth.user.id}`, { max: 60, windowMs: 60_000 });
  if (!limit.allowed) return apiError("rate_limited", 429);

  const { matchId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_body", 400);
  }

  const input = body as Record<string, unknown>;
  if (typeof input.body !== "string") return apiError("invalid_body", 400);

  const result = await sendMessage(
    auth.user.id,
    matchId,
    input.body,
    typeof input.language === "string" ? input.language : undefined
  );

  if (!result.ok) {
    if (result.reason === "not_a_match") return apiError("not_found", 404);
    return apiError(result.reason, 400);
  }

  return NextResponse.json({ ok: true, messageId: result.messageId }, { status: 201 });
}
