# Steam build

An Electron shell around the same web build the browser and Quest versions use. It runs a copy
of the game server on localhost and opens the game from it. Online play is on the hosted server
the build was packed with (`--online`), where Steam, Epic and browser players meet; the bundled
server takes over, with an offline menu that says why, when that cannot be reached.

## Where it plays, and why the port never changes

The bundled server writes the hosted origin into the page it serves
(`<meta name="kc-online-origin">`), and the page asks that server's `/api/health` before choosing
it — a server on another protocol would refuse this build at `hello`, after the menu had promised
online play. The hosted server lets the page in although it comes from `127.0.0.1`: a loopback
origin is always allowed (`packages/server/src/origins.ts`).

The game is served from the **same port every launch**: the last one used, else 21787–21796. A
page's storage belongs to its origin, and the port is part of the origin. The launcher used to ask
the OS for a new port each time, so every launch asked for a name again and made a new account,
and the old one — with everything earned on it — was unreachable. The session secret is kept in
the user's data folder for the same reason, only one copy of the app runs at a time, and the
server exits when the launcher does, so an orphan never holds the port. `npm run check:shell` runs
`main.cjs` twice under a stand-in for Electron to prove all of it.

## Why VR launches a second browser

**Electron cannot host a WebXR session.** Electron's `DEPS` disables `checkout_webxr`, which
leaves its Chromium compiled with `enable_vr=false`, so `navigator.xr` never reports an
immersive device. This is a property of the Electron binary, not a flag — there is nothing to
pass at runtime to turn it on.

Desktop Chrome and Edge *do* ship WebXR, and on Windows they drive it through the system OpenXR
runtime, which is exactly what SteamVR installs. So "Play in VR" spawns Chrome or Edge in
`--app` mode against the same `http://127.0.0.1:<port>` the Electron window is showing. This is
the approach shipping WebXR titles on Steam already use (Metachromium being the visible
example).

Two details in that launch are load-bearing:

* `--app=` removes browser chrome. The player is about to put a headset on and cannot use a URL
  bar.
* `--user-data-dir=` gives the launch its own profile. Without it Chrome silently attaches to an
  already-running instance and ignores every flag, which presents as "VR just doesn't start"
  with nothing in any log.

The decision logic — where an OpenXR runtime registers itself, which browsers qualify, what to
pass them — lives in `packages/shell` and is unit tested (`openxr.test.ts`), because it is the
part that has to be right on machines we cannot test on.

## Build

```bash
npm run build          # client + server + shell
npm run pack:steam -- --online https://<hosted origin>   # assembles dist/steam-app/
npx electron dist/steam-app     # run it locally
```

To produce the distributable and the Steamworks scripts:

```bash
npm run pack:steam -- --appid <appid> --depotid <depotid>
npx @electron/packager dist/steam-app KangarooChase \
  --platform=win32,linux --arch=x64 --electron-version=44.0.0 --out=dist/steam
npm run pack:release   # zips dist/steam/* into dist/release
steamcmd +login <builduser> +run_app_build <abs>/dist/steam-app/steamworks/app_build.vdf +quit
```

The app name has to stay `KangarooChase` with no space. It becomes the executable name, and
`pack-release.mjs` collects `dist/steam/KangarooChase-<platform>-<arch>`; renaming it means the
release step quietly finds nothing. Steam ships a directory rather than an installer, so the zip
in `dist/release` is for moving the build around — point the depot at the unzipped folder.

`--appid` / `--depotid` come from the Steamworks app admin page. They are templated rather than
committed because they are per-app.

## Store page setup

* **SteamVR support**: declare the app as VR-supported with SteamVR listed, but *not*
  "VR Only" — the flat mode is a full experience and VR needs a browser present.
* **Launch options**: one entry, no arguments. The shell picks flat or VR at runtime.
* The game writes saves to the per-user app-data directory, never next to the binary: Steam
  library folders are frequently read-only, and on Windows they often sit under Program Files.

## What is not done here

* **Code signing.** Unsigned Windows builds trip SmartScreen. A certificate is required before
  a public release.
* **Steamworks SDK integration.** No achievements, no Steam Cloud, no Steam friends/rich
  presence. The game's own account system and leaderboards are used instead. Adding
  `steamworks.js` later is a shell-only change; nothing in the game code needs to know.
* **Steam in-app purchases.** The receipt verifier supports `ISteamMicroTxn` server-side, but
  the client flow that opens the Steam overlay checkout is not wired up.
