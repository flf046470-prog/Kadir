# Patagonia Underground

Community-first website for an early-stage project in Trevelin, Chubut, Argentina.

## Principles

- Sell less, tell more, show the real journey.
- No fake progress, construction updates, budgets, reviews, bookings or partnerships.
- Concept/editorial imagery is explicitly labelled and is never presented as built project photography.
- The current project stage is Planning.

## Local development

```bash
cp .env.example .env
# Fill the required values in .env
npm install
npm run db:migrate
npm run dev
```

Production:

```bash
npm run build
npm start
```

## Routes

`/`, `/project`, `/story`, `/transparency`, `/progress`, `/journal`, `/gallery`, `/location`, `/updates`.

The app uses a lightweight history-based route layer so it can be moved to a router or server-rendered setup later. Configure the host to serve `index.html` for these paths.

## Current data boundary

The community form currently uses `localStorage` under `patagonia-community` as a transparent demo fallback. The local admin drawer supports search, country filtering, active/inactive toggling, deletion and CSV export, but it is explicitly **not production authentication**.

Before launch, replace the repository adapter with a server/API implementation backed by a secure database, add password hashing and authorization, add rate limiting and audit logs, connect a consent-aware email provider, and implement secure media uploads. Never put database credentials or provider secrets in the frontend.

Social profiles remain disabled until verified URLs are supplied. No payment, donation, pre-sale, booking or OTA integration is included in this MVP.

## Verified donation service

This repository now includes a backend foundation for a legitimate, consent-based campaign. It deliberately does not automate unsolicited outreach, fake activity, deceptive AI copy, matched-donation abuse, crypto reward extraction, or fund transfers. It records only payment-provider webhooks that pass signature verification and uses an idempotent `PaymentEvent.eventId` constraint so one provider event cannot create two donations.

Setup:

```bash
cp .env.example .env
npm install
npm run prisma:generate
npm run prisma:migrate
npm run server:dev
```

`PAYMENT_MODE=mock` is accepted only outside production and is intended for local tests. Replace `configured-provider` in `server/index.ts` with the approved provider adapter after verifying that provider's webhook contract and payout ownership. No card data is stored. `ADMIN_TOKEN` is a temporary bearer-token boundary; a production deployment must replace it with a real password-hashed, MFA-capable admin identity provider, add CSRF protection for browser admin sessions, audit logs, secret rotation, and provider-specific webhook replay protection.

The service exposes `/health`, `/api/campaign`, and a signed `/api/webhooks/payment` endpoint. Social posts are stored as drafts and require explicit human approval; no automatic direct messages are sent. Only factual, human-reviewed campaign copy should be published.


Per-route title and description are updated client-side. `public/sitemap.xml` and `public/robots.txt` are included. Replace the example canonical host with the real deployment domain before publishing. External landscape imagery is used as editorial reference; add photographer/source/license metadata to the future media repository before using project imagery.
