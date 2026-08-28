import { readFile, writeFile, mkdir } from 'node:fs/promises';
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
 * Parkour leaderboard.
 *
 * Times are only ever submitted by the room that ran the match, never by a client. Kept in
 * memory with periodic flushes; the file is the durable copy.
 */
export class Leaderboard {
  private byLevel = new Map<string, LeaderboardEntry[]>();
  private dirty = false;

  constructor(
    private readonly dataDir: string,
    private readonly maxEntries = 100,
  ) {}

  private file(): string {
    return join(this.dataDir, 'leaderboards', 'parkour.json');
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.file(), 'utf8');
      const parsed = JSON.parse(raw) as Record<string, LeaderboardEntry[]>;
      this.byLevel = new Map(Object.entries(parsed));
    } catch {
      this.byLevel = new Map();
    }
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    const target = this.file();
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(Object.fromEntries(this.byLevel)), 'utf8');
    this.dirty = false;
  }

  /** Returns the new rank (1-based) when the time made the board, otherwise -1. */
  submit(levelId: string, entry: LeaderboardEntry): number {
    if (!Number.isFinite(entry.ticks) || entry.ticks <= 0) return -1;
    const list = this.byLevel.get(levelId) ?? [];
    const existing = list.findIndex((e) => e.playerId === entry.playerId);
    if (existing >= 0) {
      const current = list[existing] as LeaderboardEntry;
      if (current.ticks <= entry.ticks) return -1; // personal best not beaten
      list.splice(existing, 1);
    }
    list.push(entry);
    list.sort((a, b) => a.ticks - b.ticks);
    if (list.length > this.maxEntries) list.length = this.maxEntries;
    this.byLevel.set(levelId, list);
    this.dirty = true;
    const rank = list.findIndex((e) => e.playerId === entry.playerId);
    return rank < 0 ? -1 : rank + 1;
  }

  top(levelId: string, count = 20): LeaderboardEntry[] {
    return (this.byLevel.get(levelId) ?? []).slice(0, count);
  }

  best(levelId: string): LeaderboardEntry | null {
    return this.byLevel.get(levelId)?.[0] ?? null;
  }

  personalBest(levelId: string, playerId: string): LeaderboardEntry | null {
    return this.byLevel.get(levelId)?.find((e) => e.playerId === playerId) ?? null;
  }
}
