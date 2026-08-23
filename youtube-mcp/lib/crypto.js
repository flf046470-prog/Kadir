/**
 * Stateless sealed tokens.
 *
 * The server keeps no database. Client registrations, authorization codes,
 * access tokens and refresh tokens are all AES-256-GCM sealed blobs that only
 * this deployment can open. The token *type* is bound as additional
 * authenticated data, so a refresh token can never be replayed as an access
 * token (or vice versa).
 */

import { createHmac, createCipheriv, createDecipheriv, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { tokenSecret } from './config.js';

const PREFIX = 'ymcp1';
const IV_LEN = 12;
const TAG_LEN = 16;

let cachedKey = null;
let cachedFrom = null;

function key() {
  const secret = tokenSecret();
  if (cachedKey && cachedFrom === secret) return cachedKey;
  // Domain-separated derivation so the raw env value is never used directly.
  cachedKey = createHmac('sha256', 'ymcp-seal-v1').update(secret).digest();
  cachedFrom = secret;
  return cachedKey;
}

export function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

export function seal(type, payload, ttlSeconds) {
  const body = JSON.stringify({ ...payload, t: type, exp: Math.floor(Date.now() / 1000) + ttlSeconds });
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(type, 'utf8'));
  const ct = Buffer.concat([cipher.update(body, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}_${Buffer.concat([iv, tag, ct]).toString('base64url')}`;
}

export class SealError extends Error {}

export function unseal(type, token) {
  if (typeof token !== 'string' || !token.startsWith(`${PREFIX}_`)) {
    throw new SealError('malformed token');
  }
  let raw;
  try {
    raw = Buffer.from(token.slice(PREFIX.length + 1), 'base64url');
  } catch {
    throw new SealError('malformed token');
  }
  if (raw.length < IV_LEN + TAG_LEN + 1) throw new SealError('malformed token');

  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = raw.subarray(IV_LEN + TAG_LEN);

  let json;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAAD(Buffer.from(type, 'utf8'));
    decipher.setAuthTag(tag);
    json = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    // Wrong key, wrong type, or tampering — all indistinguishable by design.
    throw new SealError('invalid token');
  }

  const data = JSON.parse(json);
  if (data.t !== type) throw new SealError('invalid token type');
  if (typeof data.exp !== 'number' || data.exp < Math.floor(Date.now() / 1000)) {
    throw new SealError('token expired');
  }
  return data;
}

/** RFC 7636 S256 verification. */
export function verifyPkceS256(codeVerifier, codeChallenge) {
  if (typeof codeVerifier !== 'string' || codeVerifier.length < 43 || codeVerifier.length > 128) {
    return false;
  }
  const computed = createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
  const a = Buffer.from(computed);
  const b = Buffer.from(String(codeChallenge));
  return a.length === b.length && timingSafeEqual(a, b);
}
