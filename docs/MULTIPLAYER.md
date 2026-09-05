# Multiplayer

**Nothing is built.** Like `VOICE.md`, this records what the decision costs and
what must be true of whatever is chosen — §57 puts the paid-service choice with
the owner.

---

## What it is worth

From `npm run cost-model`: roughly **$120k a year at 1M members** on the model's
usage assumptions, which is the third of the three lines that dominate every
column. Together with voice and translation it is ~80% of total cost at every
scale.

---

## What this actually needs, which is less than it sounds

A virtual date is **two people in one room**. That is worth stating plainly,
because almost every multiplayer product is built and priced for the opposite
case, and buying a platform designed for a hundred-player shooter to run a
two-person conversation is how this line becomes expensive.

What has to synchronise (§34):

- head and hand position, and rotation
- animation state
- emotes
- interaction state — who is holding the flower, who is sitting where

What does **not**: physics, projectiles, world state, authoritative simulation.
There is nothing to cheat at in a conversation, which removes the hardest and
most expensive requirement in multiplayer.

---

## §34's rules, and why they are not optional

**Do not send at a high frequency.** Position at 60 Hz for two people is a lot of
bandwidth for no perceptible gain. Send sparsely and **interpolate between
updates**; extrapolate briefly across a gap. On a mobile network the difference
between a smooth avatar and a stuttering one is almost entirely this, not
bandwidth.

**Network ownership must be safe.** A client owns its own avatar and nothing
else. It is the rule §30 states as "do not let the client manipulate server
state", and in a multiplayer context it has a specific failure: an ownership
model where any client can take control of any object lets one person move,
mute, or remove the other. In a dating product that is not a griefing bug, it is
a safety incident.

**Nothing a client says about identity is believed.** Which FioreMatch member a
connection belongs to is decided by the server from the session, never from a
field in a join message. The room is authorised the same way `/api/virtual-dates`
authorises everything else.

---

## The constraints that should decide it

**Two-person rooms, sporadically.** Price per participant-minute or per room,
not per peak concurrent. Check the minimum monthly commitment before anything
else; entry tiers built for game studios routinely exceed this product's whole
infrastructure budget.

**A maintained Unity SDK**, since the client is Unity. Without one this becomes a
networking project rather than an integration.

**Data residency**, for the same KVKK and GDPR reasons as voice. A relay carries
who is meeting whom and when, which is sensitive even though it is not content.

**Relay, not peer-to-peer, by default.** P2P is cheaper and leaks both members'
IP addresses to each other. On a dating platform that is a stalking vector, and
it is not a theoretical one. If a provider offers P2P as an optimisation,
it must be off.

**A way out.** Same reasoning as voice: a per-minute cost that grows with success
and cannot be renegotiated from a weak position.

---

## Whether it should be the same vendor as voice

Several providers sell both, and one integration is genuinely simpler than two.

Against that: it couples two decisions with different constraints — voice is
dominated by retention and recording policy, multiplayer by ownership and
latency — and it doubles what a bad choice costs. It also means one outage takes
the whole feature rather than degrading it.

**A reasonable position:** prefer one vendor for both *only* if it wins both
evaluations on its own merits. Do not let a bundle discount decide a retention
policy.

---

## What the code already assumes

Nothing — no table, column or interface names a provider, and the accounting
(`virtual_date_usage`) is deliberately independent of any future room record so
that a crashed or deleted room does not refund a quota.

The join path a client will need already exists in outline: the server knows
which members have an accepted invitation (`listUpcomingDates`), which is the
authorisation a room join has to check. Nothing else about a room is decided.
