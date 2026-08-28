import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { PlayerProfile, SaveStore } from '@kc/core';
import { parseProfile, serializeProfile } from '@kc/core';

/**
 * File-backed profile store.
 *
 * Deliberately behind the same `SaveStore` interface the rest of the code uses, so swapping in
 * Postgres/DynamoDB later is a one-file change. Writes go through a temp file + rename so a
 * crash mid-write can never corrupt a player's inventory.
 */
export class FileSaveStore implements SaveStore {
  private writing = new Map<string, Promise<void>>();

  constructor(private readonly dir: string) {}

  private path(playerId: string): string {
    const safe = playerId.replace(/[^a-zA-Z0-9_-]/g, '_');
    // Shard by prefix so a large player base does not produce one huge directory.
    return join(this.dir, safe.slice(0, 2) || '__', `${safe}.json`);
  }

  async load(playerId: string): Promise<PlayerProfile | null> {
    try {
      const raw = await readFile(this.path(playerId), 'utf8');
      return parseProfile(raw, playerId);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async save(profile: PlayerProfile): Promise<void> {
    // Serialise concurrent writes for the same player: last write wins, none interleave.
    const previous = this.writing.get(profile.playerId) ?? Promise.resolve();
    const next = previous.then(() => this.writeNow(profile));
    this.writing.set(profile.playerId, next.catch(() => undefined));
    return next;
  }

  private async writeNow(profile: PlayerProfile): Promise<void> {
    const target = this.path(profile.playerId);
    await mkdir(dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, serializeProfile(profile), 'utf8');
    await rename(temp, target);
  }
}
