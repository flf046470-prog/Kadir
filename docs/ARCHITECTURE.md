# FioreMatch V2/V3 — Architecture Analysis

This document is the **PLAN** step for the V2 and V3 differentiation features.
It records what each feature needs before any of it is built, and which parts
have already landed.

## Starting point

Before this work, the repository was a static marketing site: Next.js App
Router, 12 locales, no database, no API routes, no authentication, no Discover
feed, no messaging. That matters, because most V2/V3 features are features *of
an application that does not exist yet*.

Rather than stub a fake app, this round built the parts that are real,
self-contained, and testable today — the domain model, the matching engine, the
safety logic, and the rollout machinery — plus the marketing pages that explain
the positioning. Everything else is sequenced below.

## What landed in this round

| Module | What it does | Tests |
| --- | --- | --- |
| `src/lib/domain/taxonomies.ts` | Shared vocabulary: relationship goals, match intents, cultures, travel styles, ideal dates, discovery modes, reach, pass reasons, verifications | via engine tests |
| `src/lib/domain/profile.ts` | `MatchProfile` shape + per-field visibility, enforced by `applyVisibility` | ✓ |
| `src/lib/domain/quiz.ts` | Compatibility quiz bank and per-signal answer comparison | ✓ |
| `src/lib/matching/signals.ts` | 11 individual matching signals, each returning strength + evidence | ✓ |
| `src/lib/matching/score.ts` | Smart Match Score, per-mode weights, confidence handling | ✓ |
| `src/lib/matching/reasons.ts` | Match Reason Engine + banded compatibility display | ✓ |
| `src/lib/matching/todays-five.ts` | Today's 5 selection | ✓ |
| `src/lib/matching/matchmaker.ts` | AI Matchmaker criteria validation boundary | ✓ |
| `src/lib/matching/learning.ts` | Feedback-driven weight adjustment with caps and decay | ✓ |
| `src/lib/safety/scam-shield.ts` | Scam signal detection, risk banding, moderation state machine | ✓ |
| `src/lib/safety/trust-profile.ts` | Verification badges, no aggregate score | ✓ |
| `src/lib/safety/date-safety.ts` | Date plan lifecycle and opt-in sharing | ✓ |
| `src/lib/safety/copy-guards.ts` | Negation-aware copy guard helper | ✓ |
| `src/lib/games/prompts.ts` | Match Games prompt banks, ids only; text in i18n | ✓ |
| `src/lib/games/session.ts` | Game session lifecycle, answer validation, fair reveal | ✓ |
| `src/lib/referral/codes.ts` | Crockford Base32 codes with confusable folding | ✓ |
| `src/lib/referral/rewards.ts` | Qualification, reward ladder, fraud signals, payout decision | ✓ |
| `src/lib/photos/process.ts` | Magic-byte sniffing, bomb guards, EXIF-stripping re-encode | ✓ |
| `src/lib/storage/` | Storage driver interface + local-disk driver | ✓ |
| `src/db/photos.ts` | Upload, moderation gating, per-viewer visibility | ✓ |
| `src/lib/flags/flags.ts` | Deterministic percentage rollout for all 22 V2/V3 flags | ✓ |

185 tests, all passing: unit tests for the pure domain modules plus integration
tests against a real Postgres database. The domain modules take plain data and
touch no infrastructure, which is what made them testable before the app that
now hosts them existed.

## The eight-point analysis

### 1. Architecture impact

The matching engine is deliberately a **pure library**, not a service. It takes
profiles in and returns scores and reasons out. That keeps three properties:

- It is fully testable without infrastructure (proven — no mocks needed).
- It can run in the API process now and move to a dedicated service later
  without changing callers.
- The set of fields it can see is fixed by the `MatchProfile` type, so
  sensitive attributes cannot leak into scoring by accident.

Per-mode weights live in data (`modeWeights`), not in branching logic, so the
admin panel can tune matching without a deploy.

### 2. Database changes

New tables/columns needed when Phase 1 lands:

| Area | Storage |
| --- | --- |
| Profile | `relationship_goal`, `match_intents[]`, `connection_mode`, `ideal_dates[]`, `communication_styles[]`, `languages_spoken[]`, `languages_learning[]`, `culture_interests[]`, `open_to_other_cultures`, `future_plans[]` |
| Visibility | `profile_visibility` — one row per member, six enum columns |
| Quiz | `quiz_answers` — (member_id, question_id, option_id) |
| Travel | `travel_plans` — destination, date range, styles; indexed on (city, date range) |
| Future location | `future_locations` — city, country, approximate month |
| Matching | `match_feedback` (pass reasons), `signal_weights` (learned multipliers per member) |
| Today's 5 | `daily_suggestions` — (member_id, date, profile_id, score, reasons) for stability and analytics |
| Safety | `risk_assessments`, `moderation_cases` (with the state machine's stage), `verifications`, `date_plans` |
| Games | `game_sessions`, `game_rounds`, `game_answers`; answers must be readable per-player so the server can enforce fair reveal, plus `played_prompts` per pair to avoid repeats |
| Referral | `referral_codes` (unique index), `referrals` with qualification state, `referral_rewards`, `referral_fraud_signals` |
| Photos | `photos` — content-addressed storage key, dimensions, position, moderation status; indexed on (user, position) and on moderation status for the queue |
| Flags | `feature_flags` — name, rollout, killed, always_on[] |

Indexing notes: Discover needs a composite index on (country, city, goal,
active_at); Travel Match needs a range index on trip dates; Today's 5 is read
by (member_id, date).

### 3. API changes

New endpoints, all authenticated and authorization-checked server-side:

```
POST /api/matchmaker/parse      free text → validated criteria
GET  /api/discover?mode=...     paged candidates for a discovery mode
GET  /api/suggestions/today     Today's 5
POST /api/feedback/pass         optional pass reason
GET  /api/profile/visibility    read/update per-field visibility
POST /api/travel-plans          create/update/delete a trip
POST /api/messages/:id/translate
POST /api/conversation/suggest  icebreaker / coach suggestions
POST /api/safety/report
POST /api/date-plans            create, share, transition status
GET  /api/flags                 the caller's enabled features
```

Rate limits matter most on `/matchmaker/parse`, `/translate`, and
`/conversation/suggest` — each costs a model call, so each needs per-member
quotas independent of the subscription tier.

### 4. UI changes

Shipped: `/how-matching-works`, `/global-match`, `/conversations`, and an
expanded `/safety` explaining Scam Shield, Trust Profile, and Date Safety.

Still to build (needs the app): onboarding goal/intent step, the compatibility
quiz flow, discovery-mode switcher, Today's 5 screen, the match screen with
reasons + icebreaker + games + translate + safety entry points, profile
sections with per-section visibility toggles, and the admin panel.

### 5. AI changes

Four model-backed features, each with a narrow, validated contract:

| Feature | Contract |
| --- | --- |
| AI Matchmaker | Model proposes criteria; `parseCriteria` validates against closed taxonomies and drops anything unrecognised |
| AI Icebreaker / Coach | Model receives only the shared signals already computed, and returns suggestions the member chooses to send |
| AI Translation | Translated text always shown alongside the original, one tap apart |
| AI Date Planner | Generates plan *shapes* (budget, timing, activity type); never invents specific businesses or availability |

The recurring pattern: the model never writes directly into matching or into a
conversation. It proposes; deterministic code validates; the member decides.

### 6. Privacy implications

- **Visibility is enforced at the boundary.** `applyVisibility` strips hidden
  fields before scoring reads them, so a UI bug cannot leak a hidden field and
  a hidden field cannot influence suggestions. Covered by test.
- **Location is coarse.** The engine receives a pre-rounded distance and city/
  country ids, never coordinates. Future location is stored to the month.
- **Travel and future location default to matches-only.**
- **Learning uses only volunteered feedback** — explicit pass reasons. No dwell
  time, no scroll tracking, no silent behavioural profiling.
- **GDPR/KVKK:** every new table above must be covered by the existing account
  deletion path, and travel/future-location data must be included in export.
  This is a Phase 1 acceptance criterion, not a follow-up.

### 7. Security implications

- **Prompt injection into matching** is blocked structurally: model output is
  validated against closed vocabularies before it can influence a search
  (`parseCriteria`, tested with malicious and malformed input).
- **Scam Shield cannot act alone.** The moderation state machine only permits
  `action` from `human_review`; tested.
- **Feature flags are not a security boundary.** A flagged-off feature must
  still be enforced server-side — the flag hides the UI, authorization denies
  the call.
- **Rate limiting** on all model-backed endpoints, or a single member can run up
  unbounded cost.
- **Date Safety data is sensitive.** Trusted-contact details are encrypted at
  rest, and a plan is shared only with an explicit per-plan opt-in; tested.
- **Fair reveal is a server responsibility.** `viewFor` redacts a partner's
  game answer until both have answered, so the API must serve the redacted
  view — never the full round with the UI hiding part of it. Tested.
- **Photos are the highest-risk upload path.** Format comes from magic bytes,
  not the request; every image is re-encoded (stripping EXIF/GPS and any
  metadata payload); decoding is pixel-capped against decompression bombs;
  storage keys are content-addressed and server-generated so there is no
  traversal surface; and objects are served through a route that checks
  moderation state rather than a static mount. **Automated NSFW/CSAM screening
  is still missing and is a hard launch blocker** — `approvePhoto` is the hook.
- **Referral payouts are the abuse surface.** Rewards unlock on qualification
  rather than signup, payouts are capped per referrer per month, and a
  suspicious referral is held for review rather than auto-penalised. Tested.

### 8. Testing requirements

Present: 57 unit tests over matching, reasons, selection, criteria validation,
learning, scam detection, moderation transitions, trust badges, date-plan
lifecycle, flag rollout, and copy guards.

Required before each feature ships:
- Integration tests once the API exists (authorization on every endpoint).
- Visibility tests at the API boundary, not just the library.
- A fairness check: matching outcomes compared across groups to catch
  disparate impact before wider rollout.
- Load testing on Discover and Today's 5 at realistic candidate volumes.

## Rollout plan

Every V2/V3 feature is behind a flag, defaulting to **off**. Order:

1. `smart_match`, `match_intent`, `compatibility_dna` — the matching core.
2. `todays_five`, `discovery_modes`, `global_match` — the surfaces built on it.
3. `scam_shield`, `trust_profile`, `date_safety` — safety, before wider reach.
4. `culture_connect`, `language_exchange`, `travel_match`, `future_location`.
5. `ai_matchmaker`, `ai_icebreaker`, `ai_translation`, `conversation_coach`.
6. `match_games`, `success_stories`, `referral`, `ai_date_planner`.

Each steps 1% → 5% → 10% → 25% → 50% → 100%, holding at each step until the
metrics below are stable. Cohorts are nested, so widening never reshuffles who
is in the experiment.

## Analytics

Per feature: adoption, engagement, and effect on the funnel —
match rate, conversation rate, first-message rate, retention, paid conversion,
AI recommendation engagement, Today's 5 engagement, Global Match usage,
translation usage, scam reports, and date intent. Plus the V3 additions:
Culture Connect, Language Exchange, Travel Match, Future Location, Icebreaker,
Coach, quiz completion, match-reason engagement, and pass-feedback rate.

Conversion chains to watch: match → conversation, conversation → continued
conversation, match → date intent.

## Product philosophy, enforced in code

> Don't swipe forever. Meet people who actually fit you.

Three places where that is a code constraint rather than a slogan:

- `selectTodaysFive` returns **fewer** than five when fewer good matches exist.
  Padding the list is the failure mode it exists to prevent.
- `buildReasons` cannot emit a reason without real shared evidence.
- `decayTowardNeutral` keeps a member's feed from narrowing permanently.

## Not built, and why

Auth, database, API, Discover, messaging, mobile apps, payments, and the admin
panel remain unbuilt — see `ROADMAP.md`. The modules here are the pieces that
could be built correctly *without* those, and they are ready to be wired in
when those phases land.
