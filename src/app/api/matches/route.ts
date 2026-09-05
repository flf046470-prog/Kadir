import { NextResponse } from "next/server";
import { requireUser, isUnauthorized } from "@/auth/guard";
import { listConversations } from "@/db/messaging";

export async function GET() {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  return NextResponse.json({ conversations: await listConversations(auth.user.id) });
}
