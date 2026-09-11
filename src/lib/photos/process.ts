import { createHash } from "node:crypto";
import sharp from "sharp";

/**
 * Photo validation and processing.
 *
 * Two things here are security requirements rather than polish:
 *
 *  1. **The format is decided by the bytes, not the request.** `Content-Type`
 *     and the filename are both attacker-controlled; only the magic bytes say
 *     what a file actually is.
 *  2. **Every photo is re-encoded.** This strips EXIF, which on a phone photo
 *     routinely contains the GPS coordinates where it was taken. Publishing
 *     that on a dating profile would hand a stranger someone's home address —
 *     the single worst privacy failure this product could ship. Re-encoding
 *     also discards any payload hidden in metadata.
 */

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_DIMENSION = 2048;
export const MIN_DIMENSION = 200;

export type PhotoFormat = "jpeg" | "png" | "webp";

/** Magic-byte signatures. WebP needs the RIFF container check too. */
export function sniffFormat(buffer: Buffer): PhotoFormat | null {
  if (buffer.length < 12) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";

  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "png";
  }

  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }

  return null;
}

export type ProcessError =
  | "too_large"
  | "unsupported_format"
  | "too_small"
  | "corrupt"
  | "too_many_pixels";

export type ProcessedPhoto = {
  /** Re-encoded, EXIF-free bytes. */
  body: Buffer;
  contentType: "image/webp";
  extension: "webp";
  width: number;
  height: number;
  /** SHA-256 of the processed bytes, used as the storage key. */
  hash: string;
};

export type ProcessResult =
  | { ok: true; photo: ProcessedPhoto }
  | { ok: false; reason: ProcessError };

/**
 * Guards against decompression bombs: a small file can declare enormous
 * dimensions and exhaust memory when decoded.
 */
const MAX_TOTAL_PIXELS = 50_000_000;

export async function processUpload(input: Buffer): Promise<ProcessResult> {
  if (input.byteLength > MAX_UPLOAD_BYTES) return { ok: false, reason: "too_large" };
  if (sniffFormat(input) === null) return { ok: false, reason: "unsupported_format" };

  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    metadata = await sharp(input, { limitInputPixels: MAX_TOTAL_PIXELS }).metadata();
  } catch {
    return { ok: false, reason: "corrupt" };
  }

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  if (width === 0 || height === 0) return { ok: false, reason: "corrupt" };
  if (width * height > MAX_TOTAL_PIXELS) return { ok: false, reason: "too_many_pixels" };
  if (width < MIN_DIMENSION || height < MIN_DIMENSION) return { ok: false, reason: "too_small" };

  let body: Buffer;
  try {
    body = await sharp(input, { limitInputPixels: MAX_TOTAL_PIXELS })
      // Honour the EXIF orientation before dropping EXIF, or portraits come
      // out sideways.
      .rotate()
      .resize({
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true
      })
      // WebP re-encode: no metadata is carried across unless asked for.
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    return { ok: false, reason: "corrupt" };
  }

  const final = await sharp(body).metadata();

  return {
    ok: true,
    photo: {
      body,
      contentType: "image/webp",
      extension: "webp",
      width: final.width ?? width,
      height: final.height ?? height,
      hash: createHash("sha256").update(body).digest("hex")
    }
  };
}

/** Reads back whether any EXIF survived. Used by the test that guards this. */
export async function hasExif(buffer: Buffer): Promise<boolean> {
  const metadata = await sharp(buffer).metadata();
  return Boolean(metadata.exif);
}
