# Kangaroo Chase — Architecture

> Physical-movement social tag game. One gameplay codebase, three platforms: **Mobile**, **PC**, **VR**.

## 0. Guiding constraints

1. **One simulation, three shells.** Gameplay rules exist exactly once, in `@kc/core`, and are
   platform-, renderer- and network-agnostic. Platforms only supply *intent* in and *state* out.
2. **The server is the referee.** Every scoring, economy or unlock decision is taken by code that
   also runs on the server. The client may predict, never decide.
3. **Determinism first.** The core simulation is a pure fixed-step function
   `(state, intents) -> state`. That single property buys us: server authority, client-side
   prediction, replay, and cheap unit tests without a renderer.
4. **Performance is a design input, not a pass at the end.** Fixed 60 Hz sim, 20 Hz network,
   allocation-free hot paths, quality tiers chosen from device capability at boot.
5. **Data-driven content.** Animals, cosmetics, store, seasons, achievements and levels are data.
   Adding a tiger must never require touching gameplay code.

## 1. Technology

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript (strict) | One language across sim, client and server; the shared-sim requirement is otherwise very expensive. |
| Rendering | three.js (WebGL2, WebGPU-ready) | Mature, small runtime, runs on low-end Android, Quest and desktop from the same scene graph. |
| VR | **WebXR** | WebXR sits directly on the platform's **OpenXR** runtime (Quest, SteamVR, PICO). Gives head + both hands (controllers *and* hand-tracking) with no per-headset SDK. |
| Physics | Custom deterministic kinematic solver (`@kc/core/physics`) | A tag/parkour game lives or dies on character feel; a general rigid-body engine is both heavier and non-deterministic across platforms. Ours is ~1k lines, allocation-free, and identical on server and client. |
| Transport | WebSocket (binary frames) | Works on all three targets including browsers/Quest with no plugin. Protocol is transport-agnostic, so WebRTC DataChannel can be swapped in later. |
| Voice | WebRTC mesh + spatialised gain | P2P audio, server only relays signalling. Spatialisation happens client-side from sim positions. |
| Build | Vite | Same tool builds client bundle and server bundle; workspace TS resolves without a compile step in dev. |
| Test | Vitest | Fast, runs the core sim headlessly. |
| Store shipping | PWA today; Capacitor shell for Play Store / App Store, and APK for Quest store | No gameplay code changes: the shell only provides the surface. |

## 2. Package layout

```
packages/
  core/     @kc/core    deterministic gameplay. NO DOM, NO three.js, NO network.
  net/      @kc/net     wire protocol, snapshot/delta codec, interpolation buffer.
  server/   @kc/server  authoritative rooms, matchmaking, persistence, validation.
  client/   @kc/client  renderer + platform layers (PC / Mobile / VR) + UI + audio.
```

`tsconfig.sim.json` typechecks core+net+server **without the DOM lib**, so a stray `window`
reference in shared code is a compile error, not a runtime crash on the server.

### 2.1 `@kc/core`

```
math/        Vec3, Quat, scalar helpers, seeded PRNG (deterministic).
util/        typed event emitter, object pool, id/room-code generation, ring buffer.
physics/     collider primitives, uniform-grid broadphase, capsule collide-and-slide,
             raycast, surface queries.
world/       level format (pure data), jungle level author, grip/checkpoint indexing.
player/      PlayerState, MovementConfig, kangaroo locomotion, climbing, VR hand physics,
             tag/combat resolution.
input/       InputIntent — the *only* thing a platform is allowed to inject.
sim/         Simulation (fixed step), snapshot production, game event queue.
modes/       GameMode interface + registry + chase / infection / boxing / parkour.
content/     animals, cosmetics, store catalog, seasons, achievements, daily rewards (data).
progression/ economy, inventory, profile, achievement engine.
save/        versioned save schema + migrations + storage interface.
settings/    graphics / audio / comfort / control settings model.
analytics/   event abstraction (no PII).
moderation/  mute, block, report, kick/ban model.
```

### 2.2 Platform abstraction (`@kc/client`)

```
platform/
  Platform.ts            interface: input, ui, performance, capabilities
  detect.ts              capability probe -> platform + quality tier
  pc/    PCInput   PCUI   PCPerformance
  mobile/MobileInput MobileUI MobilePerformance
  vr/    VRInput   VRUI   VRPerformance
```

Everything above `Platform` is shared. A platform module may only:
* produce an `InputIntent` per frame,
* present UI (`UIHost` interface: screens are described declaratively, rendered as DOM on
  PC/Mobile and as world-space panels in VR),
* apply a performance profile (pixel ratio, shadow, draw distance, LOD bias, physics substeps).

### 2.3 The intent boundary

```ts
interface InputIntent {
  moveX, moveZ            // -1..1  analogue stick / WASD / VR body lean
  lookYaw, lookPitch      // radians, absolute for VR, accumulated for PC/Mobile
  jump, jumpHeld, sprint, crouch
  grabLeft, grabRight     // hold-to-grip, all platforms
  interact, emote
  hands?: HandIntent[2]   // VR only: pose + velocity per hand, in body-local space
}
```
VR hand physics is *additive*: `hands` is optional, so PC/Mobile players run the exact same
simulation minus hand forces. This is why the game is genuinely cross-play instead of three games.

## 3. Simulation model

* Fixed timestep **1/60 s**. `Simulation.step(dt)` consumes one `InputIntent` per player per tick.
* Ticks are integers; every snapshot carries its tick, so client and server always agree on *when*.
* **Client prediction**: local player is simulated immediately; inputs are kept in a ring buffer.
  On snapshot arrival the client rewinds to the server tick and replays unacknowledged inputs.
  Position error under a threshold is smoothed rather than snapped (no rubber-banding on hops).
* **Remote players** are interpolated 100 ms in the past from two snapshots — never extrapolated
  more than 250 ms, after which they are frozen (prevents ghost-tags).
* **Tag resolution is server-only.** The client shows a hit-flash on prediction, the server
  decides, and the mode applies the state change. A rejected tag simply never appears.

## 4. Movement design (the core of the game)

Three locomotion sources sum into one velocity, then one collide-and-slide pass:

1. **Kangaroo locomotion** (all platforms) — grounded hop with charge, air control, wall bounce,
   tail-balance recovery, crouch-jump. Tuned per animal via `MovementConfig` *within a clamped
   band* so cosmetic animals cannot be pay-to-win (see §7).
2. **Hand physics** (VR) — each hand is a spring-driven proxy. When a hand is inside a surface's
   grab volume and the grip is held, the hand anchors in world space; the *body* is then pulled
   toward the anchor, and hand velocity relative to the anchor is converted into body impulse.
   Pushing off a wall, hauling yourself up a branch and swinging all fall out of one rule:
   `bodyImpulse = -handDelta * pushForce * (twoHanded ? 2 : 1)`, clamped by `maxSpeed`.
3. **Climbing** (all platforms) — grips are level data. PC/Mobile players auto-anchor to the
   nearest grip in reach while the grab button is held and gain a climb-up impulse; VR players do
   it with their hands. Both paths end in the same `ClimbState`, so networking and animation are
   shared.

Momentum is conserved across states: releasing a grip preserves hand-derived velocity, which is
what makes the swing-and-launch trick work on every platform.

## 5. Networking

```
client                          server
  intent(tick, bits) ─────────▶  validate → sim.step()
                      ◀────────  snapshot(tick, baseline, delta)
                      ◀────────  events (tag, round, chat, voice signalling)
```

* Intents are ~10 bytes: axes quantised to int8, buttons packed into a bitfield, hand poses to
  int16 per component. 60 Hz of input = ~600 B/s up.
* Snapshots are **delta-encoded against the last snapshot the client acknowledged**, 20 Hz,
  with a per-entity dirty mask. A 16-player room costs ~6–10 KB/s down at full activity.
* Interest management: entities beyond `cullDistance` are sent at reduced rate (5 Hz) and hands
  are dropped entirely — the biggest bandwidth win in a VR game.

## 6. Authority & security

| Decision | Owner |
| --- | --- |
| Position | Client predicts, server simulates and corrects (hard clamp on impossible speed). |
| Tag / punch hit | Server, from server-side positions only. |
| Round state, scores, winner | Server. |
| Currency, purchases, unlocks | Server; the client's copy is a display cache. |
| Achievements, dailies, season progress | Server, from server-observed match results. |
| Cosmetic equip | Client-requested, server-validated against inventory. |

Match results are never uploaded by the client. `MatchResult` is produced by the room and passed
straight to the progression service inside the server process.

## 7. Content & fairness

`AnimalDef` carries **cosmetic** fields (model, palette, sounds, emotes, effects) and a
`feelProfile` of *bounded* modifiers — a `±3 %` clamp applied at load time by
`clampFeelProfile()`, verified by a unit test. Premium animals differ in look, sound and animation;
they cannot buy speed, jump height, health or damage. Store is fixed-price, no loot boxes, no
gacha, no randomised rewards.

## 8. Performance budget

| | Mobile (low) | Mobile (high) / PC (low) | PC (high) | VR |
| --- | --- | --- | --- | --- |
| Target | 30–60 fps | 60 fps | 120+ fps | 72–90 fps, no reprojection |
| Draw calls | < 120 | < 250 | < 800 | < 200 |
| Shadow | off | single cascade | 3 cascades | single cascade, static bake |
| Players rendered | 8 near + billboards | 16 | 16 | 12 near |
| Physics substeps | 1 | 1 | 2 | 2 |

Mechanisms: instanced foliage, LOD groups, distance culling, object pooling for all transient
entities, no per-frame allocation in the sim, hands/head culled by distance, and a
frame-time governor that drops a tier automatically after 3 s below target.

## 9. Extension points

Adding content must be additive only:

* **Animal** → append to `content/animals.data.ts` (or ship JSON from CDN). No code change.
* **Cosmetic** → append to `content/cosmetics.data.ts` with a slot from the existing slot enum.
* **Game mode** → implement `GameMode` and `registerMode()`. Rooms, HUD, results and networking
  are mode-agnostic.
* **Map** → author a `LevelDef` (colliders, grips, spawns, checkpoints, zones). The level format
  is plain data, so a future community editor can emit it.
* **Season / event** → data entries with date ranges; the engine activates them by clock.
