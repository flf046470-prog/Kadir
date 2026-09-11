import { NextResponse, type NextRequest } from "next/server";
import { requireUser, isUnauthorized, apiError } from "@/auth/guard";
import { blockUser } from "@/db/interactions";
import { isUuid } from "@/lib/uuid";

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_body", 400);
  }

  const input = body as Record<string, unknown>;
  if (typeof input.userId !== "string" || !isUuid(input.userId)) {
    return apiError("invalid_body", 400);
  }
  if (input.userId === auth.user.id) return apiError("cannot_block_self", 400);

  await blockUser(auth.user.id, input.userId);

  return NextResponse.json({ ok: true });
}
