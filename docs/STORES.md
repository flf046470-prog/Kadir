# Shipping to stores

What each store actually needs, and which constraints are forced by the technology rather than
chosen. The game is one web build; the store packages wrap it differently.

| Store | Package | VR | Status |
| --- | --- | --- | --- |
| Meta Horizon Store | Immersive WebXR PWA via Bubblewrap (TWA → APK/AAB) | Native WebXR | Buildable here; needs a signing key and a developer account |
| Steam | Desktop shell + bundled-browser VR launch | SteamVR via OpenXR | Buildable here; needs a Steamworks appid |
| Google Play / App Store | Capacitor shell | — (mobile is flat) | Not set up |

---

## Meta Horizon Store

Meta supports WebXR PWAs as a first-class product type — no engine, no native code. A PWA is
packaged with Meta's Bubblewrap fork into an Android app that launches the site in a Trusted Web
Activity.

### What is already in the repo

* `packages/client/public/manifest.webmanifest` — `display: fullscreen`, landscape, `id`, `scope`,
  and icons at 192/512/1024 plus a maskable 512.
* `packages/client/public/icons/` — the PNGs the manifest references.
* `packages/client/public/sw.js` — offline start. A headset launches the app from its library,
  so it has to boot without assuming a network.
* `scripts/build-precache.mjs` — writes `dist/client/precache.json` after each build.
* `packaging/meta-quest/twa-manifest.template.json` — the Bubblewrap project config.
* `npm run pack:quest -- --domain <host>` — renders the config and validates the PWA.
* `npm run check:pwa` — drives the built client in a real browser: worker reaches `activated`,
  then the server is killed and the app must still come up.

### Steps

```bash
npm run build                                   # dist/client + precache.json
npm run check:pwa                               # prove offline start actually works
npm run pack:quest -- --domain play.example.net # renders packaging/meta-quest/twa-manifest.json

npm install --global @meta-quest/bubblewrap-cli
cd packaging/meta-quest
bubblewrap init --manifest=https://play.example.net/manifest.webmanifest --metaquest
bubblewrap build                                # -> app-release-signed.apk / .aab
adb install ./app-release-signed.apk            # sideload onto the headset to test
```

Then bind the app to the domain, or it launches with a browser URL bar and gets rejected:

```bash
keytool -list -v -keystore ./android.keystore -alias android   # copy the SHA-256
bubblewrap fingerprint add <sha256>
# serve the generated assetlinks.json at https://<host>/.well-known/assetlinks.json
```

### Things that are permanent

* **`packageId`** — how the store recognises an update. Change it and you have published a
  second, unrelated app.
* **The signing key** — the listing is bound to it forever. Lose it and this listing can never
  be updated again; leak it and someone else can publish updates as you. It is gitignored, and
  it belongs in a password manager or a KMS, not in the repo.
* **`horizonOSAppMode: immersive`** — immersive and 2D are different product types on the store.

### Startup budget

An immersive PWA launches straight into the WebXR session, so everything fetched before the
session is up counts against Meta's startup-time requirement (`Quest.Performance.3`). Two
decisions follow from that and should not be casually undone:

* `sw.js` precaches the app shell but **never** `/models/`.
* Art packs load lazily after the session starts. The game renders procedurally without them,
  so nothing blocks on art.

### In-app purchases

Horizon Billing is enabled during `bubblewrap init` and needs a Meta Horizon Application ID.
Receipts are verified **server-side** (`packages/server/src/purchases.ts`) — the client never
decides what it owns.

---

## Steam

See `packaging/steam/README.md`. The short version: Electron is compiled with `enable_vr=false`
(`checkout_webxr` is disabled in its DEPS), so the Electron window cannot host a WebXR session.
The desktop shell therefore serves flat play, and VR launches a Chromium-class browser in app
mode against the local server, where SteamVR's OpenXR runtime drives WebXR.

---

## Google Play / App Store

Not set up. Mobile is flat-only in any case — WebXR is unavailable in Safari, so iOS ships
Mobile only. A Capacitor shell around the same `dist/client` is the intended route.
