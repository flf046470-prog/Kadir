# Troubleshooting

Failures that have actually happened here, with what they looked like and what
they were. Every entry cost time to diagnose once; none of them should cost it
twice.

---

## The whole test suite fails at once

**Looks like:** hundreds of failures, all `resetDatabase`, and the run takes far
longer than usual.

```
Caused by: Error: connect ECONNREFUSED 127.0.0.1:5432
```

**It is not the tests.** Postgres is not running — it dies during long idle
gaps.

```bash
pg_lsclusters                  # Status: down
pg_ctlcluster 16 main start    # "Removed stale pid file."
```

Check this **before** reading a single test failure. The give-away is the
duration: a suite failing on assertions runs at normal speed, one failing on
connections spends its time in timeouts.

---

## `db:migrate` says it worked and creates nothing

**Looks like:** `migrations applied successfully!`, followed by every test
failing with `relation "users" does not exist`.

**Cause:** the database was reset by dropping the `public` schema only.
drizzle-kit keeps its migration journal in a **separate `drizzle` schema**, so
the journal survived, `db:migrate` concluded every migration had already been
applied, and it created nothing.

```sql
drop schema if exists public cascade;
drop schema if exists drizzle cascade;   -- the one that is easy to forget
create schema public;
```

This is worth understanding rather than just copying, because it is the shape of
a "CI passes, the deploy is empty" incident.

---

## Demo login stops working mid-session

**Looks like:** `invalid_credentials` for an account that worked ten minutes ago.

**Cause:** `npm test` truncates the database, and the demo accounts with it.

```bash
npm run seed:demo
```

The seed prints a session cookie, which is what `npm run capture` wants.

---

## `npm run capture` fails on `03-otomatik-ceviri`

**Looks like:** `locator.waitFor: Timeout 15000ms exceeded`, only that one
screenshot, the other nine fine.

**Cause:** that capture waits for *translated* text, so it fails when no
translation provider is configured — deliberately, so a run without one cannot
ship a screenshot of the feature switched off under a filename saying it is on.

```bash
npm run translate:stub &            # speaks DeepL's real contract
TRANSLATE_PROVIDER=deepl DEEPL_API_KEY=stub \
  DEEPL_API_HOST=http://127.0.0.1:3210 npm run start
```

If it still times out with the stub running, the demo conversation has changed
and `PHRASES` in `scripts/translate-stub.mjs` no longer covers its first line.
The stub echoes anything it does not know, so the wait never matches.

---

## Browser tests fail with `ECONNREFUSED` on port 3100

They do not start a server. They talk to `FM_BASE_URL` (default
`http://127.0.0.1:3100`) and expect a **built** app with demo data behind it:

```bash
npm run build
npm run seed:demo
npm run start &
npm run test:browser
```

`CHROMIUM_PATH` overrides the browser binary where Playwright's own copy is not
the one you want.

---

## A browser test fails on a missing image, not on the app

**Looks like:** `console.error: Failed to load resource: … 404`.

Chromium reports a failed subresource as a `console.error`, with the same type as
a React warning, so a naive collector flags a missing favicon as a broken page.
`collectFailures` filters those by their fixed Chromium text. If you add a
similar check anywhere, filter them there too — otherwise the suite becomes the
thing everyone reruns until it goes green.

If the 404 is on `/api/photos/…`, the cause is usually a photo *row* whose file
was never written — inserting rows directly instead of going through
`uploadPhoto`.

---

## Pages 500 in the standalone container while the API is fine

**Looks like:** `/api/health` answers, page routes return 500 with
`getaddrinfo EMFILE localhost`.

libuv cannot use its thread pool. Observed in the development sandbox with a
single-threaded process where the ordinary `next-server` showed eleven threads,
which points at a sandbox restriction on thread creation rather than at the
application — but it was never proven. `DEPLOYMENT.md` records this as
**unverified**: request a page after the first `docker run`, and if it fails,
`npm run start` is a working fallback and the container is the thing to debug.

---

## `npm install` refuses an override

```
npm error code EOVERRIDE
npm error Override for postcss@^8.5.1 conflicts with direct dependency
```

An `overrides` entry must not contradict the direct dependency's own range. Use
`"postcss": "$postcss"` to mean "whatever we already resolved", which is what
you want when the direct dependency is already on a patched version and only a
nested copy is vulnerable.

---

## `npm audit` fails CI

The gate is `--omit=dev --audit-level=high`. Before reaching for
`npm audit fix --force` — which will happily install a new major version of Next
— check whether the advisory is against a **nested** copy that an `overrides`
entry can pin to the version already resolved. Two of the two advisories found
here were exactly that. `docs/SECURITY.md` records what was fixed, and the one
moderate that is accepted rather than fixed.

---

## `pkill -f` kills the shell

```bash
pkill -f "next start -p 3101"     # matches its own command line
```

Use the port instead:

```bash
fuser -k 3101/tcp
```

---

## Vercel checks are red but CI is green

If the description is **"Deployment rate limited — retry in 24 hours"**, it is
the account's daily build quota, not this code. Seventeen unrelated projects are
attached to this repository, so every push to it triggers eighteen builds. The
fix is to detach the unrelated projects in the Vercel dashboard, not to change
anything here.

The check that means something about FioreMatch is **"Lint, types, tests,
build"**.

---

## A store submission is rejected for something small

Run the checker before submitting, not after:

```bash
npm run store:check
```

It catches the drift that causes this: a support address that differs between
listings, a character count that is wrong, a screenshot older than the copy it
shows, product ids that no longer match the code. It cannot tell you whether a
store's requirements have changed — that part is reading their documentation,
and the report says so on every run.
