import { NextResponse, type NextRequest } from "next/server";
import { requireModerator, isDenied } from "@/auth/moderator";
import { photoQueue, actOnPhoto } from "@/db/moderation";

export async function GET() {
  const auth = await requireModerator();
  if (isDenied(auth)) return auth.response;

  return NextResponse.json({ items: await photoQueue() });
}

export async function POST(request: NextRequest) {
  const auth = await requireModerator();
  if (isDenied(auth)) return auth.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.photoId !== "string" || typeof body.action !== "string") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (body.action !== "approve" && body.action !== "reject") {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }

  const result = await actOnPhoto({
    moderatorId: auth.moderator.id,
    targetType: "photo",
    targetId: body.photoId,
    action: body.action,
    note: typeof body.note === "string" ? body.note : undefined
  });

  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 });
  return NextResponse.json({ ok: true });
}
