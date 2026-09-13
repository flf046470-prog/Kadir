# Decisions waiting on you

Everything in this repository that is finished, is finished. This is the list of
what is not, and every item on it is here for the same reason: it needs a choice
only the owner of the product can make — money, a licence, an account, a legal
position, or a machine this environment does not have.

They are not sequenced as a plan. They are sequenced by **what blocks a public
launch first**.

Each entry says what is actually blocked, what the options cost, and a
recommendation. The recommendation is a starting position, not a decision.

---

## 1. Photo screening — the hard launch blocker

**Blocked:** public signups. Not the code: the screening pipeline is built,
tested and wired into `uploadPhoto`, which now screens a photo *before* it is
stored. What is missing is the two drivers behind it, and those need accounts.
A pending photo is visible only to its owner, so the system fails closed while
they are absent.

**Why it is a blocker and not a nice-to-have:** an unscreened photo reaching
other members is the failure mode that ends a dating product, and CSAM is a legal
matter in every market this ships to, Turkey included. No amount of human
moderation covers the window between upload and review.

**The choice, and the recommendation, are now in
[`PHOTO_SCREENING.md`](PHOTO_SCREENING.md)** — which services, what they cost,
and what each driver has to do. In short:

- **PhotoDNA Cloud Service** for hash matching. Free for approved organisations,
  but access needs an application and third-party vetting, so **start it now**:
  it is the longest-lead item on the whole launch checklist, and the answer does
  not come the same day.
- **Sightengine's free tier** for classification at launch, moving to **AWS
  Rekognition** past roughly 30,000 photos a month.

The pipeline that consumes both is built and tested; the drivers are the
remaining work, and each is a contained piece against a documented interface.

Two things on this remain genuinely yours to decide: whether member photos
going to Microsoft and to a classifier is recorded properly under KVKK, and what
follows a hash match — retention, notification, reporting. The second is a
question for a Turkish lawyer, not for this repository.

---

## 2. Hosting

**Blocked:** having a public URL at all. The application runs; nothing is
deployed.

**The options, with the reasoning already written out in `DEPLOYMENT.md` and
`COST_ANALYSIS.md`:**

| | Shape | Roughly |
| --- | --- | --- |
| Hetzner + Coolify | one VPS you own, Postgres alongside | cheapest by a wide margin, you run it |
| Railway | managed, Postgres included | more per month, far less to operate |
| Vercel + managed Postgres | native to Next.js | most per month at scale, least friction now |

**Recommendation:** Hetzner + Coolify if you or someone you trust is willing to
be responsible for a server; Railway if not. The application is a single Next.js
process and a Postgres — it does not need anything more elaborate, and the
difference between these is operational appetite, not capability.

**Note about the Vercel checks on the pull request:** the red ones are an account
daily build quota, caused by seventeen unrelated projects attached to this
repository. They are not this code failing. Detaching those projects in the
Vercel dashboard clears them.

---

## 3. The support address

**Blocked:** store submission. Every store requires a working support contact,
and reviewers test it.

`support@fiorematch.com` is what the app prints and what
`ContactForm.tsx` composes a `mailto:` to. You have said the mailbox exists.

**What is left:** send a message to it from an address you do not control, and
confirm a reply arrives. Not because the address is wrong, but because a support
address that silently bounces fails review, and this is a two-minute check that
cannot be done from here.

---

## 4. Voice in virtual dates

**Blocked:** nothing that ships today. Virtual dates work as scheduling and
rooms; voice is the layer that has not been chosen.

**The tension, in full in `docs/VOICE.md`:** voice is billed per minute, so the
provider decision is a per-minute contract signed against a usage number nobody
has measured. `cost-model.mjs` currently uses a guess.

There is also an unresolved product question inside it: **reporting from inside
a voice date**. Without recording — which §31 rules out by default — a voice
report is testimony rather than evidence. The honest options are a short rolling
buffer retained *only* on a report and disclosed, or accepting testimony-only
reports. This is a decision, not an implementation detail.

**Recommendation:** ship virtual dates with **no voice at all** first if that is
viable, measure minutes per active member for a month, then choose with the real
number. That costs a release and avoids signing a rate card against a guess.

---

## 5. Multiplayer / room synchronisation

**Blocked:** the same as voice — nothing shipping, everything future.

`docs/MULTIPLAYER.md` has the constraints. The one cross-cutting point: several
vendors sell voice and multiplayer together, and one integration is genuinely
simpler than two — but the two decisions have different constraints, and a bundle
discount should not decide a recording policy. Prefer one vendor for both only if
it wins both evaluations on its own merits.

---

## 6. Unity, and everything downstream of it

**Blocked:** four build targets. From `docs/BUILDS.md`:

| Target | State | Needs |
| --- | --- | --- |
| Meta Quest | not started | Unity |
| Windows PC VR | not started | Unity |
| Steam | not started | Unity **and** a Steamworks account |
| Epic | not started | Unity **and** an Epic publisher account |

**The choices bundled here:** a Unity licence tier, which headset to target
first, and two publisher accounts that cost money and require a legal entity.

**Recommendation:** none of this is on the critical path to a launched product.
The web application, the two mobile shells and the PWA are the product; the VR
targets are an expansion. Decide them after there are members.

---

## 7. iOS archiving

**Blocked:** an App Store build. The Xcode project is generated and themed, and
`Info.plist` is complete.

**What is missing is a machine.** Archiving needs Xcode, which needs macOS.
Nothing in this environment can produce an `.ipa`, and no amount of further work
here changes that. It needs a Mac, or a macOS CI runner, plus an Apple Developer
account.

---

## 8. Microsoft Store packaging

**Blocked:** an MSIX. The assets and manifest are built and self-contained in
`mobile/microsoft-store/`.

**What is missing:** PWABuilder or a Windows machine to produce the package, and
a Partner Center product name reserved **first** — the package identity has to
match the reservation, so doing it in the other order means rebuilding.

---

## What is not on this list

Everything else. The web application is built, tested and audited: over a
thousand tests, lint and typecheck clean, a production build, five browser tests
against a real Chromium, and four code-review passes that between them found
twenty-five defects, all fixed and each with a regression test.

Where a document says something is "not built", it means a decision above has not
been made — not that code is missing behind it. `docs/README.md` separates the
two.
