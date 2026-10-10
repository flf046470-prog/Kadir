# Kangaroo Chase — PROGRESS

Session log for the scheduled routine. Newest first. `TODO.md` / `ROADMAP.md` remain the
status of record; this file is the hand-off between sessions.

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
