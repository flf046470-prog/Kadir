import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface LeaderboardEntry {
  playerId: string;
  name: string;
  animalId: string;
  /** Lap time in ticks — integer, so ties are exact. */
  ticks: number;
  at: number;
}

/**
 * Where leaderboard times live.
 *
 * The operation that matters is `submit`, and it is deliberately not "read, merge, write the
 * whole board". Two servers finishing a race in the same second would each read the board,
 * each add their own entry, and each write back — and whichever wrote second would erase the
 * other's time. That is the actual reason a shared board needs a datastore rather than a file:
 * not size, but the fact that a whole-board write is a lost update waiting to happen.
 *
 * So `submit` is specified as a single atomic upsert that keeps the *better* time, and each
 * driver has to honour that with whatever primitive it has.
 */
export interface LeaderboardStore {
  /** Fastest first. */
  top(levelId: string, count: number): Promise<LeaderboardEntry[]>;
  /**
   * Record a time, keeping only the player's best.
   *
   * Returns the 1-based rank when the time made the board, or -1 when it did not beat the
   * player's existing personal best or missed the cut.
   */
  submit(levelId: string, entry: LeaderboardEntry, maxEntries: number): Promise<number>;
  personalBest(levelId: string, playerId: string): Promise<LeaderboardEntry | null>;
  /** Persist anything buffered. A no-op for stores that write through. */
  flush(): Promise<void>;
}

/**
 * Single-instance file store — the default, and correct only while exactly one server writes.
 *
 * Kept because it makes local development and the Steam build's embedded server work with no
 * infrastructure at all. Anything horizontally scaled needs `SqlLeaderboardStore`.
 */
export class FileLeaderboardStore implements LeaderboardStore {
  protected byLevel = new Map<string, LeaderboardEntry[]>();
  protected dirty = false;
  protected loaded = true;

  constructor(private readonly dataDir: string) {
    // A store with no directory has nothing to read, so it starts ready.
    this.loaded = dataDir === '';
  }

  private file(): string {
    return join(this.dataDir, 'leaderboards', 'parkour.json');
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.file(), 'utf8');
      this.byLevel = new Map(Object.entries(JSON.parse(raw) as Record<string, LeaderboardEntry[]>));
    } catch {
      this.byLevel = new Map();
    }
    this.loaded = true;
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.load();
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    const target = this.file();
    await mkdir(dirname(target), { recursive: true });
    // Temp file + rename, so a crash mid-write cannot truncate the board to nothing.
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(Object.fromEntries(this.byLevel)), 'utf8');
    await rename(temp, target);
    this.dirty = false;
  }

  async submit(levelId: string, entry: LeaderboardEntry, maxEntries: number): Promise<number> {
    await this.ensureLoaded();
    if (!Number.isInteger(entry.ticks) || entry.ticks <= 0) return -1;

    const list = this.byLevel.get(levelId) ?? [];
    const existing = list.findIndex((e) => e.playerId === entry.playerId);
    if (existing >= 0) {
      const current = list[existing] as LeaderboardEntry;
      if (current.ticks <= entry.ticks) return -1;
      list.splice(existing, 1);
    }
    list.push(entry);
    list.sort((a, b) => a.ticks - b.ticks || a.at - b.at);
    if (list.length > maxEntries) list.length = maxEntries;
    this.byLevel.set(levelId, list);
    this.dirty = true;

    const rank = list.findIndex((e) => e.playerId === entry.playerId);
    return rank < 0 ? -1 : rank + 1;
  }

  async top(levelId: string, count: number): Promise<LeaderboardEntry[]> {
    await this.ensureLoaded();
    return (this.byLevel.get(levelId) ?? []).slice(0, count);
  }

  async personalBest(levelId: string, playerId: string): Promise<LeaderboardEntry | null> {
    await this.ensureLoaded();
    return (this.byLevel.get(levelId) ?? []).find((e) => e.playerId === playerId) ?? null;
  }
}

/**
 * In-memory store, for tests and for a server that deliberately keeps no records.
 *
 * Shares `FileLeaderboardStore`'s ranking rules by construction — it *is* that store with the
 * disk parts skipped — so a test written against this is testing the same logic that ships.
 */
export class MemoryLeaderboardStore extends FileLeaderboardStore {
  constructor() {
    super('');
  }

  override async load(): Promise<void> {}
  override async flush(): Promise<void> {}
}

/** Minimal shape of a `pg`-style client, so no database driver becomes a dependency here. */
export interface SqlClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export const LEADERBOARD_SCHEMA = `
CREATE TABLE IF NOT EXISTS parkour_times (
  level_id  TEXT   NOT NULL,
  player_id TEXT   NOT NULL,
  name      TEXT   NOT NULL,
  animal_id TEXT   NOT NULL,
  ticks     INTEGER NOT NULL CHECK (ticks > 0),
  at        BIGINT NOT NULL,
  PRIMARY KEY (level_id, player_id)
);
CREATE INDEX IF NOT EXISTS parkour_times_rank ON parkour_times (level_id, ticks ASC, at ASC);
`;

/**
 * Shared leaderboard across every server instance.
 *
 * `submit` is one statement. `ON CONFLICT ... WHERE EXCLUDED.ticks < parkour_times.ticks` makes
 * "keep the better time" the database's job, so two instances submitting at once cannot lose
 * each other's writes — which read-modify-write cannot guarantee no matter how it is ordered in
 * application code.
 *
 * The primary key is (level_id, player_id), so a player holds exactly one time per level and
 * the board never needs trimming to stay bounded per player.
 */
export class SqlLeaderboardStore implements LeaderboardStore {
  constructor(private readonly sql: SqlClient) {}

  /** Create the table if it does not exist. Safe to call on every boot. */
  async migrate(): Promise<void> {
    await this.sql.query(LEADERBOARD_SCHEMA);
  }

  async submit(levelId: string, entry: LeaderboardEntry, maxEntries: number): Promise<number> {
    if (!Number.isInteger(entry.ticks) || entry.ticks <= 0) return -1;

    const upsert = await this.sql.query(
      `INSERT INTO parkour_times (level_id, player_id, name, animal_id, ticks, at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (level_id, player_id) DO UPDATE
         SET ticks = EXCLUDED.ticks, name = EXCLUDED.name, animal_id = EXCLUDED.animal_id, at = EXCLUDED.at
         WHERE EXCLUDED.ticks < parkour_times.ticks
       RETURNING ticks`,
      [levelId, entry.playerId, entry.name, entry.animalId, entry.ticks, entry.at],
    );
    // No row returned means the WHERE guard rejected it: the stored time was already better.
    if (upsert.rows.length === 0) return -1;

    const ranked = await this.sql.query(
      `SELECT COUNT(*) + 1 AS rank FROM parkour_times
       WHERE level_id = $1 AND (ticks < $2 OR (ticks = $2 AND at < $3))`,
      [levelId, entry.ticks, entry.at],
    );
    const rank = Number(ranked.rows[0]?.rank ?? 0);
    if (!Number.isFinite(rank) || rank <= 0) return -1;
    return rank > maxEntries ? -1 : rank;
  }

  async top(levelId: string, count: number): Promise<LeaderboardEntry[]> {
    const result = await this.sql.query(
      `SELECT player_id, name, animal_id, ticks, at FROM parkour_times
       WHERE level_id = $1 ORDER BY ticks ASC, at ASC LIMIT $2`,
      [levelId, count],
    );
    return result.rows.map(toEntry);
  }

  async personalBest(levelId: string, playerId: string): Promise<LeaderboardEntry | null> {
    const result = await this.sql.query(
      `SELECT player_id, name, animal_id, ticks, at FROM parkour_times
       WHERE level_id = $1 AND player_id = $2`,
      [levelId, playerId],
    );
    const row = result.rows[0];
    return row ? toEntry(row) : null;
  }

  /** Writes go straight to the database, so there is nothing buffered to flush. */
  async flush(): Promise<void> {}
}

function toEntry(row: Record<string, unknown>): LeaderboardEntry {
  return {
    playerId: String(row.player_id ?? ''),
    name: String(row.name ?? ''),
    animalId: String(row.animal_id ?? ''),
    ticks: Number(row.ticks ?? 0),
    at: Number(row.at ?? 0),
  };
}
