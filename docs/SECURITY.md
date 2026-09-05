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
| Rate limiting | ✅ | 17 routes, covering login, registration, purchases, notifications, and every write that costs money or reaches another member. `/reports` is deliberately exempt and says so in its own comment — making it harder to report someone fails in the direction that protects abusers. The login throttle is keyed with the same normaliser the lookup uses, so one account is one bucket; eviction never drops a counter that has reached its ceiling while a less-established one remains, so a flood of throwaway keys cannot clear a victim's counter. |
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
| Report protection | ✅ | Reports are authenticated, self-reporting is refused, reasons come from a closed set, details are truncated, and the reporter is never shown to the reported member. Both ids are resolved server-side: an attached message must be one the reporter can see, written by the person they are naming, because attaching one escalates its Scam Shield assessment to human review. Blocking after reporting no longer destroys the reported message — the match is closed, not deleted. |
| Account protection | ✅ | argon2id at OWASP parameters; a miss burns equivalent hash time, so there is no user enumeration; a password change revokes every session; deletion cascades from `users` and is asserted table by table. Suspension is checked at session resolution, not only at the login form — a suspended member's existing cookie stops working immediately rather than in up to thirty days. |

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
- **NSFW/CSAM screening**, which `ROADMAP.md` already names as a hard launch
  blocker: photos are gated behind human approval, and no automated screening
  exists.

## Dependencies

`npm audit --omit=dev --audit-level=high` runs in CI and currently passes.

Two advisories were found and two `overrides` clear them, both without a major
upgrade:

- **`sharp` 0.34.5** — inherited libvips CVEs, in the copy Next bundles
  (`next/node_modules/sharp`) rather than ours, which was already on a patched
  0.35. It decodes images, so the class matters more than usual, but it was
  **not reachable**: `next/image` is imported nowhere, so Next's optimiser never
  runs. Overridden to `^0.35.3` anyway, because one `<Image>` added later would
  quietly switch that path on, and the images it would process are members'.
- **`postcss` 8.4.31** — again Next's nested copy, again ours was already
  patched. Build-time advisories (stringify XSS, `sourceMappingURL` file
  disclosure) against our own CSS rather than anything a member supplies.
  Pinned with `"postcss": "$postcss"` so the nested copy follows the one we
  already resolve.

**One moderate is accepted, not fixed:** `next-intl` ≤ 4.9.1 (an open redirect,
and prototype pollution via `experimental.messages.precompile` — a flag this
app does not set). The remedy is `next-intl@4`, a major upgrade across twelve
locales and every page, which is its own change with its own verification
rather than something to slip into an audit. `npm audit fix --force` would also
take `next` to 16 at the same time; it should not be run here.

**The open redirect was probed rather than assumed.** Against the running
server, every classic vector — `//host`, `/tr//host`, `///host`, `/\host`,
`/tr/\/host`, `/tr/../..//host`, `//host:80`, `/tr//@host` — redirects to *this*
origin, not off it: Next normalises the path before next-intl sees it, and
following the chain to completion never leaves the host. Encoded and
whitespace variants 404.

That is not a claim that the advisory is fully mitigated — its precise vector is
not published here, and a future route could reintroduce the class. It does mean
the practical exposure today is materially lower than the severity implies, and
it is backed by the structural property that **no route in this application
redirects to a target taken from a request** (grepped for; there are none).

Re-probe after any change to `middleware.ts` or the locale routing.

The gate is deliberately `--omit=dev --audit-level=high`. Advisories in build
tooling are worth knowing and are not reachable by a member, and a gate that
fails for things nobody can act on is one people learn to skip.
