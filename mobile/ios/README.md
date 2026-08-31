# iOS

The Xcode project is here and committed. `npx cap add ios` was run on Linux —
it only copies a template, so it does not need a Mac — which means the things
that template gets wrong were fixable in the repository rather than left as a
checklist for whoever opens Xcode first.

```bash
npx cap sync ios     # config + plugins into the project
npm run native:ios   # open Xcode (macOS)
```

## Already done here

None of these are what `cap add` produces, and each one is a rejection or a
crash if it is missing. They are listed so nobody re-does them, and so a future
`cap add ios` that overwrites the project can be repaired against this list.

| | Where |
|---|---|
| Photo and camera usage strings | `App/App/Info.plist` |
| Export-compliance answer (`ITSAppUsesNonExemptEncryption`) | `App/App/Info.plist` |
| Light appearance lock, matching the Android theme | `App/App/Info.plist` |
| `arm64` instead of the template's 32-bit `armv7` | `App/App/Info.plist` |
| Portrait-only on iPhone | `App/App/Info.plist` |
| Advertised languages — `en` and `tr` only | `App/App/Info.plist` |
| Privacy manifest, as a member of the App target | `App/App/PrivacyInfo.xcprivacy` |
| Brand app icon, with **no alpha channel** | `App/App/Assets.xcassets` |
| Launch screen on the brand ground | `App/App/Base.lproj/LaunchScreen.storyboard` |

Two of those deserve their reasons written down.

**The icon has no alpha channel, not merely no transparent pixels.** App Store
Connect rejects an icon that *has* the channel — "The app icon can't be
transparent nor contain an alpha channel" — and it tests for the channel. An
icon drawn on an opaque ground still fails, because the encoder writes RGBA with
every pixel at 255. `mobile/assets/generate.mjs` flattens it deliberately; that
is what the `opaquePng` path is for, and the rejection arrives only after a
build has been archived and signed.

**The launch screen sets its background explicitly** rather than using
`systemBackgroundColor`, which is dynamic and resolves to black on a phone in
dark mode.

## Still needs a Mac and an Apple account

These cannot be committed — they are Xcode capabilities that write to the
provisioning profile, or they need credentials.

1. **Associated Domains.** Signing & Capabilities → + Capability → Associated
   Domains, then `applinks:fiorematch.com` and `applinks:www.fiorematch.com`.
   The site side already serves `/.well-known/apple-app-site-association` once
   `APPLE_TEAM_ID` is set. Apple fetches it over HTTPS with no redirect, so
   check it resolves on the apex domain the app declares.

2. **Push Notifications.** Signing & Capabilities → + Capability → Push
   Notifications, then an APNs key in the developer account. `push_tokens`
   already records devices; nothing sends yet.

3. **Signing.** A team, a bundle identifier registered to it, and a
   distribution certificate.

## Screenshots

`mobile/app-store/assets/` holds a compliant set at both required sizes,
composed from the captures in `mobile/captures/`. They are stand-ins: the
pixels inside the device frame are real, but they were taken in a browser at
Play's dimensions and against a seeded database. Re-shoot from the simulator
once the app runs against real data — `mobile/app-store/screenshots.mjs`
explains the trade it makes.
