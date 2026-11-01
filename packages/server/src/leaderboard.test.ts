import { describe, expect, it } from 'vitest';

// `@kc/core` re-exports `world/index.js`, which registers every level as a side effect.
import { buildLevel, levelVersion, listLevels } from '@kc/core';

import { Leaderboard } from './leaderboard.js';
import { MemoryLeaderboardStore } from './leaderboard-store.js';
import type { LeaderboardEntry } from './leaderboard-store.js';

const entry = (playerId: string, ticks: number): LeaderboardEntry => ({
  playerId,
  name: playerId.toUpperCase(),
  animalId: 'kangaroo',
  ticks,
  at: 1,
});

/**
 * A time belongs to a course, not to a map's name.
 *
 * Records were filed under the level id alone. Every map is generated from a seed, so editing one
 * changes the course everybody runs while the id stays put — and the old course's times stay on
 * the board next to the new one's. A route that got shorter then produces a run of world records
 * nobody can account for, and the rows give no hint that anything happened, which is the worst
 * property a leaderboard can have.
 */
describe('a leaderboard record', () => {
  it('is filed under the course it was run on, not just the map', async () => {
    const store = new MemoryLeaderboardStore();
    const board = new Leaderboard(store, 100);
    await board.submit('glacier-world', entry('a', 5000));

    // The same map at a different version is a different course and therefore a different board.
    const other = `glacier-world@v${levelVersion('glacier-world') + 1}`;
    expect(await store.top(other, 20)).toHaveLength(0);
    expect(await store.top(`glacier-world@v${levelVersion('glacier-world')}`, 20)).toHaveLength(1);
  });

  it('reads back what it wrote, through every accessor', async () => {
    // `submit` keys one way and `top`/`best`/`personalBest` another is the shape of bug that
    // leaves a board permanently empty while writes report success.
    const board = new Leaderboard(new MemoryLeaderboardStore(), 100);
    await board.submit('jungle-world', entry('a', 5000));
    await board.submit('jungle-world', entry('b', 4000));

    expect(await board.top('jungle-world', 20)).toHaveLength(2);
    expect((await board.best('jungle-world'))?.playerId).toBe('b');
    expect((await board.personalBest('jungle-world', 'a'))?.ticks).toBe(5000);
  });

  it('keeps two maps apart', async () => {
    const board = new Leaderboard(new MemoryLeaderboardStore(), 100);
    await board.submit('jungle-world', entry('a', 5000));
    expect(await board.top('glacier-world', 20)).toHaveLength(0);
  });

  it('does not file an unknown map under a real one', async () => {
    /**
     * `buildLevel` falls back to the default level for an id it does not know — right for a client
     * joining a room playing a map it lacks, wrong for a record. Reading the version through that
     * fallback would stamp a nonexistent map with the jungle's version and drop its times onto the
     * jungle's board.
     */
    expect(levelVersion('no-such-map')).toBe(0);
    const board = new Leaderboard(new MemoryLeaderboardStore(), 100);
    await board.submit('no-such-map', entry('a', 1));
    expect(await board.top('jungle-world', 20)).toHaveLength(0);
  });
});

describe('a level version', () => {
  it('matches the level it is read from', () => {
    // The version is memoised. Declaring it a second time on the registry entry would let the two
    // drift, and the thing it protects is a board where being quietly wrong is the whole failure.
    for (const level of listLevels()) {
      expect(levelVersion(level.id), level.id).toBe(buildLevel(level.id).version);
    }
  });
});
