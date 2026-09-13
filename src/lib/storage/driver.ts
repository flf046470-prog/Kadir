/**
 * Object storage abstraction.
 *
 * Photos are the one thing here that genuinely needs a provider decision (S3,
 * R2, GCS, or a volume), and that decision belongs to whoever runs the service.
 * So the rest of the code talks to this interface and never to a provider SDK;
 * switching is implementing one more driver, not touching upload, moderation,
 * or rendering.
 *
 * Keys are content-addressed and generated server-side. A member never supplies
 * a path, so there is no traversal to defend against and no way to overwrite
 * someone else's object by guessing a name.
 */

export type StoredObject = {
  key: string;
  size: number;
  contentType: string;
};

export interface StorageDriver {
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  /** Public URL, or a route that streams the object for private drivers. */
  urlFor(key: string): string;
}

/**
 * Builds a storage key from the content hash. Identical bytes land on the same
 * key, so a re-upload costs nothing extra, and the key leaks nothing about the
 * member who uploaded it.
 */
export function contentKey(hash: string, extension: string): string {
  // Shard by prefix so no single directory ends up with millions of entries.
  return `photos/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}.${extension}`;
}
