import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireUser, isUnauthorized } from "@/auth/guard";
import { deleteAccount } from "@/auth/accounts";
import { SESSION_COOKIE } from "@/auth/session";

export async function GET() {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  return NextResponse.json({
    id: auth.user.id,
    email: auth.user.email,
    displayName: auth.user.displayName,
    locale: auth.user.locale
  });
}

/**
 * Account deletion. Removing the `users` row cascades to every table holding
 * this member's data — profile, attributes, visibility, quiz answers, travel
 * plans, likes, matches, blocks, weights, suggestions, and sessions.
 */
export async function DELETE() {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  await deleteAccount(auth.user.id);

  const store = await cookies();
  store.delete(SESSION_COOKIE);

  return NextResponse.json({ ok: true });
}
