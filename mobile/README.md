# mobile/

Everything that exists because FioreMatch ships to the app stores. The web app
under `src/` does not import anything from here.

```
mobile/
  android/           Capacitor Android project — opens in Android Studio
  ios/               Capacitor Xcode project — opens in Xcode
  play-store/        everything you upload to Play Console, and nothing else
  app-store/         everything you upload to App Store Connect, and nothing else
  microsoft-store/   everything you upload to Partner Center, and nothing else
  captures/          the raw 1080×1920 phone captures Play and Apple are cut from
  captures-desktop/  the raw 1366×768 desktop captures Microsoft is cut from
  shell/             error.html — the screen shown when the site cannot be reached
  assets/            icon + splash generation, for both native projects
```

The three store folders are deliberately self-contained: what Play wants, what
Apple wants and what Microsoft wants are different files at different sizes, and
a single mixed folder meant reading a table to work out which third to drag into
which console. The `assets/` and `captures*/` folders stay shared because they
are *inputs* — one mark, one set of captures — and duplicating them would let
the stores drift apart on the thing that should be identical.

There is no `mobile/windows/`, and that is deliberate. The Windows app is the
PWA — `src/app/manifest.ts` and `public/sw.js` — packaged as an MSIX by
PWABuilder. A third native shell would be a second copy of the app to keep in
step with the first two, in exchange for nothing the packaged PWA does not
already do. See `microsoft-store/submission.md`.

**Before submitting to Microsoft**, read the first section of that file: the
purchase verifier has no Microsoft driver, so subscriptions cannot be sold on
Windows today, and the listing copy currently quotes prices.

`capacitor.config.ts` stays at the repository root, because that is where the
Capacitor CLI looks for it. It points `android.path` and `ios.path` here.

## The shape of the app

The shell loads the deployed site rather than bundling a static export — see
`docs/mobile.md` for why that is forced rather than lazy. What is native is the
container: push notifications, deep links, the status bar, the keyboard and the
Android back button.

## Commands

```bash
npm run native:sync             # copy config + plugins into the native projects
npm run native:assets           # regenerate launcher icons and splash from the mark
npm run native:android          # open Android Studio
npm run native:ios              # open Xcode (macOS)
npm run store:assets            # recut all three stores from the captures
npm run store:microsoft:assets  # the Windows tile ladder (rarely changes)
```

### Re-shooting the captures

Everything under the store folders is *derived*. Nothing in them should be
edited by hand — the next `store:assets` overwrites it.

```bash
npm run seed:demo               # demo members + a cross-language conversation;
                                # prints a session cookie
npm run build && npm run start  # captures run against a real build
FM_SESSION=<token> npm run capture
npm run store:assets
```

`capture` shoots both shapes — 1080×1920 phone and 1366×768 desktop — and also
copies four of them into `public/screenshots/`, which is where the web manifest
points. One set of captures, everything else downstream.

The pricing screenshot is the reason this is a command. It was taken by hand
once and then quietly outlived two repricings, because there was nothing to
re-run and nothing to fail.

Two things the capture needs that are easy to miss:

- **A translation provider.** Without one, `translationEnabled()` is false and
  the conversation shot shows untranslated German under a filename that says
  `otomatik-ceviri`. `scripts/capture-translator.mjs` answers DeepL's contract
  locally with checked-in, accurate Turkish for the seeded lines, so the real
  driver, cache and UI all run:
  ```bash
  node scripts/capture-translator.mjs &
  export TRANSLATE_PROVIDER=deepl DEEPL_API_KEY=anything \
         DEEPL_API_HOST=http://127.0.0.1:3131
  ```
- **A server on the build you just made.** `npm run start` fails with
  `EADDRINUSE` if an older one is still up, and then the captures are of the
  *previous* build — silently, since the old server answers fine. Kill by port
  (`fuser -k 3100/tcp`), not by name.

`CAPACITOR_SERVER_URL` chooses which deploy the shell loads:

```bash
CAPACITOR_SERVER_URL=https://staging.fiorematch.com npm run native:sync
```

## Building an actual file

Android Studio is not required — the Gradle wrapper and a command-line SDK are
enough, which is what CI would use. On a machine with JDK 21:

```bash
# One-time: the SDK the project compiles against (compileSdk 36).
export ANDROID_HOME=/opt/android-sdk
curl -o /tmp/cmdtools.zip \
  https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
unzip -q /tmp/cmdtools.zip -d /tmp/cmdtools
mkdir -p "$ANDROID_HOME/cmdline-tools"
mv /tmp/cmdtools/cmdline-tools "$ANDROID_HOME/cmdline-tools/latest"
yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" \
  "platform-tools" "platforms;android-36" "build-tools;36.0.0"

cd mobile/android
./gradlew assembleDebug   # app/build/outputs/apk/debug/app-debug.apk
./gradlew bundleRelease   # app/build/outputs/bundle/release/app-release.aab
```

Both succeed with no signing configuration, and what comes out differs:

- **The debug APK is installable.** Gradle signs it with the shared Android
  debug key, so it sideloads onto a phone (`adb install`, or copy it across and
  allow install from unknown sources). It is a testing artefact: that key is
  public, every debug build in the world shares it, and Play rejects it.
- **The release build is unsigned** unless the four environment variables below
  are set, and Play refuses an unsigned upload.

### Signing a release

`app/build.gradle` reads the key entirely from the environment — no path, no
password, no alias anywhere in the repository. Set them and the same command
produces a signed artefact:

```bash
export ANDROID_KEYSTORE_PATH=/secure/path/fiorematch-upload.jks
export ANDROID_KEYSTORE_PASSWORD='…'
export ANDROID_KEY_ALIAS=upload
# ANDROID_KEY_PASSWORD is optional; it falls back to the store password.

./gradlew bundleRelease    # signed .aab — this is what Play takes
./gradlew assembleRelease  # signed .apk — direct install, not for Play
```

Generating one, if it ever has to be done again:

```bash
keytool -genkeypair -v -keystore fiorematch-upload.jks -alias upload \
  -keyalg RSA -keysize 4096 -validity 10000
```

Verify before uploading — "BUILD SUCCESSFUL" does not mean "signed", because an
unsigned release build also succeeds:

```bash
jarsigner -verify -certs app/build/outputs/bundle/release/app-release.aab
apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk
```

### The key is the app's identity

Two separate keys exist once the app is on Play, and confusing them is the
usual way this goes wrong:

- **The upload key** is the one generated above. It only proves to Google that
  an upload came from you. If it is lost, support can reset it.
- **The app signing key** is what actually signs what users install. With Play
  App Signing (the default for new apps) Google holds it, which is the whole
  reason a lost upload key is survivable. Without it, losing your key means the
  listing can never be updated again — there is no recovery, by design.

Enrol in Play App Signing. Keep the upload keystore and its password in a
password manager, not in the repository: `*.jks`, `*.keystore`, `*.p12` and
`key.properties` are gitignored, and those lines are not to be re-commented.

`/.well-known/assetlinks.json` needs the SHA-256 fingerprint of **whichever key
signs what users install** — so under Play App Signing that is Google's app
signing key, shown under *Release → Setup → App signing*, not the upload key.
List both in `ANDROID_CERT_FINGERPRINTS` (it is comma-separated for exactly
this reason): builds you sideload carry the upload key, and half your deep
links fall back to the chooser if only one is published.

```bash
keytool -list -v -keystore fiorematch-upload.jks -alias upload
```

Note what the shell points at. `capacitor.config.json` inside the APK carries
`server.url`, baked in at `cap sync` time — a build made while
`fiorematch.com` is not yet serving will open the branded offline screen, not
the app. That is `mobile/shell/error.html` doing its job, not a failure.

Build outputs are gitignored (`build/`) and belong in a release pipeline, not
in the repository.
