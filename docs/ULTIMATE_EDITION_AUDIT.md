# Kangaroo Chase — PC + VR Ultimate Edition: Phase 0 audit

Written 2026-10-09 against `440e031` (CI green: `verify`, `browser`, `postgres`). This is the
Phase 0 deliverable of the Ultimate Edition directive: what exists, what to keep, what couples PC
to VR, and what is broken. Every claim either cites a file or a measurement taken for this audit;
the probes are described in §13 so they can be re-run.

The short version: **this is not a prototype to be rebuilt.** It is a working cross-platform game,
with 39 k lines of TypeScript and 1,362 passing tests behind a single gate (`npm run verify`). It
already does the hard things the directive asks for: one deterministic simulation shared by PC, VR,
mobile and the server; server authority; WebXR hand physics; comfort systems; and a frame governor
with a headset floor. The work ahead is to fill specific gaps. Four were measured for this audit,
and two of them are exploitable today.

---

## 1. Architecture

```
packages/
  core/    @kc/core   15.6 k lines  deterministic gameplay, physics, modes, AI bots, content, progression
  net/     @kc/net     1.5 k lines  wire protocol (PROTOCOL_VERSION 4), intent/snapshot codecs, interpolation, prediction
  server/  @kc/server  3.8 k lines  authoritative rooms, matchmaking, accounts, moderation, social, HTTP API
  client/  @kc/client 18.2 k lines  three.js renderer, platform layers (PC / Mobile / VR), UI, audio, FX
  shell/   @kc/shell    0.2 k lines Electron launcher for Steam/Epic (bundled local server + online origin)
```

- **One simulation.** `Simulation` (`core/src/sim/simulation.ts`) is a fixed 60 Hz step,
  `(state, intents) → state`. The server runs it authoritatively. The client runs the same code for
  prediction and for offline practice with bots.
- **One input boundary.** A platform may only produce an `InputIntent` (`core/src/input/intent.ts`),
  set with `sim.setIntent(id, intent)`. VR adds optional `hands`, holding position and grip only.
  Hand velocity was removed from the wire in protocol 3 (see CLAUDE.md, "The wire carried a hand
  velocity nothing read").
- **Network.** WebSocket, binary frames. Intents go up at 60 Hz (16 B on PC/mobile, 30 B in VR with
  both hands). Snapshots come down at 20 Hz, delta-encoded against the last acknowledged baseline;
  far players are sent at a quarter rate (`server/src/room.ts` `broadcastSnapshots`). Remote
  players and gadget entities are interpolated 100 ms in the past on one clock.
- **Delivery.** The same client build ships to five surfaces:
  - web/PWA;
  - Quest, as a Bubblewrap TWA that loads an origin;
  - Steam/Epic, as an Electron window over a bundled localhost server, with an online origin when
    `pack:steam --online` is given;
  - Microsoft Store;
  - Android phone.
- **Content pipeline.** All tracked and reproducible:
  - Blender as a Python module (`bpy`) rigs Meshy sculpts onto body-plan skeletons
    (`tools/blender/`).
  - Props come from Meshy previews.
  - Skies are Poly Haven HDRIs and surfaces are ambientCG scans, both CC0.
  - Recorded sound effects come from ElevenLabs (`assets/audio/provenance.json`).

## 2. Important files

| Concern | File | Why it matters |
| --- | --- | --- |
| Tick, events, snapshot | `core/src/sim/simulation.ts` | The one place gameplay advances. |
| Intent + sanitisation | `core/src/input/intent.ts` | The trust boundary: `sanitizeIntent`, `BUTTON_MASK`. |
| Movement | `core/src/player/locomotion.ts` | Hop/charge/wall-bounce, hand poses, climbing, palm push. |
| Combat | `core/src/player/combat.ts` | Punch speed from hand displacement; damage; knockback. |
| Physics | `core/src/physics/` | Capsule collide-and-slide, heightfield terrain, step-up. |
| Modes | `core/src/modes/*.ts` | 9 modes on one `GameMode` interface. |
| Bots | `core/src/ai/` | `Bot(playerId, {skill, seed})`; also the test harness for every balance claim. |
| Rooms | `server/src/room.ts` | Tick loop, snapshot fan-out, results, rewards. |
| Moderation | `server/src/moderation.ts` | Moderators, bans, auto-mute, report queue. |
| Game client | `client/src/game/GameClient.ts` (1,433 lines) | Frame loop, camera, events → audio/haptics/FX. |
| VR input | `client/src/platform/vr/VRInput.ts`, `comfort.ts` | Session, `VR_BINDINGS`, rig easing, vignette, blink. |
| Device profile | `client/src/platform/Platform.ts`, `governor.ts` | Tiers, `fpsFloor`, `VR_FOLIAGE_BUDGET`. |
| Renderer | `client/src/render/Renderer.ts`, `LevelRenderer.ts`, `Avatar.ts` | Scene, levels, animals, sockets. |
| HUD / menus | `client/src/ui/Hud.ts`, `Shell.ts` (1,921 lines), `VRPanels.ts` | DOM HUD; world-space VR menus. |
| Launcher | `shell/src/main.cjs`, `launch.ts`, `openxr.ts` | Bundled server, stable origin, VR handoff to Chrome/Edge. |
| Working memory | `CLAUDE.md` (2,704 lines) | Every measured defect and the reason behind each rule. |

## 3. Existing systems (all verified present and wired)

**Gameplay**
- Locomotion: charge-jump, long-jump, wall-bounce, coyote time, per-surface friction, crouch.
- VR: hand climbing and palm push.
- Combat: buttons on PC/mobile, physical punches in VR.
- 9 modes: Kangaroo Chase, Infection, Boxing, Parkour, Hunt, Conversion Duel, Freeze Tag, King of
  the Hill, Training Room. Roo Ball is a lobby door built on the same interface.
- 9 gadgets.
- Server-authoritative physics balls.

**World**
- 3 seeded maps: `jungle-world`, `glacier-world`, `outback-station`.
- Heightfield terrain, enclosure cliffs, distant land ring, animated water.
- HDRI skies, photo surfaces, particle FX.

**Characters**
- 16 Meshy-sculpted animals, rigged with the clips the generator writes.
- The kangaroo and frog run as a real bound (planted stance, ballistic flight).
- 20+ cosmetics on generator-authored sockets.

**Online**
- Prediction/reconciliation and interpolation.
- Voice (WebRTC mesh bounded by distance, Opus tuned).
- Friends and parties, moderation, leaderboards keyed by course version.

**Progression**
- XP, coins, achievements and the Challenges screen.
- Yearly events, a season track, a coin shelf. Nothing is sold for money, and `validateCatalog`
  enforces that at boot.

**Ops**
- Sentry is lazy and scrubbed. There is an in-page crash surface that exits XR first.
- Store packaging for Steam, Epic, Meta, Microsoft and Play, plus store art and a trailer.

## 4. Already suitable for PC + VR (preserve)

These carry the platform split the directive asks for, and they work:

- **The intent boundary.** Gameplay never asks which platform a player is on. VR hands are
  additive, so a PC player runs the same simulation minus hand forces.
- **Punch parity rules in `locomotion.ts`.** Two rules here keep PC and VR even:
  - Punches aim with pitch on PC/mobile, so VR does not own the 1.6× head multiplier.
  - A held punch button falls back to the free fist only once the named one has finished.
- **`VR_BINDINGS`.** One table drives both the input loop and the hints. Crouching by ducking and
  punching by throwing are documented in the same table.
- **Comfort.** All of these exist and are measured:
  - `easeRigHeight`: worst one-frame step 18 cm → 3.3 cm.
  - The vignette.
  - A teleport blink.
  - Snap and smooth turn with sliders.
  - `grabThresholdFor`.
  - The landing camera dip, which is PC-only by construction.
- **Frame governor with a headset floor.** VR is never judged against the flat-screen table. On top
  of that, the headset gets:
  - shadows off below `high`;
  - foliage clamped to `VR_FOLIAGE_BUDGET`;
  - texture detail kept as its own decision (`textureDetail`).

  Measured: 45 calls / 410 k triangles per eye pass.
- **Events reach a headset.** `event-coverage.test.ts` requires every HUD-announced event to have a
  sound or haptic case, because the HUD is not visible in VR. Role is also encoded in ring *size*.
- **Avatar in first person.** `setFirstPerson` hides the body only. The tracked hands and the role
  ring stay visible.

## 5. VR-specific coupling and gaps

Each item below was found for this audit, by reading or by measuring.

1. **A headset player sees no HUD at all.** The round timer, score, scoreboard, role badge, gadget
   charges, the `FROZEN 2.4s` pill, headlines and toasts are all DOM (`ui/Hud.ts`). DOM is not on
   screen in an immersive session. `VRPanels.ts` provides world-space *menus* (main, friends,
   tuning) and nothing during play. No wrist or world HUD exists anywhere in `client/src`.
   - Audio and haptics cover role changes.
   - Nothing covers "how long is left", "what is the score" or "how many freeze shots do I have".
   - This is the largest PC↔VR presentation gap.
2. **Every headset is assumed to run at 72 Hz.** `VR_DISPLAY_HZ = 72` (`Platform.ts:14`) is the
   governor's floor for every VR device. Nothing reads `XRSession.frameRate` or
   `supportedFrameRates`, or calls `updateTargetFrameRate`.
   - PCVR headsets run at 80–144 Hz, and a Quest can be asked for 90 or 120.
   - So a 90 Hz Index or Link session is judged against 72 fps. It can sit at 72 — reprojecting
     every fifth frame — without the governor ever dropping a tier.
3. **The server accepts tracked hands from any client and does not bound how far they move.**
   - `sanitizeIntent` clamps each hand into a 1.2 m reach envelope per tick.
   - `combat.ts` derives punch speed from the hand's displacement between ticks.
   - A client that teleports a hand across the envelope every tick therefore throws a punch at
     about 72 m/s. Measured in §8.1.
4. **PCVR is two surfaces.** Electron is compiled without WebXR. "Play in VR" hands off to
   Chrome/Edge over SteamVR's OpenXR runtime (`shell/src/openxr.ts`). This is correct and
   unit-tested, but **has never run on a headset**.
5. **Stereo is two full scene passes.** The game uses the classic `WebGLRenderer`. Three.js 0.182
   supports multiview only in its node-based `Renderer`/`WebGPURenderer`, and the game's triplanar
   materials are `onBeforeCompile` shader patches that renderer cannot run. Every draw call is
   submitted twice in a headset.
6. **No cinematic system exists.** Nothing anywhere drives the camera other than the player, so the
   directive's PC opening and its VR-safe variant start from zero. This is not a coupling problem
   yet, and the design in the roadmap keeps it from becoming one.

## 6. Systems that need abstraction (and only these)

The rule is "refactor only with a clear architectural reason". Three have one:

- **`HudModel`.** Today the HUD reads simulation state and writes DOM directly. Gap 5.1 needs the
  same information on a second surface. The pattern that already worked here is `VR_BINDINGS`: one
  table, two consumers.
  - A pure `HudModel` derived from sim state and the local player, unit-testable without a DOM.
  - DOM renderer: PC and mobile.
  - World-space panel renderer: VR, using a wrist or forearm panel.

  Without the shared model, the two HUDs drift the way the two binding lists once did.
- **`DisplayClock`.** Each platform should report its own display rate: the session's `frameRate`
  in VR, `fpsFloor` elsewhere, falling back to the measured frame interval. The governor already
  takes `floorFps`, so this changes where one number comes from and nothing else.
- **`CameraDirector`, built new for cinematics.** It owns the camera only on platforms that are not
  VR. In VR the same timeline drives a comfort-safe equivalent: a fixed rig, a fade between shots,
  and the world animating around a still head. One script, two presentations. The opening never
  shows a move the player cannot make, because it is played by the real `Simulation` and bots.

Explicitly **not** needing abstraction:
- the simulation;
- the modes;
- the net protocol;
- the renderer's quality tiers;
- the asset pipeline.

## 7. Technical debt

**Documents that disagree with the code**
- `TODO.md` says protocol 3 (it is 4) and 1,088 tests (1,362). It lists the glacier crevasse
  wedge as an open gap; that was fixed in glacier `version` 7.
- `ARCHITECTURE.md` §2.3 still shows `interact` and hand velocity in the intent, and both are gone.
- `ARCHITECTURE.md` §8 promises VR "static bake" shadows and "< 200" draw calls. What actually runs
  is shadows *off* below `high`, measured at 45 calls per eye pass.

**Size and data hygiene**
- `CLAUDE.md` is 2,704 lines. It is the most valuable file in the repository and it is past the
  size where a reader finds the rule they need. It should be split into an index and topic files
  without losing a line.
- `Shell.ts` (1,921 lines) and `GameClient.ts` (1,433 lines) are the two places new work lands
  first. Split them only along the seams the `HudModel`/`CameraDirector` work creates, not
  speculatively.

**Inert data**
- `LevelDef.grips` and `GripKind` are authored on every map and read only by a stats test.
- The `chat` and `voice` `SimEventType` members have no producer.
- `sky.ts`'s `sunStrength` is dead. It was measured as invisible, and that is documented.

**Repository and asset pipeline**
- `patagonia-underground.bundle` and `patagonia-underground-vercel.tar.gz` (2.1 MB total) are
  tracked at the root ("Add files via upload"). They belong to another project. They are the
  owner's files, so they are left alone; they do sit in the Docker build context.
- No texture compression (KTX2/Basis) and no mesh LODs exist anywhere in the client. This is
  harmless at today's 512² photo textures and untextured animals, and it is a hard blocker for
  anything higher-resolution (§9).

## 8. Bugs

### 8.1 A modified client punches 2.8× harder — measured

Boxing mode, two players toe to toe for 20 s, damage dealt (`.probe/punch.ts`, method in §13):

| attacker input | landed | damage | per second |
| --- | --- | --- | --- |
| PC, punch button held | 74 | 227 | 11.3 |
| VR, honest jabs (6 m/s, each hand every 0.6 s) | 65 | 250 | 12.5 |
| **modified client: hand teleported across the envelope each tick** | 69 | **696** | **34.8** |

How to read the table:
- The hit *count* is capped by the victim's 0.25 s immunity, so every style lands about the same
  number.
- The damage per hit is what changes. A teleported hand sits at the top of `speedFactor` (1.4), and
  a honest 6 m/s jab sits at 0.5.

To check the probe was measuring the hand and not an artefact:
- With the hand at −0.6 m the spoof landed **0** hits.
- At 0 m it landed body shots only (21.8 dps).
- At 1.1 m it landed head shots (34.8 dps).

Who is affected:
- **Any platform can do this.** The server does not check that a player claiming tracked hands is
  in VR.
- It applies to Boxing and Conversion Duel, whose whole premise is the fistfight.

What the honest rows show: honest VR and PC are within 10 % of each other. This is a cheat, not a
platform imbalance.

### 8.2 The hunter is sent every survivor it cannot see — measured

Hunt, six bots, 4 seeds × 90 s per map. For each hunter and each living survivor, once a second:
is there a head-to-head line of sight (the same physics ray as `captureView`)?

| map | hunter→survivor samples | no line of sight |
| --- | --- | --- |
| `jungle-world` | 1,233 | **63 %** |
| `glacier-world` | 1,477 | **56 %** |
| `outback-station` | 1,419 | **77 %** |

`broadcastSnapshots` sends every player to every client. Far players arrive at a quarter rate, but
they still arrive. In a mode about hiding, which has a smoke bomb and crouch-to-break-sightline,
**more than half of what the hunter is sent is information they could not see.** A wallhack is a
renderer change, with nothing to detect on the server.

A single head-to-head ray is a conservative test: a survivor whose head is hidden behind a log but
whose feet show counts as "hidden", so these figures are an upper bound on the pure leak. The
order of magnitude is the finding.

### 8.3 Smaller, already documented

- Every headset runs at the 72 Hz floor (§5.2).
- The canyon ramp's lower steps run into the canyon's west wall.
- Bots rarely climb the outback scree.
- The mobile joystick's drawn ring is a fixed 110 px whatever `joystickSize` says.

## 9. Performance risks

- **The Quest has little headroom left.**
  - Measured per eye: 45 calls / 410 k triangles. That is ≈90 / 820 k in stereo, against Meta's
    published Quest 2 guidance of 750 k–1 M triangles a frame.
  - All of that is at today's art: 3,900-triangle untextured animals and 512² surfaces.
  - Any "realism" pass spends from this budget, and stereo doubles every call (§5.5).
- **4K textures cannot ship to a headset as-is.** Arithmetic, not opinion:
  - One 4096² RGBA texture with mips is ≈ 89 MB of GPU memory uncompressed.
  - A PBR set (colour, normal, ORM) per animal × 16 animals is ≈ 4.3 GB.
  - Even ASTC 4×4 (8 bpp) is ≈ 22 MB per 4K texture, ≈ 1 GB for the roster.
  - A Quest browser tab will not hold that. 4K is a *source* resolution, and §11 gives the tiering.
- **No texture compression or LODs** (§7). Both are prerequisites for higher-detail art on any
  tier, not just on Quest.
- **Nothing is measured on real hardware.** Every frame-time figure here comes from swiftshader or
  from counting draw calls; GC pauses and JS allocation have never been profiled on a Quest. The
  only thing that settles them is a hardware pass.
- **Post-processing is off in XR.** `Renderer.ts:487` runs the composer only when not presenting.
  That is correct for frame time, and it means VR and PC already look different; the visual system
  has to be designed for both.

## 10. Multiplayer risks

- **There is no hosted server.** Railway's trial expired on 2026-09-22. No cross-device multiplayer
  exists until the account holder restores hosting.
- **Two of the cheats above are protocol-level:** hand displacement (§8.1) and the information leak
  (§8.2). Both are server fixes.
- **Voice proximity cannot be enforced** on a mesh. A modified client can hear past 22 m. Enforcing
  it needs an SFU.
- **TURN is configured but not deployed.** Players behind carrier NAT cannot hear each other.
- **Parties live in memory** and are lost on a server restart.
- **One region and one process.** Per room, 32 players cost 1.8 % of a core and 6.4 KB/s per client.
  Rooms per box are unmeasured.
- **TCP head-of-line blocking.** WebSocket over Wi-Fi in a headset will stall interpolation on a
  lost packet. The protocol is transport-agnostic, and a WebRTC data channel is the documented
  escape hatch. Measure on a headset before choosing it.

## 11. Art and animation limitations

**Animals**
- 3,900 triangles each, **untextured**. Colour comes from per-face rules painted in Blender
  (`_paint_source`).
- No normal maps, no detail textures, no LODs.
- The source Meshy sculpts are previews (geometry only).

**Gaits**
- The hopper's run is a real bound.
- Every other gait is sine-driven, with no constant-velocity stance, so foot slip is real and
  unmeasurable (CLAUDE.md).
- The raptor keeps the old run.
- There is no runtime foot IK on terrain and no facial animation.

**Props and surfaces**
- 47 Meshy previews, untextured.
- Photo surfaces are 512².

**Assets that cannot be used**
- Unreal/Fab-Standard and Unity Asset Store content: a web build serves raw, extractable files
  (CLAUDE.md, "Asset licences").

**Meshy account (read-only balance check for this audit): 2,020 credits.** Prices from Meshy's API
pricing page today:

| operation | credits |
| --- | --- |
| text-to-3D preview | 20 |
| refine (texturing), 2K/4K | 10 |
| refine, 8K | 15 |
| retexture | 10 |
| remesh | 5 |
| auto-rig | 5 |

Texturing all 16 animals at 4K from their existing preview tasks is ≈ 160 credits. Retexturing the
47 props is ≈ 470. The budget is not the constraint; the GPU is.

## 12. Highest-value improvements, and the highest risks

### The five highest-impact improvements

1. **A HUD a headset player can see.** `HudModel` + wrist panel (§5.1, §6). Today VR plays every
   mode blind to time, score and ammunition.
2. **Close the two measured cheats on the server.**
   - Bound hand displacement per tick to a human limit (§8.1).
   - Interest management by line of sight in modes about hiding (§8.2).

   These are deterministic fixes. They come *before* any statistical "AI" detection, because a
   detector cannot see a wallhack that leaves nothing on the server.
3. **Ask each headset for its real display rate** (`DisplayClock`, §5.2). Hold 90 Hz on a Quest that
   can, and stop judging a 120 Hz Index against 72.
4. **A texture pipeline that can carry real detail.**
   - Meshy refine at 4K as the *source*.
   - Baked down in Blender onto the existing rigs.
   - Shipped as KTX2 (Basis) at **1K on Quest, 2K on PC/PCVR high, 4K only for the hero kangaroo
     on PC ultra**.
   - With LODs.

   This is how "realism" fits a frame budget. The transcoder ships in `three/examples`, so it needs
   no new npm dependency.
5. **Crossplay decided by measurement, not opinion.** The punch probe already shows honest PC and VR
   within 10 % in Boxing. Measure speed, turning and chase outcomes the same way before choosing
   among the directive's options A–D.

### The five highest technical risks

1. **VR has never run on a headset.** Every comfort, frame-rate and hand claim is unit-tested against
   a stub. One hardware pass can invalidate months of assumptions, so it should come early, not
   last.
2. **The Quest frame budget.** It is already near Meta's guidance at today's art, and every realism
   request spends from it.
3. **No hosted server, and the release identity is undecided.** Every multiplayer and Quest-store
   step waits on the account holder: hosting, a domain, and then a permanent package id.
4. **Electron without WebXR.** The PCVR path depends on Chrome/Edge being installed, and on SteamVR's
   OpenXR runtime being active. Neither has been tested.
5. **Content licences.** Web delivery makes every file extractable.
   - Recorded sound needs a paid ElevenLabs plan for commercial use.
   - Meshy free-tier output is CC BY 4.0 and must be credited.
   - Unreal/Fab-Standard assets cannot ship at all.

## 13. How the numbers in this audit were taken

- **Punch probe** (`.probe/punch.ts`, untracked; re-run reproduces the table exactly).
  - Setup: two players in `boxing` on `jungle-world`, re-placed 0.7 m apart every tick, victim
    health restored every tick.
  - Measure: the `punchHit` events credited to the attacker and the health lost, over 1,200 ticks.
  - The spoof alternates a tracked hand between local `z = 0.7` and `z = −0.5` every tick at a
    chosen height. Heights were swept to prove the variable is live (0 / body / head).
- **Sightline probe** (`.probe/leak.ts`, untracked like the other probes).
  - Setup: six `Bot`s per round in `hunt`, 4 seeds × 90 s per map, sampled once a second while the
    round is `playing`.
  - Measure: `captureViewOf(...).others[i].visible` (a physics ray, head to head) for every hunter
    and survivor pair.
- **Meshy.** One read-only call to `/openapi/v1/balance`, with the key held only in the
  environment of that one command.
- **Code facts.** Everything else cites the file and line it was read from.
