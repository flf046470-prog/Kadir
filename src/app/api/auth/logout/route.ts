import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { destroySession, SESSION_COOKIE } from "@/auth/session";

export async function POST() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  // Revoke server-side first: clearing only the cookie would leave a usable
  // session for anyone who captured the token.
  await destroySession(token);
  store.delete(SESSION_COOKIE);

  return NextResponse.json({ ok: true });
}
