# Privacy

A dating profile is close to the most sensitive category of data a person hands
over: who they are, where they are, who they are attracted to, and what they say
in private. §31 asks for privacy-first design, and the version of that which
survives a refactor is **not collecting the data**, not a policy saying it will
be handled carefully.

What follows is what the code does, not what an intention document says.

---

## Not collected at all

**No analytics vendor, no event stream, no tracking SDK.** The metrics at
`/app/admin/metrics` are aggregates computed on demand from tables the product
already keeps in order to work. Nothing is recorded by asking; nothing leaves
the server.

That single decision answers most of what a privacy review would ask: there is
no processor to name, no data-processing agreement, no consent banner for a
tracker that does not exist, and no retention policy beyond the one the
underlying tables already have.

**No precise location, ever.** Members choose a city and a country from a closed
list. The app never reads device location, and no coordinate is stored anywhere.
The Play Data Safety form is answered accordingly — "approximate location", not
"precise" — and that answer is a policy declaration, so it has to be true.

**No third-party sign-in.** "Sign in with Facebook" on a dating app correlates a
dating identity with a social one, which is a correlation people do not expect
to be making.

---

## Collected, and why

| Data | Why it exists | Who can see it |
| --- | --- | --- |
| Email, password hash, birthdate | account, and the 18+ check | nobody but the member |
| Display name, bio, city, country | the profile | per the member's own visibility settings |
| Photos | the profile | only after moderation approval |
| Messages | the conversation | the two people in it, plus a moderator on a report |
| Likes, matches, passes | the product | nobody directly; a pass reason is never shown |
| Platform identity (Meta/Steam/Epic) | cross-platform sign-in | **nobody — never leaves the server** |

**Per-field visibility is applied server-side.** A field a member has hidden is
not sent and then hidden by the client; it never leaves the machine. See
`loadProfileCards`.

---

## Deliberately minimal records

Several tables hold less than they easily could, and each omission is load-bearing:

- **Virtual date usage rows carry no content, no partner and no room contents.**
  They are a rolling month of counting, and nothing reads further back.
- **The store notification log holds a provider, an opaque id and a date** — not
  the subscription, the product or the member. It is written by an
  unauthenticated endpoint about people who may later delete their accounts, and
  a `provider_ref` there would outlive the deletion and re-link them the next
  time the same store subscription appeared.
- **`platform_user_id` never leaves the server.** `linkedPlatforms` returns the
  platform name and two dates, and a test asserts the id is absent. A Steam id
  is a durable public handle elsewhere; putting one on a dating account screen is
  one screenshot away from linking the two identities in public.
- **Analytics breakdowns withhold small buckets.** Aggregates stop being
  anonymous when the population is small, and this product's population is
  smallest exactly when someone is most likely to be reading the numbers. "One
  accepted date in the Northern Lights this week" is a fact about a person to
  anyone who knows a single member.
- **Log lines carry no identifiers.** The one warning the notification endpoint
  emits names the store and the reason, and nothing else — a log is the easiest
  place in a system for an identifier to outlive the account it belonged to.

---

## Photos

- **EXIF and GPS are stripped on upload**, before storage. A photo taken at home
  carries the home address and members do not know that.
- Re-encoded to WebP, which also discards anything else the original container
  was carrying.
- Content-addressed keys, served through a route that checks moderation state
  and the viewer on **every read** — not a static mount — and cached `private`
  precisely because visibility depends on who is asking.

---

## Deletion

**Erasure is complete by construction, not by a checklist.** Every table holding
member data cascades from `users`, so a delete removes everything in one
statement and cannot drift out of sync with the schema. A test asserts it table
by table.

`deletedAt` is set the moment a member asks to go, before the purge runs, and
both Discover and the member count respect it immediately — so "I deleted my
account" is true from the member's point of view straight away.

Account deletion is **in the app**, not by emailing support. Apple's guideline
5.1.1(v) requires this and explicitly does not accept a support email; it is
also simply the right behaviour.

The single table that does not cascade is discussed above, and holds nothing
that points at a person.

---

## Translation is the one thing that leaves

When a member uses in-chat translation, **the message text is sent to the
configured translation provider**. This is the only path by which member content
reaches a third party, and:

- It is **off unless a provider is configured**. With none set the feature does
  not appear at all, rather than appearing and failing.
- It is per message and member-initiated.
- It is declared in the Play Data Safety form as data shared with a third party,
  because it is.

If a provider is configured, that provider's terms become part of this product's
privacy posture. Choose one whose terms forbid training on submitted text.

---

## GDPR / KVKK

The structural requirements are met by the design rather than by a process:

| Right | How |
| --- | --- |
| Access | the member sees their own profile and messages in the app |
| Erasure | in-app deletion, complete by cascade |
| Rectification | profile editing |
| Data minimisation | the omissions listed above |
| Purpose limitation | no data is collected for a purpose the product does not have |

**Not met, and needing a person rather than code:** a published privacy policy
that matches this document (the legal pages exist and must be kept in step), a
named data controller, a lawful basis recorded per purpose, a data export in a
portable format, and a breach notification procedure. A deployment serving EU or
Turkish members needs all of those before it opens.

Voice and avatar data are absent from this document because neither exists. When
they do, §31's rule stands: **voice recordings are not kept by default.**
