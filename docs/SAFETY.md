# Safety

Blocking, reporting, moderation, and the scam detection that runs on every
message. `AI_SAFETY.md` covers the rules the AI itself must obey; this covers
what protects members from each other.

A dating product without moderation should not accept public signups. That is
why this shipped alongside the core loop rather than after it.

---

## The things that are never paid features

**Blocking and reporting are free, on every screen, at every tier.** A product
that charged for either would be selling safety to the people least able to
afford it, and the people who most need to block someone are not the people with
a subscription.

They are also never rate limited. `/api/reports` says so in its own comment:
making it harder to report someone fails in the direction that protects abusers,
and duplicate reports are cheaper to triage than a missed one.

---

## Blocking

`POST /api/blocks` — and it does more than hide a profile:

- The block is enforced **in both directions**, so neither person appears to the
  other in Discover, and neither can start an interaction.
- **It closes the existing match.** The conversation, its games and its virtual
  date invitations all become unreachable for both members — every read of
  `matches` filters `closed_at is null`, so the rest of the codebase gets the
  behaviour without knowing blocking exists, and open invitations are cancelled
  explicitly.
- **It does not delete anything.** Closing rather than deleting is deliberate:
  the delete used to cascade to the messages, and report-then-block is the
  ordinary sequence — a member reports the message that frightened them and
  blocks the sender in the next tap. What reached the moderation queue was a
  reason code with a null message id, for exactly the reports most likely to
  matter. The record survives for the people whose job is to read it; the
  conversation does not survive for the two members.
- A report can still be filed about a conversation a block has closed, so the
  order of the two taps never costs the reporter their evidence.
- A like recorded before the block is refused at the interaction layer rather
  than stored, and the block and the like take the same pair lock, so a block
  cannot be worked around by timing.

---

## Reporting

`POST /api/reports`, with a **closed vocabulary** of reasons: harassment,
scam_or_fraud, fake_profile, inappropriate_content, underage, other. Free-text
detail is truncated to 1000 characters.

Self-reporting is refused. **The reporter is never revealed to the reported
member** — not in the UI, not in any API response, not in a moderation action
the subject can see. Reporting someone you are in a conversation with is only
safe if it is not visible to them.

Both ids in the request are resolved server-side rather than trusted, and the
message id is the one that matters. Attaching a message to a report **escalates
it**: any Scam Shield assessment on that message goes straight to human review.
Nothing checked that the reporter had ever seen the message, so any member could
push another member's flagged message to the front of the moderation queue — or
bury the queue in escalations — using ids they had guessed rather than read. The
message must now be one the reporter can see, written by the person they are
naming. An id that names nobody is answered 400, not 500.

---

## Scam Shield

Every message is assessed before it is delivered. The output is a **risk band**,
not a verdict:

| Band | What happens |
| --- | --- |
| low | nothing |
| elevated | the recipient sees a warning beside the message |
| high | the recipient is warned **and** the case is queued for a human |

Two design rules do most of the work:

- **A pile of weak signals does not reach `high` on its own.** Asking for an
  email address is a weak signal and completely normal behaviour; treating an
  accumulation of normal behaviour as a scam produces a queue full of ordinary
  conversations and a moderator who stops reading it.
- **The message is still delivered.** Scam Shield warns the recipient; it does
  not silently drop mail. Deciding on someone's behalf that they should not have
  seen a message is a worse failure than showing them a warning they can ignore.

`AI_SAFETY.md` §7 is the governing constraint: it errs toward under-flagging.

---

## Photos

Every upload is **gated behind moderation** — pending until a human approves it,
and invisible to everyone but the owner until then. `listVisiblePhotos` and
`listVisiblePhotosFor` fail closed, so a UI that forgot to filter still cannot
leak an unscreened photo, and `/api/photos/[key]` re-checks on every read rather
than trusting a static mount.

**EXIF and GPS are stripped on upload**, before the file is stored. A photo
taken at home carries the home address, and members do not know that.

**Automated screening runs before the photo is stored.** Two separate checks,
because they are two different questions: perceptual hash matching against known
illegal material, which is a legal event with no threshold to tune, and a
classifier, which produces advice for the moderation queue. A hash match
short-circuits before the classifier is asked, and a matched photo never reaches
our own object storage at all. A match and an ordinary rejection return the
*same* answer to the member — a distinguishable one would be a free oracle for
testing which images are on the list.

The most permissive outcome the pipeline can produce is `review`. Screening
advises the queue; it does not empty it.

> **Both drivers are still unwritten, and this remains a hard launch blocker.**
> The interfaces, pipeline and tests exist; PhotoDNA and a classifier need
> accounts. Nothing is stubbed — an unconfigured driver declines, and declining
> leaves the photo pending, exactly as before. A driver that returned "clean"
> without asking anything would turn the queue that is currently keeping
> unscreened photos off the product into an empty list that looks like success.
>
> `REQUIRE_PHOTO_SCREENING=true` refuses uploads outright rather than piling up
> a queue nobody can keep up with. **Set it in production before public
> signups.** [`PHOTO_SCREENING.md`](PHOTO_SCREENING.md) has the services, the
> costs, and what each driver has to do.

---

## New accounts move slowly

A young account is limited in how many conversations it may open per day, on a
tiered schedule that relaxes with account age. Spam and scam operations depend
on volume from fresh accounts; the limit costs a genuine new member almost
nothing and costs an operation the thing it needs.

---

## Moderation

A queue, a console at `/app/moderation`, and an audit trail.

- **AI never takes final enforcement action alone** on a serious case. High-risk
  messages are *queued*, not actioned.
- **Rejecting or suspending requires a written reason**, enforced in
  `actOnPhoto`/`actOnReport` — not by the console. Refusing without one returns
  `note_required` from the API, so the requirement survives someone writing a
  different client.
- **The audit row is written in the same transaction as the state change**, so
  an enforcement action cannot exist without a record of who did it and why.
- Moderator access is checked per request from the database, and denied with
  404 — see `AUTH.md`.

---

## Date safety

For meeting in person: a plan a member can share with a trusted contact, with a
status lifecycle (`planned → started → completed / cancelled`) and explicit
opt-in before anything is shared with anyone.

`FORBIDDEN_EMERGENCY_CLAIMS` guards the copy, and there is a test for it: **this
product must never imply it is an emergency service.** A member in danger who
believes the app is summoning help instead of calling local emergency services
is the worst outcome this codebase can produce, and it would be produced by a
sentence, not by a bug.

---

## What is not built

- **Automated photo screening** — the launch blocker above.
- **Appeals.** The audit trail has the material for one (`moderationActions`
  records the action, the moderator and the reason) but there is no route for a
  member to contest a decision.
- **Proactive detection across accounts.** Signals are per message and per
  account; nothing correlates "these fourteen accounts write the same opening
  line" into one case.
