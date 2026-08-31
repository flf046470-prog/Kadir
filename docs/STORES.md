# Shipping to stores

What each store actually needs, and which constraints are forced by the technology rather than
chosen. The game is one web build; the store packages wrap it differently.

| Store | Package | VR | Status |
| --- | --- | --- | --- |
| Meta Horizon Store | Immersive WebXR PWA via Bubblewrap (TWA → APK/AAB) | Native WebXR | Buildable here; needs a signing key and a developer account |
| Steam | Desktop shell + bundled-browser VR launch | SteamVR via OpenXR | Buildable here; needs a Steamworks appid |
| Google Play | Landscape TWA via Bubblewrap (APK/AAB) | — (phone is flat) | Buildable here; needs a signing key and a developer account |
| Apple App Store | — | — | Not set up |

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

export JAVA_HOME=/path/to/jdk-17
export ANDROID_HOME=/path/to/android-sdk        # build-tools 36.1.0, platform 36
export KC_KEYSTORE_PASSWORD=…                   # generates the key on first run

npm run build:quest -- --domain play.example.net
adb install -r packaging/meta-quest/app-release-signed.apk   # sideload to test
```

`build:quest` runs `pack:quest` first, so the manifest and icon checks still gate the build. It
then writes `packaging/meta-quest/assetlinks.json` with the signing certificate's SHA-256 already
filled in — serve that at `https://<host>/.well-known/assetlinks.json`. Without it the app
launches with a browser URL bar, which the store rejects for an immersive title.

Three details in that script are not obvious, and each one cost a failed build:

* **Bubblewrap fetches the icons and web manifest over HTTP at generation time** and bakes them
  into the APK. Pointed at the real host you cannot build before the site is live, and then you
  ship whatever that host was serving. `build:quest` serves `dist/client` on loopback instead, so
  the APK carries the build you just made. `host` still names the real origin — that is what the
  intent filter and the asset-links check use.
* **`bubblewrap update --skipVersionUpgrade` writes an empty `versionName`** into `build.gradle`.
  The build succeeds and the store rejects the upload. The script passes `--appVersionName`.
* **Bubblewrap's SDK check predates the current SDK layout.** It looks for `<sdk>/tools` or
  `<sdk>/bin`; a modern install only has `<sdk>/cmdline-tools/latest/bin`, and the error it
  produces is the unhelpful "the provided androidSdk isn't correct". Symlink it:

  ```bash
  ln -s "$ANDROID_HOME/cmdline-tools/latest/bin" "$ANDROID_HOME/bin"
  ln -s "$ANDROID_HOME/cmdline-tools/latest/lib" "$ANDROID_HOME/lib"
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

## Receipt verification

Every store verifies server-side. The client sends a receipt; the server asks the store that
took the money whether it is real, and only then grants anything. Receipts carry the platform
that issued them as a prefix — `meta:<userId>`, `steam:<orderId>`, `play:<purchaseToken>` — and
are routed to the matching verifier in `packages/server/src/receipts.ts`.

Three properties are enforced there and covered by tests:

* The SKU checked against the store is **the item the server is about to grant**, never
  anything the client named. Otherwise a receipt for a cheap item could be replayed against a
  $4.99 one.
* A **store with no credentials configured is absent from the routing table**, so its receipts
  are refused rather than accepted unverified. Boot logs which platforms are live.
* A Meta consumable is **consumed before the grant**. A failed consume means the purchase was
  not spent, so granting anyway would let the same receipt be redeemed again.

Configure with environment variables. None of these may ever reach the client bundle:

| Variable | Store |
| --- | --- |
| `KC_META_APP_ID`, `KC_META_APP_SECRET` | Meta Horizon (`graph.oculus.com` verify/consume) |
| `KC_STEAM_APP_ID`, `KC_STEAM_WEB_API_KEY` | Steam (`ISteamMicroTxn/QueryTxn`) |
| `KC_PLAY_PACKAGE_NAME` | Google Play (androidpublisher; also needs a service-account token provider) |

`dev:` receipts are accepted only when `NODE_ENV !== 'production'`. In production the dev
verifier is not registered at all, so a `dev:` receipt is refused like any unknown platform.

---

## Storage

Two drivers, chosen by `KC_DATABASE_URL`:

| Unset | Files under `KC_DATA_DIR`. Correct for **one writer only** — local dev and the Steam build's embedded server. |
| Set | Postgres, shared across instances. Tables are created on boot. |

This is not a size question. A profile save and a leaderboard submit are both read-modify-write
against shared state when done over a file, so two instances serving the same player each hold
their own copy and overwrite the other's — silently losing purchases and race times. The SQL
drivers do each as a single upsert (`ON CONFLICT ... DO UPDATE`), with the leaderboard's guard
`WHERE EXCLUDED.ticks < parkour_times.ticks` making "keep the better time" the database's
decision rather than a race between servers.

`pg` is an optional dependency of the *deployment*, not of this package, so the default build
runs with no database driver present. If `KC_DATABASE_URL` is set and `pg` is missing the server
refuses to start rather than falling back — a silent fallback would look like it worked and then
lose data the moment a second instance came up. The error never echoes the connection URL,
which carries the password.

```bash
npm install pg
KC_DATABASE_URL=postgres://user:pass@host:5432/kangaroo npm start
```

---

## Google Play

The same web build as the Quest package, wrapped for a phone instead of a headset. There is no
second codebase and no second deployment: both TWAs point at the same origin, and the touch
layout is the one the client already switches to when it sees a touchscreen.

```bash
npm run build
npm run pack:phone -- --domain kangaroochase.example    # render + validate the config
npm run build:phone -- --domain kangaroochase.example   # signed .aab + .apk
```

`build:phone` and `build:quest` are the same script (`scripts/build-android.mjs --target`), and
`pack:phone` and `pack:quest` share their manifest checks through `scripts/lib/twa.mjs`. That is
deliberate: the two packages differ in four lines of Bubblewrap config and in nothing that is
hard to get right, so a second copy would only drift — and the way it would drift is that a fix
made after a store rejection lands in one of them.

### What differs from the Quest package

| | Quest | Phone |
| --- | --- | --- |
| `isMetaQuest` | `true` | `false` |
| `horizonOSAppMode` | `immersive` | absent — there is no session to launch into |
| Orientation | landscape | landscape |
| Controls | hands / controllers | on-screen stick + button clusters |
| Upload | `.aab` to the Horizon Store | `.aab` to Play |

Orientation is landscape on the phone because the touch layout puts a stick under the left thumb
and the action cluster under the right. Portrait would need a second layout, and a chase game
read through a letterbox is worse than no phone build.

### Digital Asset Links

Same as the Quest package, and the same consequence: without a verified
`.well-known/assetlinks.json` the app launches with a browser URL bar across the top. Play
tolerates that; reviewers usually do not. `build:phone` writes the exact `assetlinks.json` to
serve, with the certificate SHA-256 already filled in.

### The package id is permanent

Play binds the listing to the package id *and* the signing key, forever. The id derived from the
host is the same one the Quest build derives; that is fine today because Play and Horizon are
separate namespaces, but pass `--package-id` if you ever need them to differ.

## Apple App Store

Not set up. WebXR is unavailable in Safari, so iOS would be flat-only, and Apple does not accept
a TWA-equivalent — it needs a real native wrapper (Capacitor around the same `dist/client` is the
intended route). Nothing in the codebase blocks it; it is simply not built.
