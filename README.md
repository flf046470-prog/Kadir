# Patagonia Underground

A community-first project site for an earth-sheltered house being planned in
**Trevelin, Chubut, Argentine Patagonia**.

The point of this first release is not to take money. It is to tell the story,
show the real state of the project, and build a list of people who want to watch
it happen.

```
SITE → STORY → TRANSPARENCY → COMMUNITY → SOCIAL → FOLLOW THE JOURNEY
```

## The rules this site is built to

These are enforced in code, not just in copy:

| Rule | How it is enforced |
| --- | --- |
| No fake progress | A phase marked `not_started` cannot be saved with a progress percentage — the admin form rejects it. Bars only render when a real percentage exists. |
| No fake numbers | Community statistics are `COUNT(*)` over real rows. A figure of zero is hidden rather than invented. Vote percentages appear only once someone has voted. |
| No fake photos | The gallery ships empty with an honest empty state. Every image requires alt text **and** a licence before it can be saved. All artwork on the site is original SVG, labelled as illustration or diagram. |
| No fake bookings | There is no reservation system. The Airbnb button only appears when `AIRBNB_URL` is set to a real listing. |
| No fake payments | No payment provider is connected. The support section says so plainly instead of rendering a checkout that cannot take money. |
| No fake testimonials | Community ideas are published one at a time, by explicit action in the admin panel, and only with the name the sender chose to give. |

## Stack

- **Next.js 16** (App Router, React 19, Turbopack) with TypeScript
- **Tailwind CSS v4** — design tokens in `src/styles/globals.css`
- **SQLite** via `better-sqlite3` — one file, no external service
- **Three.js** for the conceptual 3D landscape, loaded only on request
- Server Actions for every mutation; no client-side data fetching layer

## Getting started

```bash
npm install
cp .env.example .env.local     # then fill in the values below
npm run dev                    # http://localhost:3000
```

The database file is created and migrated automatically on first request, and
seeded with starter content whose phases all begin at their true state.

### Creating the admin account

```bash
npm run admin:password         # prompts, prints ADMIN_PASSWORD_HASH=…
```

Put the hash and an `ADMIN_EMAIL` in your environment, then open `/admin` — the
account is created on the first sign-in. Passwords are hashed with scrypt; the
plain password is never stored.

### Environment

See `.env.example`. Everything optional degrades to an honest "not configured"
state rather than a broken feature:

| Variable | Effect when unset |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Canonical URLs fall back to `localhost` |
| `SESSION_SECRET` | A development default is used — **set this in production** |
| `EMAIL_PROVIDER` | Sign-ups are stored locally and logged; nothing is sent |
| `SUPPORT_ENABLED` / `STRIPE_SECRET_KEY` | Support section shows "coming soon" |
| `AIRBNB_URL` | Site states that reservations are not open |

## Commands

```bash
npm run dev         # development server
npm run build       # production build
npm start           # serve the production build
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
```

## Structure

```
src/
  app/
    (site)/[locale]/      public site — one route group, locale-prefixed
    (admin)/admin/        admin panel — its own root layout, never indexed
    api/community/stats/  aggregate counts only, no personal data
    sitemap.ts robots.ts opengraph-image.tsx
  components/             UI, original SVG artwork, the 3D scene
  lib/                    db, auth, content access, i18n, validation, uploads
  locales/                24 translation bundles
  services/               email + payment abstractions (swap-in points)
  proxy.ts                locale negotiation and redirects
```

## Languages

24 locales live under `src/locales/`, served from `/{locale}/…` with `hreflang`
alternates and a searchable switcher. Arabic and Hebrew set `dir="rtl"` on the
document, and the layout uses logical properties (`start`/`end`) throughout.

Any key missing from a bundle falls back to English, so a partial translation
still renders a complete page. Long-form project copy is published in English
and edited from the admin panel; the footer says so on non-English pages rather
than implying a translation exists.

## The 3D landscape

`/location` and the home page carry an **Explore Trevelin** section with a
Map ⇄ 3D toggle. The map is the default everywhere; the Three.js bundle is only
fetched when someone switches to 3D.

The terrain is generated procedurally from a deterministic noise function — a
conceptual Andean valley, labelled "Conceptual — not survey data" on screen. It
is **not** a survey of the real terrain, and the plot's real position is not
published. Landmarks are clickable, the render loop pauses when the canvas
scrolls out of view or the tab is hidden, WebGL support is detected before the
toggle is enabled, and the same places are always described in text below the
canvas for anyone who cannot or does not want to use it.

## Security

- scrypt password hashing, opaque session tokens stored as SHA-256 hashes
- Server-side validation (Zod) on every form, plus honeypot fields
- SQLite rate limiting on sign-ups, votes, ideas and login attempts
- Raw IPs are never stored — only an HMAC of them, keyed by `SESSION_SECRET`
- Parameterised SQL everywhere; React escapes all rendered content
- Uploads are checked by MIME **and** magic bytes, renamed randomly, capped at 8 MB
- Security headers (HSTS, `X-Frame-Options`, `X-Content-Type-Options`, Permissions-Policy) set in `next.config.ts`
- The admin panel is `noindex`, and route handlers re-check the session rather than trusting the page guard

## Deployment

The site is one Node process plus a SQLite file, so it runs anywhere with a
persistent volume: a VPS, a container, Fly.io, Railway. Point `DATABASE_PATH`
and the `public/uploads` directory at that volume.

On a serverless platform with an ephemeral filesystem, the database and uploads
would not survive between invocations. Moving to Postgres and object storage
means replacing `src/lib/db.ts` and `src/lib/upload.ts`; nothing else reads the
filesystem directly.

## Roadmap

The architecture is laid out for these phases; nothing beyond phase 1 is
implemented or implied on the public site.

1. **Now** — site, story, transparency, community, social, updates
2. Construction journal, live progress
3. Project support (payments)
4. Early access / pre-sale
5. Direct booking
6. Airbnb / OTA integration
7. Guest accounts
8. Experiences
