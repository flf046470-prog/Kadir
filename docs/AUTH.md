# Authentication

Registration, sessions, roles, and the deletion that has to be complete.

---

## Passwords

**argon2id** at the OWASP-recommended parameters: 19 MiB of memory, 2 iterations,
parallelism 1. The parameters are recorded inside the hash string, so raising
them later re-hashes on next login rather than invalidating everyone.

Minimum length 10, maximum 1024 **bytes** — the byte cap exists because argon2
hashes the whole input and an unbounded password is a denial of service you can
post. A list of the obvious ones is refused outright.

The hash is never a plaintext or a reversible value, and nothing anywhere logs a
password or reads one back.

---

## Registration

Email and password, with an **18+ check on the birthdate**. That check is what
the store age ratings rest on; it is server-side and the birthdate is stored, so
it cannot be re-answered later by a client.

Phone registration, password reset delivery and email/phone verification
delivery are **not built** — all three need an email or SMS provider, and there
is none configured. The columns (`phone`, `emailVerifiedAt`, `phoneVerifiedAt`)
exist so adding delivery is additive rather than a migration.

---

## Sessions

A session is a random token in a cookie. **The database stores only a SHA-256 of
it**, so a database leak yields no usable sessions — the raw token exists only in
the member's cookie.

| | |
| --- | --- |
| Cookie | `fm_session` |
| Lifetime | 30 days |
| `httpOnly` | yes — script cannot read it |
| `sameSite` | `lax` |
| `secure` | in production; off only for local http |

`resolveSession` compares with a timing-safe comparison and rejects expired and
revoked tokens. **A password change revokes every session**, which is what makes
"someone else is in my account" recoverable by the member alone.

---

## No user enumeration

A login for an address that does not exist still performs a full argon2id
verification, against a dummy hash generated once at startup.

Without it, "no such user" returns in microseconds and "wrong password" takes
the ~50 ms a real hash costs, and the difference is measurable over a network.
That turns the login form into an oracle for "is this person on a dating site",
which is a disclosure worth more to an attacker than most passwords.

The response is identical in both cases too — same body, same status.

---

## Authorization

Three helpers, and they are deliberately the *only* ways to get a user in a
route handler, so "did this route check auth?" is answerable by grepping:

| Helper | Grants | Denies with |
| --- | --- | --- |
| `requireUser` | any signed-in member | `401` |
| `requireModerator` | `moderator` or `admin` | **`404`** |
| `requireAdmin` | `admin` only | **`404`** |

The union types mean a handler cannot accidentally proceed with a null user — it
has to narrow before it can reach `.user`.

**Moderation and admin routes answer 404, not 403.** Confirming that a
moderation console exists tells an attacker exactly what to target; to anyone
without the role, those routes simply are not there.

`requireAdmin` is a strictly smaller door than `requireModerator`, not a stronger
version of it. The two roles do different jobs: a moderator works one reported
case at a time, an admin sees everyone at once — and "moderator" is the role a
growing product hands out most freely.

**Roles are read from the database on every call**, never carried in the session,
so revoking someone's access takes effect immediately rather than whenever their
session happens to expire. A suspended account keeps no privileges whatever its
role says.

Roles are granted out of band — a migration or an admin action. A role a member
can set is not a role.

---

## Object ownership

Routes with an id in the path pass the caller's own id into the query that
resolves the object, and **the check lives in the `WHERE` clause** rather than in
a comparison afterwards:

```ts
where(and(eq(matches.id, matchId),
          or(eq(matches.userAId, userId), eq(matches.userBId, userId))))
```

An object that is not yours does not exist to you — which is also why these
answer 404 rather than 403.

One deliberate exception: a virtual date invitation addressed to someone else
answers "not found", but the *sender* gets "not yours". The specific answer
confirms the id exists, which is only safe to tell someone who already knows.

---

## Deletion is complete

Every table holding member data cascades from `users`, so erasure cannot drift
out of sync with the schema — adding a table without a cascade is the bug, and
the deletion test asserts table by table that nothing survives.

One table deliberately does not cascade: `store_notifications`, the dedupe log
for store callbacks. It holds a provider, an opaque notification id and a date —
no subscription reference, no member. A `provider_ref` there would outlive the
deletion that was supposed to remove someone and re-link them the next time the
same store subscription appeared. A test fails if that column is ever added.

`deletedAt` is set when a member asks to go, before the purge runs, and both the
member count and Discover respect it immediately.

---

## What is not here

- **No OAuth / social sign-in.** Deliberate for a dating product: "Sign in with
  Facebook" on a dating app is a correlation people do not expect.
- **No 2FA.** Worth having; needs a delivery channel first.
- **No account recovery** beyond a password the member still knows, for the same
  provider reason. This is the most user-hostile gap on the list.
- **Platform identities** (Meta, Steam, Epic) link *to* an account rather than
  replacing this — see `src/db/platform-accounts.ts`. No driver is written for
  any of them, and the route answers 503 rather than accepting an unverified
  claim, because a platform id is a public, typeable string.
