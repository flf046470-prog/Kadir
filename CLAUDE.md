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
  attenuates. Bypassing the panner is the obvious reading and it would be a cheat: its
  `refDistance`/`rolloffFactor` are the only thing quietening a distant player, because
  **`proximityGain` in `social.ts` is exported, documented, unit tested and called by nobody.**
  Voice distance is therefore enforced client-side only — worth fixing, and a bigger job than a
  setting: with a WebRTC mesh every peer already receives every stream, so real enforcement means
  gating signalling by distance.
- `colorblindSafe` swaps the role-ring palette for blue/orange/white. The ring also encodes role in
  **size** now, always and for everyone — chaser 1.5×, fighter 1.25×, runner 1× — because hue alone
  put the chaser's red and the fighter's yellow on the axis protanopia compresses, and those are
  the two most urgent states in the game.
- `holdToGrab` uses `platform/latch.ts`, shared by PC and mobile so the rule is not written twice.
  VR has no use for it: a hand grabs because it is closed, and there is no button to hold.

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
- Two real browser clients over real WebRTC, measuring RMS on the listener.
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
