# Kangaroo Chase — working memory

Read `ARCHITECTURE.md` for the design and `TODO.md`/`ROADMAP.md` for status. This file is the
short list of things that are **expensive to rediscover**: standing rules, API shapes that are not
what you would guess, and defects that were found by measuring rather than by reading.

## Standing rules

- **Do not ask what to do next; make the technical call and justify it with a measurement.**
- **No placeholders.** A system that does not work is not finished, and a control that is
  advertised to the player and read by nothing is a bug, not a stub.
- **Run `npm run verify` before every commit** (lint + asset/pack checks + typecheck + tests +
  all three builds). It must exit 0.
- **Platform split is absolute.** Gameplay lives once in `@kc/core`. A platform supplies intent in
  and reads state out; a gameplay rule must never be written three times.
- **VR is OpenXR-compatible (WebXR) and hand/physics-driven.** The stick is an accessibility
  fallback, deliberately slower, never the primary locomotion.
- **Fairness is a hard constraint.** No loot boxes, no gacha, no pay-to-win; every in-game item is
  free. Premium content may differ *cosmetically only* — never speed, jump, health or attack. The
  server validates purchases, currency, wins, level, unlocks and round results. Never trust the
  client.
- **Git: develop and push only to `claude/kangaroo-chase-game-w62laa`.** Never push elsewhere
  without explicit permission.
- **Asset licences.** The game is web-delivered, so every served file is extractable. Only
  CC0/CC-BY/permissive packs clear `assets/packs.json`; the fetch script refuses Unity Asset
  Store, Synty and Fab-Standard by host.
- **Secrets.** Nothing in this game needs an API key — there is no LLM anywhere in it, and a key
  in a web build belongs to everyone who loads the page. Keys pasted into chat must be revoked by
  the user, never written to a file.
- **Update this file at the end of every task.**

## API shapes that are not what you would guess

- `Simulation`: the intent API is **`sim.setIntent(id, intent)`** — there is no `applyIntent`.
- `Bot`: **`new Bot(playerId: string, options: { skill: number; seed: number })`**. Passing a
  number where `BotOptions` belongs makes `1 - options.skill` NaN and the bot walks in a straight
  line forever — which silently invalidated a whole round of parkour measurements once.
- `@kc/core` has `main: ./src/index.ts` (TS source, no dist), so headless probes run through
  `node_modules/.bin/tsx`.
- `LevelDef` is **pure data built from a seed**. A level must not import gameplay modules; that is
  what lets the server, every client and a future map editor agree without downloading anything.
- `level.playRadius` is **only a bot-steering hint**. Nothing in physics or the simulation reads
  it, so it contains nobody — build real geometry if you want a boundary.
- Falling below `killPlaneY` sets `player.alive = false` and the sim respawns. This is normal.
- `LevelBuilder.ramp()` **cannot descend**: it centres steps at `y/2` with half-height
  `max(0.3, y/2)`, so a downward ramp ends up buried inside the floor. Hand-step it instead.
- The renderer colours geometry **by `SurfaceMaterial`**, not by preset name — a new look needs a
  new material (this is why `redEarth`/`redRock` exist alongside `rock`).
- `hand.punchCooldown` is set by `combat.ts` when a punch *resolves*, never by `locomotion.ts`. A
  locomotion-only test harness therefore never produces one, and punch pacing cannot be observed
  there without setting it by hand.
- WebAudio: `track.enabled = false` silences an analyser reading that track (**measured 0.000**);
  a `GainNode` at 0 does **not** (**measured 0.76**). Gate the mic with a gain node, or open mic
  deadlocks.

## Controls

Every bit in `Buttons` must be **produced** somewhere (a platform, or the AI) and **read**
somewhere else. `packages/core/src/input/intent.test.ts` scans the source and enforces this.

- `sanitizeIntent` masks with `BUTTON_MASK`, **derived from the `Buttons` table**. Do not replace
  it with a literal: the old hand-written `0x1fff` had to be widened by hand, and forgetting would
  silently strip a new button from every intent that crossed the wire.
- **Bit 5 is free.** It was `Interact` — sent by PC (`KeyE`), gamepad button 2 and a `USE` button
  in the phone's thumb cluster, and read by nothing. Measured: held for 900 ticks across four
  modes it moved no position, health, stamina or gadget charge and emitted no event. Removed; left
  as a hole so recorded intents still decode.
- `PunchLeft` is sent by **no platform** — PC and mobile have one punch button and it says right.
  The bot's coin flip is the only producer. `locomotion.ts` therefore lets a held punch button
  fall back to the free fist **once the named one has finished its throw** (not merely while it is
  unavailable — that measured as both arms out one tick apart, a windmill). Measured toe to toe:
  one hand landed 13 punches in 8 s, two landed 20; after the fix all three input styles land 102
  over 40 s.
- Gamepad: **one pad button, one action.** Gadget fire sat on button 5 beside the right-hand grab,
  so every ledge grab also fired the gadget — measured as one `gadgetUse` and a freeze-gun charge
  (a quarter of the round's ammunition) per grab. It is on button 2 now, and a test sweeps all 17
  indices.

## Settings

Every field in `Settings` must be read by something other than `settings/index.ts`.
`packages/core/src/settings/coverage.test.ts` scans for ones that are not.

Five shipped declared, defaulted, merged from storage and clamped — every ceremony a working
setting performs — and read by **nothing**: `spatialVoice`, `holdToGrab`, `hapticStrength`,
`colorblindSafe` and `locale`. Two of them were the accessibility controls. They are implemented
now, except `locale`, which was removed because there is no i18n system for it to configure; it
comes back with one.

- `spatialVoice` switches the panning model (HRTF ↔ equalpower), **not** whether distance
  attenuates. Bypassing the panner would be a cheat — see the voice note below.
- `colorblindSafe` swaps the role-ring palette for blue/orange/white. The ring also encodes role in
  **size** now, always and for everyone — chaser 1.5×, fighter 1.25×, runner 1× — because hue alone
  put the chaser's red and the fighter's yellow on the axis protanopia compresses, and those are
  the two most urgent states in the game.
- `holdToGrab` uses `platform/latch.ts`, shared by PC and mobile so the rule is not written twice.
  VR has no use for it: a hand grabs because it is closed, and there is no button to hold.

## Music

There was none. The `music` bus carried only the per-zone ambience beds — filtered noise, which is
what a *room* sounds like — so the Music slider controlled silence.

`audio/score.ts` composes bars as data: arithmetic over a seed, no `AudioContext`, unit tested for
the things a listener notices and a type checker cannot (an empty bar, a note overrunning its bar,
an off-key pitch, a chase sparser than the menu). `audio/Music.ts` only turns notes into
oscillators, scheduled ahead on WebAudio's own clock rather than per frame — a Quest holding 72 Hz
with a full room will stall the render thread, and music driven off `requestAnimationFrame` stutters
exactly when the scene gets busy.

Mood comes from the **local player's role**, not the mode id: the question a soundtrack answers is
"is something after me", and modes disagree about which role that is (prey is `runner` in Kangaroo
Chase and `survivor` in the Hunt). A per-mode table would need extending for every new mode and
would be wrong until somebody noticed.

Measured in a real browser: 13 notes over 8 s, 8 distinct pitches, 98–587 Hz, all three voices.

## Voice

`proximityGainAt(distance)` in `social.ts` is the game's falloff rule — full volume to
`VOICE_NEAR` (6 m), silence past `VOICE_FAR` (22 m), linear between — and `VoiceChat` applies it as
a gain node per peer. It used to exist only as `proximityGain(a, b)`, exported, documented, unit
tested and **called by nobody**, because the client has positions rather than `PlayerState`s. So
the documented rule was not the rule that ran: the only falloff was the `PannerNode`'s inverse
curve at `refDistance 4` / `maxDistance 45`, and two players forty metres apart could talk.

**This is not enforceable and must not be described as if it were.** Voice is a WebRTC mesh: every
peer already receives every stream, so a modified client can simply not turn its own gain down, and
`spatialVoice` must never be implemented as a panner bypass for the same reason. Enforcing
proximity means putting the server in the audio path — the SFU already listed as a known gap.

The unit suite covers the curve, not the wiring: deleting the one line in `updatePositions` that
applies it passes every test, because `VoiceChat` needs WebAudio. `npm run check:voice` exercises
the real path.

## VR

There is no headset in CI and there never will be, so the VR entry path is exercised by
`platform/vr/session.test.ts` against a stubbed `navigator.xr`: capability probe, session request,
refusal, and exit. That covers the decisions. It does **not** cover three.js presenting to a real
`XRSession`, projection matrices, hand meshes, comfort or frame rate — a green suite is not "VR
works".

`VR_BINDINGS` in `VRInput.ts` is the single table for controller buttons: the sampling loop and the
tutorial's hint list are both derived from it. They used to be two lists and had already drifted —
the right thumbstick click was bound to Sprint and the hints never said so, which is the same
defect as a button that does nothing, in the other direction. Arms-first masks `Buttons.Jump` out
of the intent, so the hop is the one binding correctly absent from the hints there.

Two controls are real but have no button, so they live in the prose half of the list: **crouch is
ducking your head** (`locomotion.ts` crouches a tracked player below 1.15 m) and punching is
throwing a punch. Crouch had no entry at all — on maps about not being seen, the one way to break
a sightline was undiscoverable.

## The frame budget

**A headset must hold 72 Hz at every tier, and the number that says so has to reach the governor.**
`profileFor` set `targetFps = 72` for VR and overwrote it four lines later with the player's
setting (default 60) — and nothing read `PerformanceProfile.targetFps` at all, because the governor
computed its own budget from `TARGET_FPS[tier]`. So a Quest was judged against a flat-screen table
and had to fall to **44 fps** before it dropped a tier. `GovernorInput.floorFps` carries the
profile's target now and `budgetMs(tier, floorFps)` takes the larger of the two; the threshold is
**53 fps**. `DEMOTE_FACTOR` is still the shared 1.35, so a sustained 60 fps in a headset is still
tolerated — narrowing that is a decision for a real device, not an assumption.

`fpsFloor(kind)` is the one place that knows a headset's display rate. The player's `targetFps` is
floored by it rather than overriding it: in VR "target 60" is not a request for less work, it is a
request to stop noticing.

**Geometry, counted in a real browser** by patching `gl.drawElements`/`drawElementsInstanced`/
`drawArrays` in the page. `jungle-world`, six players, per **scene pass**:

| tier | draw calls | triangles |
| --- | --- | --- |
| low | 44 | 410k |
| medium | 90 | 1,131k |
| medium, shadows off | 46 | 633k |
| medium, `drawDistance` 70 | 90 | 1,131k |
| high | 105 | 1,302k |

A headset draws the **scene pass twice** (one per eye) and the **shadow map once** — doubling
everything overstates it. `suggestQuality` hands a Quest `medium` (cores ≥ 8), so a headset was
being asked for ≈136 calls / 1.76M triangles a frame against Meta's published Quest 2 budget of
750k–1M. The VR branch now drops shadows and clamps `foliageBudget` to `VR_FOLIAGE_BUDGET` (60, the
low tier's figure) below `high`: **measured 45 / 410k**, i.e. ≈90 / 820k in stereo, while keeping
medium's `renderScale` 0.9, its antialias and its ten detailed avatars — the two things you look at
in a headset are the pixels and the other players, not the ferns. Shadows stay on at `high` because
nothing *suggests* high for VR and the governor only climbs into it after seeing 103 fps of
headroom, which means a tethered headset.

**Turning shadows off used to turn the textures off with them.** `surfaceQualityFor` chose the
texture tier from `profile.shadows` and `profile.shadowMapSize` — "a device too weak for shadows is
too weak for a normal map", true of the tier table and false of any platform that drops shadows for
its own reasons. Dropping the VR shadow pass therefore returned `textures: false` and would have
handed a headset flat untextured colour: the entire procedural PBR pipeline, undone by a line about
shadow maps, from a profile that reads as reasonable. `PerformanceProfile.textureDetail`
(`none`/`basic`/`full`) states it instead, and `worldNeedsRebuild` compares that rather than
`shadowMapSize` — which is applied live and bakes nothing. **A field inferred from another field is
a defect waiting for the day the two stop meaning the same thing.**

**`drawDistance` culls nothing.** 120 → 70 changed the frame by zero draw calls and zero triangles.
Its only effect is `camera.far = max(200, drawDistance * 2.2)`, already past every map's geometry
at the lowest tier; `LevelRenderer` thins props by count (`foliageBudget`, applied **per prop
kind**, taking the first N in level order) and never by distance. It is a tier constant now with
no setting behind it.

The slider that used to drive it is **`Settings.sceneryDetail`**, which scales `foliageBudget` —
the thing that actually moves. Measured on `jungle-world` at medium, per scene pass:

| scenery | draw calls | triangles |
| --- | --- | --- |
| 1.0 | 90 | 1,131k |
| 0.5 | 90 | 886k |
| 0.25 | 90 | 585k |

Draw calls do not move, and that is correct: the props are instanced, so thinning them puts fewer
instances through the same call. The saving is vertex work, not batches. It **thins only**, and is
applied after the platform branches so a headset cannot be talked back over `VR_FOLIAGE_BUDGET` —
that clamp is a frame-time promise, not a preference. Distance culling was the other candidate and
was rejected: it would introduce pop-in to a game that has none, for a saving this already gets.

## Shipping to the Quest

The Meta package is a **Bubblewrap TWA**: an Android app that loads the site over HTTPS. So the
blocker for a Meta release is not the APK — that has built here — it is an origin. And the origin
cannot be Vercel: a room is a 60 Hz loop holding open WebSockets in memory (`docs/DEPLOY.md`), so
the server needs a container host, and it serves `dist/client` itself via `KC_PUBLIC_DIR`. One
deployment is both the client the TWA loads and the server it plays on.

**`/.well-known/assetlinks.json` returned the app shell.** `serveStatic`'s SPA fallback answered
*every* missing path with `index.html` — measured 200, `text/html`, 1241 bytes — and Android's
Trusted Web Activity verifier fetches that URL and parses it as JSON. Verification failed, so the
app launched with a browser URL bar across the top, which the Horizon Store rejects outright for an
immersive title. **The 200 is what hid it**: any check that asks "does the URL answer" passes, and
the first thing that disagrees is a headset on submission day.

- `KC_ASSETLINKS` is a **comma-separated** list, served merged. `build:quest` and `build:phone`
  each write a single-element array signed with their own key; one origin serving both apps needs
  both statements, and serving one file verifies one app and silently fails the other.
- Anything else under `/.well-known/` 404s. RFC 8615 paths are machine-readable; a missing one has
  to say it is missing.
- The SPA fallback now applies **only to extension-less paths**. It used to hand `GLTFLoader` an
  HTML document for a missing `.glb`, so a path typo surfaced as a parse error inside three.js.

`packageId` and the signing key are permanent, and `horizonOSAppMode: immersive` is a different
product type from 2D — see `docs/STORES.md`.

`KC_ASSETLINKS` takes **either** the JSON array itself **or** a comma-separated list of files. Both
forms are needed: `build:quest`/`build:phone` write a file each next to the keystore that signed
it, those files are gitignored and never enter the image, and a container host has nowhere to put
one. A path cannot start with `[`, so the two do not collide.

### The live deployment

Railway project `kangaroo-chase` (workspace `flf046470-prog's Projects`): a `Postgres` service and
`game-server`, built from this branch's `Dockerfile`, at
`https://game-server-production-d3a6.up.railway.app`. It is the client the TWA will load *and* the
server matches run on — one deployment, because `KC_PUBLIC_DIR` serves `dist/client`.

Two things cost a deploy each and will again:

- **Railway injects `PORT`** (it used 8080) and the generated domain targets whatever port you
  asked for. The Dockerfile's `ENV PORT=8787` loses, so the service came up healthy on 8080 while
  the domain routed to 8787 and every request 502'd — **the logs say "listening on :8080" and look
  completely fine**. `PORT` is pinned to 8787 as a service variable now.
- **This repo holds more than one project.** Branches like
  `claude/patagonia-underground-redesign` live here too, and a Railway service whose source has no
  branch pinned builds whichever branch was pushed last — three deploys built a Next.js site from
  another branch, and one of them became the live one. `describe-service` reports
  `source: {repo}` with **no branch field even when a branch is set**, so it cannot confirm the
  pin; check `list-deployments` and read `meta.branch` instead.
- **It does not redeploy on push.** Four consecutive pushes were never built; the live service sat
  on a commit from the previous day while every one of them was green in CI. Nothing reports this
  — the site is up, it just serves old code, so the only way to catch it is to check
  `list-deployments` for the commit hash that is actually running. `connect-service-source` with
  the repo and branch triggers a build and is the way to force one; `redeploy` is not, because it
  re-runs the last deployment's **existing build**. Verify a deploy landed by asking the live
  server for something only the new commit has, never by the deploy reporting success.

Verified against the live deployment, not inferred: `/api/health` 200 JSON; `/api/content` lists
all three levels, 9 modes, 7 animals, 9 gadgets; `/.well-known/assetlinks.json` and a missing
`.glb` 404 as `text/plain` while `/play/<level>` still gets the shell; and a real socket client
joined, was put in a room and received **286 snapshots in 15 s (~19/s against the configured
20 Hz)**, first one 707 ms after connecting.

The storefront being empty is correct, not a regression: `LAUNCH_STORE` is `[]` and
`validateCatalog` refuses any priced item at boot, which is the free-game rule enforced rather
than remembered.

**Every deployment shipped with no art, and nothing said so.** `.gitignore` excluded
`packages/client/public/models/` wholesale, so all 7 animal meshes and 46 prop meshes were absent
from a fresh checkout — which is what CI runs and what the Docker image is built from. Measured
against the live server: `/models/kangaroo.glb`, `/models/fox.glb` and `/models/props/tree-1.glb`
all 404. Nothing breaks, because `loadGeometry` returns null and the renderer falls back to
procedural geometry, so the game *ran* and looked like boxes. A local `docker build` **does**
include the art, because Docker reads `.dockerignore` rather than `.gitignore` — so the machine you
test on disagreed with the machine that ships, which is why it survived this long.

**Two pipelines write to that one directory, and only one of them can be committed.** Ours —
`tools/blender/{build,props,portal}.py` — generate every animal and every prop from `animals.json`
and `assets/meshy/`, both tracked; that is deterministic output of tracked sources and ours to
redistribute. Theirs — `npm run assets:fetch` from `assets/packs.json` — is **five `source:
manual` packs out of six**: Quaternius and Kenney are click-through downloads, so no build machine
can fetch them and they are not ours to commit. Only the Khronos Fox is a direct URL.

Ours are tracked now; only the names nothing but a pack can produce stay ignored. The six animals
a pack would install collide with ours by filename and cannot be separated in `.gitignore` —
installing those packs overwrites tracked files, and `git status` saying so is the point.

Provenance was checked rather than assumed: the seven animals on disk are exactly
`animals.json`'s list including `human.glb`, which `packs.json` never mentions, and the pack-only
names (`bear.glb`, `deer.glb`, `fox-quaternius.glb`, `anim/`, `audio/`) are absent. The packs have
never been installed here.

**The error that nearly went in:** a first pass reported all six packs as automatic, because the
probe asked `p.get('manual', False)` for a key that does not exist — the field is `source`. Every
pack answered `False` for the same reason, and that is the tell this file already warns about:
identical results from different inputs. It was wrong in CLAUDE.md and in a commit message before
a second look caught it.

`check:smoke` exempts `/models/` 404s **only when the build has no art at all**, which is a
property of the whole build. With art installed a mistyped model URL still fails, and keying the
rule per-file instead would have made those two indistinguishable forever.

**`ClientMessage`'s discriminator is `t`, not `type`, and the join message is `hello`** — with
`protocol` (`PROTOCOL_VERSION`, currently 2), `name`, `animalId`, `cosmetics`, `platform`,
`crossPlay` and `token` all required. A guessed `{type:'join'}` connects, is ignored, and sends
nothing back for as long as you care to wait, which looks exactly like a broken server.

## Crash reporting

There was none, and there was no global error handler either — an unhandled error in the client
went nowhere at all, so the only way to learn the game had broken on a device was to be told.
`telemetry/errors.ts` is Sentry, wired under three constraints that all come from this project:

- **Off the boot path.** The SDK is behind a dynamic `import()` and a named `sentry` chunk.
  Measured: the entry chunk has zero Sentry in it, precache is 12 entries / 959 kB — the same as
  before it was added — and in a real browser with no DSN the chunk is never fetched and
  `sentry.io` is never contacted.
- **Nothing about a person.** `scrubEvent`/`scrubBreadcrumb` are pure and unit tested rather than
  trusted to a vendor default: the user object and request headers are deleted, query strings
  (where the guest token travels) are stripped, room codes become `<room>` so one route stays one
  issue, and **console and `ui.*` breadcrumbs are dropped as whole categories** — a filter would
  be a list of the leaks somebody thought of, and chat, voice state and names all pass through
  code that could one day log them.
- **The DSN is not a secret; the auth token is.** A DSN is a write-only ingest address that every
  web build ships in the clear, so it does not contradict the rule about keys in web builds. The
  token that uploads source maps is a real secret and never goes near the client.

Two back doors were found by measuring rather than by reading, and both would have undone the
first constraint silently:

- **`build-precache.mjs` sweeps `assets/` wholesale**, so it precached the 444 kB Sentry chunk —
  the service worker would have downloaded the crash reporter during install, which is exactly
  what the lazy import exists to prevent. It also precached **6.4 MB of source maps** the moment
  `sourcemap: 'hidden'` was turned on. Both are excluded by name now, which is why `sentry` is a
  named chunk rather than a hashed one.
- The maps are deleted from the image after the build. They exist to be uploaded from the build
  machine; the upload step goes immediately above that deletion in the `Dockerfile`.

`Settings.errorReports` is the opt-out, on by default, and a build with no `VITE_SENTRY_DSN`
sends nothing whatever it says.

**Telling an issue tracker and telling the player are different jobs, and only the first one was
being done.** Sentry installs its handlers when it initialises, so with no DSN — which is every
build until one is configured — *nothing* handled an error after boot. `main().catch` covers a
rejected boot promise and said "Kangaroo Chase failed to start. Check the console for details",
which is advice for somebody at a desk and a dead end for somebody in a headset. So
`installCrashSurface` is installed at import time, before `main()` runs, always, with or without
a DSN.

- **A throw in the render loop is permanent.** three.js's `WebGLAnimation` re-requests the next
  frame *after* the callback returns (`node_modules/three/src/renderers/webgl/WebGLAnimation.js`),
  so one throw ends the loop. The picture freezes and the game says nothing — which reads as the
  game having stopped responding rather than as an error, the same failure mode as the dropped
  gadget events.
- **In an immersive session the DOM is not on screen**, so the overlay ends the XR session first
  (`vrInput.exitVr()`) or the player never sees it.
- **Once.** At 72 Hz a throwing loop is seventy-two identical notices a second.
- The overlay is appended over the page with inline styles, never written into `#app`: replacing
  `#app` destroys the canvas (wrong if the throw came from a UI handler and the game is still
  running), and a boot that fails before `injectStyles()` has no stylesheet for `kc-btn` to use.
  It carries a **Reload button**, because "reload to start again" is an instruction and the
  player it is written for has no address bar, no keyboard and no console.
- `installCrashSurface(announce, target)` takes its `EventTarget`. Not for tidiness: a bare
  `addEventListener` is a browser global and made the whole thing untestable under Node.

Measured in a real browser against the built client: no overlay during play (canvas present),
then a real uncaught error from a timer produces one full-viewport panel — `elementFromPoint` at
the centre returns it, so it is genuinely on top of the canvas rather than merely in the DOM —
and five further throws plus an unhandled rejection leave `#kc-crash` at **one** panel still
showing the first message.

## Events

`AudioSystem.handleEvent` and `GameClient.playHaptics` are both a `switch` ending in
`default: break`, so an event nobody wrote a case for is **silently discarded** — the code looks
complete and the player gets nothing. `packages/client/src/game/event-coverage.test.ts` scans for
event types with no consumer at all. (It cannot see a *partial* regression: dropping a sound while
the haptic case survives still passes.)

Five were being dropped at once and together they were the whole gadget layer: `gadgetUse`,
`gadgetHit`, `gadgetExpire`, `status` and `roundState`. Firing a freeze gun, being hit by one, and
being **frozen in place for three seconds** all produced no sound and no pulse — which reads as
the game having stopped responding, not as a mechanic. `roundState` also carries Conversion Duel's
bell (`data: 'bout'`), so the fistfight that mode is built on started in silence.

The HUD's `FROZEN 2.4s` pill is polled from `PlayerState.gadgets`, not driven by the `status`
event — so a visible indicator existing is not evidence that the event has a consumer.

**The HUD is not a channel a headset can see, and the coverage guard did not know that.**
`event-coverage.test.ts` asked "does anything mention this type" — and the HUD's own toast
counts as a mention, so `roleChange` passed the guard while reaching **only** the HUD: no case in
`AudioSystem.handleEvent`, none in `playHaptics`. Measured with six bots over 90 s on
`jungle-world`: 6 silent role assignments at every round start in every mode, and in Conversion
Duel **24 of 24 silent**, including being beaten in a fight and converted to the other species —
the mode's entire premise. The guard now has a second check: every event the HUD's own switch
announces must also have a sound or a haptic case, found by walking each switch's braces rather
than grepping for the type name (grepping the call site `this.playHaptics(event, isLocal)` for
`playHaptics(` reports zero cases and looks exactly like an empty switch).

**`setFirstPerson` (the local-avatar-in-VR flag) was `group.visible = false`.** The comment said
"hide the head so it never blocks the view"; the code hid the whole group, which is also where
the tracked hands and the role ring live. No VR-specific hand model exists elsewhere — `VRInput`
adds three.js's controller/grip/hand objects to the rig as empty groups — so a headset player saw
no hands at all in a game whose locomotion is climbing with your arms, and lost the one role
indicator a headset can see (the HUD is DOM) along with them. It now hides `body` only; the hands
and the ring are not a guess about an untracked limb the way legs are, so there was never a reason
to hide them.

`roleChange` now gets a role-shaped cue in both channels — a low hard tone/pulse for becoming the
threat, bright and quick for becoming the prey, a thud for a Conversion Duel loss — local player
only, since six roles assigned at once would otherwise replace silence with a chord.

## Measurement hazards

These silently invalidated real measurements in this repo. Check them before believing a number.

- **The level ids are `jungle-world`, `glacier-world`, `outback-station`.** `buildLevel(id)` falls
  back to the default level for anything it does not know, rather than throwing — right for the
  runtime (a client asked for a map it lacks should not crash), fatal for a probe. Guessing
  `jungle-lobby` / `glacier-ridge` measured the *same* map three times and produced identical
  numbers across supposedly different worlds. Identical results from different inputs is the tell.
- **Each landed projectile emits two `gadgetHit` events** — one from `applyPayload` carrying the
  damage dealt, one from `detonate` with magnitude 1 meaning "direct hit". Counting events as hits
  reports a 100 % hit rate; the real figure is about half.
- Roles are assigned when the round starts, not in `addPlayer`. Read `player.role` before the
  countdown ends and everyone is `idle`.
- A mode's countdown freezes players, and a round reset restores the state you were watching. Both
  will hide an effect inside a long run.

## Water

Asked to make the maps "more realistic" (`Haritaları daha iyi gerçekçi geliştirebilir misin`), the
terrain itself was **not** the defect: `glacier-world`'s ice shelf and `outback-station`'s Gum Flat
are deliberately flat — see Map density below — and `LevelBuilder` has no heightmap/terrain
primitive to add texture to anyway, only box/cylinder/sphere/ramp. What was actually wrong,
measured rather than assumed: every water surface (jungle's river and cave pool, its canyon plunge
pool, outback's creek) was **completely static**. `textures.ts`'s water recipe is nearly smooth
(`roughness: [0.14, 0.04]`) specifically so it reads as wet, glossy and specular — and a specular
surface with a frozen ripple normal map reads as varnished glass, not moving water, because the
one thing that would show motion is exactly the thing that never moved.

`applyTriplanar` (`surfaces.ts`) now gives every triplanar material a `uFlowOffset` vec2 uniform,
added to all three triplanar sample coordinates (`triSample`, and the whiteout normal-map block) —
kept generic rather than gated behind a boolean, because the cost is one vector add before a
texture fetch that already happens, and a second compiled shader variant to omit it would double
the program count for nothing measurable. `LevelRenderer.material()` records every material built
for `'water'` in `waterMaterials`; `animate(time)` — the same per-frame hook that already breathes
the portal veils and spins checkpoint rings — is the **only** place that ever writes to it, at
`(time*0.035, time*0.05)`, different rates per axis so it reads as a current rather than a
repeating texture sliding diagonally. Every other triplanar material's offset stays at its default
zero.

`onBeforeCompile` — where `flowOffset` actually attaches to `material.userData` — only fires once
a real renderer compiles the material, which vitest's headless run never does (`surfaces.test.ts`
already documents this). `LevelRenderer.water.test.ts` stands in for that compile step by
attaching a stub uniform object by hand, then checks that `animate` moves every water material's
offset and nothing else's — mutation-tested by deleting the update loop (test failed: offset stuck
at zero) and by making `material()` push every material into `waterMaterials` instead of only
water (test failed: a rock material got moved too). The visible effect was checked the way
`surfaces.test.ts` says a shader compile has to be — in a browser: a standalone probe page loaded
the real `createSurfaceMaterial('water', …)` through Vite, not the full game, rendered it at
`t=0` and `t=6`, and diffed the two frames — 205,297 of 360,000 pixels moved (measured, not
inferred from the shader text compiling). No geometry, instance count, or texture changed, so the
frame budget is unaffected by construction; nothing here needed re-measuring against the Quest
draw-call table.

## Map density — the number that decides whether it feels like a game

Median distance to the *nearest* other player, six players, sampled once a second from t=10 s, and
the share of the round spent within 15 m of anybody. `playRadius` is the only lever: the bot turns
back toward the centre past `playRadius * 0.75`, and nothing else reads the field.

| map | shipped | now |
| --- | --- | --- |
| `jungle-world` | 18.2 m / 44 % | 13.7 m / 50 % |
| `glacier-world` | 32.1 m / 20 % | 14.0 m / 54 % |
| `outback-station` | 43.2 m / 14 % | 15.9 m / 50 % |

`playRadius: 150` put the leash at 112 m and six players on a 700 m circle; on Outback that was
48 % of the round spent on the empty apron. Nobody falls off at the tighter values — measured 0
kill-plane crossings throughout.

**Smaller is not automatically safer.** Cutting the leash alone collapses a map into its largest
zone (glacier at 45 read `shelf 100 %, crevasse 0 %, seracs 0 %`), which improves every density
figure by deleting the map. `levels.test.ts` asserts the leash reaches more than one zone, and the
ambience test caps it from the other side.

**Players are as close together as the space they are standing in is small.** Median distance to
the nearest other player, by the zone they are in: outback cave (r 14) **3.2 m**, jungle cave
(r 34) 6.0 m, outback gorge (r 34) 9.3 m, jungle canyon (r 42) 16.0 m, and every map's open
primary zone 15–46 m. A map's overall density is therefore set by **how much of the round is spent
in its biggest open area** — jungle 13 %, outback 43 %, glacier 59 % before the rescale.

That is why `glacier-world` was rebuilt at 0.6 of its horizontal size (version 1 → 2). Its rink was
124 m across — the whole of Gorilla Tag's forest several times over — and 59 % of the round was
spent on it. Scaling positions and floor extents while keeping every object's own size packs the
same sixteen towers and fourteen boulders into 0.36 of the ground: 22.3 m / 31 % → 14.0 m / 54 %,
with the zone mix intact (shelf 61 %, seracs 25 %, crevasse 9 %) and 0 % of the round outside a
zone. Shrinking a map is the lever; cutting its leash is not.

Two things bite when a map is tightened, both caught by tests rather than by looking: a scattered
object lands on a spawn (a serac tower, and before it an Outback boulder), and a literal in a test
stops matching the geometry it was copied from (`half.x > 20` for the crevasse floor,
`playRadius >= 75`). Identify things by rank or role, never by a measurement of the current map.

**Outback's station has been measured and left alone — do not "fix" it again.** It is the loneliest
place in the game (median 42.2 m to the nearest other player) and takes only 9 % of the round, and
the geometry explains why: players in it sit at a median 65.1 m from the origin against a 67.5 m
leash, reaching a median depth of 0.61 into a zone whose water tank is at x = 92. They graze its
near half and turn back. Moving it inward is the obvious fix and it is wrong — measured at three
settings, every one made the **map** worse while improving the station: centre 76 → 56 takes the
station from 9 %/42.2 m to 18 %/24.0 m and the map from 15.1 m/50 % to 20.0 m/41 %. Outback is
already at target, and on a map whose whole subject is being seen, a far corner where you are alone
is a destination rather than a defect.

A zone outside the leash is dead content. Outback's cave sat on the west wall with its nearest edge
74.7 m out — past any leash worth having, since the smallest radius that reaches it is 100 and 100
measures a third worse on density. Moving it to the gorge's east face took it from `cave 0 %` to
`cave 10 %`, and the time came out of the gorge (39 % → 24 %), which is the second place to be that
the gorge wanted.

**Measure zone occupancy with `zoneAt`, never with your own loop.** It is 3D and it picks the
*smallest* zone containing the point; a first-match-in-declaration-order loop reports something
else entirely, and once a primary zone is widened it reports nonsense. That bug made the cave look
unvisited at 0 % when it was at 10 %, and it made every zone look swallowed by `flat`.

Ambience is not a background detail: outside every zone `updateZone` calls `setAmbience(null)` and
the bed **stops**. Every map's primary zone used to end at 60–66 m while the leash puts players at
67.5 m, leaving a silent ring exactly where they spend their time — 29 % of an Outback round, 20 %
of a glacier one. Primary zones are 72 m now and `levels.test.ts` samples the whole disc, at three
heights, for holes.

## Hunt

The hunter's rifle works — on `jungle-world` it lands for the full 55 and clears five survivors by
~t=125 s. The older note that "eliminations come from prey getting wedged rather than from the
rifle" no longer reproduces; the bot obstacle-avoidance change fixed the wedging. On the two
sparser maps the hunter simply cannot find people, which is a density problem, not a weapon one.

## The Meta Horizon Store listing

`docs/META_LISTING.md` and `npm run pack:meta:listing` produce the actual submission — copy and
art — separately from `docs/STORES.md`'s packaging steps, which only get the app *installed*, not
found or approved.

- **"24-bit PNG" is a bit-depth term, not "looks opaque".** Meta's asset guidelines ask for it on
  the icon, every screenshot and every piece of key art. An RGBA image with alpha permanently 255
  everywhere is still 32-bit and fails that literally, so `pack-meta-listing.mjs` writes every
  image through a new `encodePngRGB` (colour type 2) in `scripts/lib/png.mjs`, not the RGBA
  `encodePng` the Microsoft Store script uses. Tested by reading the IHDR byte back and by
  measuring the file is smaller than the RGBA encoding of the same pixels, then mutation tested:
  changing the colour-type byte back to 6 fails both.
- **Composing the flat 512×512 icon from the raw `icon-1024.png` under-fills the canvas.** That
  source already carries its own safe-zone padding, drawn to survive an OS cropping it into a
  rounded square or a circle — which Meta's flat, uncropped icon slot never does. Handing it
  straight to `compose()` pads an already-padded glyph, leaving the kangaroo under a third of the
  canvas. Fixed by keying out the background and trimming to the glyph's own bounds first, the
  same treatment the cover art already used.
- **A row layout for the key art broke two different ways depending on aspect ratio.** Giving the
  text a fixed height share and the kangaroo `flex: 1` for whatever was left squeezed it into a
  sliver on the square and portrait sizes; giving the image `height: 100%` outright on the wide
  hero size let it touch the top and bottom edges with no margin. A single flex *column* — text,
  then kangaroo at `flex: 1` — fixes both, because the image always gets exactly what the text
  did not use rather than a number guessed per shape. Only the two most extreme ratios (10:3
  hero, 3:1 mini banner) go side by side instead, with the image given a real fixed box so it
  still gets margin.
- **There is no first-person capture, and it is documented as a gap rather than faked.** Meta
  prefers first-person POV screenshots; there is no headset here and, per this file's own VR
  section, there never will be. The five required screenshots are the desktop third-person camera
  every non-VR platform actually uses — genuine gameplay, not a mockup, but not the headset's own
  view. Likewise the trailer *video* Meta wants (30s–2min MP4/H.264/AAC): `capture:trailer`
  produces a 12 fps GIF from swiftshader frames, which is real footage in the wrong container and
  frame rate. Only the static trailer *cover image* is generated. Both gaps are named in
  `docs/META_LISTING.md` rather than left for a reviewer to discover.
- **The listing copy's claims are checked against the code, not merely written to sound right**:
  nine mode files, `KC_MAX_PLAYERS` (16), `proximityGainAt` for voice falloff, `LAUNCH_STORE`
  empty plus `validateCatalog` refusing any priced item at boot, and the actual field names of
  `ComfortSettings` — all cited by file, all read by something (per the Settings section above).
- **The privacy policy, IARC filing and developer account are not build steps.** They need a
  live URL, a real submission and an account holder, respectively, and `META_LISTING.md` says so
  rather than inventing placeholder text that would look finished and not be.

## Leaderboards

A record is filed under **the course it was run on**, not the map's name: `Leaderboard` keys every
call `"<levelId>@v<version>"`. Maps are generated from a seed, so editing one changes the course
everybody runs while the id stays put — and the old course's times would sit on the board beside
the new one's, with nothing in the rows to say so. **Bump a map's `version` whenever its geometry
changes**; that starts a clean board and leaves the old one intact under its own key.

The key is resolved inside the class, not at the three call sites (the room and two HTTP routes),
because a board is only trustworthy if none of them can forget. `levelVersion(id)` memoises the
built level's own `version` rather than declaring it a second time on the registry entry, and
returns **0** for an unknown id so a nonexistent map's times cannot land on a real map's board —
`buildLevel`'s fallback would otherwise stamp them with the jungle's version.

## How to find defects here

Measurement beats reading the code, every time. What has actually worked:

- Headless full-speed simulation with the real `Simulation` and `Bot` via `tsx`.
- A/B screenshots compared with Pillow; Playwright + Chromium at
  `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` with `--use-gl=swiftshader`.
- Two real browser clients over real WebRTC, measuring RMS on the listener — `npm run check:voice`,
  which in this container needs `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
  because Playwright looks for a `chrome-headless-shell` build that is not installed. Never run
  `npx playwright install`.
- **Mutation testing on every fix** — break the fix, confirm the new test fails, restore.
  Back the file up with `cp`, never `git checkout`: the working tree usually holds other
  uncommitted work, and a checkout takes that with it. It cost two finished edits once.
  Verify the mutation actually applied before believing a green result — a `perl -0pi -e` whose
  pattern did not match reports nothing and looks exactly like a surviving mutant.

**A source scan must strip comments first.** All three of the "declared but never read" guards
(buttons, events, settings) search source text, and the doc comment explaining *why* a thing must
be read contains its name — so deleting the only real use still passes. Measured: removing the
sole read of `hapticStrength` left the settings guard green, vouched for by the comment above the
line that had just been deleted.

Watch for harness artefacts before believing a result: a probe that reports "no difference" may be
measuring the wrong event name, running a mode whose countdown freezes the player, or crossing a
round reset that restores the state you were watching. All three have happened.
