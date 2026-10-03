import type { SaveStore } from '@kc/core';
import { FileLeaderboardStore, SqlLeaderboardStore } from './leaderboard-store.js';
import type { LeaderboardStore, SqlClient } from './leaderboard-store.js';
import { FileSaveStore, SqlSaveStore } from './persistence.js';

export interface StorageBundle {
  saves: SaveStore;
  leaderboard: LeaderboardStore;
  /** How storage was resolved, for the boot log. */
  description: string;
}

/**
 * Connect to Postgres without making `pg` a dependency of this package.
 *
 * A deployment that asks for a database gets a database or a clear failure — never a silent
 * fall back to files. Falling back would look like it worked and then lose every purchase the
 * moment a second instance started serving the same player.
 */
export async function createSqlClient(databaseUrl: string): Promise<SqlClient> {
  // The specifier is held in a variable so TypeScript and the bundler do not try to resolve
  // "pg" at build time: it is an optional runtime dependency of the deployment, not of this
  // package, and the file-storage path must build and run without it present.
  const specifier = 'pg';
  let pg: { Pool: new (config: { connectionString: string }) => SqlClient };
  try {
    pg = (await import(/* @vite-ignore */ specifier)) as unknown as typeof pg;
  } catch {
    throw new Error(
      'KC_DATABASE_URL is set but the "pg" package is not installed. Run `npm install pg` in the ' +
        'deployment, or unset KC_DATABASE_URL to use file storage (single instance only).',
    );
  }
  return new pg.Pool({ connectionString: databaseUrl });
}

/**
 * Pick the storage drivers.
 *
 * File storage is correct for exactly one writer: local development, and the Steam build's
 * embedded server, where the only player is the person running it. Anything horizontally
 * scaled needs the SQL drivers, because both a profile save and a leaderboard submit are
 * read-modify-write against shared state when done over a file, and two instances doing that
 * concurrently silently lose one of the two writes.
 */
export async function createStorage(options: { dataDir: string; databaseUrl: string }): Promise<StorageBundle> {
  if (!options.databaseUrl) {
    const leaderboard = new FileLeaderboardStore(options.dataDir);
    await leaderboard.load();
    return {
      saves: new FileSaveStore(options.dataDir),
      leaderboard,
      description: `files in ${options.dataDir} (single instance only)`,
    };
  }

  const sql = await createSqlClient(options.databaseUrl);
  const saves = new SqlSaveStore(sql);
  const leaderboard = new SqlLeaderboardStore(sql);

  // Never log the URL itself: it carries the password.
  const host = safeHost(options.databaseUrl);

  // `new Pool()` does not connect, so an unreachable or misconfigured database first shows up
  // here. That is the most common deployment mistake and the moment a connection string is
  // most likely to end up in a log, so the error is rebuilt from the redacted host rather than
  // passed through — including the original as `cause` would put it back in the log.
  try {
    await saves.migrate();
    await leaderboard.migrate();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // No `cause` on purpose: Node prints the cause chain, which would restore the driver's
    // unredacted message. The detail is carried across as text, after redaction.
    // oxlint-disable-next-line preserve-caught-error
    throw new Error(`Cannot reach the database at ${host}: ${redact(detail, options.databaseUrl)}`);
  }

  return { saves, leaderboard, description: `postgres at ${host} (shared across instances)` };
}

/**
 * Strip the connection string's password out of a message.
 *
 * The driver decides what goes in its errors, and that is not a promise we can make on its
 * behalf — so the password is removed by value rather than by trusting any particular format.
 */
function redact(message: string, databaseUrl: string): string {
  let password = '';
  try {
    password = new URL(databaseUrl).password;
  } catch {
    return message; // unparseable url: there is no password to find
  }
  return password ? message.split(password).join('***') : message;
}

function safeHost(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    return `${url.hostname}${url.port ? `:${url.port}` : ''}${url.pathname}`;
  } catch {
    return '(unparseable url)';
  }
}
