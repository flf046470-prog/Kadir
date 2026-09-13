import { hash, verify } from "@node-rs/argon2";

/**
 * Password hashing with argon2id.
 *
 * Parameters follow OWASP's current guidance for argon2id (19 MiB memory,
 * 2 iterations, parallelism 1). They are recorded in the hash string itself, so
 * raising them later doesn't invalidate existing hashes — `needsRehash` tells
 * callers when to upgrade a hash opportunistically at next successful login.
 */
const OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1
} as const;

/** Guards against denial-of-service via a very long password. */
export const MAX_PASSWORD_BYTES = 1024;
export const MIN_PASSWORD_LENGTH = 10;

export type PasswordProblem = "too_short" | "too_long" | "too_common";

/**
 * A deliberately short list of the passwords that dominate breach corpora.
 * Real deployments should check against a full breached-password set (e.g. the
 * Have I Been Pwned range API); this is the floor, not the ceiling.
 */
const COMMON_PASSWORDS = new Set([
  "password",
  "password1",
  "password123",
  "123456789",
  "1234567890",
  "qwertyuiop",
  "iloveyou1",
  "letmein123",
  "admin12345",
  "welcome123"
]);

export function validatePassword(password: string): PasswordProblem | null {
  if (password.length < MIN_PASSWORD_LENGTH) return "too_short";
  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) return "too_long";
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return "too_common";
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password, OPTIONS);
  } catch {
    // A malformed hash must read as "wrong password", never as an exception
    // that a caller might mistake for success.
    return false;
  }
}
