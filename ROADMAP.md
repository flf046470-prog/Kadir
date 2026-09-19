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

* Animals: Lion, Bear, Panda, Raccoon, Deer, Koala, Shark, Raptor, Dragon (data only).
* Maps: Waterfall, Tree Village, Cliff, Ruins sections; second world.
* Modes: Hunt, Hide & Seek, Bomb Tag, King of the Hill, Team Chase, Escape, Boss.
* Ranked mode, tournaments, global leaderboards with anti-cheat review.
* Community map format + curation pipeline.

## Milestone C — Live operations

* Seasonal cadence (8 weeks), event calendar, telemetry-driven balance passes.
* Moderation tooling: report queue, kick/ban, chat/voice review.
* Region-sharded matchmaking, dedicated room servers, save persistence in a managed database.

## Non-goals (deliberate)

* Loot boxes, gacha, randomised paid rewards, pay-to-win stats.
* Photoreal rendering — the art direction is stylised for readability and frame budget.
* Per-platform gameplay forks.
