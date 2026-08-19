# FioreMatch

**Meet Beyond Borders.** — Global AI Dating & Social Connection Platform.

This repository contains the FioreMatch web application: a multi-language,
SEO-first marketing site plus a working signed-in product — registration,
profiles, and a Discover feed driven by an explainable matching engine.

## What's in this repo today

### Marketing site

Statically generated across 12 locales:

- **Marketing & product pages** — home, `/dating`, `/international-dating`,
  `/features`, `/pricing`, `/safety`, `/about`, `/contact`
- **SEO location pages** — `/dating/[country]` and `/dating/[city]`, driven by
  a structured data file (`src/lib/countries-data.ts`) with genuine,
  hand-written content per location
- **Guides** — `/guides` and four full articles on international dating,
  online dating safety, first dates, and cross-cultural dating
- **Legal** — Privacy Policy, Terms of Service, Community Guidelines,
  Cookie Policy
- **SEO plumbing** — `sitemap.xml`, `robots.txt`, canonical URLs, hreflang
  across all 12 locales plus `x-default`, and JSON-LD for Organization,
  WebSite, SoftwareApplication, Article, and FAQPage

Every marketing page is prerendered as static HTML, mobile-first, and renders
correctly in RTL for Arabic. The signed-in app has its own shell so these pages
stay static.

### Product logic (V2/V3)

A tested, dependency-free domain core for the differentiation features. These
are pure functions over plain data — no database, no network — so they can be
wired into the API layer when it lands, without rework.

- **`src/lib/domain/`** — shared taxonomies (relationship goals, match intents,
  cultures, travel styles, ideal dates, discovery modes, verifications), the
  `MatchProfile` shape with per-field visibility, and the compatibility quiz
- **`src/lib/matching/`** — 11 matching signals, the Smart Match Score with
  per-mode weights, the Match Reason Engine, Today's 5 selection, the AI
  Matchmaker validation boundary, and the feedback learning loop
- **`src/lib/safety/`** — Scam Shield detection and risk banding, the
  moderation state machine, Trust Profile badges, Date Safety plans, and
  negation-aware copy guards
- **`src/lib/games/`** — Match Games: five game types, prompt banks, session
  lifecycle, and fair reveal (neither player can see the other's answer before
  both have answered, enforced server-side rather than by the UI)
- **`src/lib/referral/`** — Crockford Base32 referral codes with confusable
  folding, a reward ladder, and fraud signals that hold a payout for human
  review rather than penalising the referrer
- **`src/lib/flags/`** — deterministic percentage rollout (0/1/5/10/25/50/100)
  with nested cohorts and kill switches, for all 22 V2/V3 features

**167 tests**, all passing (`npm test`) — unit tests for the domain logic plus
integration tests against a real Postgres database covering auth, cascade
deletion, matching, the like/match race, visibility enforcement, and
conversation authorization.

See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the full analysis and
[`docs/AI_SAFETY.md`](./docs/AI_SAFETY.md) for the AI constraints.

### Working application

A real, signed-in product running on Postgres:

- **Auth** — registration with an 18+ check, argon2id password hashing, session
  cookies storing only a token hash, login rate limiting per IP and per account,
  and account deletion that cascades across every table
- **Profile** — editable profile with per-field visibility, validated against
  the taxonomies on write
- **Discover** — the matching engine over real data, six discovery modes, with
  every suggestion showing why it was made
- **Like / Pass / Super Like → Match** — including the concurrency handling for
  two members liking each other simultaneously
- **Messaging** — conversations per match, read state, message deletion, block,
  and report. Scam Shield runs on every outbound message and warns the
  *recipient* (never the sender, which would only teach evasion); high risk
  queues for human review and never auto-blocks anyone

`/en/app/*` requires a session; the API returns 401 and the pages redirect to
login. A conversation that isn't yours returns 404, not 403 — telling a stranger
it exists would confirm a match they have no business knowing about.

## Not implemented (and deliberately not faked)

- Match Games UI and the AI features (matchmaker, icebreaker, translation) —
  the logic exists and is tested, but is not wired to a UI
- Real-time message delivery (the conversation view polls; WebSockets later)
- Email and phone verification delivery
- Payments (Apple IAP, Google Play Billing, web), entitlements, webhooks
- Admin panel and analytics dashboards
- iOS and Android applications
- Photo upload and storage

These require dedicated backend, security, and compliance work — plus accounts
and services only the project owner can provision. See
[ROADMAP.md](./ROADMAP.md) for the phased plan.

## Tech stack

- **Next.js 15** (App Router, React 19) — static generation for SEO and speed
- **PostgreSQL** with **Drizzle ORM** — typed schema and versioned migrations
- **argon2id** (`@node-rs/argon2`) for password hashing
- **next-intl** — locale routing, message catalogs, RTL support
- **Tailwind CSS** — design system tokens in `tailwind.config.ts`
- **TypeScript** — strict mode
- **Vitest** — unit and integration tests

## Getting started

```bash
npm install
cp .env.example .env.local   # then set DATABASE_URL
npm run db:migrate           # create the schema
npm run dev     # http://localhost:3000 → redirects to /en
npm run build   # production build, prerenders all locales
npm run start   # serve the production build
npm test        # unit + integration tests (integration needs DATABASE_URL)
npm run lint
```

`DATABASE_URL` is required and has no in-code default: a misconfigured deploy
fails at startup rather than silently connecting somewhere unintended. Secrets
live in `.env.local`, which is gitignored — never in source.

## Project structure

```
src/
  app/[locale]/(marketing)/  Static marketing site
  app/[locale]/app/    Signed-in application shell
  app/api/             Route handlers
  app/sitemap.ts       Sitemap covering every locale × route
  app/robots.ts        robots.txt
  components/          Header, Footer, LanguageSwitcher, cards, JSON-LD
  lib/domain/          Taxonomies, MatchProfile + visibility, quiz
  lib/matching/        Signals, score, reasons, Today's 5, matchmaker, learning
  lib/safety/          Scam Shield, Trust Profile, Date Safety, copy guards
  lib/games/           Match Games: prompts, session state, fair reveal
  lib/referral/        Referral codes, reward ladder, fraud detection
  lib/flags/           Feature flags with staged rollout
  db/                  Schema, client, repositories, integration tests
  auth/                Passwords, sessions, accounts, route guards
  i18n/
    locales.ts         Locale list, RTL list, display names
    navigation.ts      Locale-aware Link / router
    request.ts         Message loading per request
    messages/*.json    One catalog per locale
  lib/
    seo.ts             Metadata, hreflang, and schema.org builders
    countries-data.ts  Country and city page content
    guides-data.ts     Guide article content
```

## Translation status

| Locale | Status |
| --- | --- |
| English (`en`) | Complete |
| Turkish (`tr`) | Complete |
| `de` `es` `fr` `it` `pt` `ar` `ja` `ko` `hi` `id` | Routing, hreflang, and RTL wired up; **falls back to English until translated** |

The i18n architecture is complete for all 12 locales — each has its own URL
prefix and correct hreflang, and Arabic already renders RTL. Untranslated
locales fall back to the English catalog rather than shipping duplicated copies
that would silently drift out of sync.

**To translate a locale:** add `src/i18n/messages/<locale>.json` and list the
locale in `fullyTranslatedLocales` in `src/i18n/locales.ts`. No other code
changes are needed.

**To add a 13th language:** add the code to `locales` in
`src/i18n/locales.ts` and give it a display name. It will serve English until
its catalog lands.

## Content policy

Per the project brief, this codebase does not and will not generate fake
users, fake traffic, fake reviews, fake followers, or synthetic engagement.
SEO pages are hand-written per location rather than templated at scale, so
each page says something actually true and useful about that place.

## Pricing model

PLUS and VIP are both **$1.99/year** as a global base price. Local prices are
intended to follow Apple App Store and Google Play country-level pricing
tiers — not raw currency conversion — managed centrally so they can be tuned
per market from an admin surface. The pricing page states this; the
central price management backend is Phase 4 of the roadmap.
