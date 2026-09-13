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

**One exception, and it is the launch blocker.** Photo screening unset does not
mean "photos are not screened and that is fine" — it means every upload waits
for a human, which is safe but does not scale. Before opening public signups,
wire both screening drivers and set `REQUIRE_PHOTO_SCREENING=true`, which makes
the upload endpoint answer 503 rather than filling a queue nobody can keep up
with. See [`PHOTO_SCREENING.md`](PHOTO_SCREENING.md).

## A working preview on Vercel

A preview with no database serves the marketing site and fails on everything
behind sign-in, which is enough to check the copy and not enough to walk
through the product. Two attachments fix that, and they are separate decisions.

### 1. Postgres

In the project's **Storage** tab, create a Postgres database and attach it. The
integration writes the connection variables itself — no copying. It writes
`POSTGRES_URL` among them, which is why `db/client.ts` accepts that name as well
as `DATABASE_URL`: a deploy with a database plainly attached in the dashboard
should not fail with "DATABASE_URL is not set".

Then, from a machine that can reach it:

```bash
DATABASE_URL='<the UNPOOLED connection string>' npm run db:migrate
DATABASE_URL='<the UNPOOLED connection string>' npm run seed:demo
```

**Unpooled for both.** The pooled URL goes through PgBouncer in transaction
mode, which does not carry the session state DDL and advisory locks need —
migrations appear to succeed and leave the schema half-applied. Vercel exposes
the direct one as `DATABASE_URL_UNPOOLED` or `POSTGRES_URL_NON_POOLING`. The
running app wants the *pooled* one; only these two commands want the direct one.

`DATABASE_POOL_MAX` defaults to 3 on Vercel rather than 10, because every warm
function instance keeps its own pool and a hundred-connection ceiling is
exhausted by the tenth instance. Raise it only behind a pooler.

#### If the Postgres is a Supabase project

One extra step, and it is a security step rather than a convenience one.

Supabase serves every table in `public` over HTTPS through PostgREST, to the
`anon` and `authenticated` roles. The anon key is **publishable by design** —
it ships in client bundles — so with Row Level Security off, anyone holding it
can read and write every row: `users` carries password hashes, `sessions`
carries session token hashes, `messages` carries every conversation on the
product.

FioreMatch never uses Supabase's client libraries. It connects as the table
owner over `DATABASE_URL` with postgres-js, and **an owner bypasses RLS**. So
the correct configuration here is RLS enabled with *no policies at all*: that
closes the PostgREST door completely and leaves the application's own path
untouched.

```sql
ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;
-- ...and every other table in public, plus drizzle.__drizzle_migrations
```

Supabase's linter will then report `rls_enabled_no_policy` at INFO level. That
is the expected end state for this architecture, not an unfinished job — the
advice behind that lint assumes an app talking to PostgREST, and this one does
not. Do it before the first row exists; it is reversible per table with
`DISABLE ROW LEVEL SECURITY`.

### 2. Photos

Photos need object storage. Without it the app writes to local disk, and on a
serverless platform that disk is read-only and thrown away between invocations —
so uploads fail and seeded photos are not there to serve. Discover renders
cards with no images, which reads as broken rather than as unconfigured.

Any S3-compatible bucket works; the driver takes an endpoint and path-style
addressing, so Cloudflare R2, Backblaze B2 and Supabase Storage are all fine
alongside AWS. Set `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and
for anything but AWS `S3_ENDPOINT` (`S3_REGION=auto` suits R2).

Seed **after** the bucket is attached, so the demo photos are written to it
rather than to whatever disk ran the seeder:

```bash
DATABASE_URL='<unpooled>' S3_BUCKET=... S3_ENDPOINT=... \
  S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... npm run seed:demo
```

> **A preview database is not a staging database.** `seed:demo` creates accounts
> whose password is a constant in this repository. That is safe while Vercel
> Authentication is on — the default for previews, and what makes these URLs
> ask for a login. Turning that off to show somebody makes those accounts
> reachable by anyone who has read the repo. Keep the protection on, or seed
> nothing.

---

## Publishing before signups open

These are two decisions, and `SIGNUPS=closed` is what keeps them apart.

Photo screening blocks **signups** specifically: no photo can reach another
member before there is somebody to upload it. The marketing site carries no such
dependency — twelve locales of location pages and guides, and search ranking is
mostly made of age, so every week they are not indexed is a week that cannot be
bought back later.

So the sequence that loses nothing:

1. Point the domain at the host, deploy with `SIGNUPS=closed`. The site is live
   and indexable; `/register` explains rather than 404s, so the links being
   indexed now are the ones that will work later.
2. Apply for PhotoDNA. It is an application with third-party vetting, so this is
   the wait, and it runs in parallel with the site accruing age.
3. When the drivers are wired, set `REQUIRE_PHOTO_SCREENING=true`, drop
   `SIGNUPS`, and redeploy.

Existing members are never affected by step 1 — they sign in, message and keep
everything. Closing signups is not a maintenance mode.

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

`.github/workflows/ci.yml` runs lint, typecheck, a dependency audit, the
migrations, the whole test suite, a production build, and then the browser
tests against that build — on every pull request, and on every push to
`fiorematch-main`.

The same sequence is what to run before pushing:

```bash
npm run lint
npm run typecheck
npm audit --omit=dev --audit-level=high
npm run db:migrate
npm test
npm run build

# The browser tests need the built server and the demo data behind it.
npm run seed:demo
npm run start &
npm run test:browser
```

`npm run test:browser` talks to `FM_BASE_URL` (default `http://127.0.0.1:3100`)
and does not start anything itself, so it can be pointed at a preview
deployment as easily as at a local server. `CHROMIUM_PATH` overrides the browser
binary where Playwright's own copy is not what you want.

The migrations run *before* the tests, and they are the real migrations rather
than a schema push, so a migration that would fail on a deploy fails here
instead — in the cheap place.

The workflow lives on this branch only. Several unrelated applications share
this repository on different branch trees, and a pull request runs the workflow
from its own head, so this checks FioreMatch and nothing else.

## Store notifications

`POST /api/billing/notifications/[store]` has to be reachable from the public
internet, without a session, or refunds never reach the server. It is the only
unauthenticated write in the application, and what stands in for the session is
the signature check inside the store's driver — so **it must not be put behind
an IP allowlist that assumes the stores publish stable addresses**, and equally
must not be exempted from TLS.

No driver exists for any store yet, so today it answers `503` to everything.
That is the safe direction: nothing is written until a driver can prove a
notification was signed. Configure a store's credentials and the same URL starts
accepting that store's notifications and no others.

Its replies are addressed to a machine that retries: `503` and `429` mean "come
back", `400` means "stop". Anything in front of this route — a proxy, a WAF, a
rate limiter — that turns a retryable answer into a final one will silently
discard the notifications sent during an incident, and a discarded refund is a
subscription that keeps running after the money went back.

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
- **Browser coverage is a smoke test, not a suite.** Five checks run against the
  built server in CI — the home page renders without the browser reporting a
  fault, Arabic lays out right to left, Discover is refused to a signed-out
  visitor, the login form works, and Discover shows people whose photos actually
  load. They catch "the deploy is blank", which nothing else does. They do not
  cover the product's screens in any depth, and are deliberately few: a browser
  suite earns its keep only while every failure means something.
- **No rate-limit store.** `src/lib/rate-limit.ts` is an in-memory fixed window,
  so with more than one instance the effective limit is *instances × limit*. It
  says so in its own comment. Before scaling past one instance this needs a
  shared store.
- **Photo screening has no drivers.** The pipeline, the interfaces and the
  tests are built; PhotoDNA and a classifier need accounts, and PhotoDNA's is
  an application with third-party vetting rather than a signup. This is the one
  gap on this list that blocks a launch rather than merely being absent.
- **No backups.** A managed database usually provides them; confirm rather than
  assume, and test a restore before it matters.
- **No error reporting.** Failures reach the container log and nowhere else.
- **No analytics vendor, deliberately.** `/app/admin/metrics` counts the
  product's own tables when someone opens it. There is nothing to configure and
  nothing to send, which is the point: the alternative is shipping dating
  behaviour to a third party. What it costs is that every number is computed on
  demand — fine at this size, and the first thing to revisit if the page gets
  slow rather than the first thing to replace with a tracker.
