import { createHash, createHmac } from "node:crypto";
import type { StorageDriver, StoredObject } from "./driver";

/**
 * S3-compatible object storage.
 *
 * Speaks plain S3 REST over `fetch`, which means it works unchanged against
 * AWS S3, Cloudflare R2, Backblaze B2, MinIO, and anything else implementing
 * the same API — the endpoint decides, not the code.
 *
 * There is deliberately no AWS SDK here. The runtime dependency list for this
 * project is eight packages; `@aws-sdk/client-s3` would be the largest by an
 * order of magnitude, for three requests. SigV4 is a published algorithm and
 * the signing below is verified against AWS's own documented test vectors, so
 * this is a tested hundred lines rather than a hopeful one.
 *
 * Local disk remains the default. This driver is selected only when the
 * environment names a bucket, so development needs no cloud account.
 */

export type S3Config = {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Full origin, e.g. https://s3.eu-central-1.amazonaws.com or an R2 endpoint. */
  endpoint: string;
  /**
   * Path-style puts the bucket in the path rather than the hostname. Required
   * by MinIO and most self-hosted gateways; AWS supports both.
   */
  forcePathStyle: boolean;
};

const SERVICE = "s3";
const ALGORITHM = "AWS4-HMAC-SHA256";

function sha256Hex(body: string | Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/**
 * Percent-encodes one path segment per RFC 3986. S3 rejects a signature
 * computed over a differently-encoded path, and `encodeURIComponent` leaves
 * `!'()*` alone, so those are escaped by hand.
 */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function encodeKeyPath(key: string): string {
  return key.split("/").map(encodeSegment).join("/");
}

/**
 * The four-step derivation from the secret to a request-scoped signing key.
 * Each step narrows the key's validity — by date, region, then service — so a
 * leaked signing key expires on its own and is useless elsewhere.
 */
export function signingKey(
  secretAccessKey: string,
  date: string,
  region: string,
  service: string
): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

export type SignInput = {
  method: string;
  /** Already percent-encoded, leading slash included. */
  path: string;
  headers: Record<string, string>;
  payloadHash: string;
  amzDate: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  service?: string;
};

/**
 * Builds the Authorization header for one request.
 *
 * Exported because it is the part worth testing directly: the canonical
 * request is unforgiving about ordering, casing and whitespace, and a mistake
 * surfaces as an opaque 403 rather than anything diagnosable.
 */
export function authorizationHeader(input: SignInput): string {
  const service = input.service ?? SERVICE;
  const date = input.amzDate.slice(0, 8);

  const names = Object.keys(input.headers)
    .map((n) => n.toLowerCase())
    .sort();

  const canonicalHeaders = names
    .map((n) => {
      const raw = Object.entries(input.headers).find(([k]) => k.toLowerCase() === n)?.[1] ?? "";
      return `${n}:${raw.trim().replace(/\s+/g, " ")}\n`;
    })
    .join("");

  const signedHeaders = names.join(";");

  const canonicalRequest = [
    input.method,
    input.path,
    "", // No query string is used by any request this driver makes.
    canonicalHeaders,
    signedHeaders,
    input.payloadHash
  ].join("\n");

  const scope = `${date}/${input.region}/${service}/aws4_request`;
  const stringToSign = [ALGORITHM, input.amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

  const key = signingKey(input.secretAccessKey, date, input.region, service);
  const signature = createHmac("sha256", key).update(stringToSign, "utf8").digest("hex");

  return `${ALGORITHM} Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

/** `20260823T090000Z` — the only timestamp format SigV4 accepts. */
export function amzDate(now: Date): string {
  return `${now.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
}

export class S3StorageDriver implements StorageDriver {
  constructor(private readonly config: S3Config) {}

  private target(key: string): { url: string; host: string; path: string } {
    const endpoint = new URL(this.config.endpoint);
    const encodedKey = encodeKeyPath(key);

    if (this.config.forcePathStyle) {
      const path = `/${encodeSegment(this.config.bucket)}/${encodedKey}`;
      return { url: `${endpoint.origin}${path}`, host: endpoint.host, path };
    }

    const host = `${this.config.bucket}.${endpoint.host}`;
    const path = `/${encodedKey}`;
    return { url: `${endpoint.protocol}//${host}${path}`, host, path };
  }

  private async send(
    method: string,
    key: string,
    body?: Buffer,
    contentType?: string
  ): Promise<Response> {
    const { url, host, path } = this.target(key);
    const stamp = amzDate(new Date());
    const payloadHash = sha256Hex(body ?? "");

    const headers: Record<string, string> = {
      host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": stamp
    };
    if (contentType) headers["content-type"] = contentType;

    headers.authorization = authorizationHeader({
      method,
      path,
      headers,
      payloadHash,
      amzDate: stamp,
      region: this.config.region,
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey
    });

    // `host` is set by fetch itself and rejected as a manual header, but it
    // must still be part of the signature — hence signing first, sending after.
    const { host: _host, ...sendable } = headers;

    return fetch(url, {
      method,
      headers: sendable,
      body: body ? new Uint8Array(body) : undefined
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    const response = await this.send("PUT", key, body, contentType);
    if (!response.ok) {
      throw new Error(`S3 PUT failed for ${key}: ${response.status} ${await response.text()}`);
    }
    return { key, size: body.byteLength, contentType };
  }

  async get(key: string): Promise<Buffer | null> {
    const response = await this.send("GET", key);
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`S3 GET failed for ${key}: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    const response = await this.send("DELETE", key);
    // 204 on success, 404 when already gone — both are the desired end state.
    if (!response.ok && response.status !== 404) {
      throw new Error(`S3 DELETE failed for ${key}: ${response.status}`);
    }
  }

  /**
   * Still the application route, never a bucket URL.
   *
   * Moderation state is checked on every read, so a photo that has not been
   * screened must not be reachable by anyone who learns its address. Handing
   * out a direct object URL — even an unguessable one — would move that
   * decision from the server to whoever has the link. The bucket stays private.
   */
  urlFor(key: string): string {
    return `/api/photos/${encodeURIComponent(key)}`;
  }
}
