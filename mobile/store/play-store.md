# Google Play submission

## Blocking on someone else

- **Release keystore.** Generate once, back it up somewhere that survives a
  laptop; losing it means never updating this listing again.
- **Play Console account** and the one-off registration fee.
- **A demo account** — Play reviews an app behind a login by signing in. Give
  a real account with at least one match and one conversation, or the reviewer
  sees empty screens and rates the app on those.
- **Deep links.** After the first release, take the SHA-256 of *both* the
  upload key and Play's app-signing key from Play Console → Setup → App
  integrity, and set them as `ANDROID_CERT_FINGERPRINTS` (comma-separated).
  `/.well-known/assetlinks.json` starts serving once they are set, and 404s
  until then, deliberately — Android caches a failed verification.

## Data safety form

The answers below match what the code actually does. Re-check them whenever
the app starts collecting something new; a wrong answer here is a policy
violation, not a typo.

| Question | Answer |
|---|---|
| Data encrypted in transit | Yes — HTTPS only, cleartext disabled in the shell |
| Users can request deletion | Yes — in-app, Your profile → Delete your account, and no sign-in wall in front of it |
| Data shared with third parties | Only if translation is enabled: message text goes to the configured provider. Off by default |

Collected, all linked to the account and none used for tracking or ads:

- **Name, email** — account.
- **Photos** — profile. EXIF including GPS is stripped before storage.
- **Messages** — the conversation.
- **Approximate location** — country and city, chosen from a list. The app
  never reads device location.
- **Device ID** — the push token, so a notification reaches the right phone.

Play also asks for a deletion URL usable by someone who has uninstalled the
app. `https://fiorematch.com/<locale>/app/profile` is the in-app route; the
web-accessible equivalent is the same page, since the site and the app are one
deployment. What deletion actually removes, and the three references
deliberately kept as `SET NULL` — the moderation record, and rewards a referrer
already earned — is written out in `app-store.md`; the same answer applies here.

## Content rating

A dating app is **Mature 17+** at minimum, and the questionnaire asks directly
about user-to-user communication and whether it is moderated. It is: Scam
Shield assesses every message, photos are gated behind moderation, and there is
a reporting and blocking flow. Say so — an unmoderated answer changes the
rating.

## Listing

- **Title** — FioreMatch
- **Short description** — Meet people who are looking for the same thing.
- **Privacy policy URL** — `https://fiorematch.com/en/legal/privacy`
- **Screenshots** — at least two phone screenshots. `docs/mobile.md` covers
  capturing them.

## Technical

- `targetSdk` must meet Play's current floor, which rises every August; check
  `mobile/android/variables.gradle` before each submission.
- Upload an **Android App Bundle** (`.aab`), not an APK.
