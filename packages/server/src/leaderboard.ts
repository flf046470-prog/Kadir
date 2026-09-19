import { levelVersion } from '@kc/core';

import { FileLeaderboardStore } from './leaderboard-store.js';
import type { LeaderboardEntry, LeaderboardStore } from './leaderboard-store.js';

export type { LeaderboardEntry, LeaderboardStore } from './leaderboard-store.js';
export { FileLeaderboardStore, SqlLeaderboardStore, LEADERBOARD_SCHEMA } from './leaderboard-store.js';
export type { SqlClient } from './leaderboard-store.js';

/**
 * Parkour leaderboard.
 *
 * Times are only ever submitted by the room that ran the match, never by a client — a
 * client-reported lap time is a claim about a race the server already simulated.
 *
 * Storage sits behind `LeaderboardStore`: a file for a single instance (local dev, the Steam
 * build's embedded server), or SQL for anything horizontally scaled, where a whole-board
 * read-modify-write would silently lose one of two concurrent finishes.
 */
export class Leaderboard {
  constructor(
    private readonly store: LeaderboardStore,
    private readonly maxEntries = 100,
  ) {}

  /** Convenience for the common single-instance case. */
  static file(dataDir: string, maxEntries = 100): Leaderboard {
    return new Leaderboard(new FileLeaderboardStore(dataDir), maxEntries);
  }

  async load(): Promise<void> {
    if (this.store instanceof FileLeaderboardStore) await this.store.load();
  }

  flush(): Promise<void> {
    return this.store.flush();
  }

  /**
   * The board a time belongs on: the map *and the course it was run on*.
   *
   * Records were filed under the level id alone, so any edit to a map's geometry poured the new
   * course's times into the old course's board. Nothing announces that — the rows look fine, and
   * a route that got shorter simply produces a run of new world records that no one can explain.
   * A level already carries a `version` for exactly this, and bumping it now starts a clean board
   * while leaving the old one intact under its own key.
   *
   * Resolved here rather than at the call sites: there are three of them across the room and the
   * HTTP API, and a board is only trustworthy if none of them can forget.
   */
  private key(levelId: string): string {
    return `${levelId}@v${levelVersion(levelId)}`;
  }

  /** Returns the new rank (1-based) when the time made the board, otherwise -1. */
  submit(levelId: string, entry: LeaderboardEntry): Promise<number> {
    return this.store.submit(this.key(levelId), entry, this.maxEntries);
  }

  top(levelId: string, count = 20): Promise<LeaderboardEntry[]> {
    return this.store.top(this.key(levelId), count);
  }

  async best(levelId: string): Promise<LeaderboardEntry | null> {
    return (await this.store.top(this.key(levelId), 1))[0] ?? null;
  }

  personalBest(levelId: string, playerId: string): Promise<LeaderboardEntry | null> {
    return this.store.personalBest(this.key(levelId), playerId);
  }
}
