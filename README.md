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

Every page is prerendered as static HTML (329 routes), mobile-first, and
renders correctly in RTL for Arabic.

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
| `de` `es` `fr` `it` `pt` `ar` `ja` `ko` `hi` `id` | Routing, hreflang, and RTL wired up; **copy currently mirrors English pending professional translation** |

The i18n architecture is complete for all 12 locales — each has its own
catalog at `src/i18n/messages/<locale>.json`, its own URL prefix, and correct
hreflang. Translating a locale means editing its catalog only; no code changes
are needed. Arabic already renders RTL correctly.

Adding a 13th language: add the code to `src/i18n/locales.ts`, add a display
name, and drop in `src/i18n/messages/<code>.json`.

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
