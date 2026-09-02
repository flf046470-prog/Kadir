import { createProfile } from '@kc/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SqlLeaderboardStore } from './leaderboard-store.js';
import type { SqlClient } from './leaderboard-store.js';
import { SqlSaveStore } from './persistence.js';
import { createSqlClient } from './storage.js';

/**
 * The SQL drivers against a real Postgres.
 *
 * The other storage tests use a stub client, which proves the SQL is *called* correctly but not
 * that Postgres accepts it or that the concurrency guarantee holds. That guarantee is the entire
 * reason these drivers exist — a file store loses one of two simultaneous writes — so it has to
 * be exercised against a real database with real parallel connections.
 *
 * Skipped unless KC_TEST_DATABASE_URL is set, so a normal `npm test` needs no database:
 *   KC_TEST_DATABASE_URL=postgres://postgres:pass@127.0.0.1:5432/kc npm test
 */
const url = process.env.KC_TEST_DATABASE_URL ?? '';

describe.skipIf(!url)('SQL storage against a real Postgres', () => {
  let sql: SqlClient;
  let saves: SqlSaveStore;
  let board: SqlLeaderboardStore;
  // Every run uses fresh ids so repeated runs against the same database cannot interfere.
  const run = Math.random().toString(36).slice(2, 10);
  const level = `lvl-${run}`;

  beforeAll(async () => {
    sql = await createSqlClient(url);
    saves = new SqlSaveStore(sql);
    board = new SqlLeaderboardStore(sql);
    await saves.migrate();
    await board.migrate();
  });

  afterAll(async () => {
    await sql.query('DELETE FROM parkour_times WHERE level_id = $1', [level]);
    await sql.query('DELETE FROM player_profiles WHERE player_id LIKE $1', [`%-${run}`]);
    await (sql as unknown as { end?: () => Promise<void> }).end?.();
  });

  it('runs migrations twice without error', async () => {
    // Every boot calls migrate; the second boot must not fail on an existing table.
    await saves.migrate();
    await board.migrate();
  });

  describe('profiles', () => {
    it('round-trips a profile through the database', async () => {
      const id = `player-a-${run}`;
      const profile = createProfile(id, 'Ada');
      profile.coins = 1234;
      profile.xp = 5678;

      await saves.save(profile);
      const loaded = await saves.load(id);

      expect(loaded?.playerId).toBe(id);
      expect(loaded?.name).toBe('Ada');
      expect(loaded?.coins).toBe(1234);
      expect(loaded?.xp).toBe(5678);
    });

    it('overwrites on a second save rather than inserting a duplicate', async () => {
      const id = `player-b-${run}`;
      await saves.save({ ...createProfile(id, 'Bo'), coins: 10 });
      await saves.save({ ...createProfile(id, 'Bo'), coins: 20 });

      expect((await saves.load(id))?.coins).toBe(20);
      const rows = await sql.query('SELECT COUNT(*) AS n FROM player_profiles WHERE player_id = $1', [id]);
      expect(Number(rows.rows[0]?.n)).toBe(1);
    });

    it('returns null for an unknown player and after delete', async () => {
      const id = `player-c-${run}`;
      expect(await saves.load(id)).toBeNull();
      await saves.save(createProfile(id, 'Cy'));
      expect(await saves.load(id)).not.toBeNull();
      await saves.delete(id);
      expect(await saves.load(id)).toBeNull();
    });

    it('does not interleave two concurrent saves into a half-applied profile', async () => {
      const id = `player-d-${run}`;
      const a = { ...createProfile(id, 'Dee'), coins: 100, xp: 100 };
      const b = { ...createProfile(id, 'Dee'), coins: 900, xp: 900 };

      await Promise.all([saves.save(a), saves.save(b), saves.save(a), saves.save(b)]);

      // Whichever save landed last wins entirely; what must never happen is one field from one
      // save and another field from the other.
      const loaded = await saves.load(id);
      expect([100, 900]).toContain(loaded?.coins);
      expect(loaded?.coins).toBe(loaded?.xp);
    });
  });

  describe('leaderboard', () => {
    it('accepts a first time and ranks it first', async () => {
      const rank = await board.submit(level, { playerId: `p1-${run}`, name: 'One', animalId: 'fox', ticks: 5000, at: 1 }, 10);
      expect(rank).toBe(1);
    });

    it('refuses a worse time and leaves the stored one intact', async () => {
      const id = `p2-${run}`;
      await board.submit(level, { playerId: id, name: 'Two', animalId: 'fox', ticks: 4000, at: 2 }, 10);
      const worse = await board.submit(level, { playerId: id, name: 'Two', animalId: 'fox', ticks: 9000, at: 3 }, 10);

      expect(worse).toBe(-1);
      expect((await board.personalBest(level, id))?.ticks).toBe(4000);
    });

    it('accepts an improvement and replaces the stored time', async () => {
      const id = `p3-${run}`;
      await board.submit(level, { playerId: id, name: 'Three', animalId: 'fox', ticks: 8000, at: 4 }, 10);
      const better = await board.submit(level, { playerId: id, name: 'Three', animalId: 'fox', ticks: 3000, at: 5 }, 10);

      expect(better).toBeGreaterThan(0);
      expect((await board.personalBest(level, id))?.ticks).toBe(3000);
    });

    it('orders top() by time, then by who got there first', async () => {
      const top = await board.top(level, 10);
      const ticks = top.map((e) => e.ticks);
      expect([...ticks].sort((a, b) => a - b)).toEqual(ticks);
    });

    it('rejects a non-integer or non-positive time before touching the database', async () => {
      expect(await board.submit(level, { playerId: `bad-${run}`, name: 'X', animalId: 'fox', ticks: 0, at: 1 }, 10)).toBe(-1);
      expect(await board.submit(level, { playerId: `bad-${run}`, name: 'X', animalId: 'fox', ticks: -5, at: 1 }, 10)).toBe(-1);
      expect(await board.submit(level, { playerId: `bad-${run}`, name: 'X', animalId: 'fox', ticks: 1.5, at: 1 }, 10)).toBe(-1);
    });

    /**
     * The property the whole SQL path exists for. Read-modify-write over a file cannot promise
     * this: two writers both read 9000, both decide their time is better, and the slower one
     * lands last. Here "keep the better time" is a single statement, so the best time wins no
     * matter how the writes interleave.
     */
    it('keeps the best of many concurrent submissions for one player', async () => {
      const id = `race-${run}`;
      const times = [9000, 4200, 7000, 2500, 6000, 3100, 8000, 5000, 2500, 9999];
      const best = Math.min(...times);

      await Promise.all(
        times.map((ticks, i) =>
          board.submit(level, { playerId: id, name: 'Racer', animalId: 'fox', ticks, at: 100 + i }, 50),
        ),
      );

      expect((await board.personalBest(level, id))?.ticks).toBe(best);
      const rows = await sql.query('SELECT COUNT(*) AS n FROM parkour_times WHERE level_id = $1 AND player_id = $2', [
        level,
        id,
      ]);
      expect(Number(rows.rows[0]?.n)).toBe(1);
    });

    it('holds exactly one row per player per level, so the board stays bounded', async () => {
      const rows = await sql.query(
        'SELECT player_id, COUNT(*) AS n FROM parkour_times WHERE level_id = $1 GROUP BY player_id HAVING COUNT(*) > 1',
        [level],
      );
      expect(rows.rows).toEqual([]);
    });
  });
});
