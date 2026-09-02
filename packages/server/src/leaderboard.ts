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

  /** Returns the new rank (1-based) when the time made the board, otherwise -1. */
  submit(levelId: string, entry: LeaderboardEntry): Promise<number> {
    return this.store.submit(levelId, entry, this.maxEntries);
  }

  top(levelId: string, count = 20): Promise<LeaderboardEntry[]> {
    return this.store.top(levelId, count);
  }

  async best(levelId: string): Promise<LeaderboardEntry | null> {
    return (await this.store.top(levelId, 1))[0] ?? null;
  }

  personalBest(levelId: string, playerId: string): Promise<LeaderboardEntry | null> {
    return this.store.personalBest(levelId, playerId);
  }
}
