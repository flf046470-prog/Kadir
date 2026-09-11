import { NextResponse } from "next/server";
import { requireUser, isUnauthorized, apiError } from "@/auth/guard";
import { undoLastPass } from "@/db/likes-received";

export const dynamic = "force-dynamic";

/** Takes back the most recent pass. PLUS and above. */
export async function POST() {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  const result = await undoLastPass(auth.user.id);
  if (!result.ok) {
    // 403 for the gate, 404 for an empty history: a member with nothing to
    // undo is not being refused, and telling them otherwise would send them to
    // the pricing page for a plan that would change nothing.
    return apiError(result.reason, result.reason === "not_entitled" ? 403 : 404);
  }

  return NextResponse.json({ ok: true, userId: result.userId });
}
