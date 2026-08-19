import "server-only";

import { getDb } from "./db";

export const VOTE_CHOICES = ["absolutely", "love", "change", "idea"] as const;
export type VoteChoice = (typeof VOTE_CHOICES)[number];

export function isVoteChoice(value: string): value is VoteChoice {
  return (VOTE_CHOICES as readonly string[]).includes(value);
}

export type VoteTally = { choice: VoteChoice; count: number; percent: number };

export type Idea = {
  id: number;
  name: string;
  country: string;
  email: string;
  body: string;
  status: string;
  published: number;
  created_at: string;
};

/**
 * One vote per client key. A repeat vote replaces the previous answer rather
 * than adding a second one, so the tally stays honest without accounts.
 */
export function recordVote(choice: VoteChoice, country: string, clientKey: string): void {
  const db = getDb();
  db.prepare(
    // The unique index on client_key is partial, so the conflict target has to
    // repeat its WHERE clause for SQLite to match it.
    `INSERT INTO feedback_votes (choice, country, client_key) VALUES (?, ?, ?)
     ON CONFLICT(client_key) WHERE client_key <> '' DO UPDATE SET
       choice = excluded.choice,
       country = excluded.country,
       created_at = datetime('now')`,
  ).run(choice, country, clientKey);
}

export function hasVoted(clientKey: string): VoteChoice | null {
  const row = getDb()
    .prepare("SELECT choice FROM feedback_votes WHERE client_key = ?")
    .get(clientKey) as { choice: string } | undefined;
  return row && isVoteChoice(row.choice) ? row.choice : null;
}

/** Returns an empty array when nobody has voted — never a placeholder tally. */
export function getVoteTallies(): { total: number; tallies: VoteTally[] } {
  const rows = getDb()
    .prepare("SELECT choice, COUNT(*) AS count FROM feedback_votes GROUP BY choice")
    .all() as { choice: string; count: number }[];

  const total = rows.reduce((sum, r) => sum + r.count, 0);
  if (total === 0) return { total: 0, tallies: [] };

  const byChoice = new Map(rows.map((r) => [r.choice, r.count]));
  const tallies = VOTE_CHOICES.map((choice) => {
    const count = byChoice.get(choice) ?? 0;
    return { choice, count, percent: Math.round((count / total) * 100) };
  });
  return { total, tallies };
}

export function addIdea(input: {
  name: string;
  country: string;
  email: string;
  body: string;
}): void {
  getDb()
    .prepare("INSERT INTO ideas (name, country, email, body) VALUES (?, ?, ?, ?)")
    .run(input.name, input.country, input.email, input.body);
}

export function listIdeas({ status = "" }: { status?: string } = {}): Idea[] {
  const where = status ? "WHERE status = ?" : "";
  const params = status ? [status] : [];
  return getDb()
    .prepare(`SELECT * FROM ideas ${where} ORDER BY created_at DESC, id DESC`)
    .all(...params) as Idea[];
}

/** Ideas the owner has explicitly chosen to publish, with names only. */
export function getPublishedIdeas(limit = 6): Pick<Idea, "id" | "name" | "country" | "body" | "created_at">[] {
  return getDb()
    .prepare(
      `SELECT id, name, country, body, created_at FROM ideas
       WHERE published = 1 ORDER BY created_at DESC LIMIT ?`,
    )
    .all(limit) as Pick<Idea, "id" | "name" | "country" | "body" | "created_at">[];
}

export type CommunityStats = {
  votes: number;
  saidYes: number;
  ideas: number;
  members: number;
  earlyAccess: number;
  countries: number;
};

/**
 * Aggregates only. Nothing here identifies a person, and every figure is a
 * straight count of rows that actually exist.
 */
export function getCommunityStats(): CommunityStats {
  const db = getDb();
  const one = (sql: string, ...params: unknown[]) =>
    (db.prepare(sql).get(...params) as { c: number }).c;

  return {
    votes: one("SELECT COUNT(*) AS c FROM feedback_votes"),
    saidYes: one("SELECT COUNT(*) AS c FROM feedback_votes WHERE choice IN ('absolutely','love')"),
    ideas: one("SELECT COUNT(*) AS c FROM ideas"),
    members: one("SELECT COUNT(*) AS c FROM community_members WHERE status = 'active'"),
    earlyAccess: one(
      "SELECT COUNT(*) AS c FROM community_members WHERE status = 'active' AND interests LIKE '%early_guest%'",
    ),
    countries: one(
      `SELECT COUNT(*) AS c FROM (
         SELECT country FROM community_members WHERE country <> ''
         UNION
         SELECT country FROM feedback_votes WHERE country <> ''
         UNION
         SELECT country FROM ideas WHERE country <> ''
       )`,
    ),
  };
}

/* ── supporters (schema-only until a payment provider is connected) ─────── */

export type Supporter = {
  id: number;
  display_name: string;
  country: string;
  amount_minor: number;
  currency: string;
  created_at: string;
};

/** Only supporters who ticked the box are ever returned, and never their email. */
export function getListedSupporters(): Supporter[] {
  return getDb()
    .prepare(
      `SELECT id, display_name, country, amount_minor, currency, created_at
       FROM supporters
       WHERE listed_consent = 1 AND status = 'succeeded' AND display_name <> ''
       ORDER BY created_at DESC`,
    )
    .all() as Supporter[];
}
