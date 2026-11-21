import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { PlayerProfile, SaveStore } from '@kc/core';
import type { SqlClient } from './leaderboard-store.js';
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

/**
 * SQL-backed profile store, for deployments running more than one server.
 *
 * The file store is correct only while one process owns the directory. Two instances serving
 * the same player — which is the normal case behind a load balancer — would each hold their own
 * copy and overwrite the other's, quietly losing purchases and progression.
 *
 * Profiles are stored as the same serialized form the file store writes, so `parseProfile` and
 * `serializeProfile` stay the single definition of what a profile is on disk, and switching
 * drivers cannot change what a save means.
 */
export const PROFILE_SCHEMA = `
CREATE TABLE IF NOT EXISTS player_profiles (
  player_id  TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
`;

export class SqlSaveStore implements SaveStore {
  constructor(private readonly sql: SqlClient) {}

  /** Create the table if it does not exist. Safe to call on every boot. */
  async migrate(): Promise<void> {
    await this.sql.query(PROFILE_SCHEMA);
  }

  async load(playerId: string): Promise<PlayerProfile | null> {
    const result = await this.sql.query('SELECT data FROM player_profiles WHERE player_id = $1', [playerId]);
    const raw = result.rows[0]?.data;
    return typeof raw === 'string' ? parseProfile(raw, playerId) : null;
  }

  async save(profile: PlayerProfile): Promise<void> {
    // A single upsert: no read-modify-write, so two instances saving the same player cannot
    // interleave into a half-applied profile.
    await this.sql.query(
      `INSERT INTO player_profiles (player_id, data, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (player_id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
      [profile.playerId, serializeProfile(profile), Date.now()],
    );
  }

  async delete(playerId: string): Promise<void> {
    await this.sql.query('DELETE FROM player_profiles WHERE player_id = $1', [playerId]);
  }
}
