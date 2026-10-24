# Kangaroo Chase — PC + VR Ultimate Edition: roadmap

Companion to `docs/ULTIMATE_EDITION_AUDIT.md`. The phases are the directive's (0–15). The scope
inside each one is set by what the audit measured, not by what a generic game would need.

Sizes:

| size | meaning |
| --- | --- |
| **SMALL** | days; one module; existing tests extend |
| **MEDIUM** | one to two weeks; a few modules; new tests and one new probe |
| **LARGE** | weeks; crosses packages or needs new art |
| **VERY LARGE** | a month or more, or blocked on hardware/accounts nothing here controls |

A phase is done when `npm run verify` exits 0 and its exit criteria are met. The criteria are
numbers a probe or a test prints, not "looks better".

---

## Proposed architecture: one core, two presentation layers

```
                 ┌────────────────────── @kc/core (unchanged contract) ──────────────────────┐
 InputIntent ──▶ │ Simulation · physics · modes · combat · bots · progression · content      │ ──▶ Snapshot / SimEvents
                 └────────────────────────────────────────────────────────────────────────────┘
                         ▲ server runs it authoritatively; client runs it for prediction/practice

 @kc/client
   shared:    Renderer · LevelRenderer · Avatar · Effects · Audio · HudModel* · CameraDirector* · DisplayClock*
   PC layer:  PCInput · third-person camera · DOM HUD · cinematic camera shots · post-processing
   VR layer:  VRInput · rig/comfort · wrist HUD* · world menus · comfort-safe cinematic · stereo budget
                                                                     (* = new in this plan)
```

The rule is the one `ARCHITECTURE.md` already states, made concrete for the two gaps the audit
found:

- **What a player knows** is computed once, in `HudModel`, from the simulation, and drawn twice: as
  DOM on PC and mobile, as a wrist panel in VR. Same shape as `VR_BINDINGS`: one table, two
  consumers, a test that holds them together.
- **What the camera does** is decided once, in `CameraDirector`, from a shot list.
  - On PC it is shown as camera motion.
  - In VR it is shown as fades between fixed vantage points; the head is never moved by the game.
  - The shot list is played by the real `Simulation` with bots, so the opening can only show moves
    the player can make.
- **What a frame may cost** comes from `DisplayClock`: the headset's actual refresh rate, or the
  platform floor. The governor already takes `floorFps`; only the source changes.

Gameplay stays in `@kc/core` and is never forked per platform. Platform differences that are
fairness questions, such as VR hands, are settled on the server by measurement (Phase 12).

---

## Phases

### Phase 0 — Full repository audit · **SMALL** · done

`docs/ULTIMATE_EDITION_AUDIT.md`. Four new measurements:
- a 2.8× punch exploit;
- a 56–77 % hidden-player information leak in the Hunt;
- every headset judged against 72 Hz;
- no HUD in VR.

### Phase 1 — Critical bugs and architecture preparation · **MEDIUM**

Scope, in order:

1. **Hand displacement bound.** On the server path, cap each tracked hand's movement per tick
   relative to the body at a human limit (≈ 15 m/s, i.e. 0.25 m per tick).
   - The existing `posed` snap-on-respawn stays.
   - Exit: `.probe/punch.ts` spoof falls from 34.8 dps to within 15 % of honest VR (12.5). Honest
     VR and the PC rows unchanged.
   - Mutation-tested.
2. **Line-of-sight interest management** for modes that declare `hidesPlayers`. Hunt first.
   - A survivor the hunter cannot see is not sent, or is sent as a coarse last-known position.
   - The rule is the mode's to declare, not a per-platform hack.
   - Exit: `.probe/leak.ts` shows the share of hidden survivors *sent* falls from 56–77 % to the
     share inside a small grace radius.
   - Bandwidth re-measured against the < 70 B idle-frame budget.
3. **`DisplayClock`.**
   - Read `XRSession.frameRate`/`supportedFrameRates` where present, and ask for 90 Hz on a Quest
     that offers it.
   - Otherwise derive the rate from the measured XR frame interval.
   - Exit: unit tests on a stubbed session at 72/90/120. Governor thresholds follow.
4. **`HudModel` extracted** from `Hud.ts`, with no visible change on PC.
   - Exit: existing HUD tests pass through the model.
   - A coverage test refuses a HUD field with no VR consumer — the same pattern as
     `event-coverage.test.ts`.
5. **Document drift.** Fix `TODO.md`, `ARCHITECTURE.md` §2.3 and §8. Split `CLAUDE.md` into an
   index and topic files with no line lost.

### Phase 2 — Core kangaroo movement · PC controller · VR locomotion · **MEDIUM**

The movement is already tuned and measured (CLAUDE.md "Locomotion feel"); do not retune by feel.

- **Measure PC vs VR**, in the directive's terms, with bots and synthetic VR intents:
  - sustained ground speed;
  - turn rate under pursuit;
  - climb rate;
  - chase outcome.
- **Gamepad.** Verify dead zones and response curves on PC.
- **VR arms-first locomotion.** Measure for comfort on hardware (Phase 13 gate).

Exit: a table in `docs/PERFORMANCE_BUDGETS.md` or `docs/QA_VR.md` stating each gap with its number.

### Phase 3 — Third-person PC camera · VR body/presence · **MEDIUM**

- **PC camera:**
  - measure occlusion — the share of frames where geometry sits between camera and player;
  - add pull-in or fade if that share is material;
  - lock-on framing for Boxing.
- **VR presence:**
  - forearms driven from the tracked hands by IK, so climbing shows arms, not floating fists;
  - the body is kept hidden, as `setFirstPerson` already does for good reason.

Exit: occlusion share before and after; a forearm visible in a headset render.

### Phase 4 — Kangaroo Chase gameplay polish · **MEDIUM**

- Readability of the chaser at distance: ring size already encodes role.
- Measure the time-to-first-sighting per map, since `captureView` exists.
- Tag feedback across HUD, audio, haptics and FX.

Exit: the "median distance to nearest player" and "close and in sight" figures from CLAUDE.md held
or improved on all three maps.

### Phase 5 — AI + animals · **LARGE**

- **Bots.** The outback scree and the canyon ramp corner are known weak spots; fix them with the
  existing `routeOut`/exit machinery.
- **Animal textures** (owner asked for realism):
  - Meshy *refine* at 4K on the 16 existing preview tasks: ≈ 160 of 2,020 credits.
  - Baked in Blender from the high-poly sculpt onto the existing 3,900-triangle rigs: base colour
    and normal.
  - Shipped through the Phase 8 KTX2 pipeline: 1K on Quest, 2K on PC/PCVR high.
  - The rule-based painter stays as the fallback.

Exit: 16 textured animals pass `animal-geometry`, `animal-orientation` and `animal-motion` tests,
plus a VRAM figure per tier.

### Phase 6 — Flagship Jungle Valley level · **VERY LARGE**

Grow `jungle-world` — it is already the flagship — rather than add a fourth map. Add the sections
Milestone B named: waterfall, tree village, cliff, ruins.

- **Built with the existing builders:**
  - `terrain`/`sculpt`;
  - `fallenLog`;
  - `enclose`;
  - `ramp`, which is now correct.
- **Dressed with Meshy hero props.** Text-to-3D preview plus refine is 30 credits a prop, so 30
  props ≈ 900 credits.
- **Version bump** per the Leaderboards rule.

Exit, measured with six bots × 16 seeds:
- 0 kill-plane falls;
- stuck share ≤ today's 7.8 %;
- every new zone reached;
- the Quest stereo budget held.

### Phase 7 — Animation + environmental interaction · **LARGE**

- **Gaits.** Give non-hopper gaits a real stance phase, which makes foot slip measurable and then
  fixable. Do the raptor's run.
- **Foot IK** on terrain for remote avatars.
- **Grip kinds.** Make `GripKind` real (branch sway, vine swing) or delete it. Today it is inert
  data (audit §7).

Exit: planted-foot slip per gait, the same method as `Avatar.bound.test.ts`.

### Phase 8 — Lighting + graphics + scalable visual system · **LARGE**

- **KTX2/Basis** texture pipeline. The transcoder ships in `three/examples`; no new npm dependency.
- **Mesh LODs** generated in the Blender pipeline.
- **Baked ambient occlusion** for static level geometry, or lightmaps where it pays.
- **Higher-resolution photo surfaces** on PC tiers only.
- **One tier table** per platform, written down in `docs/PERFORMANCE_BUDGETS.md` with before/after
  numbers.

Exit: per-tier draw calls, triangles and texture memory measured in a browser; Quest stereo
≤ 1 M triangles.

### Phase 9 — Audio + dynamic music + haptics · **MEDIUM**

- **Music** already composes bars as data and takes its mood from the local role. Add intensity
  layers driven by the distance to the threat.
- **ElevenLabs recordings** need a paid plan for commercial use (account). Synthesis stays as the
  fallback.
- **Haptics:** every event already has a pulse; tune the strengths on hardware.

### Phase 10 — PC cinematic opening · VR-safe opening · **LARGE**

- `CameraDirector` plus a shot list.
- The opening is played by the real `Simulation` with bots, so every move shown is a move the player
  can make.
- The trailer's frame-stepping clock (`timeControlSource`) already renders it deterministically.
- **VR:**
  - the same timeline seen from fixed vantage points;
  - cuts are fades;
  - no camera motion the player did not make.

Exit: a PC capture of the opening and a VR comfort checklist in `docs/QA_VR.md`.

### Phase 11 — Progression + social systems · **MEDIUM**

The loop is in place: XP, coins, achievements, Challenges, events, season track, coin shelf.

- Add weekly challenges that rotate play styles.
- Add friend codes, the known gap.
- Add a push channel instead of 5 s polling.
- Nothing is sold for money; `validateCatalog` stays.

### Phase 12 — Multiplayer hardening and crossplay testing · **LARGE**

- **Statistical cheat detection** (the "AI anti-cheat" the owner asked for). Built after Phase 1
  closes the holes a detector cannot see.
  - Per-player, per-round features computed on the server:
    - hand-trajectory statistics against the honest range;
    - punch speed distribution;
    - tick-timing regularity;
    - reaction time to a target becoming visible, which Phase 1 makes measurable;
    - movement entropy.
  - A small model scores the features **in the server process**.
  - Training data comes from bots (honest) and the probes (synthetic cheaters).
  - Flags go to the **existing moderator report queue**. Nothing is banned by the model alone.
  - Nothing here is an LLM, and nothing needs an API key — CLAUDE.md's rule stands.
  - Exit: precision/recall on held-out synthetic cheats; false-flag rate on bot rounds.
- **Crossplay decision (options A–D)** from Phase 2's numbers plus the Boxing probe.
  - Honest PC and VR are within 10 % in Boxing today.
  - The working recommendation is **A (full crossplay) for casual play, with D (separate
    competitive queues) only if ranked is added**. It is confirmed or overturned by measurement,
    not by this paragraph.
- **Hosting, TURN, load test.** Rooms per box, measured. Hosting is account-gated.

### Phase 13 — PC optimization · VR/Quest optimization · **VERY LARGE** (hardware-gated)

- **First real-headset pass, and move it as early as hardware allows** (audit risk 1). Quest
  standalone through the TWA or Quest Browser, plus PCVR through the Steam handoff, checking:
  - session entry;
  - 72/90 Hz hold;
  - GC pauses;
  - comfort;
  - haptics;
  - hands.
- **PC:** system requirements from two or three real Windows machines.
- **Multiview** only if the headset numbers demand it. It means moving off the classic
  `WebGLRenderer` and porting the triplanar shader patches (audit §5.5), so it is a decision, not a
  default.

### Phase 14 — UI/UX/settings/accessibility · **MEDIUM**

- The wrist HUD from Phase 1's `HudModel`, polished on hardware.
- **i18n**, with Turkish first. `Settings.locale` comes back only with a real translation system.
- The joystick ring size follows `joystickSize`.
- The colour-blind palette is already in place.

### Phase 15 — Full QA · bug fixing · release candidate · **LARGE**

- `docs/QA_PC.md` and `docs/QA_VR.md` as runnable checklists.
- Every check that can run in CI does.
- The release candidate waits on the account items:
  - hosting and domain;
  - a permanent package id;
  - store accounts and fees;
  - IARC;
  - a privacy policy URL.

---

## Owner questions answered

### Quest *and* PCVR

Both run the same WebXR client. There are no separate builds of the game.

- **Quest standalone:**
  - The Quest Browser can open the game's URL directly for testing, once a server is hosted
    again.
  - The TWA (`pack:quest`) is the store package. It needs the domain and a permanent package id
    first.
- **PCVR:** the Steam app hands off to Chrome/Edge, which drive SteamVR's OpenXR runtime.
- **What changes for the two:**
  - `DisplayClock` (Phase 1): 72/90/120 on Quest, 90–144 on PCVR.
  - Tier defaults: Quest medium-with-VR-clamps; PCVR high with shadows.
  - Hardware validation (Phase 13).

### "AI" against cheating

Yes — as statistical detection on the server (Phase 12), *after* the two measured holes are closed
deterministically (Phase 1). Order matters:

- No detector can see a wallhack the server never had to serve. Today 56–77 % of what a hunter is
  sent is information they could not see.
- A server-side bound beats any classifier for the hand exploit (2.8× damage).

### 4K models with Meshy

Generate at 4K as the **source**; ship by tier.

- **The arithmetic** (audit §9): a 4K PBR set for every animal is ≈ 4.3 GB uncompressed, ≈ 1 GB
  even as ASTC. No headset holds that.
- **The plan:**
  - Meshy refine at 4K.
  - Blender bake onto the existing rigs, so every clip and socket keeps working.
  - KTX2 at 1K (Quest) / 2K (PC, PCVR high) / 4K (hero kangaroo, PC ultra).
  - LODs.
- **Credits:**

  | work | credits |
  | --- | --- |
  | 16 animals | ≈ 160 |
  | 47 props | ≈ 470 |
  | 30 new hero props for Jungle Valley | ≈ 900 |
  | **total** | ≈ 1,530 of the 2,020 available |

### Unreal for the maps

**Recommendation: no.**

- **Switching the game to Unreal** means rewriting 39 k lines and losing two things:
  - the shared TypeScript simulation, which the server runs;
  - browser and TWA delivery, which is how Quest and crossplay work today.
- **Using Unreal only as an editor and exporting glTF** brings the meshes across and leaves behind
  what makes Unreal look real: Lumen lighting, Nanite geometry, virtual shadow maps and landscape
  material layering. What survives is what Blender already produces.
- **Megascans/Fab Standard content** requires that end users be prevented from extracting it,
  which a web build cannot do (CLAUDE.md "Photographed skies").

The realism Unreal would bring is reached here through:
- textured Meshy hero assets;
- baked AO and lightmaps;
- KTX2;
- LODs;
- the existing HDRI and photo-surface pipeline.

---

## What this plan explicitly does NOT change

**Engine and simulation**
- **The engine.** Three.js and WebXR stay. No Unreal, no Unity, and no WebGPU/node-material
  migration unless Phase 13's headset numbers demand multiview.
- **The simulation and the intent boundary.** No per-platform gameplay, ever. No physics-engine
  swap: the custom solver is deterministic and identical on server and client.
- **The wire protocol,** except where a measured fix needs it. A version bump cuts stale PWA clients
  cleanly; that is fine, but it is not free.

**Fairness and licences**
- **The free-game rule:**
  - `validateCatalog` refuses any price;
  - cosmetics are cosmetic only;
  - animal feel is clamped to ±3 %.
- **The asset licence gates.** Only CC0/CC-BY/permissive content; Unity Asset Store, Synty and Fab
  Standard are refused by host.

**Comfort and performance**
- **Comfort defaults.**
  - The stick stays slower than arms-first locomotion.
  - Landings are not smoothed.
  - The game never moves a headset player's camera, cinematic or not.
- **The governor's arithmetic.** Only its floor's *source* changes (`DisplayClock`).

**Already measured — do not redo**
- Outback's station placement, glacier's scale, the sun angle, the punch-cue site. Each was
  measured and settled; CLAUDE.md says why.

## Decisions waiting for the owner before Phase 1

1. **Approve Phase 1's scope as listed**, or reorder it.
2. **"Realism" vs the stylised non-goal.** `ROADMAP.md` lists "photoreal rendering" as a non-goal,
   for readability and frame budget. The proposal: realistic *materials and animation* (textured
   animals, baked lighting, real gaits) with silhouettes kept readable — not photorealism.
3. **Meshy spend.** About 1,530 credits across Phases 5–6, in stages, each one rendered and checked
   before the next.
4. **The key.** The Meshy key pasted in chat must be **rotated**, and the new one set as the
   environment secret `MESHY_API_KEY`. It was used once, read-only, and written nowhere.
