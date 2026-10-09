# Kangaroo Chase — PROGRESS

Session log for the scheduled routine. Newest first. `TODO.md` / `ROADMAP.md` remain the
status of record; this file is the hand-off between sessions.

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
