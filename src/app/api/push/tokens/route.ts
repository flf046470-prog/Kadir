import { NextResponse, type NextRequest } from "next/server";
import { requireUser, isUnauthorized, apiError } from "@/auth/guard";
import { isPushPlatform, registerPushToken, unregisterPushToken } from "@/db/push-tokens";
import { checkRateLimit } from "@/lib/rate-limit";

/** Tokens are opaque provider strings; this bounds what reaches a column. */
const MAX_TOKEN_LENGTH = 512;

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  // Registration repeats on every launch, which is intended — it refreshes
  // `lastSeenAt` — but a launch loop should not be able to hammer the table.
  const limit = checkRateLimit(`push:${auth.user.id}`, { max: 30, windowMs: 60_000 });
  if (!limit.allowed) return apiError("rate_limited", 429);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_body", 400);
  }

  const { token, platform } = body as Record<string, unknown>;

  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return apiError("invalid_token", 400);
  }
  if (typeof platform !== "string" || !isPushPlatform(platform)) {
    return apiError("invalid_platform", 400);
  }

  await registerPushToken(auth.user.id, token, platform);

  return new NextResponse(null, { status: 204 });
}

/**
 * Retires a device — on sign-out, or when the member turns notifications off.
 *
 * 204 either way. Whether that token was registered is not something a caller
 * needs told, and answering differently would let one probe the table.
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_body", 400);
  }

  const token = (body as Record<string, unknown>).token;
  if (typeof token !== "string") return apiError("invalid_token", 400);

  await unregisterPushToken(auth.user.id, token);

  return new NextResponse(null, { status: 204 });
}
