# iOS

This directory is a placeholder. `npx cap add ios` needs macOS and Xcode, which
the environment this was built in does not have, so the Xcode project is
created on a Mac rather than committed half-formed.

```bash
npx cap add ios      # writes mobile/ios/App/... (capacitor.config.ts sets the path)
npx cap sync ios
npm run native:ios   # opens Xcode
```

Everything below is the part `cap add` does **not** do. Each one is a store
rejection or a crash if it is skipped.

## 1. Photo permissions — this one crashes

The app uploads profile photos. In a `WKWebView` that is an
`<input type="file">`, and iOS terminates the app rather than showing a picker
when the usage strings are missing. Add to `Info.plist`:

```xml
<key>NSPhotoLibraryUsageDescription</key>
<string>FioreMatch needs access to your photos so you can add them to your profile.</string>
<key>NSCameraUsageDescription</key>
<string>FioreMatch needs the camera so you can take a photo for your profile.</string>
```

Apple rejects generic strings ("this app needs photo access"). Say what it is
for, in the words above or better ones.

## 2. Associated Domains — deep links

Signing & Capabilities → **+ Capability** → Associated Domains, then add:

```
applinks:fiorematch.com
applinks:www.fiorematch.com
```

The site side is already built: `/.well-known/apple-app-site-association` is
served once `APPLE_TEAM_ID` is set. Apple fetches it over HTTPS with no
redirect, so check it resolves on the apex domain the app declares.

## 3. Push capability

Signing & Capabilities → **+ Capability** → Push Notifications. Then create an
APNs key in the Apple Developer account and upload it wherever the sends will
originate. `push_tokens` already records devices; nothing sends yet.

## 4. Privacy manifest

Copy `mobile/store/PrivacyInfo.xcprivacy` into the Xcode project (target
membership: App). Apple has required this since 2024 and rejects builds that
declare an inaccurate one — read it before shipping, it describes what this
app actually collects and must stay true as the app changes.

## 5. App icon

`mobile/assets/AppIcon-1024.png` is the master. Xcode 14+ derives every size
from one 1024×1024 file. It is deliberately opaque with no alpha: the App Store
rejects an icon with transparency.

## 6. Encryption declaration

The app uses HTTPS only, which is exempt, but the question is asked on every
submission. In `Info.plist`:

```xml
<key>ITSAppUsesNonExemptEncryption</key>
<false/>
```

Without it, every build waits on a manual compliance answer before it can go to
TestFlight.
