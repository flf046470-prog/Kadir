# Deploying the game server

The client ships inside the store packages. This document is about the other half: the
authoritative server that actually runs matches.

## What kind of process this is

A room is a 60 Hz simulation loop holding open WebSocket connections and per-player state in
memory. That rules out serverless: a function that can be frozen, relocated or scaled to zero
between requests cannot hold a match together. It needs a container host or a VM that keeps the
process alive.

It also means **room state is per-instance**. Postgres makes profiles, purchases and leaderboards
shared; it does not make rooms shared. Two instances behind a plain round-robin load balancer
will each hold their own set of rooms, and two players who wanted to play together can land on
different ones. See [Running more than one instance](#running-more-than-one-instance).

## Quick start

```bash
export KC_SESSION_SECRET=$(openssl rand -hex 32)
docker compose up --build
```

That brings up Postgres and the server, waits for the database to be genuinely ready before
migrating, and serves on `http://localhost:8787`.

Without Compose:

```bash
docker build -t kangaroo-chase .
docker run --rm -p 8787:8787 \
  -e KC_SESSION_SECRET=$(openssl rand -hex 32) \
  -e KC_DATABASE_URL=postgres://user:pass@host:5432/kangaroo \
  kangaroo-chase
```

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `KC_SESSION_SECRET` | — | **Required when `NODE_ENV=production`; the server refuses to boot without it.** Session tokens are signed with it, so a default value means anyone can forge a session. |
| `KC_DATABASE_URL` | *(empty)* | Postgres URL. Empty selects file storage, which is correct for **one instance only**. |
| `PORT` / `HOST` | `8787` / `0.0.0.0` | |
| `KC_DATA_DIR` | `/data` in the image | Only used by file storage. Needs a volume if you rely on it. |
| `KC_PUBLIC_DIR` | `/app/dist/client` | Static client. Harmless to serve alongside the API; the store builds carry their own copy. |
| `KC_ASSETLINKS` | *(empty)* | Digital Asset Links, served merged at `/.well-known/assetlinks.json`. Either the **JSON array itself** or a comma-separated list of files to read — a path cannot start with `[`, so the two do not collide. **Required for the Quest and Play builds**: without it Android cannot verify the Trusted Web Activity and the app launches with a browser URL bar, which the Horizon Store rejects for an immersive title. `build:quest` and `build:phone` each write a single-element array signed with its own key; one origin serving both apps needs both. The files are gitignored and never enter the image, so on a container host paste the JSON. |
| `KC_ALLOWED_ORIGINS` | *(empty = any)* | Comma-separated. Browsers send `Origin` on the WebSocket upgrade. Empty is fine for the Quest and Steam builds; set it if a public web origin exists. |
| `KC_MAX_ROOMS` / `KC_MAX_PLAYERS` | `200` / `16` | Voice is a mesh, so past ~16 per room it needs an SFU. |
| `KC_META_APP_ID`, `KC_META_APP_SECRET` | *(empty)* | Meta receipt verification. |
| `KC_STEAM_APP_ID`, `KC_STEAM_WEB_API_KEY` | *(empty)* | Steam receipt verification. |

A store with no credentials configured is absent from the routing table, so **its receipts are
refused rather than accepted unverified**. Leaving these empty is safe, not lax — it means
purchases fail closed. `dev:` receipts do not exist when `NODE_ENV=production`.

## Crash reporting

Two **build-time** variables, read by Vite when the client bundle is compiled. They are not server
settings and setting them at runtime does nothing — the client is a static bundle with nothing to
read a variable from.

| Variable | Notes |
| --- | --- |
| `VITE_SENTRY_DSN` | Sentry ingest address. Empty (the default) means the reporter never initialises, never fetches its chunk and never sends anything. **Not a secret**: a DSN is write-only, cannot read an issue, and every web build ships one in the clear. |
| `VITE_KC_RELEASE` | Build identity for the release tag, so an issue points at a commit. `dev` when unset. On Railway, `RAILWAY_GIT_COMMIT_SHA`. |

The Dockerfile takes both as `ARG`s before `npm run build`. On Railway they are ordinary service
variables; the builder passes them through.

What is sent is in `packages/client/src/telemetry/errors.ts` and is unit tested rather than
trusted: the error, the build, the platform and the route. No name, no chat, no voice, no
position; the user object and request headers are deleted, query strings are stripped, room codes
are replaced with `<room>`, and console and UI breadcrumbs are dropped as categories. Players can
turn it off in Settings; it is on by default.

**The Sentry auth token is a real secret and is a different thing from the DSN.** It uploads
source maps and must never reach the client. `vite.config.ts` emits `hidden` source maps so they
exist to be uploaded from the build machine, and the Dockerfile deletes them from the image
afterwards — they are 6.4 MB and have no business on a headset. The upload step goes immediately
above that deletion.

## Storage

File storage is correct for exactly one writer: local development, and the Steam build's
embedded server, where the only player is the person running it.

Anything else needs `KC_DATABASE_URL`. A profile save and a leaderboard submit are both
read-modify-write against a file, so two instances doing either concurrently silently lose one
of the two writes. The SQL drivers do each as a single statement — `INSERT … ON CONFLICT … DO
UPDATE … WHERE EXCLUDED.ticks < parkour_times.ticks` makes "keep the better time" the database's
job rather than the application's.

If `KC_DATABASE_URL` is set and the database is unreachable, the server **fails to start**. It
does not fall back to files: a fallback would look like it worked and then lose every purchase
the moment a second instance served the same player.

Schema is created at boot (`CREATE TABLE IF NOT EXISTS`), so there is no separate migration step.

To run the storage tests against a real database:

```bash
KC_TEST_DATABASE_URL=postgres://user:pass@host:5432/kangaroo npm test
```

They are skipped when that variable is unset.

## Deployment targets

**Fly.io** suits this well — persistent machines, private networking to Fly Postgres, and TCP
passthrough for WebSockets.

```bash
fly launch --no-deploy            # generates fly.toml from the Dockerfile
fly postgres create               # then: fly postgres attach <name>
fly secrets set KC_SESSION_SECRET=$(openssl rand -hex 32)
fly deploy
```

Set `min_machines_running = 1` and do **not** enable scale-to-zero: stopping the machine drops
every connected player mid-match.

**Railway / Render** work the same way — point them at the Dockerfile, add a Postgres plugin,
set `KC_SESSION_SECRET`, and disable any idle-sleep setting.

**A plain VPS** is the cheapest option and entirely reasonable here: `docker compose up -d`
behind Caddy or nginx with TLS. The reverse proxy must pass through the WebSocket upgrade:

```nginx
location /ws {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;   # a match outlives the default 60s idle timeout
}
```

That `proxy_read_timeout` is not optional. The default drops idle WebSockets after 60 seconds,
which looks exactly like a random disconnect bug.

## Health and shutdown

`GET /api/health` returns `{ ok, rooms, uptime }` and is what the image's `HEALTHCHECK` calls.
Treat it as liveness: if it fails the process is wedged and should be replaced.

On `SIGTERM` the server stops the rooms, flushes the leaderboard and closes, with a 3-second
backstop before forcing exit. The image uses the exec-form `CMD` so the server is PID 1 and
receives the signal directly — a shell wrapper would swallow it and the orchestrator would
`SIGKILL` mid-match instead.

## Running more than one instance

Profiles, purchases and leaderboards are shared through Postgres, so a second instance is safe
for *player data*. Rooms are not shared. Before scaling out, one of these has to exist:

1. **Sticky routing by room.** The client already receives a room id; the proxy would need to
   route by it so everyone in a room reaches the same instance.
2. **A matchmaking service** that assigns a room to an instance and hands the client that
   instance's address directly.

Neither is built. Until one is, run a single instance and scale it vertically — one process
handles far more than the player count this game needs at launch.

## What is not set up

* TLS termination — do it at the proxy or the platform.
* Backups. `pg_dump` on a schedule; the profile table is the part that cannot be regenerated.
* Metrics beyond the health endpoint.
* An SFU for voice past ~16 players per room.
