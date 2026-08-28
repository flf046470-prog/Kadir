# App Store submission

Read `mobile/ios/README.md` first — the Xcode project does not exist yet, and
four of the steps there are crashes or rejections if skipped.

## Blocking on someone else

- **Apple Developer Program** membership, and the team id, which becomes
  `APPLE_TEAM_ID` so `/.well-known/apple-app-site-association` starts serving.
- **A demo account** for App Review, with a match and a conversation already in
  it. Reviewers reject dating apps whose screens are empty behind the login.
- **An APNs key** if push is to work.

## App Privacy answers

Same substance as the Play data-safety table, in Apple's vocabulary. It must
also match `mobile/store/PrivacyInfo.xcprivacy`, which ships inside the binary
— Apple compares them.

Collected and **linked to the user**; none used for tracking:

- Contact Info → Name, Email Address
- User Content → Photos, Other User Content (messages)
- Location → Coarse Location (country/city, member-chosen)
- Identifiers → Device ID (push token)

## The two guidelines this app has to answer for

**4.2 Minimum Functionality.** The shell loads a website, and Apple rejects
apps that are only a wrapper. What distinguishes this one: push notifications,
Universal Links, and a product that is genuinely an app rather than a brochure.
If review pushes back, the answer is more native surface — not an appeal.

**5.1.1(v) Account Deletion.** Satisfied: Your profile → Delete your account,
which removes the `users` row; 28 of the 31 foreign keys to it are
`ON DELETE CASCADE`, so profile, photos, matches, messages, likes, blocks,
quiz answers, travel plans, sessions, push tokens and rewards go with it.
Apple checks this specifically for apps that create accounts, and a
support-email route does not pass.

Three references are `ON DELETE SET NULL` rather than cascade, deliberately, and
it is better to be able to say why than to be asked:

- `moderation_actions.subject_user_id` and `.moderator_id` — the safety record
  of what was reported and what a moderator did survives, with no pointer to a
  person. Deleting an account cannot be a way to erase the record of abusing
  it. The free-text `note` on such a row is written by a moderator, so purging
  notes on deletion is worth doing before launch if the moderation flow ever
  starts putting names in them.
- `referral_rewards.referee_id` — a referrer keeps a reward they already earned
  when the person they invited later leaves. The reward row belongs to the
  referrer, who did not delete anything.

Also relevant: dating apps are **17+**, and App Review will look for reporting
and blocking. Both exist — the report flow is on every message, and blocking is
in the conversation header.

## Listing

- **Name** — FioreMatch
- **Subtitle** — Meet people who mean it
- **Privacy policy URL** — `https://fiorematch.com/en/legal/privacy`
- **Screenshots** — 6.7" and 6.5" iPhone sizes are mandatory.
