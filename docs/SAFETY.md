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
- **It deletes the existing match**, which cascades. Messages, gifts, games and
  pending virtual date invitations all go with it, so blocking someone takes
  every open thread with them and the rest of the codebase never has to know
  blocking exists.
- A like recorded before the block is refused at the interaction layer rather
  than stored, so a block cannot be worked around by timing.

---

## Reporting

`POST /api/reports`, with a **closed vocabulary** of reasons: harassment,
scam_or_fraud, fake_profile, inappropriate_content, underage, other. Free-text
detail is truncated to 1000 characters.

Self-reporting is refused. **The reporter is never revealed to the reported
member** — not in the UI, not in any API response, not in a moderation action
the subject can see. Reporting someone you are in a conversation with is only
safe if it is not visible to them.

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

> **`approvePhoto` is the hook automated screening belongs in, and there is
> none.** No NSFW classifier, no CSAM hash matching. `ROADMAP.md` names this a
> **hard launch blocker**: public signups must not open until a hash-matching
> service and a classifier are wired in. Human-only review does not scale past a
> handful of uploads a day, and the failure mode is not a bad screenshot.

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
