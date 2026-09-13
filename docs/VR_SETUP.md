# VR client setup

**There is no Unity project in this repository, and nothing here builds one.**
No Unity licence, no headset to verify against, and two of the services it would
need have no provider chosen.

What does exist is the server half: everything a headset would need to
authenticate a member, find their matches, and discover that two people agreed
to meet. This document is the handover to whoever builds the client — what is
already decided, what the API gives you, and the rules that are not negotiable.

---

## What is already built

| | |
| --- | --- |
| Accounts, profiles, matching, messaging | ✅ live |
| Cross-platform identity (Meta / Steam / Epic → FioreMatch account) | ✅ schema and route; **no verifier driver** |
| Virtual date invitations, scheduling, expiry, acceptance | ✅ live, with tests |
| Environment catalogue with tier gating | ✅ |
| Per-member monthly allowance and its accounting | ✅ |
| Entitlements (what this member may do) | ✅ |
| Avatars, rooms, voice, multiplayer, in-room interactions | ❌ nothing |

The web and mobile UI for inviting and answering exists and is **switched off**:
the `virtual_dates` feature flag is deliberately at rollout 0. Turning it on
without a client would let two people agree to meet somewhere that does not
exist, and would spend a free member's five-a-month allowance on nothing.

---

## The flow the client joins

```
member signs in on the headset
  → platform ticket verified → FioreMatch account   ← driver missing
  → GET /api/user/entitlements                       what may they do
  → GET /api/matches                                 who they know
  → GET /api/virtual-dates                           invitations, upcoming, allowance
  → the two of them accept
  → [ room ]                                         ← does not exist
```

Only the bracketed step is missing from the server's point of view. Everything
above it answers today.

---

## The API surface

### `GET /api/virtual-dates`

```jsonc
{
  "available": true,          // false when the flag is off — degrade, do not error
  "invites":   [ /* open invitations, both directions */ ],
  "upcoming":  [ /* accepted dates that have not happened */ ],
  "environments": [ /* only those this member's tier may choose */ ],
  "allowance": { "remaining": 3, "limit": 5 }   // theirs only, never the other side's
}
```

`available: false` is the shape to handle first, not last. A client that treats
it as an error will show a failure whenever the flag is off, which is right now.

### `POST /api/virtual-dates`

`{ matchId, environment?, scheduledFor? }` → an invitation, or a refusal with a
reason. The refusals are a closed set and each means something different:
`no_dates_left`, `environment_locked`, `unknown_environment`,
`scheduled_in_the_past`, `scheduled_too_far`, `already_pending`, `not_a_match`.

Show them apart. "Something went wrong" for `no_dates_left` is how a member
concludes the product is broken rather than that they have used their five.

### `POST /api/virtual-dates/[inviteId]`

`{ response: "accept" | "decline" }`.

**Acceptance is the billable moment** — it is where both allowances are checked
and spent, and where a room should be considered to exist. Not the invitation,
and not the room actually opening.

Note the asymmetry when the flag is off: `accept` returns 404, `decline` still
works. A kill switch flipped during an incident must not leave people holding
invitations they cannot answer for a week.

---

## Environments

Ids and a minimum tier, and deliberately nothing else — no names, no
descriptions, no images. Those belong with the screens that show them.

| id | minimum tier |
| --- | --- |
| `basic_cafe` | free |
| `sunset_beach` | plus |
| `star_observatory` | plus |
| `luxury_restaurant` | vip |
| `rooftop` | vip |
| `tropical_island` | vip |

**The free environment is deliberately plain but real.** A free tier with no
environment at all would make the whole feature paid; the thing to sell is the
ceiling, not the feature.

Gating is enforced server-side at invite time, and an unknown id is **refused
rather than defaulted** — a silent substitution would put two people somewhere
neither chose, and would make a locked environment indistinguishable from a typo
to anyone probing the API.

---

## Rules the client does not get to decide

**Authentication.** A platform id proves nothing — "I am Steam user 76561…" is a
public, typeable string. The client sends the platform's signed *ticket*; the
server turns it into an identity. No driver exists for Meta, Steam or Epic, so
`/api/user/platforms/[platform]` answers 503 rather than accepting a claim.
Writing one needs credentials from a publisher account.

**Entitlements.** Never decided on the headset. `GET /api/user/entitlements` is
for rendering the right UI; the server enforces. A client that lets someone into
a VIP environment because a local variable said VIP is a client that will be
worked around.

**Allowance.** Do not cache and decrement locally. An invitation sits for a week
and the member may have spent their month on another device meanwhile — which is
why the inviter's allowance is re-checked at acceptance rather than trusted from
invite time.

**Room authorisation.** Membership of a room is decided by the server from an
accepted invitation, never from a room id the client supplies. `listUpcomingDates`
is the query that answers "are these two people allowed to be in a room
together".

**Safety.** Block, report, mute and leave must exist inside the experience and
must not depend on the other participant's client. Blocking already deletes the
match and cascades to invitations; a live session has to be included. See
`SAFETY.md` and the unresolved question in `VOICE.md` about what a report from
inside a date can even contain.

**Privacy.** No recording by default (§31). Position and voice are the most
intimate telemetry this product could hold; the ordinary rule applies harder —
do not store what the feature does not require.

---

## Before writing any of it

Three decisions are outstanding and each changes the architecture:

1. **Voice provider** — `VOICE.md`
2. **Multiplayer provider** — `MULTIPLAYER.md`
3. **Asset licensing** for environments, avatars, animations and audio —
   `ASSET_LICENSES.md`, which is currently short because nothing third-party
   ships. That is where §32 will actually bite.

`ROADMAP.md` and `docs/BUILDS.md` record what is blocked and why.
