# Builds

Every target §52 names, what this repository can actually produce, and the last
step — the one nobody can automate for you — for each.

Written after producing them rather than before, so what is below has been run.

---

## What exists

| Target | Producible here | Command |
| --- | --- | --- |
| Web | ✅ | `npm run build` |
| Android AAB (Play) | ✅ signed | `./gradlew :app:bundleRelease` |
| Android APK (sideload, testing) | ✅ signed | `./gradlew :app:assembleRelease` |
| iOS | ⚠️ project only | needs macOS + Xcode to archive |
| Microsoft Store (MSIX) | ⚠️ assets only | needs PWABuilder or Windows |
| Meta Quest | ❌ | needs Unity |
| Windows PC VR | ❌ | needs Unity |
| Steam | ❌ | needs Unity **and** a Steamworks account |
| Epic | ❌ | needs Unity **and** an Epic publisher account |

The four VR rows are one blocker, not four: there is no Unity project in this
repository, no Unity licence, and no headset to verify a build against. Their
*server* halves are built and shipped — invitations, the environment catalogue,
cross-platform identity, entitlements — so a client has something to connect to
when there is one. See `ROADMAP.md`.

---

## Web

```bash
npm run build && npm run start
```

This is the path every check runs against. The container is documented in
`DEPLOYMENT.md`, including the one thing about it that is unverified.

**Last step:** none. It is the deployment.

---

## Android

```bash
export ANDROID_HOME=/path/to/android-sdk
export ANDROID_KEYSTORE_PATH=/path/to/upload.jks
export ANDROID_KEYSTORE_PASSWORD=…
export ANDROID_KEY_ALIAS=upload

npx cap sync android
cd mobile/android
./gradlew :app:bundleRelease :app:assembleRelease
```

Outputs land in `app/build/outputs/`. Verified from this repository:

| | |
| --- | --- |
| Application id | `com.fiorematch.app` |
| Version | `1.0` (versionCode 1) |
| Bundle | 4.0 MB, signed, `META-INF/UPLOAD.RSA` present |
| ABIs | arm64-v8a, armeabi-v7a, x86, x86_64 |

**The keystore is never in this repository, and the build reflects that.** The
signing config reads `ANDROID_KEYSTORE_PATH` from the environment; unset, the
build still succeeds and produces an *unsigned* bundle. That is deliberate —
someone building to look at the app should not need a signing key — but it means
"the build worked" is not the same as "the artefact is uploadable". Check for the
signature before trusting one:

```bash
unzip -l app/build/outputs/bundle/release/app-release.aab | grep META-INF
$ANDROID_HOME/build-tools/*/apksigner verify --print-certs \
  app/build/outputs/apk/release/app-release.apk
```

### Last steps

1. **Bump `versionCode`** in `mobile/android/app/build.gradle`. Play refuses a
   bundle whose code is not higher than the last one uploaded, and it is the one
   thing here that cannot be derived.
2. **Enrol in Play App Signing.** The key above is the *upload* key; Google
   re-signs with the app key it holds. Losing the upload key is recoverable,
   losing an app key is not — which is the whole reason for the split.
3. **Set `ANDROID_CERT_FINGERPRINTS`** on the deployment to the SHA-256 of the
   certificate Play signs with — not the upload one, once App Signing is on.
   `/.well-known/assetlinks.json` 404s until it is set, and a wrong value is
   worse than none: deep links stop opening the app and nothing reports it.
4. `npm run store:check`, then the checklist in
   `mobile/play-store/submission.md`.

---

## iOS

`mobile/ios/App/App.xcodeproj` is a real project, not a placeholder — Capacitor
plugins are wired through SPM and `Info.plist` carries the usage descriptions.

**It cannot be archived here.** Archiving needs Xcode, which needs macOS. Nothing
in this repository can stand in for that, and a build produced any other way
would not be one Apple accepts.

### Last steps

```bash
npx cap sync ios
open mobile/ios/App/App.xcodeproj
```

1. Set the team and a provisioning profile for `com.fiorematch.app`.
2. Product → Archive, then distribute to App Store Connect.
3. Set the Associated Domains capability to `applinks:fiorematch.com`, and
   confirm `/.well-known/apple-app-site-association` answers with the team id in
   it. Same failure mode as Android: wrong is worse than absent.
4. The review notes in `mobile/app-store/listing.md` are written to be pasted
   into App Review Notes. The three guidelines Apple will actually look at are
   listed there.

---

## Microsoft Store

`mobile/microsoft-store/` holds the listing, the screenshots and the tile art.
The package itself is produced from the deployed PWA by PWABuilder, so it cannot
be built before the site is live — see `submission.md`, which walks it through.

**Last step:** reserve the product name in Partner Center *first*. The package
identity comes from the reserved name, so packaging before reserving produces an
identity that has to be thrown away.

---

## Before any of them

```bash
npm run store:check
```

Checks the three listings against each other and against the code: identifiers,
product ids, the support address, the character counts, and whether the
screenshots are older than the copy they show. Exits non-zero on a blocker.

It cannot confirm that a store's current requirements are what the listings
assume — §51 is explicit about not making that assumption, and the report says so
on every run. That part is a person reading each store's documentation.
