# FioreMatch Roadmap

The brief describes a full multi-platform product. This document sequences that
scope into phases, each following the required loop:

**PLAN → DEVELOP → TEST → SECURITY CHECK → FIX → DEPLOY → MONITOR**

Nothing moves to production without passing security, payments, authentication,
privacy, moderation, performance, SEO, and mobile-responsiveness checks.

---

## Phase 0 — Web foundation ✅ shipped

The public web surface, statically generated across 12 locales.

- Marketing, pricing, safety, about, contact pages
- SEO country/city pages and guide articles
- Legal pages (Privacy, Terms, Community Guidelines, Cookies)
- Full i18n architecture, hreflang, canonical URLs, sitemap, robots
- JSON-LD: Organization, WebSite, SoftwareApplication, Article, FAQPage
- Account UI shells, explicitly non-functional

**Exit criteria met:** builds clean, 329 static routes, no console errors,
mobile and RTL verified.

---

## Phase 1 — Identity & data layer

The first phase that touches real user data, and therefore the first that
needs a full security review.

- PostgreSQL schema + migration tooling
- Email and phone registration, secure login, password reset
- Password hashing (argon2id), session management, rate limiting
- Profile model: photos, bio, age, city, country, interests, hobbies,
  relationship intent, languages, preferences
- Privacy controls and **full account deletion** (GDPR/KVKK erasure)
- API layer with authorization enforced server-side on every route

**Security gate:** authentication flow review, rate-limit verification,
PII-at-rest audit, deletion-completeness test.

---

## Phase 2 — Core product loop

The MVP that makes the product a dating app rather than a website.

- Discover feed with Like / Pass / Super Like
- Mutual-like → Match creation
- Filters: age, country, city, language, interests, intent, distance,
  gender/preference
- Real-time messaging: text, emoji, photos, delete, read status, typing
- Block and report on every profile and conversation

**Design constraint:** the messaging schema carries a language field per
message from day one, so AI translation (Phase 5) is additive, not a rewrite.

---

## Phase 3 — Safety & moderation

Ships alongside Phase 2, not after it. A dating product without moderation
should not accept public signups.

- Spam and fake-account signal detection
- Fraud and romance-scam pattern detection
- Suspicious-behavior monitoring across likes, messages, reports
- AI-assisted content moderation with confidence thresholds
- **Human-reviewed moderation queue** — AI never takes final enforcement
  action alone on serious cases
- Moderator tooling: case view, action log, appeal trail

---

## Phase 4 — Monetization

- Product/subscription/entitlement/payment schema
- Apple In-App Purchase and Google Play Billing integration
- Web payment provider integration
- **Server-side receipt verification** — no client-trusted entitlements
- Webhook handling for renewals, refunds, chargebacks, cancellations
- Country-level pricing tiers managed centrally (App Store / Play tiers,
  not raw FX conversion)
- One-time products: Boost, Super Like, Profile Promotion, Premium Visibility

**Security gate:** entitlement bypass testing, webhook signature verification,
replay-attack protection.

---

## Phase 5 — AI layer

- Explainable matching over shared interests, hobbies, intent, language,
  lifestyle, stated preferences, and like/pass/match history
- "Why we think you may match" explanations surfaced to users
- AI Profile Assistant — bio, headline, interest, and opener suggestions
  that **never fabricate personal facts** about the user
- In-chat AI translation (PLUS feature)

**Constraint:** matching must remain explainable and auditable. No optimizing
for time-in-app at the expense of match quality.

---

## Phase 6 — Mobile apps

- iOS and Android clients sharing the Phase 1–4 API
- Shared account, profile, match, and subscription state with web
- Store-native purchase flows
- App Store and Play Store review readiness (dating-category requirements)

---

## Phase 7 — Operations & growth

- Admin panel: user, content, product, pricing, campaign, moderation,
  SEO, blog, and translation management
- Analytics: DAU, MAU, retention, churn, CAC, ARPU, LTV, conversion,
  match rate, message rate, revenue by country and language
- Referral system with fraud detection
- Hermes automation agent: SEO and technical monitoring, content planning,
  analytics reporting, error and performance monitoring — with a **human
  approval workflow** for anything consequential

**Hard constraint, all phases:** no fake traffic, no bot users, no fake
reviews, no fake followers, no synthetic engagement. Growth is real users,
real matches, real traffic, real revenue.

---

## Five-year targets

| Year | Focus |
| --- | --- |
| 1 | Product-market fit |
| 2 | Global SEO + social growth |
| 3 | AI matchmaking and international scaling |
| 4 | Approaching million-user scale |
| 5 | Established global dating/social brand |

Scenarios: cautious 500K users · successful 3M · very successful 10M+.
These are targets and scenarios, not guarantees.
