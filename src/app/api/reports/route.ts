import { NextResponse, type NextRequest } from "next/server";
import { requireUser, isUnauthorized, apiError } from "@/auth/guard";
import { createReport } from "@/db/messaging";

const VALID_REASONS = new Set([
  "harassment",
  "scam_or_fraud",
  "fake_profile",
  "inappropriate_content",
  "underage",
  "other"
]);

/**
 * Abuse reports. Deliberately unrestricted by rate limiting: making it harder
 * to report someone is the wrong failure mode, and duplicate reports are
 * cheaper to triage than a missed one.
 */
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
  if (typeof input.reportedId !== "string" || typeof input.reason !== "string") {
    return apiError("invalid_body", 400);
  }
  if (!VALID_REASONS.has(input.reason)) return apiError("invalid_reason", 400);
  if (input.reportedId === auth.user.id) return apiError("cannot_report_self", 400);

  const id = await createReport({
    reporterId: auth.user.id,
    reportedId: input.reportedId,
    messageId: typeof input.messageId === "string" ? input.messageId : undefined,
    reason: input.reason,
    details: typeof input.details === "string" ? input.details.slice(0, 1000) : undefined
  });

  return NextResponse.json({ ok: true, reportId: id }, { status: 201 });
}
