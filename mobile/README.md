# mobile/

Everything that exists because FioreMatch ships to the app stores. The web app
under `src/` does not import anything from here.

```
mobile/
  android/    Capacitor Android project — committed, opens in Android Studio
  ios/        README only; `npx cap add ios` needs macOS and writes here
  shell/      error.html — the screen shown when the site cannot be reached
  assets/     icon + splash generation, and the iOS 1024 master it produces
  store/      listing metadata, the privacy manifest, submission checklists
```

`capacitor.config.ts` stays at the repository root, because that is where the
Capacitor CLI looks for it. It points `android.path` and `ios.path` here.

## The shape of the app

The shell loads the deployed site rather than bundling a static export — see
`docs/mobile.md` for why that is forced rather than lazy. What is native is the
container: push notifications, deep links, the status bar, the keyboard and the
Android back button.

## Commands

```bash
npm run native:sync      # copy config + plugins into the native projects
npm run native:assets    # regenerate launcher icons and splash from the mark
npm run native:android   # open Android Studio
npm run native:ios       # open Xcode (after `npx cap add ios` on a Mac)
```

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

Both succeed with no signing configuration, and what comes out differs in a way
that matters:

- **The debug APK is installable.** Gradle signs it with the shared Android
  debug key, so it sideloads onto a phone (`adb install`, or copy it across and
  allow install from unknown sources). It is a testing artefact: that key is
  public, every debug build in the world shares it, and Play rejects it.
- **The release AAB is not.** `app/build.gradle` has no `signingConfig`, so the
  bundle comes out unsigned and Play will refuse the upload. Signing needs a
  keystore that belongs to whoever publishes the app — generate it once, keep
  it somewhere it cannot be lost (losing it means never updating the listing
  again), and add a `signingConfigs` block reading the password from the
  environment rather than from a file in the repository.

Note what the shell points at. `capacitor.config.json` inside the APK carries
`server.url`, baked in at `cap sync` time — a build made while
`fiorematch.com` is not yet serving will open the branded offline screen, not
the app. That is `mobile/shell/error.html` doing its job, not a failure.

Build outputs are gitignored (`build/`) and belong in a release pipeline, not
in the repository.
