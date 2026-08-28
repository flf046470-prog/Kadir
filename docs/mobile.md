# The mobile app

FioreMatch ships to the app stores as a Capacitor shell around the deployed
site. This is the reasoning, the setup, and the parts that still need a machine
with an Android or Apple toolchain.

## Why the shell loads a URL instead of bundling the app

The usual way to put a web app inside Capacitor is a static export bundled into
the binary. That is not available here, and not because of a missing flag:

- Sessions are httpOnly cookies issued by the server.
- Discover, Today's 5 and the conversation are `force-dynamic` — they are
  different for every member on every request.
- Every read goes through an API route that checks membership against the
  database before it returns a row.

A static export would ship a build with no server, no session and no data. So
`capacitor.config.ts` sets `server.url`, and the shell loads the site. What is
native is the container: push notifications, deep links, the status bar, the
keyboard and the Android back button.

The trade, stated plainly:

- **One codebase.** A change to the matching engine reaches phones on the next
  deploy rather than the next store review.
- **The app needs a connection to start.** `server.errorPath` points at
  `mobile/shell/error.html` so that is a branded screen rather than a webview
  error, but it is still a screen that says "no".
- **Apple's guideline 4.2** rejects apps that are only a website in a frame.
  Push, deep links and the store listing are what distinguish this from one; if
  a review pushes back, the answer is more native surface, not an argument.

## Setup

```bash
npm install
npm run build            # the web app still builds normally
npx cap sync             # copy config + plugins into the native projects
```

`CAPACITOR_SERVER_URL` overrides the URL the shell loads. Point it at a staging
deploy or a machine on your LAN to test against something other than
production:

```bash
CAPACITOR_SERVER_URL=https://staging.fiorematch.com npx cap sync
```

### Android

```bash
npm run native:assets    # regenerate launcher icons + splash from the mark
npm run native:android   # opens Android Studio
```

`mobile/android/` is committed. Re-running `npx cap add android` restores
Capacitor's placeholder icons, so run `npm run native:assets` after it.

### iOS

`mobile/ios/` holds a README and nothing else: `npx cap add ios` needs macOS and
Xcode, which the environment this was built in does not have. On a Mac, run it
and then follow `mobile/ios/README.md`, which lists what `cap add` does not
generate — Associated Domains, the app icon, the privacy manifest and the push
capability — each with the file it belongs in.

`npm run native:assets` already writes `mobile/assets/AppIcon-1024.png` for the
iOS asset catalogue, from the same mark and the same `#fff5f7` ground as the
Android icons.

## What is built, and what is not

| | Status |
|---|---|
| Shell loads the deployed site | done |
| Offline / unreachable screen | done |
| Android launcher icons, adaptive icon, splash | done |
| App Links / Universal Links | routes done, need the two env vars |
| In-app account deletion (Apple 5.1.1(v), Play policy) | done |
| Apple privacy manifest | written, needs adding to the Xcode target |
| Android back button | done |
| Status bar, splash dismissal, keyboard | done |
| Push **registration** (device → `push_tokens`) | done |
| Push **delivery** | needs FCM + APNs credentials |
| iOS project | needs a Mac |
| Store listing, signing | needs the publishing account |

### Deep links need two environment variables

The intent filter is marked `autoVerify`, which is what makes Android open the
app without showing an "open with" chooser. Verification only passes once
`https://fiorematch.com/.well-known/assetlinks.json` lists this app's package
name and the SHA-256 fingerprint of the signing certificate. iOS needs the
matching `apple-app-site-association`.

Both files are served by routes — `src/app/.well-known/` — built from
`src/lib/native/app-links.ts`, so they never drift from the package name in the
manifest. They are **404 until configured**, which is deliberate: Android caches
a *failed* verification, so serving a placeholder that does not match the real
certificate is worse than serving nothing.

```bash
# The upload key, and Play's app-signing key if Play App Signing is on.
keytool -list -v -keystore <release.keystore> -alias <alias>

ANDROID_CERT_FINGERPRINTS=AB:CD:...,12:34:...   # comma-separated, both keys
APPLE_TEAM_ID=A1B2C3D4E5
```

Two fingerprints is the normal case, not an edge case: with Play App Signing
the uploaded build is signed by the upload key and the delivered build by
Google's, and a device that gets the wrong one silently falls back to the
chooser. Until the variables are set the links still open the app — just via
that chooser.

### Push delivery needs credentials

`push_tokens` is populated correctly today: a device registers after the member
gets their first match, and re-registering after a different sign-in moves the
token to the new owner rather than leaving the notification addressed to the
previous one. Nothing sends yet. That needs:

- **Android** — a Firebase project, `google-services.json` in
  `mobile/android/app/`, and the Google Services Gradle plugin.
- **iOS** — an APNs key from the Apple Developer account, and the Push
  Notifications capability.

Both belong to the account that publishes the app.

## Check these on real hardware first

Written without a device or emulator available, so unverified on hardware:

- **Keyboard behaviour in the conversation.** `KeyboardResize.Native` is the
  documented default rather than a measured choice. Check that the composer
  rises with the keyboard, and where the bottom tab bar ends up while typing —
  it may need hiding when the keyboard is open.
- **Safe areas on a notched device.** The layout uses
  `env(safe-area-inset-bottom)` for the tab bar and `viewport-fit=cover`.
- **The splash-to-app transition.** `launchAutoHide` is off and the app hides
  the splash once React mounts; if that leaves a gap, the hide is in
  `src/components/native/NativeShell.tsx`.
- **Deep links** — before `assetlinks.json`, verify with:
  ```bash
  adb shell am start -a android.intent.action.VIEW \
    -d "https://fiorematch.com/tr/register?ref=ABCD2345"
  ```
