# Launch order

`DECISIONS_PENDING.md` lists what is unfinished, sorted by what blocks a launch
first. That is a list of *blockers*, deliberately not a plan — several of its
entries have nothing to do with each other and two of them can be started this
morning.

This is the plan: the same work sequenced by **what has to exist before what**,
for the web site and for the mobile apps together. Where two things do not
depend on each other, they are in the same stage and should run in parallel.

The dependencies are real, and three of them are the ones that cost weeks if
they are discovered late:

- **PhotoDNA access is applied for, not bought.** It gates public signups and
  the answer does not arrive the same day, so it starts before anything else
  and runs underneath every other stage.
- **The Microsoft Store package identity comes from a reserved name.** Reserve
  first, package second, or the package is thrown away.
- **Deep links need the deployed site *and* the store signing identity.** The
  site has to be live before either app's link verification can be proven, and
  Android's fingerprint is only knowable after Play App Signing is on.

Nothing below is code that needs writing. Every stage is an account, a machine,
a decision, or a deploy.

---

## Stage 0 — start today, in parallel, before anything else

Four things with nothing between them and you. All four are waiting on someone
else's clock, which is exactly why they go first.

| | What | Why it is first |
| --- | --- | --- |
| 0.1 | **Apply for PhotoDNA Cloud Service** | Longest lead item on the whole list. Approval needs an application and third-party vetting. Public signups do not open without it. [`PHOTO_SCREENING.md`](PHOTO_SCREENING.md) has what the application needs. |
| 0.2 | **Test `support@fiorematch.com` end to end** | Send from an address you do not control; confirm a reply arrives. Two minutes. Store reviewers test it, and a silently bouncing support address fails review. |
| 0.3 | **Reserve the product name in Partner Center** | The MSIX identity is derived from the reservation. Packaging before reserving means rebuilding. Costs nothing to do now. |
| 0.4 | **Open the two developer accounts** | Google Play (one-time fee) and Apple Developer (annual). Apple's account approval is not instant, and for a company account it can take over a week. Neither is needed until Stage 3, which is why both are opened in Stage 0. |

**Also decide here, because Stage 1 needs the answer:** hosting.
[`DECISIONS_PENDING.md` §2](DECISIONS_PENDING.md) sets out the three options.
The short version: Hetzner + Coolify if someone will be responsible for a
server, Railway if not.

---

## Stage 1 — the site goes live, with signups closed

Everything here is one afternoon once Stage 0's hosting decision is made. It
depends on nothing in Stage 0 finishing.

1. **Provision the host and the Postgres.** [`DEPLOYMENT.md`](DEPLOYMENT.md) has
   the container and the environment.
2. **Run the migrations** against it: `npm run db:migrate`.
3. **Set the environment.** `.env.example` is the list, and every entry in it
   says what breaks when it is absent. At minimum here: `DATABASE_URL` and
   `NEXT_PUBLIC_SITE_URL=https://fiorematch.com`. The S3 settings can wait for
   Stage 2 — with signups closed nobody can upload a photo — but they are not
   optional past it on a serverless host, where the local disk that photos
   otherwise fall back to is discarded between requests.
4. **Set `SIGNUPS=closed`.** This is the switch that makes this stage possible:
   the marketing site, pricing, safety and legal pages all render, and every
   join button becomes "coming soon" instead of a registration form. Nobody can
   upload a photo, so screening not being live is not a hole.
5. **Point `fiorematch.com` at it** and confirm TLS. The domain is already
   bought.
6. **Smoke-test the deploy**: the home page in Turkish and English, the pricing
   page, the contact form's `mailto:`, and `/robots.txt` and `/sitemap.xml`.

**What this buys, beyond a URL:** the domain starts accruing search age from
today rather than from launch day, and the PWA becomes fetchable — which
Stage 5 requires.

---

## Stage 2 — open signups

Gated by Stage 0.1. This is the only stage that cannot be pulled forward.

1. **Sightengine account** (free tier is enough at launch) — the classifier half.
2. **Implement the two drivers** against the interface in
   `src/lib/safety/screening-drivers.ts`. Each is a contained piece against a
   documented seam; the pipeline that consumes them is built and tested.
3. **Set `REQUIRE_PHOTO_SCREENING=true`.** With it on, an unconfigured driver
   throws instead of quietly letting photos through.
4. **Upload a photo end to end** on the deployed site and confirm it goes
   `pending` → `approved`, and that a pending photo is invisible to everyone but
   its owner.
5. **Flip `SIGNUPS` off `closed`.**

Two things to settle with a Turkish lawyer while the application is pending, not
after: how member photos going to Microsoft and to a classifier is recorded
under KVKK, and what follows a hash match — retention, notification, reporting.

---

## Stage 3 — Android

Can start the moment Stage 1 is live; does not wait for Stage 2. Publishing to a
closed test track with signups closed is fine and gets Play's review clock
started early.

1. `npx cap sync android`, bump `versionCode`, build the release bundle.
   [`BUILDS.md`](BUILDS.md) has the exact commands and the signature check —
   an unsigned bundle builds successfully, so verify rather than assume.
2. **Enrol in Play App Signing** on first upload.
3. **Set `ANDROID_CERT_FINGERPRINTS` on the deployment** to *both* SHA-256
   fingerprints, comma-separated: your upload key, and the app-signing key
   Google shows under Release → Setup → App signing. List only one and roughly
   half of installs fall back to the "open with" chooser.
   `/.well-known/assetlinks.json` 404s until it is set, and a wrong value is
   worse than an absent one — Android caches a failed verification, so deep
   links stop opening the app and nothing reports it.
4. `npm run store:check`, then `mobile/play-store/submission.md`.

The ordering inside this stage is the point: the fingerprint is not knowable
until step 2 has happened, and step 3 changes the deployed site, not the app.

---

## Stage 4 — iOS

Needs a Mac or a macOS CI runner. Nothing in this repository can stand in for
it, and no further work here changes that.

1. `npx cap sync ios`, open the project, set the team and provisioning profile.
2. Product → Archive → App Store Connect.
3. Set Associated Domains to `applinks:fiorematch.com`, then confirm
   `/.well-known/apple-app-site-association` answers with your team id in it.
   Same failure mode as Android.
4. Paste the review notes from `mobile/app-store/listing.md` into App Review
   Notes. The three guidelines Apple will actually look at are named there.

---

## Stage 5 — Microsoft Store

**Requires Stage 1 to be live** — PWABuilder packages the deployed site, so
this genuinely cannot be done earlier. It also requires Stage 0.3, which is why
that was reserved in Stage 0.

Run PWABuilder against `https://fiorematch.com`, produce the MSIX with the
identity from the reserved name, and follow
`mobile/microsoft-store/submission.md`.

---

## Stage 6 — after there are members

Deliberately last. None of it is on the critical path to a launched product,
and two of the four decisions are contracts priced per minute against a usage
number nobody has measured yet.

- **Voice in virtual dates** — ship without voice, measure minutes per active
  member for a month, then choose. [`VOICE.md`](VOICE.md), including the
  unresolved question of what a report from inside a voice date can be when
  nothing is recorded.
- **Multiplayer / room sync** — [`MULTIPLAYER.md`](MULTIPLAYER.md).
- **Unity, and the four VR targets downstream of it** — Meta Quest, Windows PC
  VR, Steam, Epic. One blocker, not four. Their server halves already ship.

---

## The short version

```
Stage 0  PhotoDNA application ─────────────────────────────┐  (weeks, in background)
         support@ test · Partner Center name · dev accounts │
             │                                              │
Stage 1  site live, SIGNUPS=closed ───┬──────────┬──────────┤
             │                        │          │          │
Stage 2      │                        │          │  ◄───────┘ open signups
Stage 3      └─ Android ──────────────┤          │
Stage 4          iOS ─────────────────┤          │
Stage 5          Microsoft Store ◄────┘          │
Stage 6          voice · multiplayer · Unity ◄───┘  (after members)
```

Stage 1 is reachable this week and is what makes the domain a live site.
Stage 2 is the one thing on this page that a decision cannot accelerate, which
is why Stage 0.1 is the first line of the plan.
