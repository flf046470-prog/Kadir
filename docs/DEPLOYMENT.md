# Deployment

The server is a standard Next.js application with a PostgreSQL database. There
is nothing exotic in here: no queue, no worker, no cache tier, no object storage
unless photos are configured to use one.

Everything below assumes you have chosen a host and a database. Neither choice
is made in this repository, deliberately — both cost money and both are hard to
reverse, so they belong to whoever pays for them.

---

## What has to exist first

| | Why |
| --- | --- |
| A PostgreSQL 16 database | Everything. There is no fallback store. |
| A domain with TLS | Deep links, the PWA manifest, and both stores refuse plain HTTP. |
| `DATABASE_URL` | The one required variable. |
| `NEXT_PUBLIC_SITE_URL` | Canonical URLs and referral links are built from it. |

Everything else in `.env.example` is optional and switches a feature on. Unset,
each one is *off* rather than broken: no translation provider means no
translation, no S3 bucket means photos on local disk, no Microsoft credentials
means Windows purchases answer "not open".

## Migrations

```bash
npm run db:migrate
```

Run it before the new version starts serving, not after. Every migration so far
is additive — new tables and columns — so an old instance keeps working against
a migrated database, which is what makes a rolling deploy safe. **If that ever
stops being true, this line has to change**, and the migration that breaks it
should say so in its own commit.

## Running it

Two ways, and the difference matters more than it looks.

### `npm run start`

The ordinary Next.js production server. Needs `node_modules` present.

```bash
npm ci
npm run build
npm run start
```

This is the path every check in this repository has been run against.

### The container

`Dockerfile` builds a three-stage image around `output: standalone`, which
traces the modules the server actually reaches and writes a `server.js` that
runs without `node_modules`. The runtime image carries the application and
nothing else, runs as an unprivileged user, and has a `HEALTHCHECK` that reaches
`/api/health`.

```bash
docker build -t fiorematch .
docker run -p 3000:3000 -e DATABASE_URL=... -e NEXT_PUBLIC_SITE_URL=... fiorematch
```

> **Verify page rendering on the first deploy, before trusting this image.**
>
> The standalone server was exercised in the development sandbox and behaved in
> a way I could not fully explain: `/api/health` and the other API routes answer
> correctly, but page routes returned 500 with
> `getaddrinfo EMFILE localhost`, which is libuv's error when it cannot use its
> thread pool. The process showed a single thread, where the ordinary
> `next-server` process on the same machine showed eleven.
>
> That pattern points at a sandbox restriction on thread creation rather than at
> the application or the Dockerfile — the same code serves the same pages
> correctly under `npm run start`, and the standalone build itself succeeds.
> But I could not prove it, and the honest position is that **standalone page
> rendering is unverified**.
>
> So: after the first `docker run`, request a page — not just `/api/health` —
> and confirm it returns 200. If it does not, `npm run start` is a working
> fallback and the container is the thing to debug, not the app.

## Checks

`.github/workflows/ci.yml` runs lint, typecheck, the migrations, the whole test
suite and a production build against a real PostgreSQL 16 service — on every
pull request, and on every push to `fiorematch-main`.

The same sequence is what to run before pushing:

```bash
npm run lint
npm run typecheck
npm run db:migrate
npm test
npm run build
```

The migrations run *before* the tests, and they are the real migrations rather
than a schema push, so a migration that would fail on a deploy fails here
instead — in the cheap place.

The workflow lives on this branch only. Several unrelated applications share
this repository on different branch trees, and a pull request runs the workflow
from its own head, so this checks FioreMatch and nothing else.

## Health

`GET /api/health` reaches the database and answers `200` or `503`. It is a
*readiness* probe: an instance that is running but cannot read should leave the
load balancer rotation rather than serve errors to every signed-in member.

It deliberately reveals nothing else — no version, no commit, no environment, no
error text. It answers to anyone who can reach the port, and a version string is
a free hint about which advisories apply.

## The mobile shells depend on this

`capacitor.config.ts` bakes `CAPACITOR_SERVER_URL` into the native builds at
`npx cap sync` time. Until the server is live at that URL, the Android and iOS
apps open `mobile/shell/error.html` — the branded offline screen — rather than
the app. That is the shell working correctly, not a failure.

This is also why deployment comes before the VR work: a headset has nothing to
connect to until this exists.

## What is not here yet

Named rather than omitted, so the gaps are decisions instead of surprises:

- **CI checks, it does not deploy.** Nothing publishes an image or runs a
  migration against a real database; both are still done by hand, on purpose,
  because both belong to whoever owns the environment.
- **Nothing drives a browser.** The suite is unit and database tests. The
  screenshot pipeline (`npm run capture`) does drive Chromium, but it needs
  seeded data and a running server, so it stays a command someone runs rather
  than a check.
- **No rate-limit store.** `src/lib/rate-limit.ts` is an in-memory fixed window,
  so with more than one instance the effective limit is *instances × limit*. It
  says so in its own comment. Before scaling past one instance this needs a
  shared store.
- **No backups.** A managed database usually provides them; confirm rather than
  assume, and test a restore before it matters.
- **No error reporting.** Failures reach the container log and nowhere else.
