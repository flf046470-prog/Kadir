import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { S3StorageDriver, authorizationHeader, signingKey, amzDate } from "./s3";
import { contentKey } from "./driver";

/**
 * Signing is checked against AWS's own published examples rather than against
 * this implementation's own output. A self-consistent signer that disagrees
 * with AWS is worthless — it fails only in production, as an opaque 403 — so
 * the known-answer tests are the point of this file.
 */
describe("SigV4 known answers", () => {
  it("derives the signing key AWS documents", () => {
    const key = signingKey(
      "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      "20120215",
      "us-east-1",
      "iam"
    );
    expect(key.toString("hex")).toBe(
      "f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d"
    );
  });

  it("signs AWS's documented GET Object example", () => {
    const empty = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    const header = authorizationHeader({
      method: "GET",
      path: "/test.txt",
      headers: {
        host: "examplebucket.s3.amazonaws.com",
        range: "bytes=0-9",
        "x-amz-content-sha256": empty,
        "x-amz-date": "20130524T000000Z"
      },
      payloadHash: empty,
      amzDate: "20130524T000000Z",
      region: "us-east-1",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
    });

    expect(header).toContain(
      "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
    );
    // Signed headers must be lowercase and sorted, or S3 rejects the request.
    expect(header).toContain("SignedHeaders=host;range;x-amz-content-sha256;x-amz-date");
  });

  it("formats the timestamp the way SigV4 requires", () => {
    expect(amzDate(new Date("2026-08-23T09:04:05.678Z"))).toBe("20260823T090405Z");
  });
});

/**
 * Driver mechanics against a stub that speaks enough S3 to be worth talking to.
 * This cannot prove the signature is right — the known-answer tests above do
 * that — but it does prove the verbs, paths, encoding and body handling.
 */
describe("S3StorageDriver", () => {
  const objects = new Map<string, Buffer>();
  const seen: { method: string; url: string; auth: string; sha: string }[] = [];
  let server: Server;
  let endpoint: string;

  function handler(request: IncomingMessage, response: ServerResponse) {
    const chunks: Buffer[] = [];
    request.on("data", (c: Buffer) => chunks.push(c));
    request.on("end", () => {
      seen.push({
        method: request.method ?? "",
        url: request.url ?? "",
        auth: String(request.headers.authorization ?? ""),
        sha: String(request.headers["x-amz-content-sha256"] ?? "")
      });

      const key = decodeURIComponent((request.url ?? "").replace(/^\/bucket-name\//, ""));

      if (request.method === "PUT") {
        objects.set(key, Buffer.concat(chunks));
        response.writeHead(200).end();
      } else if (request.method === "GET") {
        const body = objects.get(key);
        if (!body) return void response.writeHead(404).end();
        response.writeHead(200).end(body);
      } else if (request.method === "DELETE") {
        objects.delete(key);
        response.writeHead(204).end();
      } else {
        response.writeHead(405).end();
      }
    });
  }

  beforeAll(async () => {
    server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (typeof address === "string" || !address) throw new Error("no port");
    endpoint = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function driver() {
    return new S3StorageDriver({
      bucket: "bucket-name",
      region: "auto",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      endpoint,
      forcePathStyle: true
    });
  }

  it("round-trips an object", async () => {
    const key = contentKey("abcdef0123456789", "webp");
    const body = Buffer.from("not really a webp, but bytes are bytes");

    const stored = await driver().put(key, body, "image/webp");
    expect(stored).toEqual({ key, size: body.byteLength, contentType: "image/webp" });

    const read = await driver().get(key);
    expect(read?.equals(body)).toBe(true);

    await driver().delete(key);
    expect(await driver().get(key)).toBeNull();
  });

  it("returns null for a missing object rather than throwing", async () => {
    expect(await driver().get("photos/00/11/does-not-exist.webp")).toBeNull();
  });

  it("puts the bucket in the path when path-style is forced", async () => {
    seen.length = 0;
    await driver().put("photos/ab/cd/x.webp", Buffer.from("x"), "image/webp");
    expect(seen[0].url).toBe("/bucket-name/photos/ab/cd/x.webp");
  });

  it("signs every request and declares the payload hash", async () => {
    seen.length = 0;
    await driver().get("photos/ab/cd/x.webp");
    expect(seen[0].auth).toMatch(/^AWS4-HMAC-SHA256 Credential=/);
    // An unsigned-payload marker would let a proxy alter the body undetected.
    expect(seen[0].sha).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps serving photos through the app route, not the bucket", () => {
    // Moderation is checked per read; a direct object URL would bypass it.
    expect(driver().urlFor("photos/ab/cd/x.webp")).toBe(
      "/api/photos/photos%2Fab%2Fcd%2Fx.webp"
    );
  });
});
