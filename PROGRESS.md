# Kangaroo Chase — PROGRESS

Session log for the scheduled routine. Newest first. `TODO.md` / `ROADMAP.md` remain the
status of record; this file is the hand-off between sessions.

## 2026-10-31 — First person, bare hands, legless avatars

**Done:** first-person camera as the flat-screen default (P / Settings), placed fists drawn in first
person, crosshair; every avatar legless; bare-hand tracking fixed (palm position, pinch-or-fist grip,
no gadget on a pinch); the desktop simulator has bare hands (Y). CLAUDE.md → "First person, bare
hands, and no legs".

**Measured:** `check:xrsim` 33/33 (32/33 with the grip read back); 4 VRInput mutations caught;
FPV checked in a browser (screenshots in the session scratchpad).

**Next:** easter eggs.

## 2026-10-25 (evening) — CI red on 60c8f31: the world behind a menu

**Done:** `check:smoke` timed out in CI on the practice click (30 s, after "click action done").
Cause, measured: the main menu draws the whole world behind an 86–95 % opaque screen at full cost,
and Cage Fight's spawn facing turned that view towards the map's busy middle (frames 1.5 → 2.3 s in
swiftshader, the `setLook` line alone). A Playwright click waits on about ten frames. Under a menu
the world is drawn one frame in four now (`game/backdrop.ts`), never in a headset.

**Measured:** Playwright clicks, practice 22.5 → 7.6 s, leave match 21.1 → 4.7 s; `check:smoke`
exit 0 on all three viewports; two mutations of the rule each fail `backdrop.test.ts`.

**Next:** the owner's request — first-person view, hand tracking, the kangaroo's legs, easter eggs.

## 2026-10-25 (afternoon) — Cage Fight: team boxing in a cage (interactive, A31)

**Done:** mode `cage-fight`, 1v1 up to 4v4 in a steel cage on every map (`LevelBuilder.cage`,
`ArenaDef`, maps `version` 9, a tenth lobby door); chain-link fence (`render/Cage.ts`). Found on the
way and fixed:
- No spawn facing ever reached a PC or mobile player. It is a `placed` event now, and it calls
  `setLook`, which had no caller.
- Teleports flew the flat-screen camera across the map; they cut now.
- The fence vanished past ~40 m (alpha test against mip-averaged alpha); it is blended now.
- Ring-outs credited stale punches and played a self-knockout cue; both fixed.
- A cleared boulder could leave its rock prop behind; it goes with the boulder now.

CLAUDE.md → "Cage Fight".

**Measured:**
- Bots, 8 players, 2 rounds a map: 31 / 34 / 35 fights, 0 friendly hits, 0 fighter-ticks outside the
  fence.
- In a browser, the view against the cage: cageside 2.75 → 0.00 rad, a corner 2.90 → 0.15 rad.
- Fence pixels at 45 m: 0 → 5.9k.
- 21 core and 4 render mutations, each failing its own test.
- The `code-review` skill ran on the diff; 7 findings fixed, 1 false (roles do not carry over: every
  round is a new `Simulation`).

**Next:** A32 (the jungle's 83 collider-less boulder props), then A28; task #4 (the store kit) still
waits for a rebuild, since the copy now says 11 modes.

## 2026-10-25 — A27: a guard in Boxing (interactive)

**Done:** a glove on the line of a punch takes it (`combat.ts` → `guarded`, 20 % gets through);
`Buttons.Guard` for PC (E, pad left trigger) and mobile (GUARD button); VR hint. Found on the way
and fixed: button punches landed on the way back, a level one was always a head shot, the aim
jumped 13 cm in a tick looking up, grab-toggling landed 40.9 a second with no punch, and bots
boxed from inside each other. CLAUDE.md → "A glove in the way takes the punch".

**Measured:** jab 8.96 → 1.79 a second into raised VR gloves, same into a PC guard; hook and body
shot not blocked; bot Boxing 128 → 150 hits a round, 73 % → 49 % head. Thirteen mutations, each
failing its own test. `npm run verify` green.

**Next:** the owner's new request — team boxing (1v1–4v4) and a cage fight.

## 2026-10-24 (night) — left and right were swapped on every platform (interactive)

**Done:** the simulation's body "right" was the character's left. Fixed in `locomotion.ts` (the
axis, the stick-climb tangent, `stepAgainstBody`), `VRInput.toBodyLocal` and `Avatar`'s fallback
hands. CLAUDE.md → "Left and right were swapped on every platform".

**Measured:** against a three.js camera's own x axis (`handedness.test.ts`, 6 tests): D / stick
right -1.00 → +1.00 along the screen's right at seven yaws; stick climb -1.00 → right; each
procedural fist on its own shoulder; VR and procedural hands on one convention. `check:xrsim` gained
"D steps to the right of the screen", read from the drawn camera. Five mutations, each failing its
own test (the `stepAgainstBody` one survived 704 tests until a 600°/s head-turn test was added).
Kangaroo Chase with bots byte-identical; bot Boxing 111 → 109 hits a round over 32 seeds (noise).

**CI:** the browser job on `01904f7` failed `check:xrsim` 27/28 ("holding 2 moves the right hand":
-1.08 m). The cause was Playwright's default headless shell, which under pointer lock reports a 20 px
move as +860/-860 px. That reproduces here exactly (-1.08 m, 28/29). The check now launches the full
Chromium (`channel: 'chromium'`), which passes it here 29/29.

**Next session — first task:** unstash and finish A27 (guard in Boxing).

## 2026-10-24 (evening) — a desktop VR simulator, and the VR bugs it found (interactive)

**Asked:** a desktop VR simulator to test VR with a keyboard and mouse. The request named Godot; there
is no Godot project in this repository or any of the owner's (checked every branch and repo), so the
owner chose the WebXR equivalent for Kangaroo Chase.

**Done:** `?xrsim` installs IWER (`iwer@2.5.0`) as an emulated Quest 3; keys and the mouse drive the
head, both controllers, triggers, grips, sticks, a hand on its own, a jab and a duck
(`platform/vr/desktopXr.ts`, `desktopXrRuntime.ts`, `docs/DESKTOP_VR_SIMULATOR.md`,
`npm run play:xrsim`). Never over a real headset; IWER off the boot path and the precache. A failed
VR start is on screen with **Play on desktop** (`?platform=pc`) and **Back to VR**.

**Found and fixed:** the VR body faced backwards (the stick walked -1.00 along the view); VR head
height was measured from y = 0 (5.6 m in a 4 m pit); "Enter VR" covered "Got it". **Found, not yet
fixed:** strafing is mirrored on every platform (D moved -1.00 along the camera's right).

**Measured:** `check:xrsim` 28/28 in Chromium (swiftshader); unit tests `desktopXr.test.ts` (15),
VRInput head height (2) and body yaw (3), each fix mutation-tested.

**Left:** A27 (guard in Boxing) is in `git stash` with a patch backup, half done — its measurements
also found that button punches landed on the way back and grab toggles punched.

**Next session — first task:** fix the mirrored strafe in `@kc/core`, then unstash and finish A27.

## 2026-10-24 (later) — A3 done: the VR grab path, the gamepad sticks, and the table (interactive)

**Done:** `docs/PERFORMANCE_BUDGETS.md` is A3's table — ground speed, turning, climb rate and chase
outcome, PC against synthetic VR. Measuring it found four VR defects between the controller and the
simulation, all fixed: the magnet grab (arms-first sent the assisted climb Grab bits; a fist in
mid-air 1 m from a wall fell 0 m in 2 s, now 6 m), the gadget trigger closing the hand (60/60 →
0/60), grab sensitivity reaching no hand (now `shapeGrip`, 0.89–0.17), and water no arms-first
player could leave (0.00 m in 15 s in the jungle river → 22.6 m; a hand holds the floor under its
own feet). Gamepad sticks are radial with a rescale and a look curve (`platform/stick.ts`).

**Measured:** chase, 3 PC + 3 synthetic arms-first bots × 16 seeds × 90 s × 3 maps: VR chaser
share 20–26 % (fair 16.7 %), PC 7–13 %; VR catches PC less often than the reverse everywhere.
Tests: `VRInput.test.ts` (9), `stick.test.ts` (6), 3 gamepad tests, 4 comfort tests, 3 floor-hold
tests; 17 mutations, each caught by its own test.

**Left:** the chase gap is A20's to decide. Room-scale head penetration and a real headset pass
are still hardware-gated.

**Next session — first task:** Track A, A27 (a guard in Boxing).

## 2026-10-24 — A3 under way: the ground model and air strafing (interactive)

**Done:** the ground brakes the speed a held stick is not asking for (sprint end, empty stamina,
crouch and snare now slow a runner; 90° turns and weaving no longer add speed); stamina has a
5 → 25 breath gap, carried on the wire; steering never adds speed, on the ground or in the air
(air strafing gave 17.3 m/s of progress against a 9.6 m/s sprint). Bots slide along walls (both
roles), turn round in corners and keep their side between hops. `enclose` no longer pads walls onto
floor (it had sealed the jungle canyon trench). All three maps version 8.

**Measured:** six bots × 16 rounds: stuck 1.5 / 3.4 / 2.8 % (HEAD 3.6 / 6.1 / 3.9), 0 falls; Hunt
downs per round 4.21 / 3.96 / 3.96 (HEAD 3.67 / 2.67 / 4.13). 13 new tests; 18 mutations, each
caught by its own test. Details in `CLAUDE.md` ("The ground held nobody to a speed").

**Left of A3:** VR magnet grab, gamepad dead zones, climb rate, VR-bot chase outcome, the table in
`docs/PERFORMANCE_BUDGETS.md`.

**Then (same day): the Meta store research** the owner asked for — `docs/META_STORE_RESEARCH.md`,
eleven games, 55 ranked reviews and every histogram. Three defects it pointed at, measured and
fixed: VR boxing paid for flailing (32.8 → 4.9 damage/s, jabs unchanged, PC unchanged), a party of
three could auto-mute anyone in a room of twelve or fewer, and a timed ban gave no reason. Backlog
A27–A30 and B8.

**Next session — first task:** Track A, the rest of A3 (VR magnet grab first), then A27.

## 2026-10-18 — GitHub access back; A2 planted strides done (interactive)

**Pushed:** the five commits of 10-16 (surfaces, branches, the plan, A1), rebased over the 6th run's
note. GitHub access works again.

**A2 done:** every walking animal's planted foot moves 0.01–0.09 m/s (median) from 1.5 to 7.2 m/s,
a stance slides 0–7 mm up to the 9.7 m/s sprint, and the runs make footfalls. Generator:
three-axis leg solver (splay + foot turn), held only while a foot is down. Client:
`plantedBlend`, `plantedRate`, `advancePlanted`, robust `measureGait`. All sixteen models rebuilt.
`Avatar.gait.test.ts` (6 tests); 7 client and 2 generator mutations each caught. Details in
`CLAUDE.md` ("Planted strides").

**Left over:** short-legged animals land at about body speed at a sprint (needs a draw-back like
the bound's). Recorded in `ROADMAP.md` A2.

**Next session — first task:** Track A, item A3 (PC against VR movement, measured).

## 2026-10-17 (6th run) — still blocked on owner decisions (routine, docs-only)

**Checked:** branch `claude/kangaroo-chase-game-w62laa` is current at 01119e6; no new commits and no owner answer on PR #4 (only Vercel bot notices).
**Not run:** `npm run verify` (no code change).
**Next session — first task:** unchanged: owner approves/declines the CLAUDE.md split, glacier balance, per-grip feel spec, or hosting.

## 2026-10-16 — surfaces, branches, and a twelve-month plan with work in it (interactive)

**Done (committed, not pushed — pushes return 403, see B1):**
- 4bb36cb: ground stops tiling (`TRI_VARIED`), ice is clear sheets with fractures, frost in world
  space (`TRI_FROST`), and the ORM texture is read once.
- 7cffbd5: tree branches are drawn as oval boughs, trunks have twelve sides.
- `ROADMAP.md` → "The next twelve months" rewritten as two tracks. Track A is an ordered list
  (A1–A26) that needs no account; Track B is the account holder's, by month.
- `TODO.md` → "Next up" now points at Track A.

**Parked:** planted gaits (finished on 10-18, see above).

- A1 done: the creek runs in a channel; the ground probe reports the higher of two equally flat
  surfaces, so players stand in the water in every pool; water wins depth ties in the renderer.
  Details and measurements in `CLAUDE.md` ("Water sat in the plane of its bed").

**Next session — first task:** Track A, item A2 (planted strides).
"Blocked on the owner" applies to Track B only.

## 2026-10-11 (5th run) — still blocked on owner decisions (routine, docs-only)

**Checked:** branch `claude/kangaroo-chase-game-w62laa` is current at 8197a8f; no new commits since the 4th run.
Every remaining TODO "Next up" item is gated on the account holder or hardware (hosted server/domain, store pages,
headset pass, Capacitor). Per-grip feel changes the deterministic sim and needs a feel spec; the CLAUDE.md split
was refused by the permission classifier last run and was not retried.
**Not run:** `npm run verify` (no code change).
**Next session — first task:** owner answers one of: approve/decline the CLAUDE.md split, glacier balance,
per-grip feel spec, hosting. Until then nothing safe and useful is left to do autonomously.

## 2026-10-11 (4th run) — 1.5 CLAUDE.md split blocked by the permission classifier (routine)

**Done:** nothing changed in code. Verified branch `claude/kangaroo-chase-game-w62laa` is current at 95f6332.
**Blocked:** the planned first task (split CLAUDE.md, 2924 lines, into an index + `docs/memory/*.md`
with a "no line lost" check) was refused by the auto-mode classifier as self-modification of the
agent's own instruction file. It was not worked around. Plan if the owner approves: split by `## `
section into ~10 topic files, keep the preamble + Standing rules in CLAUDE.md, add an index, and
verify the multiset of non-blank lines is identical before/after.
**Not run:** `npm run verify` (docs-only).
**Next session — first task:** owner approves (or declines) the CLAUDE.md split; otherwise only
owner/hardware-gated items remain (glacier balance, per-grip feel spec, hosting, headset pass).

## 2026-10-11 (3rd run) — VR wrist HUD built from `HudModel` (routine)

**Done:** `ui/wristPanel.ts` (pure `wristLines(HudModel)`, `WRIST_FIELDS` / `WRIST_EXEMPT`),
`ui/VRWristHud.ts` (canvas quad on the left controller, redraws only when text changes), wired in
`main.ts` (`onModeState`; hidden on results). `wristPanel.test.ts` (5) is the coverage test: a
`HudModel` field in neither list fails it.
**Tests:** `npm run verify` exit 0 (typecheck, 1400 passed / 12 skipped, builds, hostile, shell).
**Not verified:** the panel has never been rendered on a headset or in an XR emulator; placement
(position/tilt on the wrist) is a guess and needs hardware.
**Next session — first task:** 1.5 split CLAUDE.md (2924 lines) with a "no line lost" check.

## 2026-10-11 (2nd run) — Phase 1.4 `HudModel` extracted (routine)

**Done:** `packages/client/src/ui/hudModel.ts` — pure `buildHudModel()` (headline, timer, role badge,
tally, local bout, scoreboard, charge, gadget strip, status) with no DOM. `Hud.ts` now only draws the
model (`drawTally`/`drawBout`/`drawGadgets`); visible output is unchanged by construction.
**Tests:** new `hudModel.test.ts` (7). `npm run typecheck` clean; `npm test` 1395 passed, 12 skipped
(before the final test-file typo fix; hudModel tests re-run green). Lint has only pre-existing warnings.
`npm run verify` (build/hostile/shell) not run this session.
**Not done in 1.4:** the VR wrist HUD consumer and the coverage test that refuses a model field with
no VR consumer (needs the wrist panel to exist first; same pattern as `event-coverage.test.ts`).
**Next session — first task:** build the VR wrist panel from `HudModel` (see `VRPanels.ts`), then add the
coverage test. Then 1.5: split CLAUDE.md (2924 lines) with a "no line lost" check.

## 2026-10-11 — Phase 1.5 document drift (routine)

**Done:** TODO.md (tests 1388, protocol 4, glacier crevasse wedge struck out as fixed in `version` 7);
ARCHITECTURE.md (hand-displacement cap in §2.3, headset-rate target in §8, Hunt line-of-sight in §5).
**Tests:** `npm run verify` green end to end (1388 passed, 12 skipped).
**Still open in Phase 1:** 1.4 `HudModel` + VR wrist HUD; 1.5 split of CLAUDE.md (2924 lines, needs a
"no line lost" check). Interactive session idle since 2026-10-10 18:08 UTC.
**Next session — first task:** 1.4 `HudModel` extraction from `Hud.ts` with a coverage test.

## 2026-10-10 — Ultimate Edition Phase 1 APPROVED by the owner, in progress (interactive session)

**The owner approved Phase 1 in full in the chat** ("Faz 1 hallet ... her şeyi şimdiden
onaylıyorum"). The approval was never on PR #4, which is why the routine runs kept reporting
"blocked". An interactive session is working through `docs/ULTIMATE_EDITION_ROADMAP.md` → Phase 1,
so do not start a parallel change to the same files.

**Done and pushed:**
- 698b898: turning no longer punches; a cheat's punch is capped at a human hand.
- 3f488f3: Hunt concealment by line of sight; far players no longer blink; a far newcomer is no
  longer drawn at the origin.

**In this commit:** the headset's real refresh rate reaches the frame governor
(`platform/vr/displayRate.ts`).

**Still to do in Phase 1:**
- 1.4: `HudModel` plus a VR wrist HUD.
- 1.5: document drift — TODO.md (protocol 4, test count, crevasse), ARCHITECTURE.md §2.3/§8, and
  splitting CLAUDE.md.

The glacier-balance and per-grip-feel questions are still open; they are not part of Phase 1.

## 2026-10-10 (10th run) — still blocked on owner (docs-only)

**Checked:** branch current at 698b898 (the punch-speed fix landed after the 9th-run note: turning no longer punches, cheat punch capped at `maxSpeed`). PR #4 still has only Vercel bot comments, no owner answer.
**Not run:** `npm run verify` (docs-only; dependencies not installed this run).
**Next session — first task:** owner answers one of: glacier balance, Ultimate Edition Phase 1 approval, per-grip feel spec, hosting. Until then only docs/test hygiene is safe.

## 2026-10-10 (9th run) — still blocked on owner; per-grip feel is not a small change (no code change)

**Checked:** branch current (2f3ecbc); PR #4 comments (30) contain only Vercel bot notices, no owner answer on glacier balance, Ultimate Edition Phase 1, or hosting.
**Finding:** the 8th run's fallback task (per-grip feel) is larger than assumed. `LevelDef.grips`/`GripKind` are never read by `physics/` or `player/locomotion.ts`; grabbing is keyed only on `SurfaceFlags.Climbable` (`isGrabbable`). Per-grip feel means a change to the deterministic sim (and likely prediction/reconcile tests and protocol), so it needs an owner decision on the intended feel, not an autonomous edit.
**Not run:** `npm run verify` (docs-only).
**Next session — first task:** owner answers one of: glacier balance, Phase 1 approval, per-grip feel spec. Without it, only low-risk work remains (docs/test hygiene).

## 2026-10-10 (8th run) — no safe autonomous task left; owner decisions needed (no code change)

**Checked:** branch `claude/kangaroo-chase-game-w62laa` at 393b5a5 is current; PR #4 has no owner
approval for Ultimate Edition Phase 1 (only Vercel bot + old comments). TODO.md "Next up" items 1, 2, 4, 5
all need the account holder, hardware, or a store account.

**Blocked on the owner (pick any to unblock):**
1. Glacier balance: smaller play area / fewer pillars / shorter tag immunity (runs 3-7 ruled out all bot causes).
2. Approve Ultimate Edition Phase 1 (`docs/ULTIMATE_EDITION_ROADMAP.md`).
3. Hosted server / domain (Railway trial ended 2026-09-22).

**Not run:** `npm run verify` (docs-only). **Next session — first task:** if the owner has answered 1 or 2, do that; otherwise implement per-grip feel (`GripKind` is read only by a test, see TODO "Known gaps") as a small, tested change.

## 2026-10-10 (7th run) — experiment: chaser awareness 80 m does not fix glacier (reverted)

**Done (measured, 6 seeds x 6 bots x 90 s, `measure-stuck.ts`)**
- Hypothesis: `pickTarget` awareness (18 + skill*32 m) makes chasers ignore distant stationary runners. Tried a flat 80 m for chasers.
- Result: glacier **14 -> 14** tags (unchanged), outback 97 -> 114 (+17 %), jungle 61 -> 62; stuck share +0.2..0.7 pt. Glacier is therefore not an awareness/target-selection problem. Reverted (outback gain is a balance change nobody asked for).
- Combined with runs 3-6: bot navigation, chaser speed, steering and target range are all ruled out for glacier; the cause is map balance (small shelf, tag immunity 2 s + 1.5 s).

**Not run:** `npm run verify` (no code change).

**Next session — first task:** needs an owner decision on glacier balance (smaller play area, fewer pillars, or shorter immunity). Without one, stop glacier bot work and pick another TODO.md item.

## 2026-10-10 (6th run) — seracs probe: near-misses are tag immunity, not ice slip (no code change)

**Done (measured, glacier-world, 6 seeds x 6 bots x 90 s, untracked `.probe/serac.ts`)**
- Logged chaser vs. runners standing in the seracs zone (x 24..38, z -16..-2) within 25 m: 3376 samples, 14 tags (baseline reproduced). Chaser closes the gap in 52 % of samples.
- Of the samples within 5 m, the largest buckets are runner `invulnTimer > 0` with the chaser busy (cooldown/immunity), i.e. just-tagged players, and both stationary. That is the tag-immunity rule working, not a steering failure.
- Only ~155 of 3376 samples (~5 %) are "runner vulnerable, chaser free, <5 m, same level (dy 0)". The ice-overshoot hypothesis is not supported: chasers are near and not sliding past.
- Many runners are stationary (speed 0) at 10-25 m while the chaser moves at 9-12 m/s: the shortage looks like runner/chaser distribution and immunity time (2 s victim + 1.5 s tagger) on a small shelf map, i.e. map balance, not bot navigation.

**Not run:** `npm run verify` (docs-only; no code changed).

**Next session — first task:** decide with the owner whether glacier needs a balance change (smaller play area, fewer pillars, or shorter immunity) before more bot work; if continuing on bots, sample why stationary runners at 10-25 m are not being approached (chaser target selection: is it chasing a different runner?).

## 2026-10-10 (5th run) — experiment: chaser `avoidObstacle` does not fix glacier tags (reverted)

**Done (measured, 6 seeds x 6 bots x 90 s, `measure-stuck.ts`)**
- Baseline reproduced exactly: glacier 14 tags / 6.6 % stuck, outback 97 / 4.1 %, jungle 61 / 6.8 %.
- Tried: run `avoidObstacle` (blocked-detour) for chasers that have a target too. Result: glacier **11** tags (stuck 6.6 -> 4.5 %), outback **87** (-10 %), jungle 65 (stuck 6.8 -> 7.4 %). Glacier tags did not rise and outback fell, so **reverted**; no code change committed.
- Conclusion: the glacier tag shortage is not chaser pillar-wedging. Remaining hypothesis: ice friction (0.35) means the chaser cannot close on prey that keeps moving on the seracs; may be map balance rather than bot navigation.

**Not run:** `npm run verify` (docs-only).

**Next session — first task:** log chaser target/velocity vs. prey while prey is in the seracs zone (x~30, z -12..-6) to see whether the chaser overshoots on ice (slip) rather than gets blocked; consider braking/lead-pursuit for chasers on low-friction surfaces. Success = glacier tags/90 s up from ~2 toward 6+ without lowering outback/jungle.

## 2026-10-10 (4th run) — glacier tag rarity: diagnosis only, no code change

**Done (measured, 6 seeds x 6 bots x 90 s, `.probe/` scripts untracked)**
- Tags: jungle 61, glacier **14**, outback 97. Chaser-to-nearest-runner distance: mean 16.7 / 14.1 / 11.5 m; share of chaser time within 4 m: 15 % / **7 %** / 30 %.
- Not a chaser-speed problem: chaser mean speed 11.7 / 10.8 / 13.3 m/s; slow (<1.5 m/s) share 2.6 % / 5.7 % / 2.8 %. Chasers are never dead.
- Slow chaser ticks on glacier cluster at x≈30, z -12..-6: the `seracs` zone (ice, friction 0.35, 12 m pillars ids 60/61/64/65, plus ledges at y≈12). Runners that reach the pillars keep >4 m from the chaser; the chaser does not close.
- `measure-stuck.ts glacier-world 8 90`: 5.9 % stuck, 24 % of it in cell (40,-8).

**Not done:** no behaviour change (no measured fix yet). `npm run verify` not run (docs-only).

**Next session — first task:** log chaser target + path state while a runner is inside the seracs zone (is the chaser's `routeOut`/target stuck on a pillar-blocked straight line?). Try pillar-aware chaser steering; success = glacier tags/90 s up from ~2-3 toward 6+ without lowering outback/jungle.

## 2026-10-10 (3rd run) — harness counts tags; chaser `routeOut` cleared

**Done**
- `scripts/measure-stuck.ts`: tag count was always 0 (`sim.events` is a `SimEventQueue`, not an array). Now drains the queue each tick and prints `tags N (per match)`.
- Measured (16 seeds x 6 bots x 90 s), chaser `routeOut` off vs on: outback 220 vs 213 tags, stuck 4.4 % both; jungle 231 vs 231, 7.1 % both; glacier 45 vs 45, 6.6 % both. The chaser change does not hurt tag rate (outback diff -3 %, within noise). No code change to `bot.ts`.
- New observation: **glacier-world has only ~2.8 tags per 90 s match** versus 13-14 on outback/jungle — chasing there is barely working (balance or navigation).

**Tests:** `tsc --noEmit` and oxlint on the script only; `npm run verify` not run (script-only change).

**Next session — first task:** find why glacier tags are ~5x rarer (measure-stuck by role/cell on glacier-world, check whether chasers fail on seracs/crevasse), then try the flee-steering wall-slide fix across all three maps.

## 2026-10-10 (2nd run) — gorge floor follow-up: measured, no code change

**Done**
- Re-ran `scripts/measure-stuck.ts outback-station 16 90`: **4.4 %** stuck (reproduces the previous run exactly; harness is deterministic). Dominant cells unchanged: gorge floor x≈-60 at z -8 / 8 / 28 (≈50 % of stuck), plus (48,-48).
- Experiment: `PIT_ESCAPE_SECONDS` 6 → 20 gave 4.4 % → 3.9 % only, same cells. Reverted — the gain is too small to justify a behaviour change without tag-balance data, so the cause is not "escape ends too early".
- Observed: the cells sit on the west face of the gorge east wall (x -59.5) beside the 12 m gap (|z|<6) that holds the exit ramp (foot (-68,-15,0)). They are runners pinned by flee steering, not bots failing to find the exit.
- **Harness bug found, not yet fixed:** `tags` in `scripts/measure-stuck.ts` is accumulated (line ~70, `sim.events?.filter`) but never printed, and may always be 0 if events are cleared inside `step()`. Tag counts before/after the chaser `routeOut` change therefore remain unmeasured.

**Not run:** `npm run verify` (docs-only change); no code changed.

**Next session — first task:** make the harness count tags correctly (check how `Simulation` exposes events per step), print them, then compare tag counts with/without the chaser `routeOut` change in `bot.ts`. After that, try a flee-steering fix: prey whose heading points into a wall within ~2 m slides along it toward the nearest exit instead of stopping (measure outback + jungle + glacier).

## 2026-10-10 — outback gorge: bots pinned against the wall

**Done**
- `scripts/measure-stuck.ts` (tracked): stuck share by role and 4 m cell, `npx tsx scripts/measure-stuck.ts <level-id> [seeds] [seconds]`. Refuses unknown level ids (`buildLevel` silently falls back to the jungle).
- Root cause (measured): 13.1 % of outback bot-seconds stuck, 81–86 % runners, nearly all on the gorge floor at x≈-60. The play-area leash aims at the map centre, which from the gorge floor is through the gorge wall; prey gets no obstacle detours. Also the gorge zone sphere does not cover the whole slot.
- Fix in `Bot` (`bot.ts`): `escapePit` — prey that makes <1.4 m in 1.2 s inside a pit heads for the zone's exit for 6 s, applied after the leash; `routeOut` now counts "in the pit" as below the exit top and within 1.4×radius of its foot; chasers with a target also use `routeOut`.
- Result (16 seeds × 6 bots × 90 s): outback **13.1 % → 4.4 %** stuck. Jungle 7.1 % and glacier 6.6 %: identical before/after.
- Regression test in `navigation.test.ts` (fails at 13.1 % without the fix, passes with it).
- `npm run verify` exit 0.

**Not done / still open:** remaining outback stuck cells at the gorge floor x≈-60 (z -8, 28, 8) and (48,-48); tag counts/balance not re-measured; Phase 1 of the Ultimate Edition still waits for the owner's approval (none found on PR #4).

**Next session — first task:** re-run the harness on the outback, find why the gorge-floor cells still read ~1 % each, and check tag counts before/after (chaser `routeOut` change).

## 2026-10-09 — Ultimate Edition Phase 0 (no gameplay change)

**Done**
- `docs/ULTIMATE_EDITION_AUDIT.md`: the owner's PC + VR directive, Phase 0. Four new measured
  findings:
  - a modified client punches 2.8× harder (`.probe/punch.ts`);
  - 56–77 % of the survivors a Hunt hunter is sent are out of sight (`.probe/leak.ts`);
  - every headset is judged against 72 Hz;
  - a headset player has no HUD.
- `docs/ULTIMATE_EDITION_ROADMAP.md`: phases 0–15 with sizes, the proposed architecture, and what
  not to change.
- `verify` exit 0, 1362 tests.

**The owner asked that Phase 1 not start without their approval.** Check the conversation or the
PR before starting gameplay work for the Ultimate Edition. The roadmap's Phase 1 list is the
proposed order once approved.

## 2026-10-09 — audit session (no gameplay change)

**Done**
- Verified the repo and dev branch `claude/kangaroo-chase-game-w62laa` (exists on origin, 440e031).
  The cloud session started on `ccr-4ec37d19-vo1q9y`, which holds an unrelated Next.js site;
  the game lives only on the kangaroo branch.
- Ran `npm ci` and `npm run verify` on a clean checkout: **exit 0**, 1362 tests passed
  (12 skipped), lint, asset/pack gates, typecheck, all three builds, `check:hostile`, `check:shell`.
  (TODO.md header still says 1088 tests; the counted figure is 1362.)
- Created this file.

**Not run:** `check:smoke` / `check:pwa` (need a Playwright browser download, forbidden by CLAUDE.md).

**Known gaps (unchanged, from TODO.md):** VR untested on hardware; no hosted server (Railway trial
ended 2026-09-22, needs the account holder); grips (`branch/ledge/vine/rock/root`) all climb
identically; outback bots ~16 % stuck bot-seconds, jungle ~8 %; no i18n; store accounts/domain.

**Next session — first task:** measure the outback bot-stuck share (the `.probe/stuck.ts`
harness is untracked, so write a tracked one under `tools/` first), find the dominant stuck
cell, and fix it with a `version` bump + before/after numbers. Fallback: per-grip-kind feel/highlight.

**Last commit:** see `git log -1` on the branch.
