# Payments

How money becomes an entitlement, what is wired, and what refuses to pretend.

Nothing here can be bought yet in the sense that matters: **no store has
credentials configured**, so every purchase route answers "not open". The
machinery is built and tested; what is missing is a publisher account, which is
not a thing code can supply.

---

## Why not Stripe

On mobile it is not a choice. Apple's guideline 3.1.1 and Google Play's billing
policy both require digital subscriptions to go through in-app purchase, and
selling a subscription through a web checkout inside those apps is a rejection.

So the model is: **the store takes the money, and tells us.**

---

## The two halves

### Redemption — "did this person pay?"

`POST /api/billing/purchase`

The client hands over what the store gave it — a purchase token on Android, an
original transaction id on iOS, a Store ID key on Windows — and the server asks
that store whether it is real. **The token is never trusted on its own**: it
arrives from a device, and a device is not a source of truth about whether money
changed hands.

The client says *which* store, because the three token formats are opaque and
indistinguishable, and asking the wrong store returns "no such purchase", which
looks exactly like a forgery.

Safe to call repeatedly, and the app should: it is called on every launch to
reconcile a subscription whose notification never arrived. `recordPurchase`
converges rather than accumulates, so a replay is a no-op.

### Notification — "and here is what happened since"

`POST /api/billing/notifications/[store]`

Redemption answers the question once, at the moment of purchase. Everything
afterwards — the renewal, the cancellation, the refund, the card that stopped
working — happens at the store.

**The refund is the case this exists for.** `subscriptionFor` has always known a
refund ends access immediately rather than at the period end, but nothing told
it: the only thing that re-checks a subscription is the client reconciling on
launch, and someone who has taken their money back has no reason to open the app
again. Without this endpoint the entitlement outlives the payment for the whole
remaining period — a year, at these prices.

This is **the only route in the application that writes without a session**. It
has to be: a store has no cookie and calls hours after anyone was last online.
What replaces the session is the signature, so nothing touches the database
until the driver confirms the store signed it.

---

## What is wired

| | Verify a purchase | Verify a notification |
| --- | --- | --- |
| Microsoft Store | ✅ `lib/billing/microsoft.ts` | ❌ |
| Google Play | ❌ | ❌ |
| App Store | ❌ | ❌ |

**Nothing is stubbed, and that is the design.** Every unwired cell answers
`503 "not open"`. A stub that returned "valid" would hand a subscription to
anyone who could post to these routes, which is worse than having no route at
all. What each driver has to do is written down in `lib/billing/index.ts` rather
than guessed at.

Microsoft is the awkward one and is named as such: its collections query needs a
Store ID key that only the *client* can obtain, so a notification about a Windows
purchase can never be re-verified the way redemption verifies one. Refunds there
arrive by polling the clawback API rather than by push, so that driver is a
poller wearing the same interface — or Windows keeps having no refund path.

---

## Things that are easy to get wrong

**A refund is not a cancellation.** Cancelling switches off the renewal and
keeps the paid period. A refund ends access now. They are separate flags on
`VerifiedPurchase` for exactly this reason, and collapsing them costs money in
one direction and goodwill in the other.

**`providerRef` is the subscription, not the transaction.** Renewals produce new
transactions against the same subscription; a row keyed on the transaction would
multiply once a month and lose the unique index that stops one purchase
entitling two accounts. Google's purchase token and Apple's original transaction
id are both stable across renewal.

**One payment must not entitle two accounts.** A token arriving under a second
account is refused loudly (`already_redeemed`) rather than swallowed — it is
either a shared login or someone spreading one payment across several accounts.

**Notifications are not ordered.** Every store says so, and retries with backoff
produce overtakes on their own. A renewal retried for an hour lands *after* the
refund that followed it, and applied in arrival order it restores an entitlement
the member has been paid back for. `signedAt` — when the store signed it, not
when it arrived — is what prevents that; anything no newer than the notification
already applied is dropped.

**Unreachable is not invalid.** The driver returns `null` for "the store says
this is not real" and throws for "the store could not be reached". Collapsing
them either retries forever on a forgery or hands out entitlements whenever a
store has a bad afternoon. The route maps them to `400` and `503`, and those
status codes are behaviour: a store retries one and gives up on the other.

---

## Deploying this

`POST /api/billing/notifications/[store]` must be reachable from the public
internet, without a session, over TLS. See `DEPLOYMENT.md` — in particular, do
not put anything in front of it that turns a retryable answer into a final one,
because a discarded refund is a subscription that keeps running after the money
went back.

Product ids to configure in each store are in `lib/billing/purchase.ts`
(`PRODUCT_IDS`), and `npm run store:check` verifies the listings still name the
same ones.

---

## What is not built

- **Webhook-driven proration, upgrades and downgrades.** An upgrade arrives as
  an ordinary purchase of the other product and lands correctly, but nothing
  reasons about the money in between; the stores handle that themselves.
- **One-time products** — Boost, Super Like, Profile Promotion. The entitlement
  side of Boost exists (`boosts`, `boostGrants`); nothing sells one.
- **Receipts, invoices, and billing history.** The payment provider keeps these
  properly and is the system of record for money. `subscriptions` is one row per
  member answering "what may they do right now", not a ledger.
