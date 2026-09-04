# Security audit

A pass over the controls §30 asks for, done by reading the code rather than by
recalling what was intended. Each row says **how it was checked**, so the claim
can be re-run rather than trusted — and so a later change that breaks one is
findable.

Audited at `03d3998`, against the whole `src/` tree.

One finding, fixed in the same commit. Everything else held.

---

## The finding

**JSON-LD could be closed out of its own `<script>` tag.** `src/components/JsonLd.tsx`
serialised structured data with `JSON.stringify` and wrote it with
`dangerouslySetInnerHTML`. A script element's contents are raw text and the only
thing that ends one is `</script`; JSON has no reason to escape `<`, so a string
containing `</script><script>…</script>` would have closed the tag and run.

**Not reachable at the time it was found.** Every caller is a statically
generated marketing page fed by hand-written copy — the guides, the city pages,
pricing, the site layout. That is a fact about today's callers, not about the
component, which takes `Record<string, unknown>` and will serialise whatever it
is handed. The obvious next things to put in JSON-LD are `Person`, `Review` and
`aggregateRating`, all of which carry text somebody typed, and at that moment it
becomes stored XSS on a public page.

Fixed by escaping `<` as `<` in `src/lib/json-ld.ts` — a valid JSON escape,
so consumers parse a byte-identical document — with tests that assert both the
breakout is impossible and the data round-trips unchanged.

---

## §30, item by item

| Control | Status | How it was checked |
| --- | --- | --- |
| Server-side authorization | ✅ | Every one of the 36 API routes enumerated against its guard. All carry `requireUser`, `requireModerator` or `requireAdmin` except six that are public by necessity: the three `/auth/*` routes, `/health`, `/photos/[key]`, and `/billing/notifications/[store]`. |
| Session validation | ✅ | `resolveSession` on every request; sessions store a SHA-256 of the token, so the database holds nothing usable. Role is re-read from the database per call, so revoking access takes effect immediately rather than at session expiry. |
| Rate limiting | ✅ | 17 routes, covering login, registration, purchases, notifications, and every write that costs money or reaches another member. `/reports` is deliberately exempt and says so in its own comment — making it harder to report someone fails in the direction that protects abusers. |
| Anti-spam / anti-abuse | ✅ | Scam Shield on every message; young accounts limited on new conversations; likes capped per tier; gifts capped daily. |
| Input validation | ✅ | Closed vocabularies everywhere a value reaches a query — discovery filters, report reasons, gift ids, virtual-date environments, store ids, product ids. Unknown values are refused rather than defaulted. |
| Secure API | ✅ | No `dangerouslySetInnerHTML` outside `JsonLd` (now escaped). No open redirect: nothing redirects to a target taken from the request. No raw SQL with an unbound value — the one raw query, in `db/analytics.ts`, binds its parameters. |
| Encrypted transport | ⚠️ deployment | Enforced by the host, not by this repository. `docs/DEPLOYMENT.md` names TLS as a prerequisite and calls out that the notification route must not be exempted from it. |
| Secrets never in the client | ✅ | One `NEXT_PUBLIC_` variable exists (`NEXT_PUBLIC_SITE_URL`, a public URL). No server variable is read from any `"use client"` file — the only `process.env` in one is `NODE_ENV`. |
| Secrets never committed | ✅ | `.env.local` is gitignored; `.env.example` is the only env file ever added in the repository's history; every secret-bearing key in it is declared empty, and the two values present are placeholders (`CHANGE_ME`, `localhost`). |
| Secure purchase verification | ✅ | The client's token is never trusted on its own — the store is asked. No driver is stubbed: an unconfigured store answers 503 rather than accepting a claim. Notifications are believed only after a signature check. |
| Server-side entitlement | ✅ | No route reads a tier, plan or entitlement from a request body or query string — grepped for, and there are none. Every check is a database lookup keyed on the session's user. |
| Platform ID privacy | ✅ | `platform_user_id` never leaves the server; `linkedPlatforms` returns the platform name and two dates, and a test asserts the id is absent from what it returns. |
| Audit logs | ✅ | `moderation_actions` records the moderator, the subject, the action and the written reason, and `writeAudit` runs **inside the same transaction as the state change** — so an enforcement action cannot exist without its audit row. The reason is required by `actOnPhoto`/`actOnReport`, not by the console: refusing without one returns `note_required` from the API. |
| Admin RBAC | ✅ | Two roles, and the smaller one is not a rank of the larger: `requireAdmin` excludes moderators from the metrics surface. Both deny with **404, not 403**, so neither surface announces itself. Verified live against a member, a moderator and an admin. |
| Report protection | ✅ | Reports are authenticated, self-reporting is refused, reasons come from a closed set, details are truncated, and the reporter is never shown to the reported member. |
| Account protection | ✅ | argon2id at OWASP parameters; a miss burns equivalent hash time, so there is no user enumeration; a password change revokes every session; deletion cascades from `users` and is asserted table by table. |

## Object ownership

Every route with an id in its path passes the caller's own id into the query
that resolves the object, and the check lives in the `WHERE` clause rather than
in a comparison afterwards — so an object that is not yours does not exist to
you, which is also why these answer 404 rather than 403.

`resolveMatchFor(userId, matchId)` is the pattern; `/photos/[key]` uses
`canServe`, and `/virtual-dates/[inviteId]` additionally distinguishes "not
yours" from "not found" **only for the sender**, who already knows the id
exists.

## §31 — privacy

Storage is minimised by design rather than by policy, which is the version that
survives a refactor:

- **Analytics collects nothing.** Every number is an aggregate computed on
  demand from tables the product already keeps; there is no event stream and no
  vendor. Breakdown buckets below a threshold are withheld, because aggregates
  stop being anonymous when the population is small.
- **The store-notification log holds a provider, an opaque id and a date** — not
  the subscription, the product or the member. A provider reference there would
  outlive the account deletion that was supposed to remove someone.
- **Virtual date usage rows carry no content, no partner and no room contents.**
- **Photos are stripped of EXIF and GPS on upload**, and are gated behind
  moderation before another member can see them.
- **Voice and avatars store nothing**, because neither exists. When they do,
  §31's rule stands: recordings are not kept by default.

## What this audit does not cover

- **The VR client.** There isn't one. §33's performance and §34's network
  ownership rules have nothing to apply to yet.
- **Penetration testing.** This is a code audit. It finds classes of bug that are
  visible in the source; it does not replace someone attacking a running
  deployment.
- **Dependency vulnerabilities.** Not surveyed here. `npm audit` in CI is the
  cheap way to keep that honest and is not wired up yet.
- **NSFW/CSAM screening**, which `ROADMAP.md` already names as a hard launch
  blocker: photos are gated behind human approval, and no automated screening
  exists.
