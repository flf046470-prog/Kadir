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

**Exit criteria met:** builds clean, 365 static routes, no console errors,
mobile and RTL verified.

---

## Phase 0.5 — Product logic core ✅ shipped

The V2/V3 differentiation features have a deterministic core that does not
depend on a database. Building and testing it first means the hard parts are
proven before the app exists to host them.

- Domain taxonomies, `MatchProfile` with per-field visibility, compatibility quiz
- 11 matching signals, Smart Match Score with per-mode weights, Match Reason
  Engine, Today's 5, AI Matchmaker validation boundary, feedback learning loop
- Scam Shield detection + risk banding + moderation state machine, Trust
  Profile, Date Safety plans, copy guards
- Match Games: five game types, prompt banks, session lifecycle, fair reveal
- Referral: Crockford Base32 codes, reward ladder, qualification gating, and
  fraud signals that hold rather than punish
- Feature flags with staged rollout for all 22 V2/V3 features
- Marketing pages: `/how-matching-works`, `/global-match`, `/conversations`,
  `/referral`, expanded `/safety`

**Exit criteria met:** unit tests passing, lint clean, build clean.
Analysis in `docs/ARCHITECTURE.md`; constraints in `docs/AI_SAFETY.md`.

These modules are libraries, not features a member can use — they need Phases
1–2 to have profiles, a feed, and conversations to operate on.

---

## Phase 1 — Identity & data layer ✅ shipped

- PostgreSQL schema (12 tables) with Drizzle migrations
- Email registration with an 18+ check, secure login, logout
- argon2id password hashing at OWASP parameters; sessions store only a
  SHA-256 of the token, so a database leak yields no usable sessions
- Rate limiting per IP and per account on login, per IP on registration
- Profile model with per-field visibility, validated against the taxonomies
- **Full account deletion** by cascade from `users`, so erasure cannot drift
  out of sync with the schema
- API layer with `requireUser` on every non-public route

**Security gate passed:** no user enumeration (a miss burns equivalent hash
time), password never stored readably, expired and revoked sessions rejected,
password change revokes all sessions, deletion completeness verified across
every table. All covered by integration tests against a real database.

**Not yet done in this phase:** phone registration, password reset delivery,
and email/phone verification delivery — all need an email/SMS provider.

---

## Phase 2 — Core product loop 🚧 in progress

Shipped:
- Discover feed running the matching engine over real data, six modes
- Like / Pass / Super Like, and mutual-like → Match
- Explainable reasons rendered on every suggestion
- Block, which also removes an existing match
- Optional pass feedback stored for the learning loop

The like/match path serialises on an advisory lock keyed to the pair. Without
it, two members liking each other simultaneously produced *no* match at all —
neither transaction could see the other's uncommitted row. Found by a
concurrency test, which now guards it.

- Messaging with read state, message deletion, block, and report
- Scam Shield running on every message, warning the recipient and queueing
  high-risk cases for human review
- Photo upload with EXIF/GPS stripping, gated behind moderation review
- Discovery filters — age, country, city, language, relationship goal, match
  intent, culture — applied in SQL, with every value checked against a closed
  vocabulary before it reaches a query
- Profile cards on Discover: name, age, city, goal, bio and languages, with
  each member's visibility settings applied server-side

Filters live in the URL rather than in browser storage: a reload keeps them, a
link carries them, and nothing about a member's search is left behind on a
shared device. Place ids are slugified on every write, so "Germany" and
"germany" are one country rather than two — without that, a country filter
matches almost nobody and looks like an empty product.

Still to build:

- Distance filter, and gender / preference filtering (needs those fields first)
- Real-time delivery (the conversation view polls today), typing indicators
- Photo sharing in messages
- Today's 5 surface

**Design constraint:** the messaging schema must carry a language field per
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
- **Automated NSFW and CSAM screening for photos — a hard launch blocker.**
  Photos are already gated behind approval and `approvePhoto` is the hook, but
  no automated screening exists. Public signups must not open until a
  hash-matching service (e.g. PhotoDNA) and a classifier are wired in.

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
