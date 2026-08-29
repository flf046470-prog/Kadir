# Kangaroo Chase — TODO

Status of every phase in `ROADMAP.md`. A phase is only ticked when it is implemented **and**
covered by a passing check (`npm run verify` = lint + typecheck + 107 tests + both builds).

## Milestone A — Playable MVP

- [x] **1 · Architecture & core** — monorepo, deterministic math/PRNG, custom capsule solver
      (collide-and-slide, ground probe, step-up, one-way platforms), `InputIntent` boundary
- [x] **2 · Locomotion on three platforms** — PC (KB/M + gamepad), Mobile (floating stick,
      swipe look, button cluster), VR (WebXR head + two hands); one movement system
- [x] **3 · VR hand physics, climbing, jumping** — anchor-and-pull locomotion with preserved
      momentum, palm push, two-handed multiplier, assisted climb for flat platforms
- [x] **4 · Jungle map** — deterministic seed build: Jungle, Cave, Canyon + tree village,
      grips, spawns, parkour checkpoint route
- [x] **5 · Multiplayer** — authoritative rooms, binary intents, delta snapshots, interest
      management, prediction + rewind/replay reconciliation, interpolation
- [x] **6 · Kangaroo Chase** — chaser handover on tag, continuous runner scoring, winner
- [x] **7 · Infection** — permanent infection, last-survivor bonus
- [x] **8 · VR Boxing** — velocity-based punches (relative to body), stamina, knockback,
      head/body hit split, KO + respawn; button-driven on PC/Mobile
- [x] **9 · Parkour Race** — ordered checkpoints, lap timing, personal + world best
- [x] **10 · Lobby** — menu, mode select, practice-with-bots, results screen
- [x] **11 · Animals** — 6 launch animals, 9 more as ready data, ±3 % feel clamp enforced
- [x] **12 · Cosmetics** — 9 slots, 20 launch items, socket-based rendering, equip validation
- [x] **13 · Store** — fixed price points, catalog validator, server-verified purchases
- [x] **14 · Economy** — coins/XP from server-computed match results, coin purchases
- [x] **15 · Daily rewards** — 7-day cycle on the server clock, streaks
- [x] **16 · Achievements** — 11 achievements incl. lower-is-better speedrun goal
- [x] **17 · Private rooms** — KANG-XXXX codes, create/join, invite by code
- [x] **18 · Voice chat** — WebRTC mesh, spatial panners, server relays signalling only,
      mute/block honoured on both chat and voice
- [x] **19 · Events & seasons** — season track (free + optional premium), event windows
- [x] **20 · Optimisation** — instanced level + props, quality tiers, adaptive frame governor,
      LOD-style avatar detail budget, snapshot deltas, rest-state velocity snapping
- [x] **21 · QA** — 107 automated tests; browser smoke test on desktop and mobile viewports
- [~] **22 · Release preparation** — builds, PWA manifest, CI; store shells still to do

## Known gaps (honest list)

- **VR is untested on hardware.** All WebXR code paths typecheck and the body-local hand
  transform is unit tested, but no headset exists in CI. First hardware session should check:
  session entry, hand tracking fallback, snap-turn comfort, 72 fps hold.
- **iOS**: WebXR is unavailable in Safari, so iOS ships Mobile only.
- **Store shells**: Meta Quest (Bubblewrap PWA) and Steam (Electron shell) are set up — see
  `docs/STORES.md`. Capacitor (Play/App Store) is not. Receipt verification is real for Meta,
  Steam and Google Play; the Play verifier still needs a service-account token provider wired
  to a deployment.
- **Voice chat** is a mesh — fine to ~16 players, needs an SFU beyond that.
- **Analytics** has an abstraction and a buffered implementation, but no backend sink.
- **Moderation** has the model, rate limiting and report log, but no review tooling.
- **Level art** is procedural; see `docs/ASSETS.md` for the optional art-pack pipeline.
- **Leaderboards** are per-server-instance files; a shared datastore is needed for a real
  global board.

## Next up (in order)

1. Hardware VR pass: comfort defaults, haptics, hand-tracking (no controllers) support.
2. Capacitor shell + Quest APK, then real receipt verification.
3. Server: move profiles and leaderboards to a managed database; region sharding.
4. Content: Waterfall / Tree Village / Ruins sections; the nine roadmap animals.
5. Ranked mode and tournaments on top of the existing mode registry.
