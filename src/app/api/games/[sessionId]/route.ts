import { NextResponse, type NextRequest } from "next/server";
import { requireUser, isUnauthorized, apiError } from "@/auth/guard";
import { answerRound, loadSessionFor, setSessionStatus, viewSession } from "@/db/games";
import type { GameStatus } from "@/lib/games/session";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * One game session.
 *
 * GET returns the session as this member is allowed to see it; PATCH moves its
 * status; POST records an answer. Membership is resolved from the match on
 * every call, so none of these trust an id supplied by the caller.
 */

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  const { sessionId } = await params;
  const access = await loadSessionFor(sessionId, auth.user.id);
  if (!access) return apiError("not_found", 404);

  return NextResponse.json(
    { session: viewSession(access) },
    { headers: { "cache-control": "private, no-store" } }
  );
}

/** Accept, decline, or end. The engine decides which moves are legal. */
const MEMBER_TRANSITIONS: GameStatus[] = ["active", "declined", "ended"];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  const { sessionId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_body", 400);
  }

  const status = (body as Record<string, unknown>).status;
  if (typeof status !== "string" || !MEMBER_TRANSITIONS.includes(status as GameStatus)) {
    return apiError("invalid_status", 400);
  }

  const result = await setSessionStatus(sessionId, auth.user.id, status as GameStatus);
  if (!result.ok) return apiError(result.reason, result.reason === "not_found" ? 404 : 409);

  return NextResponse.json({ ok: true });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  const limit = checkRateLimit(`game-answer:${auth.user.id}`, { max: 120, windowMs: 60_000 });
  if (!limit.allowed) return apiError("rate_limited", 429);

  const { sessionId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_body", 400);
  }

  const input = body as Record<string, unknown>;
  if (typeof input.roundIndex !== "number" || typeof input.value !== "string") {
    return apiError("invalid_body", 400);
  }

  const result = await answerRound(sessionId, auth.user.id, input.roundIndex, input.value);
  if (!result.ok) return apiError(result.reason, result.reason === "not_found" ? 404 : 409);

  return NextResponse.json({ ok: true, status: result.status });
}
