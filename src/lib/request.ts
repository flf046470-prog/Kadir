import "server-only";

import crypto from "node:crypto";
import { headers } from "next/headers";

const SECRET = process.env.SESSION_SECRET ?? "patagonia-underground-dev-secret";

/**
 * Callers are identified by a salted hash of their IP so that rate limiting
 * works without keeping raw addresses anywhere.
 */
export async function getClientKey(): Promise<string> {
  const hdrs = await headers();
  const forwarded = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || hdrs.get("x-real-ip") || "unknown";
  return crypto.createHmac("sha256", SECRET).update(ip).digest("hex").slice(0, 32);
}
