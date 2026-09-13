# Store compliance

Three stores, three sets of rules, and the checks that keep the listings honest.

```bash
npm run store:check
```

Run it before every submission. It exits non-zero on a blocker.

---

## What is checked automatically

`scripts/store-check.mjs` reports on what the repository can prove about itself:

| §51 item | Check |
| --- | --- |
| Store metadata | Every field with a declared character limit fits it, and the hand-written counter under each block is accurate |
| Store metadata | The support address is identical in all three listings and matches `supportEmail` in the code |
| Package identifiers | `capacitor.config.ts`, Android and iOS name the same application id |
| Subscriptions | The product ids in `lib/billing/purchase.ts` are the ones the listings quote |
| Account deletion | The route exists and implements `DELETE` |
| Reporting, blocking | The routes exist and implement `POST` |
| Age rating | The 18+ check exists in registration |
| Icons | Each store's required art is present |
| Screenshots | Present (counted recursively — the three stores arrange them differently and all three are right) |
| Screenshots | **Not older than the copy they show** |
| Signing | The procedure is documented |

The staleness check exists because this repository has already lost that
argument: a pricing screenshot stayed live for months after the pricing changed.
Nothing failed and nothing warned — the file was simply older than the copy
beside it.

---

## What it deliberately does not do

**It does not assert what the stores currently require.** §51 is explicit about
not assuming an outdated requirement, and a hardcoded "80 characters" in a script
is exactly that: an unsourced number that looks authoritative and rots quietly.

So the limits are read out of the listing headings, where they sit beside the
copy they govern, and the report says on every run that confirming them against
each store's current documentation is a human step. A report that looked complete
would be the thing that stopped someone checking.

It also cannot check performance or crash rates (§51's last two items), which are
properties of a running app rather than of a repository.

---

## The requirements each store actually enforces

Recorded in the listings themselves, next to the fields they affect:

- `mobile/play-store/listing.md` and `submission.md` — Data Safety form answers
  with the code that justifies each one, content rating, the Play App Signing
  step.
- `mobile/app-store/listing.md` — App Privacy labels, the age rating
  questionnaire, and the three guidelines Apple will actually look at.
- `mobile/microsoft-store/listing.md` and `submission.md` — Partner Center's
  different field set, IARC, and the reserve-the-name-first ordering.

They are separate files on purpose. The same copy in three places is the shortest
route to updating one and forgetting the others, which is precisely what
`store:check` now catches when it happens anyway.

---

## The ones that will fail a review

**Account deletion must be in the app.** Apple's 5.1.1(v) does not accept a
support email. It is implemented and cascades — see `PRIVACY.md`.

**Digital subscriptions must use in-app purchase.** Selling through a web
checkout inside the apps is a rejection under Apple 3.1.1 and Play's billing
policy. See `PAYMENTS.md`.

**The privacy policy URL must answer during review.** It is served even with
`PUBLIC_SITE=off`, and that is why. A link that does not open is a rejection.

**The deployment must be live.** These are Capacitor shells that load
`https://fiorematch.com`. If the server does not answer, the reviewer sees the
offline screen and the app is rejected — the shell working correctly.

**Data Safety and App Privacy answers are policy declarations**, not marketing.
"Approximate location, not precise" is true because the app never reads device
location. Answering these wrong is an enforcement matter rather than an
inaccuracy.

**A working support address.** All three require one. `support@fiorematch.com`
is in the listings and in the code; send it a test message and confirm a reply
before submitting.

---

## The blocker that is not about listings

**Automated NSFW and CSAM screening does not exist.** Photos are gated behind
human approval and `approvePhoto` is the hook, but nothing automated screens
them.

`ROADMAP.md` names this a hard launch blocker and it is the one item on this page
that no amount of listing accuracy substitutes for. Public signups should not
open until a hash-matching service and a classifier are wired in.
