import { describe, expect, it } from 'vitest';

import { LEADERBOARD_SCHEMA, MemoryLeaderboardStore, SqlLeaderboardStore } from './leaderboard-store.js';
import type { LeaderboardEntry, SqlClient } from './leaderboard-store.js';

const entry = (playerId: string, ticks: number, at = 1): LeaderboardEntry => ({
  playerId,
  name: playerId.toUpperCase(),
  animalId: 'kangaroo',
  ticks,
  at,
});

describe('leaderboard store contract', () => {
  it('ranks by time, fastest first', async () => {
    const store = new MemoryLeaderboardStore();
    expect(await store.submit('lvl', entry('a', 6000), 100)).toBe(1);
    expect(await store.submit('lvl', entry('b', 5000), 100)).toBe(1);
    expect(await store.submit('lvl', entry('c', 7000), 100)).toBe(3);

    expect((await store.top('lvl', 10)).map((e) => e.playerId)).toEqual(['b', 'a', 'c']);
  });

  it('keeps only a player’s best time', async () => {
    const store = new MemoryLeaderboardStore();
    await store.submit('lvl', entry('a', 5000), 100);
    expect(await store.submit('lvl', entry('a', 7000), 100)).toBe(-1);
    expect(await store.submit('lvl', entry('a', 4000), 100)).toBe(1);

    const all = await store.top('lvl', 10);
    expect(all).toHaveLength(1);
    expect(all[0]?.ticks).toBe(4000);
  });

  it('breaks ties by who got there first', async () => {
    const store = new MemoryLeaderboardStore();
    await store.submit('lvl', entry('late', 5000, 200), 100);
    await store.submit('lvl', entry('early', 5000, 100), 100);
    expect((await store.top('lvl', 10)).map((e) => e.playerId)).toEqual(['early', 'late']);
  });

  it('rejects impossible times rather than storing them', async () => {
    const store = new MemoryLeaderboardStore();
    expect(await store.submit('lvl', entry('a', 0), 100)).toBe(-1);
    expect(await store.submit('lvl', entry('a', -5), 100)).toBe(-1);
    expect(await store.submit('lvl', entry('a', 1.5), 100)).toBe(-1);
    expect(await store.top('lvl', 10)).toEqual([]);
  });

  it('bounds the board', async () => {
    const store = new MemoryLeaderboardStore();
    for (let i = 0; i < 10; i += 1) await store.submit('lvl', entry(`p${i}`, 1000 + i), 3);
    expect(await store.top('lvl', 50)).toHaveLength(3);
  });

  it('keeps levels separate', async () => {
    const store = new MemoryLeaderboardStore();
    await store.submit('jungle', entry('a', 5000), 100);
    await store.submit('canyon', entry('b', 6000), 100);
    expect((await store.top('jungle', 10)).map((e) => e.playerId)).toEqual(['a']);
    expect(await store.personalBest('canyon', 'a')).toBeNull();
    expect((await store.personalBest('jungle', 'a'))?.ticks).toBe(5000);
  });
});

/** Records statements so the driver's decisions can be checked without a database. */
function recordingSql(responses: Record<string, unknown>[][]): { sql: SqlClient; statements: string[]; params: unknown[][] } {
  const statements: string[] = [];
  const params: unknown[][] = [];
  let call = 0;
  return {
    statements,
    params,
    sql: {
      async query(text, values) {
        statements.push(text);
        params.push(values ?? []);
        return { rows: responses[call++] ?? [] };
      },
    },
  };
}

describe('SQL leaderboard store', () => {
  it('upserts and ranks in two statements', async () => {
    const { sql, statements, params } = recordingSql([[{ ticks: 5000 }], [{ rank: '3' }]]);
    const rank = await new SqlLeaderboardStore(sql).submit('lvl', entry('a', 5000, 42), 100);

    expect(rank).toBe(3);
    expect(statements[0]).toContain('INSERT INTO parkour_times');
    // The conflict guard is what makes two instances racing safe: the database decides which
    // time is better, so neither can clobber the other with a stale read.
    expect(statements[0]).toContain('ON CONFLICT (level_id, player_id) DO UPDATE');
    expect(statements[0]).toContain('WHERE EXCLUDED.ticks < parkour_times.ticks');
    expect(params[0]).toEqual(['lvl', 'a', 'A', 'kangaroo', 5000, 42]);
    expect(statements[1]).toContain('COUNT(*) + 1 AS rank');
  });

  it('treats an empty upsert result as "your existing time was better"', async () => {
    // The WHERE guard suppressed the update, so no row comes back and nothing was changed.
    const { sql, statements } = recordingSql([[]]);
    expect(await new SqlLeaderboardStore(sql).submit('lvl', entry('a', 9000), 100)).toBe(-1);
    // And it must not go on to compute a rank for a time it did not store.
    expect(statements).toHaveLength(1);
  });

  it('reports -1 when the time ranks past the end of the board', async () => {
    const { sql } = recordingSql([[{ ticks: 5000 }], [{ rank: 250 }]]);
    expect(await new SqlLeaderboardStore(sql).submit('lvl', entry('a', 5000), 100)).toBe(-1);
  });

  it('rejects an impossible time without touching the database', async () => {
    const { sql, statements } = recordingSql([]);
    expect(await new SqlLeaderboardStore(sql).submit('lvl', entry('a', -1), 100)).toBe(-1);
    expect(statements).toHaveLength(0);
  });

  it('reads the board fastest-first with a bounded limit', async () => {
    const { sql, statements, params } = recordingSql([
      [{ player_id: 'b', name: 'B', animal_id: 'fox', ticks: 4000, at: 2 }],
    ]);
    const rows = await new SqlLeaderboardStore(sql).top('lvl', 20);

    expect(rows).toEqual([{ playerId: 'b', name: 'B', animalId: 'fox', ticks: 4000, at: 2 }]);
    expect(statements[0]).toContain('ORDER BY ticks ASC, at ASC');
    expect(statements[0]).toContain('LIMIT $2');
    expect(params[0]).toEqual(['lvl', 20]);
  });

  it('returns null for a player with no time', async () => {
    const { sql } = recordingSql([[]]);
    expect(await new SqlLeaderboardStore(sql).personalBest('lvl', 'nobody')).toBeNull();
  });

  it('has a schema keyed so a player holds one time per level', async () => {
    expect(LEADERBOARD_SCHEMA).toContain('PRIMARY KEY (level_id, player_id)');
    expect(LEADERBOARD_SCHEMA).toContain('CHECK (ticks > 0)');
    expect(LEADERBOARD_SCHEMA).toContain('CREATE TABLE IF NOT EXISTS');
  });

  it('migrates idempotently', async () => {
    const { sql, statements } = recordingSql([[]]);
    await new SqlLeaderboardStore(sql).migrate();
    expect(statements[0]).toContain('CREATE TABLE IF NOT EXISTS parkour_times');
  });
});
