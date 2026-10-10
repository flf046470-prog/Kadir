# Kangaroo Chase — PROGRESS

Session log for the scheduled routine. Newest first. `TODO.md` / `ROADMAP.md` remain the
status of record; this file is the hand-off between sessions.

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
