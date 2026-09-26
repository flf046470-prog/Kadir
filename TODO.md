# Kangaroo Chase — TODO

Status of every phase in `ROADMAP.md`. A phase is only ticked when it is implemented **and**
covered by a passing check.

`npm run verify` = lint + asset/pack gates + typecheck + **1088 tests** + all three builds +
`check:hostile`. CI runs the same commands as separate steps, plus a `postgres` job against a real
database and a `browser` job (`check:smoke`, `check:pwa`) against a real Chromium.

Numbers here are counted from the repository, not remembered. Re-count before trusting them: this
file claimed 107 tests and 6 animals for a long time after both had moved.

## Milestone A — Playable MVP

- [x] **1 · Architecture & core** — monorepo, deterministic math/PRNG, custom capsule solver
      (collide-and-slide, ground probe, step-up, one-way platforms), `InputIntent` boundary
- [x] **2 · Locomotion on three platforms** — PC (KB/M + gamepad), Mobile (floating stick,
      swipe look, button cluster incl. crouch), VR (WebXR head + two hands); one movement system
- [x] **3 · VR hand physics, climbing, jumping** — anchor-and-pull locomotion with preserved
      momentum, palm push, two-handed multiplier, assisted climb for flat platforms
- [x] **4 · Maps** — **3 worlds**, each deterministic from a seed: `jungle-world` (jungle, cave,
      canyon, tree village), `glacier-world` (shelf, seracs, crevasse), `outback-station`
      (gum flat, gorge, cave, station). Grips, spawns, zones and parkour routes indexed
- [x] **5 · Multiplayer** — authoritative rooms, binary intents (**protocol 3**), delta
      snapshots, interest management, prediction + rewind/replay reconciliation, interpolation
      (players *and* gadget entities on one clock)
- [x] **6 · Kangaroo Chase** — chaser handover on tag, continuous runner scoring, winner
- [x] **7 · Infection** — permanent infection, last-survivor bonus
- [x] **8 · VR Boxing** — velocity-based punches (relative to body), stamina, knockback,
      head/body hit split, KO + respawn; button-driven on PC/Mobile
- [x] **9 · Parkour Race** — ordered checkpoints, lap timing, personal + world best
- [x] **10 · Lobby** — menu, mode select, portals, practice-with-bots, results screen
- [x] **11 · Animals** — **16 meshes on disk**, generated from `animals.json` by the Blender
      pipeline and tracked; every one a distinct shape, enforced by hashing POSITION+NORMAL out of
      the shipped `.glb`s; ±3 % feel clamp and a standing-height fairness bound enforced by test
- [x] **12 · Cosmetics** — 9 slots, 20 launch items, socket-based rendering, equip validation
- [x] **13 · Store** — everything free; catalog validator refuses any price at boot,
      server-verified purchase machinery retained and tested
- [x] **14 · Economy** — coins/XP from server-computed match results, coin purchases
- [x] **15 · Daily rewards** — 7-day cycle on the server clock, streaks
- [x] **16 · Achievements** — 11 achievements incl. lower-is-better speedrun goal
- [x] **17 · Private rooms** — KANG-XXXX codes, create/join, invite by code
- [x] **18 · Voice chat** — WebRTC mesh, spatial panners, `proximityGainAt` falloff applied per
      peer, server relays signalling only, mute/block honoured on both chat and voice
- [x] **19 · Events & seasons** — season track (both tiers free), event windows
- [x] **20 · Optimisation** — instanced level + props, quality tiers, adaptive frame governor
      with a headset floor, `sceneryDetail`, snapshot deltas, rest-state velocity snapping
- [x] **21 · QA** — 1088 automated tests; browser smoke test on desktop and mobile viewports;
      PWA check; hostile-client check against a real server over a real socket
- [x] **22 · Release preparation** — builds, PWA manifest + service worker, CI, licence-gated
      art pipeline, Meta Quest (Bubblewrap), Steam (Electron) and Microsoft Store packaging,
      Meta Horizon listing copy + art, real receipt verification, SQL storage drivers,
      Sentry crash reporting behind a lazy chunk, in-page crash surface. See `docs/STORES.md`
      and `docs/META_LISTING.md`.

## Beyond the MVP, already shipped

These were Milestone B items in `ROADMAP.md` and are done:

- **Modes: 9 registered** — `kangaroo-chase`, `infection`, `boxing`, `parkour`, `hunt`,
  `duel` (Conversion Duel), `freeze-tag`, `hill` (King of the Hill), `training` (Training Room),
  plus player-authored house rules on top of the registry.
- **Gadgets: 9** — freeze gun, smoke bomb, steel vest/helmet, bear trap, tripwire alarm, field
  kit, hunter rifle, hunter net; entities rendered, audible and felt.
- **Art: 16 animals + 47 props**, tracked, generated from tracked sources.
- **Procedural PBR, ACES tone mapping, IBL sky, post-processing, music, animated water.**

## Known gaps (honest list)

- **VR is untested on hardware, and this is the largest single risk.** Comfort vignette, haptics,
  hand tracking, bindings and the session entry path are implemented and unit tested against a
  stubbed `navigator.xr`, but no headset exists in CI and none ever will. A green suite is not
  "VR works". First hardware session should check: session entry, pinch-to-grab with controllers
  put down, vignette timing on a fast run, haptic strength, snap-turn comfort, 72 fps hold, and
  whether the arms-first locomotion is actually comfortable.
- **Publishing is blocked on things that are not build steps**: a Meta developer account, an IARC
  age rating, and a privacy-policy URL. `docs/META_LISTING.md` names them rather than inventing
  placeholders.
- **A real domain, then a permanent `packageId` and signing key — in that order, and all three
  are irreversible.** `pack:quest`/`pack:phone` derive `packageId` by reversing `--domain`, so the
  domain decides the app's permanent identity. The packaging is parameterised correctly; what is
  *not* settled is the input. The artefacts currently in `packaging/` say
  `com.example.kangaroo_chase`, left over from a build run with a placeholder domain — and
  `com.example.` is a reserved example namespace that both Meta and Google Play reject outright.
  The generated Railway host would produce a valid id but a bad permanent one, since it names a
  hosting provider's throwaway subdomain.
- **`/.well-known/assetlinks.json` 404s on the live deployment**, because `KC_ASSETLINKS` is
  unset there. That is currently the *correct* state, not a gap to close in a hurry: the only
  statements available are for the placeholder package above, signed by keystores that live in an
  ephemeral container and are gitignored, so publishing them would verify nothing and would have
  to be undone. Set `KC_ASSETLINKS` to the merged JSON array (the file-path form cannot work on a
  container host) once the real domain, package id and permanently-stored keystore exist. Until
  then a Quest TWA launches with a browser URL bar, which the Horizon Store rejects for an
  immersive title.
- **Trailer video.** Meta wants 30 s–2 min MP4/H.264/AAC. `capture:trailer` produces a 12 fps GIF
  from swiftshader frames — real footage, wrong container and frame rate. No encoder is installed
  here. Only the static trailer cover image is generated.
- **No first-person screenshots.** Meta prefers them; there is no headset. The five supplied are
  the third-person camera every non-VR platform actually uses — genuine gameplay, not a mockup.
- **iOS**: WebXR is unavailable in Safari, so iOS ships Mobile only.
- **Store shells**: Meta Quest, Steam and Microsoft Store are set up. **Capacitor (Play / App
  Store) is not.** Receipt verification is real for Meta, Steam and Google Play; the Play verifier
  still needs a service-account token provider wired to a deployment.
- **Steam needs no origin; Meta cannot not need one.** The Steam package bundles the client *and*
  the authoritative server and serves them over localhost — measured end to end with no internet:
  16 animals from `/api/content`, every `.glb` off local disk, two socket clients in one room at
  20.0 snapshots/s. The Meta package is a Bubblewrap TWA and `pack:quest` refuses to render
  without `--domain`, because a TWA *is* an app that loads a URL.
- **Electron cannot host WebXR.** `enable_vr=false` is compiled into the Electron binary, so the
  Steam window is flat-only and "Play in VR" hands off to Chrome/Edge against the same local
  server. A Steam *VR* listing has to say so.
- **Voice chat** is a mesh — fine to `KC_MAX_PLAYERS` (16), needs an SFU beyond that. Proximity
  falloff is applied client-side and is therefore **not enforceable**; saying otherwise would be
  a lie about a cheat. Enforcing it means putting the server in the audio path.
- **Analytics** has an abstraction and a buffered implementation, but no backend sink.
- **Moderation** has the model, rate limiting and a report log, but no review tooling.
- **Level geometry has no terrain primitive** — `LevelBuilder` offers box/cylinder/sphere/ramp
  only. Heightmap terrain is a new primitive, not a tuning job.
- **`LevelDef.grips`/`GripKind`** (`branch`/`ledge`/`vine`/`rock`/`root`) are authored into every
  map and read only by a test's level-stats count. All five climb identically, keyed on
  `SurfaceFlags.Climbable`; the promised per-grip feel and highlighting do not exist.
- **No i18n.** `Settings.locale` was removed rather than left as a control that configures
  nothing; it comes back with a translation system.

## Deployment

**Currently offline.** Railway's trial expired on 2026-09-22 at 00:04 UTC, the `game-server`
deployment was `REMOVED`, and the origin now 404s with `Application not found`. Bringing it back
needs a Railway plan selected by the account holder; nothing in this repository can do it. The
project and service still exist, so it is a billing state rather than a lost deployment.

Railway project `kangaroo-chase`, service `game-server`, built from this branch's `Dockerfile`.
One deployment serves both the client (`KC_PUBLIC_DIR` → `dist/client`) and the rooms.

**It does not redeploy on push, and nothing reports that.** The site stays up and serves old code.
Measured once at 13 commits behind while every one of them was green in CI. Force a build with
`connect-service-source` (not `redeploy`, which re-runs the previous build), and verify by asking
the live server for something only the new commit has — a `hello` at the current
`PROTOCOL_VERSION` is the cheapest probe.

## Next up (in order)

1. Hardware VR pass: comfort defaults, haptics, hand tracking without controllers.
2. Content: map, character and animation work — new sections, the nine roadmap animals,
   richer locomotion clips.
3. Capacitor shell for Play / App Store.
4. Server: region sharding.
5. Ranked mode and tournaments on top of the existing mode registry.
