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

## The next twelve months: Coming Soon to Early Access on Steam and Epic

Written 2026-10-03. Every quarter has one thing that has to be true at its end. Every date that is
not ours is cited: Steam's Next Fests (October 2026, February 2027, June 2027) and its review rules
(a Coming Soon page reviewed at least seven business days before it goes up, and public for at
least two weeks before release) come from Steamworks; the store requirements come from
`docs/PC_LISTINGS.md`. Items the account holder must do are marked **(account)**, because nothing in
this repository can do them.

### Q4 2026 (Oct–Dec): one server, two Coming Soon pages

The quarter's test: a player on the Steam build and a player in a browser can join the same match.

- ~~**One server for every store.**~~ Done in code (2026-10-05): a PC build packed with
  `pack:steam --online <origin>` plays on the hosted server and falls back to the one it carries,
  and `check:crossplay` puts a PC page and a browser player in one room in CI. The same pass found
  that every Steam launch had made a new account (a new port, so a new origin, every launch). What
  is left is the server itself, next line.
- Hosting back up — Railway's trial ended 2026-09-22 **(account)** — then the domain and the Android
  package identity, decided once (`CLAUDE.md`: "Release identity is one irreversible decision").
- Steamworks partner account and the $100 app fee, Epic developer account and its $100 fee, tax
  and bank forms **(account)**.
- Privacy policy at a live URL, written against what `packages/server/src/` actually stores.
- Coming Soon pages on both stores with the `pack:pc:listing` art, the `pack:trailer` video and
  the checked copy. Release date "To be announced".
- ~~Fix the measured glacier defect: bots spend 29 % of bot-seconds stuck in two crevasse cells.~~
  Done: the crevasse ramp spans its full width now, 6.0 % stuck (glacier `version` 7).

### Q1 2027 (Jan–Mar): real hardware

The quarter's test: VR has run on a real headset, and the system requirements are numbers someone
measured.

- A real-headset pass on the PC VR handoff (Electron → Chrome/Edge → OpenXR). Tick Steam's "VR
  Supported" only if it works.
- System requirements from a test pass on two or three real Windows PCs, not from this container.
- A trailer cut from real-machine footage, with the game's own sound effects once their licence
  is settled. `npm run pack:trailer` already produces a store-spec MP4 for the Coming Soon pages:
  the game filmed frame by frame under swiftshader, scored with its own music.
- Code signing for the Windows build. Unsigned builds trip SmartScreen **(account, certificate)**.
- A Steam Playtest for a closed group. It is the first time strangers meet on one server, so
  moderation (`KC_MODERATORS`) needs at least one person on call.
- Skip February's Next Fest. A demo nobody can play together is worse than no demo.

### Q2 2027 (Apr–Jun): Steam Next Fest, June 2027

The quarter's test: a public demo that holds up under a festival's traffic.

- The Next Fest demo: Kangaroo Chase, Roo Ball and the Training Room on one map.
- Load test the hosted server at festival scale. The per-room figures are measured (32 players:
  1.8 % of a core, 6.4 KB/s per client); the number of rooms per box is not.
- TURN for voice (`KC_TURN_URLS`/`KC_TURN_SECRET`). Without it, players behind carrier NAT cannot
  hear each other, and a festival is mostly those players.
- Content from Milestone B that the demo can show: one more map section, and the bots made good
  racers on the outback's scree.
- An IARC rating, which Epic recommends **(account)**.

### Q3 2027 (Jul–Sep): Early Access on both stores at once

The quarter's test: the game is for sale or free-to-play (a decision for Q2), on Steam and Epic on
the same day, sharing one server.

- Release-date review submitted at least seven business days ahead, with the page public at least
  two weeks before.
- Seasons on the Milestone C cadence (8 weeks). The first season's cosmetics are already earned,
  never bought (`SEASON_SHELF`).
- Region sharding, if the Next Fest numbers say one region is not enough. It is not built before
  then.
- If Steam achievements are added, Epic's are added in the same release, as Epic's distribution
  rules require.

### What this plan does not do

- No money in the game in year one. `LAUNCH_STORE` is empty, and `validateCatalog` refuses a
  priced item at boot. Revisiting that is a decision, not a roadmap item.
- No Quest Store submission in this window. The TWA needs the same origin and identity as above,
  and Meta's review is its own project. It follows the PC release, not the other way round.

## Non-goals (deliberate)

* Loot boxes, gacha, randomised paid rewards, pay-to-win stats.
* Photoreal rendering — the art direction is stylised for readability and frame budget.
* Per-platform gameplay forks.
