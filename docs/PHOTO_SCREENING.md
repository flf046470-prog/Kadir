# Photo screening

The one hard launch blocker, and which services to use for it.

`docs/DECISIONS_PENDING.md` puts this first because it is the only item on that
list that cannot wait: everything else can wait for revenue, this cannot wait for
signups. An unscreened photo reaching another member is the failure mode that
ends a dating product, and the window between upload and human review is exactly
where it happens.

---

## Two problems, not one

Conflating them is the mistake this design exists to prevent.

| | Question | Answered by | Nature of the answer |
| --- | --- | --- | --- |
| **Hash matching** | is this *known* child sexual abuse material? | a perceptual hash checked against a maintained list | yes or no, no threshold, a legal event |
| **Classification** | is this acceptable on a dating profile? | a trained classifier | a probability, wrong in both directions, advice to a queue |

A single "is this bad?" interface would force one threshold onto both, and the
one it would get wrong is the first. `src/lib/safety/screening.ts` keeps them as
two interfaces for that reason.

---

## Recommendation

### Hash matching — **Microsoft PhotoDNA Cloud Service**

Free for approved organisations, and the industry standard. Perceptual hashing,
so it catches resized, cropped and recoloured copies rather than only byte-exact
ones.

**How to get it:** apply at
[microsoft.com/photodna/cloudservice](https://www.microsoft.com/en-us/photodna/cloudservice).
Access is subject to third-party vetting, so **start this before you need it** —
it is an application, not a signup, and the answer does not come the same day.
This is the long-lead item on the whole launch checklist.

**Two things to know before wiring it:**

- The *cloud* service means the image is sent to Microsoft. That is a processor
  relationship and belongs in the KVKK/GDPR record before a single member photo
  goes through it.
- PhotoDNA matches **known** material. It has no classifier for novel content.
  If that gap matters for your risk posture, Thorn's Safer adds a CSAM
  classifier on top — it is paid, and it is a reasonable second-year decision
  rather than a launch one.

### Classification — **Sightengine to start, AWS Rekognition at scale**

Verified September 2026 against the vendors' own pricing pages:

| | Free tier | Then |
| --- | --- | --- |
| **Sightengine** | 2,000 operations/month (max 500/day), no card | $29/mo for 10,000, $99/mo for 40,000, $0.002/op over |
| **AWS Rekognition** | 1,000 images/month for the first 12 months | $0.0010/image to 1M, $0.0008 to 5M, $0.0006 beyond |

**Start on Sightengine's free tier.** It costs nothing, it is enough for launch
and early growth, and its nudity model separates *explicit* from *suggestive*
natively — which is the distinction this product actually needs. A swimsuit
photo at the beach is an ordinary dating profile photo, and a classifier that
treats it as mild nudity would reject a large share of legitimate uploads.
`ClassifierCategory` has `suggestive` as its own value for exactly this.

**Move to Rekognition when volume passes roughly 30,000 photos a month**, where
its per-image price wins and there is no monthly floor. At 45,000 photos —
around 500 signups a day at three photos each — Sightengine is about $109/month
and Rekognition about $45. The mapping from Rekognition's label taxonomy onto
`ClassifierCategory` is where the swimsuit-versus-nudity threshold gets decided,
and it is the real work in that driver.

Hive is the other credible option and works with dating apps, but its self-serve
tier caps at roughly 3,000 requests a month, so it means a sales conversation
before you have members.

---

## What is built

Everything above the drivers.

- `src/lib/safety/screening.ts` — the two interfaces, the pipeline, and the
  outcome type. `screenPhoto` runs the hash match first and short-circuits on a
  match, so known illegal material is never forwarded to a second commercial
  provider for a second opinion.
- `src/lib/safety/screening-drivers.ts` — driver selection from the
  environment, shaped like `lib/billing/index.ts`.
- `uploadPhoto` screens **before storing**. A photo that hash-matches never
  lands in our own bucket; storing and deleting would mean it existed on our
  infrastructure, with that bucket's replication and backup retention, for
  however long the round trip took.
- A hash match and a classifier rejection return **the same answer to the
  member**. A distinguishable response is a free oracle for testing which images
  are on the list.

Twelve unit tests and nine integration tests cover it.

## What is not built, and why

**The drivers themselves.** Both default to declining, and declining leaves a
photo `pending` — visible only to its owner, exactly as today. Nothing is
stubbed: a driver that returned "clean" without asking anything would turn the
moderation queue, which is currently the thing keeping unscreened photos off the
product, into an empty list that looks like success.

What each has to do:

- **PhotoDNA** — POST the image bytes to the Match endpoint with the
  subscription key in `Ocp-Apim-Subscription-Key`; the response says whether it
  matched and against which list.
- **Sightengine** — POST to `/1.0/check.json` with `models=nudity-2.1,offensive`
  and read the class probabilities.
- **Rekognition** — `DetectModerationLabels`, then map its taxonomy onto
  `ClassifierCategory`.

**Automatic approval.** The most permissive outcome the pipeline can produce is
`review`. Approving automatically needs a measured false-negative rate on this
product's own uploads, and shipping it as a default would mean the first photo
that fooled the classifier reached members with nobody having looked.

**What follows a hash match** — retention, notification, and reporting to the
relevant authority. This is a legal question, not a product one, and the
obligations differ by jurisdiction: US providers report to NCMEC under
18 U.S.C. § 2258A, and the position for a Türkiye-based operator is something a
Turkish lawyer has to state rather than something this document should guess at.
A half-built reporting path nobody has had a lawyer read is worse than an
explicit gap, so this is an explicit gap.

---

## Configuration

| Variable | Effect |
| --- | --- |
| `PHOTODNA_SUBSCRIPTION_KEY` | selects the PhotoDNA hash matcher |
| `SIGHTENGINE_API_USER` / `SIGHTENGINE_API_SECRET` | selects the Sightengine classifier |
| `AWS_REKOGNITION_REGION` | selects the Rekognition classifier |
| `REQUIRE_PHOTO_SCREENING` | `true` refuses uploads outright when screening is not configured |

A key set with no driver implemented **throws at startup** rather than falling
back to `none`. Someone who has been approved for PhotoDNA and put the key in
the environment believes screening is on; a quiet fallback would give them a
deployment that reports itself unscreened only if they read the health endpoint.
This is the one control where believing it is on when it is off is the entire
failure.

`REQUIRE_PHOTO_SCREENING` is off by default because development and the test
suite have no screening, and an upload path that cannot be exercised is not a
useful default. **Turn it on in production before public signups.** Off, every
photo waits for a person — safe, but it does not scale past what a human can
actually look at, and a review queue nobody can keep up with fails silently and
gradually.

---

## Sources

Pricing and eligibility verified September 2026:

- [PhotoDNA Cloud Service](https://www.microsoft.com/en-us/photodna/cloudservice)
- [Amazon Rekognition pricing](https://aws.amazon.com/rekognition/pricing/)
- [Sightengine pricing](https://sightengine.com/pricing)

Vendor pricing changes. Re-check before committing to a number in a budget.
