import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createStorage } from './storage.js';
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
    // second instance served the same player. The driver is installed, so this is a real
    // connection failure rather than a missing module — either way it must not fall back.
    await expect(
      createStorage({ dataDir: '/tmp', databaseUrl: 'postgres://u:hunter2@nonexistent.invalid:5432/kc' }),
    ).rejects.toThrow(/Cannot reach the database at nonexistent\.invalid/);
  });

  it('never puts the database password in the error it throws', async () => {
    // The driver decides what goes in its own errors, so this asserts the guarantee we make on
    // top of it: whatever comes back, the password is not in what reaches a log.
    const error = await createStorage({
      dataDir: '/tmp',
      databaseUrl: 'postgres://user:hunter2@nonexistent.invalid:5432/kc',
    }).catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('hunter2');
    // A `cause` chain would put the driver's own message — and whatever it contains — back into
    // the default error print.
    expect((error as Error).cause).toBeUndefined();
  });

  it('redacts a password that the driver did put in its message', async () => {
    // The realistic leak: a driver error that echoes the connection string. The password is
    // removed by value, so it does not depend on the message's shape.
    const password = 'nonexistent.invalid';
    const error = await createStorage({
      dataDir: '/tmp',
      databaseUrl: `postgres://user:${password}@nonexistent.invalid:5432/kc`,
    }).catch((e: Error) => e);

    // The host appears in our own prefix; what must not survive is the password occurrence
    // inside the driver's message, which this URL forces to be the same string.
    expect((error as Error).message).toContain('***');
  });
});
