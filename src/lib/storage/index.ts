import { join } from "node:path";
import type { StorageDriver } from "./driver";
import { LocalStorageDriver } from "./local";
import { S3StorageDriver } from "./s3";

/**
 * Chooses the storage driver from the environment.
 *
 * Local disk is the default, so a clone runs with no cloud account and no
 * configuration. S3 is selected only when a bucket is named — an incomplete
 * S3 configuration is a startup error rather than a silent fall back to disk,
 * because falling back would mean a deploy that looks healthy while writing
 * photos to a filesystem that vanishes on the next request.
 */

let driver: StorageDriver | null = null;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is required when S3_BUCKET is set. Configure the S3 credentials or unset S3_BUCKET to use local disk.`
    );
  }
  return value;
}

function build(): StorageDriver {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    return new LocalStorageDriver(process.env.STORAGE_ROOT ?? join(process.cwd(), ".storage"));
  }

  const region = process.env.S3_REGION ?? "auto";

  return new S3StorageDriver({
    bucket,
    region,
    accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
    endpoint: process.env.S3_ENDPOINT ?? `https://s3.${region}.amazonaws.com`,
    // Anything that is not AWS proper generally needs path-style addressing,
    // so a custom endpoint opts into it unless told otherwise.
    forcePathStyle:
      process.env.S3_FORCE_PATH_STYLE === "true" ||
      (process.env.S3_FORCE_PATH_STYLE !== "false" && Boolean(process.env.S3_ENDPOINT))
  });
}

export function storage(): StorageDriver {
  driver ??= build();
  return driver;
}

/** Test hook, for swapping in a different driver. */
export function setStorageDriver(next: StorageDriver | null): void {
  driver = next;
}

export type { StorageDriver, StoredObject } from "./driver";
export { contentKey } from "./driver";
