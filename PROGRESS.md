# Kangaroo Chase — PROGRESS

Session log for the scheduled routine. Newest first. `TODO.md` / `ROADMAP.md` remain the
status of record; this file is the hand-off between sessions.

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
