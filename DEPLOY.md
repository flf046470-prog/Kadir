# Deploying

The app is a single Next.js project at the repository root. There is no
monorepo, no nested app directory, and no custom output location — Vercel's
Next.js preset is correct as-is, and `vercel.json` pins it so a dashboard
setting cannot drift.

| Setting | Value |
| --- | --- |
| Root Directory | *(repository root — leave empty)* |
| Framework Preset | Next.js |
| Build Command | `next build` |
| Install Command | `npm install` |
| Output Directory | `.next` |
| Node.js Version | 20.x or newer (`engines` requires ≥ 20.9) |

## Deploy

```bash
npm install
npx vercel login          # once, on this machine
npx vercel deploy --prod  # from the repository root
```

The first `deploy` asks which scope and project to use and writes `.vercel/`
locally; every later `npx vercel deploy --prod` goes straight out.

## Routes

There is no `/` page component: `src/proxy.ts` reads `Accept-Language` (and the
`pu_locale` cookie) and redirects `/` to `/en`, `/tr`, `/es` and so on. A
`redirects()` entry in `next.config.ts` sends `/` to `/en` as a safety net, so
the root resolves even if the proxy is ever skipped. Everything else lives
under `/[locale]/…`, with `/admin` and `/api` outside the locale prefix.

## Environment

Every variable is optional — the site boots without any of them — but three
matter in production:

| Variable | Why |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Canonical tags, `hreflang`, sitemap and Open Graph URLs. Set it to the final domain. |
| `SESSION_SECRET` | Hashes admin session tokens and the IPs used for rate limiting. Without it the code falls back to a known development value — set a real one. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH` | The admin account. Until both are set nobody can sign in, which is the safe default. Generate the hash with `npm run admin:password`. |

`.env.example` documents the rest (email provider, Stripe, Airbnb URL). Add them
in Vercel under Settings → Environment Variables; `.env.local` is deliberately
excluded from the upload by `.vercelignore`.

## The database, and what serverless does to it

The site stores content, sign-ups, votes and ideas in SQLite through
`better-sqlite3`. On Vercel the project directory is read-only, so `src/lib/db.ts`
puts the file in `/tmp` when it detects a serverless runtime.

That is enough for the site to *run*, and everything the public sees — pages,
phases, the gallery — is re-seeded on every cold start, so the site always looks
complete. But `/tmp` belongs to one instance and does not outlive it:

- a sign-up, vote or idea written on one instance is invisible to the next;
- uploaded images cannot be stored at all (the admin panel says so plainly);
- the admin session ends whenever the instance recycles.

So Vercel is right for showing the site and collecting nothing. Before the
community forms are used in earnest, point the data layer at real storage:

- **Keep SQLite, move the file** — any host with a persistent volume (Fly.io,
  Railway, a small VPS, Docker with a mounted volume). Set `DATABASE_PATH` to
  that volume and nothing else changes.
- **Keep the SQL, change the driver** — Turso / libSQL speaks SQLite over the
  network and is close to a drop-in replacement for `better-sqlite3`.
- **Move to Postgres** — Neon, Supabase or Vercel Postgres. The schema in
  `src/lib/db.ts` is ordinary SQL; the queries live in `src/lib/content.ts`,
  `community.ts` and `auth.ts`.

Uploads have the same shape of problem: they are written under `public/uploads`.
On a persistent host that is a folder; on Vercel it needs object storage (Vercel
Blob, S3, Cloudinary) wired into `src/lib/upload.ts`.

## Domain

In Vercel: Project → Settings → Domains → **Add**, then enter the domain. Vercel
shows either an `A` record (`76.76.21.21`) for an apex domain or a `CNAME`
(`cname.vercel-dns.com`) for a subdomain; add that record at your DNS provider
and Vercel issues the certificate once it resolves. Afterwards set
`NEXT_PUBLIC_SITE_URL` to the same origin and redeploy, so canonical URLs,
`hreflang` and the sitemap all point at the domain rather than the deployment
URL.
