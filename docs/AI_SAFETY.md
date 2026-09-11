# AI Safety Policy

Rules that constrain every AI-backed feature on FioreMatch. These are
requirements, not aspirations: where a rule can be enforced in code or covered
by a test, it is, and the enforcement point is named below.

## 1. AI proposes, people decide

No AI system on FioreMatch acts on a member's behalf.

- It does not send messages. Conversation Coach and AI Icebreaker return
  suggestions; the member chooses, edits, or ignores them.
- It does not carry on a romantic conversation in a member's place.
- It does not present itself as a person. Suggestions are labelled as
  suggestions.
- It does not take enforcement action. Scam Shield produces a risk band; only a
  human moderator can act on it.

**Enforced by:** `moderationFlow` in `src/lib/safety/scam-shield.ts` permits the
`action` stage only from `human_review`. Covered by test.

## 2. No fabrication about a member

An explanation may only cite something the system actually holds.

The Match Reason Engine emits **structured reasons** — a signal id plus the
exact shared values — which the UI renders through translated strings. A model
is never in the position of writing a claim about a member, so it cannot invent
one. Reasons that require evidence are dropped when there is none.

**Enforced by:** `buildReasons` in `src/lib/matching/reasons.ts`, with
`REQUIRES_EVIDENCE`. Covered by a test asserting every cited value is genuinely
shared by both profiles.

The AI Profile Assistant may improve how a member expresses something, never
invent a fact about them — no fake jobs, locations, hobbies, or history.

## 3. No discriminatory matching

The matching engine is given a fixed field list (`MatchProfile`). It never
receives, and cannot infer from, ethnicity, religion, health, political views,
income, or sexual orientation beyond a member's own stated preference filter.

Cultural interest is what a member wants to connect with. It is never derived
from their nationality, name, language, or location, and never treated as a
personality trait.

**Enforced by:** the `MatchProfile` type boundary in
`src/lib/domain/profile.ts`. Adding a sensitive field would require a
deliberate type change, visible in review.

**Still required:** a disparate-impact check comparing match outcomes across
groups, before any matching feature passes 25% rollout. See
`docs/ARCHITECTURE.md` § Testing.

## 4. No sensitive inference

We do not infer attributes a member did not state. The learning loop consumes
only **explicitly volunteered** pass reasons — never dwell time, scroll depth,
photo-viewing duration, or other silent behavioural signals.

Adjustments are capped and decay toward neutral so a member's feed cannot
collapse into a filter bubble they can't escape.

**Enforced by:** `applyFeedback` / `decayTowardNeutral` in
`src/lib/matching/learning.ts`; vague reasons (`not_my_type`,
`not_interested`, `other`) map to no signal at all. Covered by test.

## 5. Model output is untrusted input

Anything a model produces is validated against a closed vocabulary before it can
influence matching. Unrecognised, malformed, or oversized values are dropped,
never guessed at. This is what stops a prompt-injected or hallucinated criterion
from reaching the engine.

**Enforced by:** `parseCriteria` in `src/lib/matching/matchmaker.ts`. Covered by
tests using malicious and malformed input.

## 6. Honest uncertainty

- Compatibility is always shown as **potential** compatibility, banded, never as
  a scientific verdict.
- When too few signals have data, no figure is shown at all.
- The compatibility quiz is not a personality test and produces no psychological
  classification, diagnosis, or trait label.
- Trust Profile shows which specific checks passed. There is no aggregate safety
  score, and we never claim a member is guaranteed safe — verification confirms
  a fact, not an intention.

**Enforced by:** `describeCompatibility` returns `unavailable` below the
confidence threshold; `containsForbiddenTrustClaim` guards the copy. Both
covered by tests.

## 7. Errs toward under-flagging

Scam Shield is deliberately conservative. Wrongly accusing a real member does
more damage than a borderline case, which the report flow still catches.
Detection is lexical and behavioural only — nationality, name, language, and
photo are never risk signals.

**Enforced by:** diminishing-returns scoring in `assessRisk` prevents a pile of
weak signals from reaching high risk on its own. Covered by test.

## 8. No fake anything

No fake users, fake traffic, fake reviews, fake followers, or synthetic
engagement — in the product, in analytics, or in marketing. This applies to
automated tooling as much as to people.

## 9. Human escalation is always available

Any AI-assisted decision that affects a member's account can be escalated to a
human. Serious moderation cases go to a human by default rather than on request.

## Review checklist

Before any AI-backed feature widens its rollout:

- [ ] Model output validated against a closed vocabulary
- [ ] Explanations cite only real, held data
- [ ] No sensitive attribute reachable by the feature
- [ ] Uncertainty surfaced honestly; no overclaiming
- [ ] Human escalation path exists and is tested
- [ ] Rate limits in place on model-backed endpoints
- [ ] Disparate-impact check run and reviewed
