# Spatial voice

**Nothing is built, and this is a decision document rather than a design one.**
§10 asks for spatial voice in a virtual date; choosing how to provide it is a
paid-service decision, which §57 puts with the owner rather than with the
implementer.

What follows is what the choice costs, what the code already assumes, and the
constraints that should decide it.

---

## What it is worth

From `npm run cost-model`, voice is one of the three lines that dominate every
cost column. At 1M members on the model's usage assumptions it is roughly
**$180k a year**, and a provider charging twice the rate costs another $180k.

For comparison, the entire server, database, storage and bandwidth bill at that
scale is under $20k. **This decision is worth more than every hosting decision
put together**, which is the main reason it deserves its own document.

The usage assumption behind that (20 virtual-date minutes per active member per
month) is a guess about a feature nobody has used. It is the number to measure
first, not the rate.

---

## What the product needs

- **Spatial**, not conference audio. Two people at a table should sound like two
  people at a table; a flat mix is not a virtual date, it is a phone call with a
  headset on.
- **Two participants per room.** This is not a social platform with forty people
  in a lobby. Almost every provider prices and scales for the large case, and
  the pricing that follows from that is often bad for the small one.
- **Mobile-network tolerant.** A member on Turkish mobile data is the normal
  case, not the edge case.
- **A hard mute the other person cannot override**, reachable in one action.
  This is a safety control, not an audio feature — see below.
- **No recording by default.** §31 is explicit: voice recordings must not be
  kept by default. A provider whose product records to enable features is a
  provider whose defaults have to be fought.

---

## The constraints that should decide it

**Recording and retention.** The question to ask a vendor is not "can we turn
recording off" but "what do you retain when it is off, for how long, and where".
A dating conversation is among the most sensitive audio a person produces. A
provider that keeps transcripts for a machine-learning pipeline is disqualified
regardless of price.

**Data residency.** Members are principally in Turkey and the EU. KVKK and GDPR
both make the location of processing a question you have to be able to answer,
and "the nearest region" is not an answer if the nearest region is elsewhere.

**Per-minute versus per-concurrent-user.** Two-person rooms with sporadic use fit
per-minute pricing far better than per-peak-concurrent, which is priced for
always-on platforms. Read the minimum commitment carefully; several providers'
entry tiers are larger than this product's whole infrastructure budget.

**Whether it survives the client.** Voice has to be built into the VR client,
which is Unity. A provider without a maintained, licensable Unity SDK turns this
into a networking project.

**An exit.** This is a per-minute cost that grows with success and cannot be
renegotiated from a weak position. Prefer one that speaks a standard (WebRTC)
over one whose value is a proprietary stack, so that leaving is expensive rather
than impossible.

---

## Safety is part of this, not after it

Text has moderation; audio has none, and the same protections have to exist:

- **Mute and leave must be instant and one action**, and must not depend on the
  other participant's client behaving.
- **Blocking must end the session.** Blocking already deletes the match and
  cascades to invitations (`SAFETY.md`); a live room has to be included.
- **Reporting from inside a date** needs to work, and needs to produce something
  a moderator can act on. Without recording — which §31 rules out by default —
  that is a report with no evidence, which is a genuine and unsolved tension.
  The honest options are a short rolling buffer retained *only* on a report
  (with disclosure), or accepting that voice reports are testimony rather than
  evidence. **This is a product decision that has not been made, and it should
  be made before voice ships, not after the first report.**

---

## What the code already assumes

Nothing about a provider — which is deliberate, so this decision stays open:

- `virtual_date_invites` and `virtual_date_usage` are the accounting, and are
  separate from any future session or room record on purpose. A room that
  crashes, is cleaned up, or is deleted for privacy must not hand the member
  their quota back: the infrastructure was paid for either way.
- The allowance is spent at **acceptance**, which is the moment a room would
  exist — so the cost model's per-minute line and the entitlement ceiling are
  measuring the same event.
- No table, column or interface names a voice provider anywhere.

Whatever is chosen plugs in below `virtual-dates`, the way `PurchaseVerifier`
and the translation driver do: an interface the rest of the app does not know
the shape of.

---

## Recommended shape of the decision

1. Ship VR dates with **no voice at all** first, if that is viable. Text already
   works, and it makes the usage number measurable before committing to a rate.
2. Measure minutes per active member for a month.
3. Then choose, with the real number in hand and the retention questions above
   asked in writing.

That order costs a release. It also avoids signing a per-minute contract based on
the guess currently sitting in `cost-model.mjs`.
