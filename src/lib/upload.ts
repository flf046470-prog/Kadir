import "server-only";

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const MAX_BYTES = 8 * 1024 * 1024;

/** Only formats a browser can render, matched on both MIME type and magic bytes. */
const ALLOWED: { mime: string; ext: string; magic: number[][] }[] = [
  { mime: "image/jpeg", ext: "jpg", magic: [[0xff, 0xd8, 0xff]] },
  { mime: "image/png", ext: "png", magic: [[0x89, 0x50, 0x4e, 0x47]] },
  { mime: "image/webp", ext: "webp", magic: [[0x52, 0x49, 0x46, 0x46]] },
  { mime: "image/avif", ext: "avif", magic: [[0x00, 0x00, 0x00]] },
];

export type UploadResult =
  | { ok: true; filePath: string }
  | { ok: false; error: string };

/**
 * Writes an uploaded image under /public/uploads with a random name. The
 * original filename is never used, so a crafted name cannot escape the
 * directory or overwrite an existing file.
 */
export async function saveUpload(file: File): Promise<UploadResult> {
  if (!file || file.size === 0) return { ok: false, error: "No file was selected." };
  if (file.size > MAX_BYTES) return { ok: false, error: "That image is larger than 8 MB." };

  const spec = ALLOWED.find((entry) => entry.mime === file.type);
  if (!spec) return { ok: false, error: "Use a JPEG, PNG, WebP or AVIF image." };

  const bytes = Buffer.from(await file.arrayBuffer());
  const magicMatches = spec.magic.some((signature) =>
    signature.every((byte, i) => bytes[i] === byte),
  );
  if (!magicMatches) {
    return { ok: false, error: "That file's contents don't match its type." };
  }

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString("hex")}.${spec.ext}`;
  await fs.writeFile(path.join(UPLOAD_DIR, name), bytes);
  return { ok: true, filePath: `/uploads/${name}` };
}

/** Deletes a previously uploaded file, refusing anything outside the folder. */
export async function deleteUpload(filePath: string): Promise<void> {
  if (!filePath.startsWith("/uploads/")) return;
  const resolved = path.resolve(UPLOAD_DIR, path.basename(filePath));
  if (!resolved.startsWith(UPLOAD_DIR)) return;
  await fs.rm(resolved, { force: true });
}
