import { NextResponse, type NextRequest } from "next/server";
import { requireModerator, isDenied } from "@/auth/moderator";
import { reportQueue, actOnReport, queueCounts } from "@/db/moderation";

export async function GET() {
  const auth = await requireModerator();
  if (isDenied(auth)) return auth.response;

  const [items, counts] = await Promise.all([reportQueue(), queueCounts()]);
  return NextResponse.json({ items, counts });
}

export async function POST(request: NextRequest) {
  const auth = await requireModerator();
  if (isDenied(auth)) return auth.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.reportId !== "string" || typeof body.action !== "string") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const allowed = ["dismiss", "suspend", "approve"];
  if (!allowed.includes(body.action)) {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }

  const result = await actOnReport({
    moderatorId: auth.moderator.id,
    targetType: "report",
    targetId: body.reportId,
    action: body.action as "dismiss" | "suspend" | "approve",
    note: typeof body.note === "string" ? body.note : undefined
  });

  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 });
  return NextResponse.json({ ok: true });
}
