import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { StorageDriver, StoredObject } from "./driver";

/**
 * Local-disk driver.
 *
 * Suitable for development and single-instance deployments. It is not suitable
 * for multiple instances (each would hold different files) or for anything
 * needing a CDN — that is what a real object-storage driver is for, and why the
 * interface exists.
 *
 * Objects are served through an application route rather than a static mount,
 * so moderation state is checked on every read instead of being bypassable by
 * knowing a URL.
 */
export class LocalStorageDriver implements StorageDriver {
  constructor(private readonly root: string) {}

  /**
   * Resolves a key to a path under the root, rejecting anything that escapes
   * it. Keys are generated server-side today, but a defence that only holds
   * while every caller behaves is not a defence.
   */
  private pathFor(key: string): string {
    const full = resolve(this.root, key);
    const rootWithSep = resolve(this.root) + sep;

    if (!full.startsWith(rootWithSep)) {
      throw new Error("Storage key escapes the storage root");
    }
    return full;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);

    return { key, size: body.byteLength, contentType };
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathFor(key));
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.pathFor(key));
    } catch {
      // Already gone is the desired end state.
    }
  }

  urlFor(key: string): string {
    return `/api/photos/${encodeURIComponent(key)}`;
  }
}
