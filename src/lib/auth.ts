import "server-only";

import crypto from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "./db";

const SESSION_COOKIE = "pu_session";
const SESSION_TTL_DAYS = 7;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

export type AdminUser = { id: number; email: string };

/* ── password hashing (scrypt, no external dependency) ────────────────── */

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password.normalize("NFKC"), salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
  });
  return [
    "scrypt",
    SCRYPT_PARAMS.N,
    SCRYPT_PARAMS.r,
    SCRYPT_PARAMS.p,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, N, r, p, salt, hash] = stored.split("$");
    if (scheme !== "scrypt") return false;
    const expected = Buffer.from(hash, "base64");
    const derived = crypto.scryptSync(
      password.normalize("NFKC"),
      Buffer.from(salt, "base64"),
      expected.length,
      { N: Number(N), r: Number(r), p: Number(p) },
    );
    return crypto.timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}

/* ── bootstrap ────────────────────────────────────────────────────────── */

/**
 * Creates the first admin from environment variables when the table is empty.
 * Prefer ADMIN_PASSWORD_HASH (generate with `npm run admin:password`); a plain
 * ADMIN_PASSWORD is accepted for local development and hashed immediately.
 */
export function ensureAdminBootstrap(): void {
  const db = getDb();
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM admin_users").get() as {
    count: number;
  };
  if (count > 0) return;

  const email = process.env.ADMIN_EMAIL?.trim();
  const hash = process.env.ADMIN_PASSWORD_HASH?.trim();
  const plain = process.env.ADMIN_PASSWORD;
  if (!email || (!hash && !plain)) return;

  db.prepare("INSERT INTO admin_users (email, password_hash) VALUES (?, ?)").run(
    email,
    hash && hash.startsWith("scrypt$") ? hash : hashPassword(plain as string),
  );
}

export function adminExists(): boolean {
  const { count } = getDb()
    .prepare("SELECT COUNT(*) AS count FROM admin_users")
    .get() as { count: number };
  return count > 0;
}

/* ── sessions ─────────────────────────────────────────────────────────── */

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: number): Promise<void> {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  const hdrs = await headers();

  getDb()
    .prepare(
      "INSERT INTO admin_sessions (token_hash, user_id, expires_at, user_agent) VALUES (?, ?, ?, ?)",
    )
    .run(hashToken(token), userId, expires.toISOString(), hdrs.get("user-agent")?.slice(0, 255) ?? "");

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    getDb().prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(hashToken(token));
  }
  store.delete(SESSION_COOKIE);
}

export async function getCurrentAdmin(): Promise<AdminUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const db = getDb();
  db.prepare("DELETE FROM admin_sessions WHERE expires_at < datetime('now')").run();
  const row = db
    .prepare(
      `SELECT u.id AS id, u.email AS email
       FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > datetime('now')`,
    )
    .get(hashToken(token)) as AdminUser | undefined;
  return row ?? null;
}

export async function requireAdmin(): Promise<AdminUser> {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  return admin;
}

export function authenticate(email: string, password: string): AdminUser | null {
  ensureAdminBootstrap();
  const row = getDb()
    .prepare("SELECT id, email, password_hash FROM admin_users WHERE email = ?")
    .get(email.trim()) as { id: number; email: string; password_hash: string } | undefined;

  // Always run a hash comparison so a missing account and a wrong password
  // take a comparable amount of time.
  const stored = row?.password_hash ?? hashPassword(crypto.randomBytes(16).toString("hex"));
  const ok = verifyPassword(password, stored);
  if (!row || !ok) return null;

  getDb()
    .prepare("UPDATE admin_users SET last_login_at = datetime('now') WHERE id = ?")
    .run(row.id);
  return { id: row.id, email: row.email };
}

export function changePassword(userId: number, current: string, next: string): boolean {
  const db = getDb();
  const row = db
    .prepare("SELECT password_hash FROM admin_users WHERE id = ?")
    .get(userId) as { password_hash: string } | undefined;
  if (!row || !verifyPassword(current, row.password_hash)) return false;
  db.prepare("UPDATE admin_users SET password_hash = ? WHERE id = ?").run(
    hashPassword(next),
    userId,
  );
  db.prepare("DELETE FROM admin_sessions WHERE user_id = ?").run(userId);
  return true;
}
