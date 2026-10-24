# Kangaroo Chase — Roadmap

Phases are ordered by dependency, not by visibility. A phase is "done" only when
`npm run verify` (lint + typecheck + tests + build) passes with the phase's features working.

## Milestone A — Playable MVP (this repository's target)

| Phase | Scope | Exit criteria |
| --- | --- | --- |
| 1 | Project architecture, math, physics, input abstraction, player state | Capsule controller resolves against level geometry; unit tests green |
| 2 | Locomotion: PC, Mobile, VR intents into one movement system | Same `Simulation` produces the same motion from three intent sources |
| 3 | VR hand physics, climbing, jumping | Push-off, haul-up, swing-and-launch all reachable; momentum conserved |
| 4 | Jungle map (Jungle / Cave / Canyon) | Traversable, multi-route, grips + checkpoints indexed |
| 5 | Multiplayer: authoritative server, prediction, interpolation, delta snapshots | 16 bots in a room under bandwidth budget; reconciliation test green |
| 6 | Kangaroo Chase mode | Round timer, chaser handover, scores, winner |
| 7 | Infection mode | Last survivor wins |
| 8 | VR Boxing mode | Velocity-based punches, stamina, knockback, platform-adapted controls |
| 9 | Parkour mode | Checkpoints, personal best, world best |
| 10 | Lobby (social space + private rooms) | Room codes, mode voting, customisation area |
| 11 | Animals (6 launch animals, data-driven) | Fairness clamp enforced by test |
| 12 | Cosmetics | Slots, equip validation, no gameplay effect |
| 13 | Store | Empty by design — the game is free; the verified-purchase machinery is retained |
| 14 | Economy | Earn by playing; wins/playtime/records |
| 15 | Daily rewards | 7-day cycle, server clock |
| 16 | Achievements | Progress from server-observed match results |
| 17 | Private rooms | KANG-XXXX codes, invite, public/private |
| 18 | Voice chat | WebRTC signalling + spatial gain + mute/block |
| 19 | Events / seasons | Date-driven activation; both reward tracks are free |
| 20 | Optimisation | Quality tiers, pooling, interest management, bandwidth |
| 21 | QA | Unit + integration coverage of every system above |
| 22 | Release prep | Build pipeline, store shells, privacy/analytics posture |

## Milestone B — Content & retention (post-MVP)

* Animals: Lion, Bear, Panda, Raccoon, Deer, Koala, Shark, Raptor, Dragon — shipped, all sixteen sculpted (`CLAUDE.md`).
* Maps: Waterfall, Tree Village, Cliff, Ruins sections; second world.
* Modes: Hide & Seek, Bomb Tag, Team Chase, Escape, Boss. (Hunt, King of the Hill and Roo Ball shipped.)
* Friends and parties — shipped (see `TODO.md`); friend codes and cross-server presence are next.
* Ranked mode, tournaments, global leaderboards with anti-cheat review.
* Community map format + curation pipeline.

## Milestone C — Live operations

* Seasonal cadence (8 weeks), event calendar, telemetry-driven balance passes.
* Moderation tooling: report queue, kick/ban, chat/voice review.
* Region-sharded matchmaking, dedicated room servers, save persistence in a managed database.

## The next twelve months (October 2026 – September 2027)

Revised 2026-10-16, replacing the plan of 2026-10-03. Its first quarter's code is done: a PC build
plays on a hosted server and falls back to the one it carries (`check:crossplay`), and the glacier
wedge is fixed. Everything else on that plan waited on the account holder, so the scheduled sessions
reported "nothing safe left to do" while most of `docs/ULTIMATE_EDITION_ROADMAP.md` (Phases 2–15)
was untouched. This plan therefore runs on **two tracks**.

- **Track A** is engineering any session can do with no account, key or hardware. It is ordered.
  A session takes the first unticked item, finishes it to its exit test, ticks it here and records
  it in `PROGRESS.md`.
- **Track B** is what only the account holder can do. Each item has the month it is needed by,
  because the store dates further down depend on it.

The rules in `CLAUDE.md` apply to every item: measure before and after, run `npm run verify` before
every commit, mutation-test every fix, and update `CLAUDE.md`. An item is ticked when its exit test
passes. Writing the code does not tick it.

### Track A: engineering, in order

**October–November 2026: finish what is open, then measure the two platforms against each other**

- [x] **A1. Water fights the ground.** The outback creek's top (y −15) was coplanar with the bed under
  it on 96 % of its area. Done: the creek runs in a channel 0.3 m deep (outback `version` 7), and
  water wins depth ties in the renderer. The ground probe now reports the higher of two equally
  flat surfaces, so the water is the ground in every pool (before, in three of the four, players
  stood on the floor under it). `levels.test.ts` refuses an authored solid in a pool's plane.
  Measured: 0 coplanar samples; bots byte-identical on all three maps, because friction acts only
  on a released stick.
- [x] **A2. Planted strides for every walking animal.** Done: median planted-foot slip 0.01–0.09 m/s
  from 1.5 to 7.2 m/s on every walking animal, 0–7 mm a stance up to the 9.7 m/s sprint, cadence at
  most 3.7 strides/s, and the runs have footfalls (`Avatar.gait.test.ts`; `CLAUDE.md`, "Planted
  strides"). Left over: short-legged animals land at about body speed at a sprint, which needs a
  draw-back like the bound's.
- [x] **A2a. Arm locomotion against the Gorilla Tag lab's P0 gates.** Done: a hand that moves faster
  than a hand can (12 m/s, or carried by a snap turn) is a pose jump that re-grips and moves nobody;
  grabs anchor where the hand closed; letting go keeps the last 100 ms of pull. Measured: a 0.5 m
  tracking jump threw a player 19 m up, now nothing; a snap turn lurched 22.9 m/s, now 0; a spoofed
  hand travelled 17.3 m/s along a wall, now at most 9.1; release speed across 72–144 Hz within 10 %
  (was up to 42 %). Not met: the lab's 5 % (needs pose interpolation to the tick) and room-scale head
  penetration (needs a device). `CLAUDE.md`, "A hand that jumps is not a pull".
- [ ] **A3. PC against VR movement, measured** (Phase 2). Sustained ground speed, turn rate under
  pursuit, climb rate and chase outcome, with bots and synthetic VR intents. Gamepad dead zones and
  curves. Exit: a table in `docs/PERFORMANCE_BUDGETS.md`, every gap with its number.
  *Under way (2026-10-24).* Measuring it found the ground braking nobody who kept steering, and air
  strafing worth 17.3 m/s of progress against a 9.6 m/s sprint on a keyboard. Both fixed, with the
  bots' wall response and a wall pad that sealed the jungle trench (CLAUDE.md, "The ground held
  nobody to a speed"). Left: the VR "magnet grab" (`VRInput` sends Grab bits in arms-first, so the
  assisted climb holds a headset player on a wall the hand is not touching: 0 m fall in 2 s against
  6 m), gamepad radial dead zone and curve, climb rate, chase outcome against VR-shaped bots, and
  the table.
- [ ] **A4. The third-person camera's occlusion** (Phase 3). Measure the share of frames with
  geometry between the camera and the player; add pull-in or fade if that share is material; lock-on
  framing for Boxing. Exit: the occlusion share before and after.
- [ ] **A5. VR forearms** (Phase 3). Forearms by IK from the tracked hands, so climbing shows arms
  rather than floating fists. Exit: a forearm in a headset-camera render; a test on the IK.

**December 2026: the chase itself**

- [ ] **A6. Time to first sighting, per map** (Phase 4), via `captureView`. Tag feedback across the
  HUD, audio, haptics and effects. And water. It is the slipperiest footing in the game (friction 0.3,
  ice is 0.35) and changes no one's speed, while the outback's design always meant its creek to slow
  you. Wading as a speed cap, against water as it is, measured on the jungle river, which is the main
  case. Exit: the density figures in `CLAUDE.md` ("Map density") held or
  improved on all three maps.
- [ ] **A7. Bots where they are weak** (Phase 5). The outback scree, the canyon ramp corner, and the
  glacier's rare chases (about 1.7 a round). Exit: stuck share and chases per round, 6 bots × 16
  seeds, before and after.
- [ ] **A8. Privacy policy text**, written against what `packages/server/src/` actually stores, in
  `docs/PRIVACY.md`. Hosting it at a URL is B4. Exit: every stored field listed, each cited by file.

**January 2027: the graphics foundation** (Phase 8)

- [ ] **A9. KTX2/Basis textures.** The transcoder ships in `three/examples`, so no new dependency.
  Exit: texture memory per tier, measured in a browser.
- [ ] **A10. Mesh LODs** from the Blender pipeline, for animals and props. Exit: triangles per frame
  at each tier, and Quest stereo ≤ 1 M triangles.
- [ ] **A11. Baked ambient occlusion** for static level geometry, the contact shadow the headset
  tier has none of. Exit: a fixed-camera A/B per map; the frame cost measured.
- [ ] **A12. 1K photographed surfaces at the high tier only**, through KTX2. Exit: an A/B at eye
  height; texture memory within the tier table.

**February 2027: animals that look like animals**

- [ ] **A13. Textured animals** (Phase 5). Meshy refine at 4K on the 16 existing preview tasks,
  about 160 credits, baked in Blender onto the existing 3,900-triangle rigs (base colour and
  normal), shipped at 1K on a headset and 2K on PC high. The rule painter stays as the fallback.
  Needs B2. Exit: the `animal-geometry`, `animal-orientation` and `animal-motion` tests pass on all
  16; VRAM per tier measured.
- [ ] **A14. Grip kinds made real or deleted** (Phase 7). `GripKind` is inert data today: branch
  sway and vine swing, or remove the field. Exit: a test on whichever is chosen.

**March–April 2027: the flagship map grows** (Phase 6)

- [ ] **A15. Jungle Valley, part one: the waterfall and the tree village**, with the existing
  builders (`terrain`/`sculpt`, `fallenLog`, `enclose`, `ramp`) and the jungle `version` bumped.
- [ ] **A16. Jungle Valley, part two: the cliff and the ruins**, dressed with Meshy hero props
  (about 30 credits a prop; needs B2).
- Exit for both: with 6 bots × 16 seeds, 0 kill-plane falls, stuck share ≤ 7.8 %, every new zone
  reached, and the headset stereo budget held.
- [ ] **A17. Music that knows how close the threat is** (Phase 9). Intensity layers driven by the
  distance to the chaser, on the existing score. Exit: a unit test on the layer curve; a browser
  measurement of the voices playing.

**May 2027: the server under load, and cheating** (Phase 12)

- [ ] **A18. Statistical cheat detection.** Per-player, per-round features on the server: hand
  trajectories, punch-speed distribution, tick timing, reaction to a target becoming visible, and
  movement entropy. A small model in the server process, trained on bots (honest) and the probes
  (synthetic cheaters). Flags go to the existing moderator queue, and nothing is banned by the model
  alone. Exit: precision and recall on held-out synthetic cheats, and the false-flag rate on bot
  rounds.
- [ ] **A19. Rooms per box**, load-tested locally against the built server. Exit: the number,
  written in `CLAUDE.md` beside the per-room figures.
- [ ] **A20. The crossplay decision**, from A3's numbers and the Boxing probe (options A–D in the
  Ultimate Edition roadmap). Exit: a measured recommendation in that file.
- [ ] **A21. The Next Fest demo build**: Kangaroo Chase, Roo Ball and the Training Room on one map,
  behind a build flag. Exit: `check:smoke` against the demo build.

**June 2027: the opening** (Phase 10)

- [ ] **A22. The PC cinematic and the VR-safe opening**, played by the real `Simulation` with bots
  and filmed with the trailer's frame-stepping clock; cuts are fades in VR. Exit: a PC capture, and
  a VR comfort checklist in `docs/QA_VR.md`.

**July 2027: progression, social, language** (Phases 11 and 14)

- [ ] **A23. Weekly challenges, friend codes, and push instead of the 5 s friends poll.** Nothing is
  sold. Exit: tests on each; the poll's request rate before and after.
- [ ] **A24. Translations, Turkish first**, with `Settings.locale` back only now that there is a
  system for it to configure; the joystick ring follows `joystickSize`. Exit: every UI string comes
  from the table, and a test refuses a string that does not.

**August–September 2027: release candidate** (Phase 15)

- [ ] **A25. `docs/QA_PC.md` and `docs/QA_VR.md` as runnable checklists**, with every check that can
  run in CI running there.
- [ ] **A26. Season 2**: cosmetics earned, never bought, on the 8-week cadence of Milestone C.
- [ ] **A27. Guard in Boxing** (from the Meta store reviews, `docs/META_STORE_RESEARCH.md` §1).
  Gloves raised in front of the head absorb most of a punch that meets them. Exit: a jab into a
  raised guard lands a fraction of one into an open face, a test on it, and an answer for PC and
  mobile players, who have no hands to raise.
- [ ] **A28. Repeated targeting** (§2). How often one player is the target of the same chaser or
  hunter round after round, measured with bots; a rule only if the number is material.
- [ ] **A29. Prey that fights back** (§6). Runner distance covered with a chaser within 15 m, with and
  without gadgets, in Kangaroo Chase and Infection: does a freeze gun turn running into camping?
- [ ] **A30. "Can't get in"** (§7). What a browser and a Quest player see when the server is down, a
  room is full or the protocol differs — a clear message for each, checked by a probe.

### Track B: the account holder, by month

| when | item | blocks |
| --- | --- | --- |
| now | **B1. GitHub access for this repository.** Pushes return 403 ("Claude doesn't have GitHub access to flf046470-prog/Kadir"). Install the Claude GitHub App at https://github.com/apps/claude/installations/select_target, or re-link it from https://claude.ai/customize/connectors?auth_start=github&auth_start_force=1. | every push, including the scheduled sessions' |
| now | **B2. `MESHY_API_KEY` as an environment secret**, and rotate both keys pasted in chat. | A13, A16 |
| now | **B3. One scheduled routine, not two.** "Kangaroo Chase" (hourly, :15) failed on 2026-10-16 with the usage limit reached. "derinlik oyun" (hourly, :03) sends only "devam et" to a fresh session, which has no context to continue, and its last run finished in 26 s. Keep one routine with the full prompt, every 3–4 hours, so a run has the time to finish an item. | the whole of Track A |
| November | **B4. Hosting** (Railway plan or another container host), then the **domain**, which fixes the Android package id for good (`CLAUDE.md`: "Release identity is one irreversible decision"), then the privacy policy at a URL (A8). | crossplay online, Coming Soon pages, the Quest app |
| December | **B5. Steamworks and Epic developer accounts**, the two $100 fees, tax and bank forms; then the Coming Soon pages from `pack:pc:listing`, `pack:trailer` and `docs/PC_LISTINGS.md`. Release date "To be announced". | every store date below |
| Q1 2027 | **B6. Hardware**: one headset (Quest 3, or PC VR through SteamVR) and two or three Windows PCs, for a hardware pass (Phase 13) and measured system requirements. Code signing for Windows. | ticking "VR Supported"; a SmartScreen-clean installer |
| when the domain exists | **B8. An appeal contact** for bans, at a URL the ban message can name (`docs/META_STORE_RESEARCH.md` §4). | fair bans |
| Q2 2027 | **B7. Decisions**: free-to-play or paid; a paid ElevenLabs plan for the recorded effects, or synthesis only; the IARC rating; TURN for voice (`KC_TURN_URLS`/`KC_TURN_SECRET`). | Next Fest, Early Access |

### The store dates, if Track B keeps up

- **December 2026**: Coming Soon on Steam and Epic (needs B4 and B5). Steam reviews a page at least
  seven business days before it goes up.
- **Q1 2027**: a closed Steam Playtest after the hardware pass (B6). February's Next Fest is
  skipped: a demo nobody can play together is worse than none.
- **June 2027**: Steam Next Fest with the A21 demo, after load testing (A19) and TURN (B7).
- **Q3 2027**: Early Access on Steam and Epic on the same day, sharing one server, with the
  release-date page public at least two weeks before.

If Track B slips, Track A does not stop. It runs in order, and the store dates move with Track B.

### What this plan does not do

- No money in the game in year one. `LAUNCH_STORE` is empty, and `validateCatalog` refuses a
  priced item at boot. Revisiting that is a decision (B7), not a roadmap item.
- No Quest Store submission in this window. The TWA needs the same origin and identity as B4, and
  Meta's review is its own project. It follows the PC release, not the other way round.
- No Capacitor shell for Google Play or the App Store, and no region sharding. Both wait until
  the PC release shows the numbers that would justify them.
- No Unreal and no engine change. The reasons are in `docs/ULTIMATE_EDITION_ROADMAP.md`.

## Non-goals (deliberate)

* Loot boxes, gacha, randomised paid rewards, pay-to-win stats.
* Photoreal rendering — the art direction is stylised for readability and frame budget.
* Per-platform gameplay forks.
