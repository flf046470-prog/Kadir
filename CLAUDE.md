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

## Map density — the number that decides whether it feels like a game

Median distance to the *nearest* other player, six players, sampled once a second from t=10 s, and
the share of the round spent within 15 m of anybody:

| map | median nearest | within 15 m | Hunt survivors left after 180 s |
| --- | --- | --- | --- |
| `jungle-world` | 15.1 m | 50 % | 0, 0, 0 |
| `glacier-world` | 28.5 m | 24 % | 4, 3, 2 |
| `outback-station` | 51.3 m | 10 % | 5, 1, 5 |

All three have `playRadius: 150`, which is why that field is the wrong lever — it steers bots and
contains nobody. Outback Station is the emptiest map in the game: nine tenths of a round with
nobody in sight, and a hunter who usually catches no one. A tag game is only a game at the density
the top row shows.

## Hunt

The hunter's rifle works — on `jungle-world` it lands for the full 55 and clears five survivors by
~t=125 s. The older note that "eliminations come from prey getting wedged rather than from the
rifle" no longer reproduces; the bot obstacle-avoidance change fixed the wedging. On the two
sparser maps the hunter simply cannot find people, which is a density problem, not a weapon one.

## How to find defects here

Measurement beats reading the code, every time. What has actually worked:

- Headless full-speed simulation with the real `Simulation` and `Bot` via `tsx`.
- A/B screenshots compared with Pillow; Playwright + Chromium at
  `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` with `--use-gl=swiftshader`.
- Two real browser clients over real WebRTC, measuring RMS on the listener.
- **Mutation testing on every fix** — break the fix, confirm the new test fails, restore.

Watch for harness artefacts before believing a result: a probe that reports "no difference" may be
measuring the wrong event name, running a mode whose countdown freezes the player, or crossing a
round reset that restores the state you were watching. All three have happened.
