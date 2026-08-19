# Patagonia Underground

Community-first website for an early-stage project in Trevelin, Chubut, Argentina.

## Principles

- Sell less, tell more, show the real journey.
- No fake progress, construction updates, budgets, reviews, bookings or partnerships.
- Concept/editorial imagery is explicitly labelled and is never presented as built project photography.
- The current project stage is Planning.

## Local development

```bash
npm install
npm run dev
```

Production checks:

```bash
npm run lint
npm run build
npm run preview
```

## Routes

`/`, `/project`, `/story`, `/transparency`, `/progress`, `/journal`, `/gallery`, `/location`, `/updates`.

The app uses a lightweight history-based route layer so it can be moved to a router or server-rendered setup later. Configure the host to serve `index.html` for these paths.

## Current data boundary

The community form currently uses `localStorage` under `patagonia-community` as a transparent demo fallback. The local admin drawer supports search, country filtering, active/inactive toggling, deletion and CSV export, but it is explicitly **not production authentication**.

Before launch, replace the repository adapter with a server/API implementation backed by a secure database, add password hashing and authorization, add rate limiting and audit logs, connect a consent-aware email provider, and implement secure media uploads. Never put database credentials or provider secrets in the frontend.

Social profiles remain disabled until verified URLs are supplied. No payment, donation, pre-sale, booking or OTA integration is included in this MVP.

## SEO and assets

Per-route title and description are updated client-side. `public/sitemap.xml` and `public/robots.txt` are included. Replace the example canonical host with the real deployment domain before publishing. External landscape imagery is used as editorial reference; add photographer/source/license metadata to the future media repository before using project imagery.
