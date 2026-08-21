import "server-only";

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

/**
 * SQLite is intentional for this MVP: the whole site is one small Node process
 * with a file-backed database, so it can be hosted on any VPS or container with
 * a persistent volume. `DATABASE_PATH` points at that volume in production.
 *
 * On a serverless host the project directory is read-only and only /tmp can be
 * written, so the default moves there. The database is then per-instance and
 * short-lived: pages, phases and the gallery come back from the seed on every
 * cold start, but sign-ups and votes written on one instance are not visible to
 * the next. Point DATABASE_PATH at real storage — a volume, or a hosted
 * Postgres/Turso — before collecting anything that has to last.
 */
const SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

const DB_PATH =
  process.env.DATABASE_PATH ??
  (SERVERLESS
    ? path.join("/tmp", "patagonia.db")
    : path.join(process.cwd(), "data", "patagonia.db"));

declare global {
  var __pu_db__: Database.Database | undefined;
}

function createConnection(): Database.Database {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL DEFAULT '',
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash  TEXT PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at  TEXT NOT NULL,
      user_agent  TEXT
    );

    CREATE TABLE IF NOT EXISTS community_members (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name  TEXT NOT NULL,
      email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
      country     TEXT NOT NULL DEFAULT '',
      consent     INTEGER NOT NULL DEFAULT 0,
      status      TEXT NOT NULL DEFAULT 'active',
      source      TEXT NOT NULL DEFAULT 'website',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_members_created ON community_members(created_at DESC);

    CREATE TABLE IF NOT EXISTS story_sections (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      slug        TEXT NOT NULL UNIQUE,
      kicker      TEXT NOT NULL DEFAULT '',
      heading     TEXT NOT NULL,
      body        TEXT NOT NULL DEFAULT '',
      sort_order  INTEGER NOT NULL DEFAULT 0,
      published   INTEGER NOT NULL DEFAULT 1,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS progress_phases (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      slug        TEXT NOT NULL UNIQUE,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'not_started',
      date_label  TEXT NOT NULL DEFAULT '',
      progress    INTEGER NOT NULL DEFAULT 0,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS posts (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      kind         TEXT NOT NULL DEFAULT 'update',
      slug         TEXT NOT NULL UNIQUE,
      title        TEXT NOT NULL,
      entry_date   TEXT NOT NULL,
      phase_slug   TEXT NOT NULL DEFAULT '',
      excerpt      TEXT NOT NULL DEFAULT '',
      body         TEXT NOT NULL DEFAULT '',
      image_path   TEXT NOT NULL DEFAULT '',
      image_alt    TEXT NOT NULL DEFAULT '',
      video_url    TEXT NOT NULL DEFAULT '',
      published    INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_posts_kind_date ON posts(kind, entry_date DESC);

    CREATE TABLE IF NOT EXISTS gallery_images (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path    TEXT NOT NULL,
      title        TEXT NOT NULL DEFAULT '',
      description  TEXT NOT NULL DEFAULT '',
      location     TEXT NOT NULL DEFAULT '',
      photographer TEXT NOT NULL DEFAULT '',
      source_url   TEXT NOT NULL DEFAULT '',
      license      TEXT NOT NULL DEFAULT '',
      category     TEXT NOT NULL DEFAULT 'patagonia',
      season       TEXT NOT NULL DEFAULT '',
      alt_text     TEXT NOT NULL DEFAULT '',
      width        INTEGER NOT NULL DEFAULT 0,
      height       INTEGER NOT NULL DEFAULT 0,
      sort_order   INTEGER NOT NULL DEFAULT 0,
      published    INTEGER NOT NULL DEFAULT 1,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_gallery_cat ON gallery_images(category, sort_order);

    CREATE TABLE IF NOT EXISTS rate_limits (
      bucket       TEXT PRIMARY KEY,
      hits         INTEGER NOT NULL DEFAULT 0,
      window_start INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS feedback_votes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      choice      TEXT NOT NULL,
      country     TEXT NOT NULL DEFAULT '',
      client_key  TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_votes_choice ON feedback_votes(choice);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_client ON feedback_votes(client_key)
      WHERE client_key <> '';

    CREATE TABLE IF NOT EXISTS ideas (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL DEFAULT '',
      country     TEXT NOT NULL DEFAULT '',
      email       TEXT NOT NULL DEFAULT '',
      body        TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'new',
      published   INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ideas_created ON ideas(created_at DESC);

    /*
     * Supporters exist as a schema only. No payment provider is connected, so
     * nothing writes to this table yet; it is here so that adding Stripe later
     * does not require a data migration.
     */
    CREATE TABLE IF NOT EXISTS supporters (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      display_name   TEXT NOT NULL DEFAULT '',
      email          TEXT NOT NULL DEFAULT '',
      country        TEXT NOT NULL DEFAULT '',
      amount_minor   INTEGER NOT NULL DEFAULT 0,
      currency       TEXT NOT NULL DEFAULT 'USD',
      provider       TEXT NOT NULL DEFAULT '',
      provider_ref   TEXT NOT NULL DEFAULT '',
      listed_consent INTEGER NOT NULL DEFAULT 0,
      status         TEXT NOT NULL DEFAULT 'pending',
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_supporters_ref ON supporters(provider, provider_ref)
      WHERE provider_ref <> '';
  `);

  // Columns added after the first release.
  addColumn(db, "community_members", "interests", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "community_members", "locale", "TEXT NOT NULL DEFAULT ''");
  // What an image shows — "Interior", "Floor plan", "Exterior — night". The
  // gallery groups and labels by it.
  addColumn(db, "gallery_images", "subject", "TEXT NOT NULL DEFAULT ''");
}

/** SQLite has no ADD COLUMN IF NOT EXISTS, so the column list is checked first. */
function addColumn(db: Database.Database, table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}


export function getDb(): Database.Database {
  if (!globalThis.__pu_db__) {
    globalThis.__pu_db__ = createConnection();
  }
  return globalThis.__pu_db__;
}
