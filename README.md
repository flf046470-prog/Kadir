# FioreMatch

**Meet Beyond Borders.** — Global AI Dating & Social Connection Platform.

This repository contains the FioreMatch web application: a multi-language,
SEO-first Next.js site covering the public-facing product surface.

## What's in this repo today

A production-ready **web front end**, statically generated across 12 locales:

- **Marketing & product pages** — home, `/dating`, `/international-dating`,
  `/features`, `/pricing`, `/safety`, `/about`, `/contact`
- **SEO location pages** — `/dating/[country]` and `/dating/[city]`, driven by
  a structured data file (`src/lib/countries-data.ts`) with genuine,
  hand-written content per location
- **Guides** — `/guides` and four full articles on international dating,
  online dating safety, first dates, and cross-cultural dating
- **Legal** — Privacy Policy, Terms of Service, Community Guidelines,
  Cookie Policy
- **Account UI** — `/login` and `/register`, front-end only and clearly
  labeled as such (see *Not implemented* below)
- **SEO plumbing** — `sitemap.xml`, `robots.txt`, canonical URLs, hreflang
  across all 12 locales plus `x-default`, and JSON-LD for Organization,
  WebSite, SoftwareApplication, Article, and FAQPage

Every page is prerendered as static HTML (365 routes), mobile-first, and
renders correctly in RTL for Arabic.

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

**109 unit tests**, all passing (`npm test`).

See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the full analysis and
[`docs/AI_SAFETY.md`](./docs/AI_SAFETY.md) for the AI constraints.

## Not implemented (and deliberately not faked)

The following are **not** in this repo. The `/login` and `/register` pages
render a working form UI but create no account and send no data anywhere — they
say so on the page itself. Nothing here stores a password, processes a payment,
or claims a user count.

- Authentication, account storage, password reset
- Database, API layer, migrations
- Discover / Like / Pass / Match / messaging
- AI matching and AI Profile Assistant
- Moderation pipeline and moderation queue
- Payments (Apple IAP, Google Play Billing, web), entitlements, webhooks
- Admin panel and analytics dashboards
- iOS and Android applications

These require dedicated backend, security, and compliance work. See
[ROADMAP.md](./ROADMAP.md) for the phased plan.

## Tech stack

- **Next.js 15** (App Router, React 19) — static generation for SEO and speed
- **next-intl** — locale routing, message catalogs, RTL support
- **Tailwind CSS** — design system tokens in `tailwind.config.ts`
- **TypeScript** — strict mode

## Getting started

```bash
npm install
npm run dev     # http://localhost:3000 → redirects to /en
npm run build   # production build, prerenders all locales
npm run start   # serve the production build
npm test        # unit tests for the matching, safety, and flag logic
npm run lint
```

No environment variables are required for the current site. When backend
services land, secrets go in `.env.local` (gitignored) — never in source.

## Project structure

```
src/
  app/[locale]/        Locale-scoped routes (all pages live here)
  app/sitemap.ts       Sitemap covering every locale × route
  app/robots.ts        robots.txt
  components/          Header, Footer, LanguageSwitcher, cards, JSON-LD
  lib/domain/          Taxonomies, MatchProfile + visibility, quiz
  lib/matching/        Signals, score, reasons, Today's 5, matchmaker, learning
  lib/safety/          Scam Shield, Trust Profile, Date Safety, copy guards
  lib/games/           Match Games: prompts, session state, fair reveal
  lib/referral/        Referral codes, reward ladder, fraud detection
  lib/flags/           Feature flags with staged rollout
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
