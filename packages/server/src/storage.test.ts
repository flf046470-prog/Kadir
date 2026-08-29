import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createSqlClient, createStorage } from './storage.js';
import { FileLeaderboardStore } from './leaderboard-store.js';
import { FileSaveStore } from './persistence.js';

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'kc-storage-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('storage selection', () => {
  it('uses files when no database is configured', async () => {
    const dataDir = await tempDir();
    const storage = await createStorage({ dataDir, databaseUrl: '' });

    expect(storage.saves).toBeInstanceOf(FileSaveStore);
    expect(storage.leaderboard).toBeInstanceOf(FileLeaderboardStore);
    // The description is what the boot log shows; it has to say this is not safe to scale.
    expect(storage.description).toContain('single instance only');
  });

  it('round-trips a leaderboard entry through the file store', async () => {
    const dataDir = await tempDir();
    const storage = await createStorage({ dataDir, databaseUrl: '' });

    expect(await storage.leaderboard.submit('lvl', { playerId: 'a', name: 'A', animalId: 'fox', ticks: 5000, at: 1 }, 10)).toBe(1);
    await storage.leaderboard.flush();

    // A fresh store reading the same directory must see the flushed time.
    const reopened = await createStorage({ dataDir, databaseUrl: '' });
    expect((await reopened.leaderboard.top('lvl', 10))[0]?.playerId).toBe('a');
  });

  it('fails loudly when a database is asked for but unavailable', async () => {
    // Falling back to files here would look like it worked, then lose purchases as soon as a
    // second instance served the same player.
    await expect(createStorage({ dataDir: '/tmp', databaseUrl: 'postgres://u:hunter2@db:5432/kc' })).rejects.toThrow(
      /pg" package is not installed/,
    );
  });

  it('never puts the database password in the error it throws', async () => {
    const error = await createSqlClient('postgres://user:hunter2@db.internal:5432/kc').catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('hunter2');
  });
});
