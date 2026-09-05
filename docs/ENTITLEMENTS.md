# Entitlements

What each tier may do, where that is decided, and why the limits have the shapes
they have.

`src/lib/billing/tiers.ts` is the source of truth for every number below. The
pricing page, the JSON-LD offers and the store listings are rendered or checked
from it, so there is no second copy to drift — a test fails if the copy stops
matching the code.

---

## The three tiers

**PLUS $19.99/year, VIP $49.99/year**, annual only. At these prices a monthly
plan would cost more in payment processing than it collects.

The stores convert to local currency from this base, so a member in Istanbul is
charged a regional equivalent rather than these dollars. **The store is the
source of truth at purchase time**; these numbers are what the store price tiers
must be configured to match, and what the pricing page renders when no store
price is available.

The two paid tiers sell different things rather than different amounts of the
same thing:

- **PLUS buys control over who you see** — advanced filters, more likes, who
  liked you, undo, unlimited translation.
- **VIP buys control over who sees you** — priority in Discover, your profile's
  visitors, the badge, a monthly Boost.

| | FREE | PLUS | VIP |
| --- | --- | --- | --- |
| Advanced filters | — | ✅ | ✅ |
| Likes per day | 50 | 200 | unlimited |
| See who liked you | — | ✅ | ✅ |
| Undo a pass | — | ✅ | ✅ |
| Translations per day | 15 | unlimited | unlimited |
| Profile visitors | — | — | ✅ |
| Priority in Discover | — | — | ✅ |
| VIP badge | — | — | ✅ |
| Boost length | 30 min | 30 min | 60 min |
| Monthly Boost credits | 0 | 0 | 1 |
| Gifts per day | 3 | 10 | unlimited |
| Virtual dates per month | 5 | 30 | unlimited |

`null` in the code means unlimited, not zero. That distinction is load-bearing:
a bug that read it as zero would lock out the members who pay the most.

**Free is not a trial.** Profile, Discover, matching, messaging, standard
filters, blocking and reporting are all free and always will be — as are 15
translations a day, which is roughly a dozen messages, enough for a real first
conversation across a language gap. The listing promises translation; that
promise has to be true before anyone has paid anything, or the store description
is misleading rather than the free tier being stingy.

---

## Where a tier comes from

```
subscriptions row → activeTier() → entitlementsFor() → the check
```

`activeTier` decides, and two rules matter more than the rest:

- **Cancelling does not end access.** Someone who cancels in month one bought
  the year; withdrawing it immediately would be keeping the money for a service
  taken away. `canceled` keeps access until the period ends — it stops the
  renewal being assumed, not the access.
- **`currentPeriodEnd` is authoritative and `status` is a hint.** A store
  notification that never arrives must not leave a lapsed subscription running
  forever, so access expires on the clock regardless of what the row says. This
  is what makes a missed webhook survivable rather than a free subscription.

`past_due` still has access: the member has not asked to stop and the store is
still retrying their card. A refund is different — it ends access immediately,
whatever the period end says, because they are no longer paying for the time
they were sold. See `PAYMENTS.md`.

---

## Where it is enforced

**Server-side, always, and never from anything the client said.** No route
accepts a tier, plan or entitlement from a request body or query string; every
check is a database lookup keyed on the session's user. `docs/SECURITY.md`
records how that was verified.

This matters most where the UI already hides something. A hidden control is not
a gate — the query string is public — so, for example, advanced filters are
stripped server-side for a member without them and the response says
`filtersDowngraded: true` rather than silently returning a narrower feed.

`GET /api/user/entitlements` returns the member's own entitlements so a client
can render the right UI. It is a convenience for rendering, not the gate.

---

## Rolling windows, not calendar days

Likes and translations reset over a **rolling 24 hours**; virtual dates over a
**rolling 30 days**.

A calendar day resets at midnight in some timezone, which is either the
server's — wrong for everyone not living in it — or the member's, which is
self-reported and therefore adjustable by anyone who wants their limit back. A
rolling window has neither problem, and it is the same length for every member
in every month: a monthly quota on calendar months gives 31 days in January and
28 in February for the same money.

The cost is that "when do I get more?" has no single answer, which is why the
API returns the remaining count rather than a reset time.

---

## Every allowance is counted where it is spent

A limit read on one connection and spent on another is not a limit: it is a
check-then-act, and every parallel request wins it. The likes route permits two
hundred a minute, so a daily cap read in the route and written in `recordLike`
could be stepped over by anyone willing to open two hundred sockets — and the
cap PLUS is sold to remove was the one being stepped over.

So each allowance is counted **inside the transaction that spends it**, on the
same connection, under an advisory lock keyed on the member:

- `likeAllowance` and `virtualDateAllowance` both take an executor argument, and
  the charging path passes its own `tx`.
- `startBoost` counts the month's claims under `boost:<member>` before inserting
  the next one, so `monthlyBoostCredits` is spent as the count it is rather than
  read as a boolean. Its grant rows are keyed on (member, month, ordinal); the
  key used to be (member, month), which capped every tier at one credit however
  many it was configured to give.
- Passes never charge, and re-deciding on a profile already liked never charges
  twice: the row is already counted, so the second decision replaces it rather
  than billing for the same person again.

The executor has to reach **all the way down**, to the subscription lookup and
not just the counting query. A function handed a `tx` that then reads on the
pool asks for a second connection while holding the first, and the pool defaults
to ten: ten concurrent charges each hold one, each wait for another, and none
can finish. That is not a slow query — it is the route hanging, and it appears
only once concurrency reaches the pool size, so nothing smaller reveals it.
`tierOf` and `entitlementsOf` therefore take the executor too, and
`db/pool.integration.test.ts` runs each charging path at twice the pool size and
fails on a timeout if the shape ever comes back.

---

## Virtual dates are charged differently, on purpose

Every other limit is a fairness device. The virtual date ceiling is a **cost
control**: it is the first thing in the product that costs money *while it
runs*, since a room is two people in a voice-and-network session billed by the
minute.

So it is charged to everyone the cost is incurred for:

- The inviter's allowance is **checked when they invite but not spent**. A
  declined invitation costs nothing to run, and charging for it would be
  charging someone for another person's "no".
- **Both allowances are checked and spent on acceptance**, which is the moment
  a room would exist. Charging only the inviter would make the ceiling trivially
  avoidable — a member out of dates would simply ask to be invited instead.
- The inviter's is **re-checked at acceptance** rather than trusted from invite
  time, because an invitation sits for a week and they may have spent their
  month meanwhile.

The two charges and the answer are one transaction. A crash between them either
gives away a date nobody paid for or charges for one nobody accepted, and both
are the kind of thing found a month later in numbers that do not add up.

Usage rows carry no content, no partner and no room contents — they are a
rolling month of counting and nothing reads further back.

---

## "Unlimited" is a ceiling nobody normally reaches

VIP's unlimited likes, gifts and virtual dates are unlimited as a product
promise. They are not an invitation to automate: the ordinary abuse controls
still apply above them — rate limits per route, Scam Shield on messages, and
moderation. A member cannot buy their way out of those, and a tier that let them
would be selling the ability to spam.

---

## Adding a tier or changing a number

1. Change `tiers.ts`. Everything downstream is derived from it.
2. Run `npm test` — `tiers.test.ts` and `pricing-copy.test.ts` will tell you
   what else claimed to know the old value.
3. Run `npm run store:check`, because the store listings quote the prices and a
   wrong price in a listing is a policy violation rather than a typo.
4. Re-shoot the screenshots (`npm run capture`) if a price is visible in one.
   This has been missed before: a pricing screenshot stayed live for months
   after the pricing changed.
