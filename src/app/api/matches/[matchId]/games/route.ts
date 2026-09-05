import { NextResponse, type NextRequest } from "next/server";
import { requireUser, isUnauthorized, apiError } from "@/auth/guard";
import { inviteToGame, sessionsForMatch } from "@/db/games";
import { gameIds, type GameId } from "@/lib/games/prompts";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Games on one match.
 *
 * A member who is not part of the match gets 404, not 403 — the same rule the
 * conversation follows, and for the same reason: telling a stranger "this
 * exists but isn't yours" confirms a match they have no business knowing about.
 */

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  const { matchId } = await params;
  // Redaction happens in the repository, so an unrevealed answer is absent
  // from this payload rather than merely hidden by the UI.
  const sessions = await sessionsForMatch(matchId, auth.user.id);

  return NextResponse.json({ sessions }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  const limit = checkRateLimit(`games:${auth.user.id}`, { max: 20, windowMs: 60_000 });
  if (!limit.allowed) return apiError("rate_limited", 429);

  const { matchId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_body", 400);
  }

  const game = (body as Record<string, unknown>).game;
  if (typeof game !== "string" || !(gameIds as string[]).includes(game)) {
    return apiError("invalid_game", 400);
  }

  const result = await inviteToGame(auth.user.id, matchId, game as GameId);
  if (!result.ok) {
    return apiError(result.reason, result.reason === "not_matched" ? 404 : 409);
  }

  return NextResponse.json({ sessionId: result.sessionId }, { status: 201 });
}
