# DREAM LAYERS: DON'T WAKE UP — Build Specification

> Build prompt for an autonomous coding agent. Read **all** of section 0–3 before writing
> a single line of code. Sections 0–3 are binding constraints; sections 4–12 are the
> content spec. Where they conflict, sections 0–3 win.

---

## 0. Mission, delivery format, and repository placement

### 0.1 What you are building

A **Roblox multiplayer horror game** for 1–6 players called *Dream Layers: Don't Wake Up*.
Players descend through progressively hostile dream layers, completing objectives while a
server-authoritative monster hunts them.

### 0.2 What you are delivering

You are **not** delivering a `.rbxl` binary and you are **not** editing a live Roblox place.
You are delivering a **Rojo-syncable source tree** that a developer opens in Roblox Studio.

Deliver exactly this, and nothing outside it:

```
game/
├── default.project.json        # Rojo 7 project definition
├── aftman.toml                 # pins rojo, selene, stylua, lune versions
├── selene.toml                 # lint config, roblox std
├── stylua.toml
├── .luaurc                     # luau-lsp config, strict mode
├── README.md                   # how to open, sync, configure IDs, and play
├── src/
│   ├── shared/                 # → ReplicatedStorage.Shared
│   ├── server/                 # → ServerScriptService.Server
│   ├── client/                 # → StarterPlayer.StarterPlayerScripts.Client
│   └── testing/                # headless test harness (NOT synced into the place)
└── tests/                      # Lune test suites
```

Everything lives under `game/` at the repository root. **Do not modify, move, delete, or
lint any file outside `game/`.** The repository currently contains an unrelated Next.js
application (`app/`, `src/`, `server/`, `prisma/`, `package.json`); it is not part of this
task and must remain byte-identical.

### 0.3 Language and file conventions

- All Luau files use the `.luau` extension, `--!strict` on every module, and 4-space indent.
- Every runtime script is a `ModuleScript` except a **single** `Script` (`src/server/init.server.luau`)
  and a **single** `LocalScript` (`src/client/init.client.luau`). These two are bootstrappers:
  they require modules and start them in a defined order. No gameplay logic in them.
- Module names are PascalCase and match their filename. `init.luau` re-exports a folder.
- All comments in English.

### 0.4 The one architectural rule that matters most

**Separate pure logic from Roblox instances.**

Any logic that can be expressed as `f(data) -> data` must live in a module that never
touches `game`, `workspace`, `Instance`, or any Roblox service. These modules are unit-tested
headlessly under Lune. Roblox-facing code is a thin adapter layer around them.

Pure modules (mandatory, non-exhaustive):
- corridor/maze graph generation
- objective state machine and progress evaluation
- inventory rules (capacity, stacking, combination recipes)
- fear/sanity accumulation math
- loot and event weighted-selection tables
- flashlight battery drain model
- receipt-idempotency bookkeeping
- data schema migration (v1 → v2 → …)
- reward/XP/level curve

If you catch yourself writing `if player.Character then` inside one of these, you have put
it in the wrong layer.

---

## 1. Non-goals — do not build these

Explicitly out of scope. Building them is a defect, not a bonus.

- Custom 3D meshes, textures, animations, or audio files. You cannot author binary assets.
- Any invented Roblox asset ID, gamepass ID, developer product ID, or place ID.
- Cross-server matchmaking (`MemoryStoreService` queues, `TeleportService` reserved servers).
  This is a **single-place, single-server, round-based** game. Layers are built and destroyed
  inside one running server.
- Voice chat integration, trading, friend systems, badges, leaderboards backed by
  `OrderedDataStore` beyond one simple global level board.
- Anti-cheat that inspects the client (memory scanning, injected-script detection). Server
  authority and validation only.
- A web dashboard, analytics backend, or anything outside Roblox.
- Gore, dismemberment, or explicit body horror. Roblox moderation constrains this; the horror
  is atmospheric, not graphic. Keep it 13+ appropriate.

---

## 2. Hard technical constraints

These are correctness requirements. Violating one is a bug even if the game "works".

### 2.1 Roblox API currency
- Use `task.wait`, `task.spawn`, `task.delay`, `task.defer`. Never `wait`, `spawn`, `delay`.
- Use `os.clock()` for durations and `workspace:GetServerTimeNow()` for synced timestamps.
  Never `tick()`.
- Use `workspace:Raycast` with `RaycastParams`. Never `FindPartOnRay`.
- Use `Instance:GetAttribute`/`SetAttribute` for per-instance data. Never `StringValue` tag objects.
- Use `CollectionService` tags for "all things of kind X" queries. Never name-based `FindFirstChild` scans in loops.
- Use `ProximityPrompt` for every world interaction. It is keyboard, gamepad, and touch
  capable for free, and it enforces a server-visible max distance. Do not hand-roll
  interaction raycasts on the client.

### 2.2 Lifecycle correctness
- `Players.CharacterAutoLoads = false`. The match service owns all spawning.
- Handle the `PlayerAdded` race: iterate `Players:GetPlayers()` **and** connect `PlayerAdded`.
- Every connection made for a player/character/round must be stored and disconnected when
  that player/character/round ends. Use a `Trove`/`Maid`-style cleanup helper written by
  you in `shared/Utility/Trove.luau`. Unbounded connection growth is a failure condition.
- Exactly **one** `RunService.Heartbeat` connection on the server and **one** `PreRender` +
  **one** `Heartbeat` on the client. All periodic work goes through a scheduler module that
  runs registered tasks at their own tick rates (monster AI at 10 Hz, fear at 4 Hz, battery
  at 2 Hz, autosave at 1/120 Hz). Per-system `Heartbeat` connections are forbidden.
- `game:BindToClose` must flush all pending saves with a bounded wait.

### 2.3 Networking contract
- All remotes are created by a single `shared/Remotes.luau` module that builds them on the
  server and waits for them on the client. No `WaitForChild` chains scattered through code.
- Every `RemoteEvent`/`RemoteFunction` handler must, in this order:
  1. Rate-limit the calling player (token bucket, per-remote budget).
  2. Type-check every argument (`typeof`, range, string length ≤ 64, table depth ≤ 3).
  3. Verify the player is in the correct game state (in-round, alive, not spectating).
  4. Verify spatial validity (distance to target ≤ the interaction's declared max + 4 studs).
  5. Verify the action is legal against server state.
  Only then mutate state.
- The client never sends "I picked up item X" — it sends "I pressed the prompt on instance Y",
  and the server decides what that means.
- No `RemoteFunction` from server → client (a malicious client can hang the server thread).
  Server → client is always `RemoteEvent`.
- Never send the monster's position to clients except through normal physics replication of
  its model, and never replicate a monster the client should not be able to see.

### 2.4 Monetization correctness
- `MarketplaceService.ProcessReceipt` is assigned **exactly once**, in one module.
- Receipt idempotency: record `receiptInfo.PurchaseId` in a dedicated DataStore inside the
  same `UpdateAsync` that grants the item. Return `Enum.ProductPurchaseDecision.NotProcessedYet`
  on any failure, `PurchaseGranted` only after the grant is durably written.
- Gamepass ownership: cache `UserOwnsGamePassAsync` per session with a failure path that
  retries rather than denying permanently.
- All product/gamepass IDs live in `shared/Config/ProductConfig.luau` and default to `0`.
  When an ID is `0`, the shop entry renders as "Coming soon" and the purchase path is disabled.
  **The game must be fully playable and testable with every ID set to `0`.**
- Respect `PolicyService:GetPolicyInfoForPlayerAsync` — hide paid-item surfaces when
  `ArePaidRandomItemsRestricted` or the region policy requires it.

### 2.5 Data correctness
- One `DataStore` for profiles, keyed `player_<UserId>`.
- Session locking: the profile stores a `sessionJobId` and `heartbeat` timestamp. On load,
  if another server holds an unexpired lock, retry with backoff and finally load in
  "read-only, do not save" mode rather than clobbering.
- Every write is `UpdateAsync` with a transform function that is pure and re-runnable.
- Schema versioning: the profile has `schemaVersion`. A migration chain upgrades older
  profiles on load. Never silently drop unknown fields.
- Retry with exponential backoff (0.5s, 1s, 2s, 4s, 8s) and respect
  `DataStoreService:GetRequestBudgetForRequestType`. Never save in a loop.
- Autosave interval: 120 seconds, jittered per player so saves do not align.
- A failed save must never destroy in-memory state or grant duplicate rewards.

### 2.6 Determinism
- **Every** random decision in gameplay generation goes through a seeded RNG obtained from a
  `shared/Utility/Rng.luau` wrapper over `Random.new(seed)`. The round has one master seed;
  each subsystem derives a child seed from it.
- The master seed is logged and displayable in a debug UI. Given the same seed and the same
  player count, layer generation must be identical.
- This is what makes procedural generation unit-testable and lets players share a run.
- `math.random` is banned outside cosmetic client-only effects.

### 2.7 Asset ID policy
- All sound, image, and animation IDs live in `shared/Config/AssetConfig.luau`.
- Every ID defaults to `""` (empty). Code must handle an empty ID by silently skipping the
  effect — never by erroring or leaving a broken instance.
- Where an ID is empty, provide a **procedural fallback** where one is possible: a `Sound`
  can be skipped, but lighting flicker, camera shake, particle bursts, fog shifts, and UI
  distortion must all be implemented procedurally so the game reads as horror with zero
  uploaded assets.
- Do not invent numeric asset IDs. A fabricated ID that resolves to unrelated content is
  worse than silence.

### 2.8 Performance budgets
Hard numbers. Measure them; do not assert them.

| Budget | Limit |
|---|---|
| Active `RunService` connections (server) | 1 |
| Active `RunService` connections (client) | 2 |
| Parts per built layer | ≤ 4,000 |
| Simultaneously active monster instances | ≤ 2 |
| `PathfindingService:ComputeAsync` calls | ≤ 4 per second across all monsters |
| Remote traffic per player | ≤ 20 events/sec sustained |
| Post-processing effects active at once | ≤ 4 |
| ParticleEmitters emitting at once | ≤ 12 |
| Layer build time (server) | ≤ 2 s, yielding so the server never stalls > 30 ms |

Anchor all static geometry (`BasePart.Anchored = true`). Use `Model:PivotTo` for placement.
Build layers into a folder, then parent the folder to `workspace` once.

---

## 3. Architecture contracts

Define these **before** implementing systems. Every service must compile against them.

### 3.1 Service lifecycle

Every server service is a module returning a table with an optional subset of:

```lua
export type Service = {
    Name: string,
    Priority: number?,          -- lower inits first, default 100
    Init: ((self: Service) -> ())?,   -- create state, no cross-service calls
    Start: ((self: Service) -> ())?,  -- connect events, may call other services
    Stop: ((self: Service) -> ())?,   -- teardown, used by tests
}
```

`init.server.luau` requires all services, sorts by `Priority`, calls every `Init`, then every
`Start`. A service must never require another service at module scope — it resolves
dependencies through a `ServiceRegistry` inside `Start`. This prevents cyclic requires and
makes services individually testable.

Client controllers follow the identical shape.

### 3.2 Round state machine

One authoritative enum, one owner (`MatchService`), one replicated snapshot.

```
Lobby → Countdown → Loading → InLayer → LayerTransition → Escape → Results → Lobby
                        ↑__________________|
```

- Only `MatchService` may change state. Everything else observes.
- State changes broadcast a versioned snapshot: `{ state, layerIndex, roundId, seed, endsAt }`.
- Late joiners receive the snapshot immediately and are placed in the lobby, never dropped
  into a running layer.
- `roundId` increments every round; every deferred callback checks its captured `roundId`
  against the current one and no-ops on mismatch. This is how you avoid the classic
  "last round's monster spawned into the new round" bug.

### 3.3 Player state

```lua
export type PlayerRuntimeState = "Lobby" | "Alive" | "Downed" | "Spectating" | "Escaped"
```

Stored server-side in a `PlayerStateService`. Replicated to the owning client in full and
to other clients in a redacted form (teammate name + alive/dead only — never position,
never inventory, never fear).

### 3.4 Layers are data, not code

This is the difference between a shippable project and 20,000 lines of hand-placed parts.

Each layer is a **descriptor table** consumed by a generic builder:

```lua
export type RoomDescriptor = {
    id: string,
    size: Vector3,
    doorways: { { side: "N"|"S"|"E"|"W", offset: number, kind: "Door"|"Open"|"Locked" } },
    props: { { kind: string, cframe: CFrame, attributes: { [string]: any }? } },
    lights: { { cframe: CFrame, color: Color3, range: number, flickerProfile: string? } },
    spawnWeights: { itemSpawns: number, eventNodes: number, monsterNodes: number },
    tags: { string },
}

export type LayerDescriptor = {
    id: string,
    displayName: string,
    lighting: LightingProfile,
    audio: AudioProfile,
    generation: "Authored" | "Procedural",
    rooms: { RoomDescriptor },        -- Authored: fixed layout graph
    generator: GeneratorConfig?,      -- Procedural: rules for assembly
    objectives: { ObjectiveDescriptor },
    monster: MonsterProfile,
    eventTable: EventWeightTable,
}
```

`LayerBuilder.luau` turns any `LayerDescriptor` into instances. Prop kinds resolve through a
`PropFactory` that builds furniture, doors, lockers, beds, desks, and gurneys **procedurally
from primitives** (`Part`, `WedgePart`, `UnionOperation` is not available at runtime, so
compose from anchored parts inside a `Model`). Roughly 25 prop kinds cover all five layers.

Adding a room becomes a table entry, not a new script. This is mandatory.

### 3.5 Objectives are declarative

```lua
export type ObjectiveKind =
    "CollectItems" | "FindKey" | "RepairDevice" | "ActivateSwitches"
  | "SolveCode" | "SurviveTimer" | "ReachExit" | "IdentifyRecords"

export type ObjectiveDescriptor = {
    id: string,
    kind: ObjectiveKind,
    displayText: string,           -- "Find the basement key."
    progressText: string?,         -- "%d / %d found"
    target: number,
    params: { [string]: any },
    optional: boolean,             -- optional objectives feed the secret ending
}
```

`ObjectiveService` holds a pure `ObjectiveMachine` (unit-tested) that takes
`(descriptors, events) -> newState`. Each layer picks 1 required objective plus 0–2 optional
ones from its pool using the round seed, so runs differ.

### 3.6 Monster AI contract

A single `MonsterController` class parameterised by a `MonsterProfile`. States:

```
Idle → Patrol → Investigate → Chase → Search → Attack → Retreat → (Patrol|Idle)
```

Every profile field is configurable per layer:

```lua
export type MonsterProfile = {
    displayName: string,
    walkSpeedPatrol: number,
    walkSpeedChase: number,
    detectionDistance: number,      -- max distance for sight
    fieldOfViewDegrees: number,
    hearingDistance: number,
    hearingSensitivity: number,     -- noise units needed to trigger
    attackDistance: number,
    attackCooldown: number,
    searchDuration: number,
    detectionCooldown: number,      -- lockout after losing a target
    lingerChance: number,           -- probability of "watch, then leave"
    ambushChance: number,
    despawnAfter: number?,
    canOpenDoors: boolean,
}
```

Detection rules (server-side, no exceptions):
- **Sight**: within `detectionDistance`, inside `fieldOfViewDegrees`, and a raycast from the
  monster's head to the player's torso hits the player first. Sprinting, a lit flashlight
  pointed at the monster, and standing in light all multiply effective detection distance.
- **Hearing**: players emit noise units — walking 1, sprinting 3, flashlight toggle 2,
  door slam 6, dropped item 4, failed puzzle 5. Noise decays over 3 seconds and attenuates
  with distance. Crouching emits 0.
- **Never** detect through the round's grace period (first 20 s of a layer).

Horror pacing requirement — the AI must be capable of *not* attacking:
- On acquiring a target, roll against `lingerChance`. On success the monster moves to a
  sightline, stares for 1.5–3 s, then retreats and enters `detectionCooldown`. It does not chase.
- `Patrol` includes "cross a doorway the player can see and continue past" waypoints.
- The monster plays positional audio while in `Search` even when far from any player.
- A minimum of 45 s must elapse between the end of one chase and the start of the next.

Implement the state machine as a pure module (`shared/AI/MonsterBrain.luau`) that takes a
perception snapshot and returns a decision. The Roblox-facing controller feeds it perception
and executes decisions via `Humanoid:MoveTo` / `PathfindingService`. The brain is unit-tested
with synthetic perception snapshots.

### 3.7 Remote surface (complete list — do not add more without a reason)

| Remote | Dir | Payload | Server validation |
|---|---|---|---|
| `StateSnapshot` | S→C | round snapshot | — |
| `PlayerStateSync` | S→C | own state, redacted teammates | — |
| `RequestInteract` | C→S | `Instance` | tag, distance, prompt exists, cooldown |
| `RequestUseItem` | C→S | `slotIndex: number` | slot occupied, item usable, cooldown |
| `RequestDropItem` | C→S | `slotIndex: number` | slot occupied |
| `RequestMoveItem` | C→S | `from: number, to: number` | both in 1..6 |
| `RequestToggleFlashlight` | C→S | — | rate limit 4/s, has flashlight |
| `RequestSubmitCode` | C→S | `puzzleId: string, code: string` | ≤ 16 chars, near puzzle, attempt cooldown |
| `RequestQueue` / `RequestLeaveQueue` | C→S | — | state is Lobby |
| `RequestSpectateTarget` | C→S | `userId: number` | caller is spectating, target alive |
| `RequestPurchase` | C→S | `sku: string` | sku exists; server calls `PromptProductPurchase` |
| `RequestEquipCosmetic` | C→S | `cosmeticId: string` | owned per server-side profile |
| `InventorySync` | S→C | own inventory only | — |
| `ObjectiveSync` | S→C | objective display state | — |
| `FearSync` | S→C | own fear only | — |
| `HorrorCue` | S→C | `cueId, params` | — |
| `EndingCinematic` | S→C | `endingId` | — |

Notice what is absent: no `GrantCoins`, no `CompleteObjective`, no `DealDamage`, no
`ReviveMe`. Those are server-internal.

---

## 4. Feature scope, tiered

Build **P0 completely before starting P1.** A finished P0 is worth more than a broken P2.

### P0 — Playable vertical slice (must ship)
1. Rojo project builds; lint, typecheck, and tests pass.
2. Lobby with functioning Play/queue, 10 s countdown, cancel-before-start.
3. `MatchService` round state machine, 1–6 players, late joiners safe.
4. Layer 1 (The House) fully built from descriptors, with one objective chain.
5. Item + inventory system, 6 slots, server-authoritative, `ProximityPrompt` pickups.
6. Flashlight with battery drain, flicker, and findable batteries.
7. Monster AI with all seven states, one profile, and the linger/retreat behaviour.
8. Fear system with heartbeat/breathing/vignette/whisper response curve.
9. Death → spectator with player cycling; all-dead → `YOU NEVER WOKE UP` → lobby.
10. HUD: objective, stamina, battery, fear, inventory, teammate status.
11. DataStore save/load of coins, XP, level, with session locking and `BindToClose`.
12. Rate limiting and validation on every remote.
13. Mobile + gamepad input parity via `ContextActionService` and `ProximityPrompt`.

### P1 — Full content
14. Layers 2 (School), 3 (Endless Corridor, procedural), 4 (Hospital), 5 (Broken Dream).
15. `RandomEventService` with the five rarity tiers.
16. Puzzle system (codes, symbol matching, switch sequences, audio cues).
17. Layer transitions with portals, loading screen, and per-layer lighting/audio profiles.
18. Escape sequence: 5 dream anchors, collapse, chase, countdown, final portal.
19. Rewards, XP curve, levels, collectibles.
20. Three endings (Normal / Bad / Secret) with cinematic screens.

### P2 — Economy and polish
21. Shop (flashlights, cosmetics, emotes, boosts) with `sku`-driven catalogue.
22. Gamepasses (VIP, Extra Emotes, Premium Flashlight, Cosmetic Pack).
23. Developer products (Revive, Coin Pack, XP Boost, Temporary Protection) + `ProcessReceipt`.
24. VIP perks: nametag, cosmetic, flashlight skin, lobby area, emotes. **No gameplay advantage.**
25. Secrets, hidden rooms, mysterious lobby NPC dialogue, daily reward.
26. Private-server compatibility (`game.PrivateServerId ~= ""` → same rules, saving intact).

### Balance guardrail
A player who has spent nothing must be able to reach every ending. Paid items may only grant
convenience (a second revive, faster battery recharge, cosmetics, XP rate). No paid item may
increase damage, reduce monster detection, or unlock content gates.

---

## 5. Content spec per layer

For each layer, produce a `LayerDescriptor` plus its prop kinds. Keep the descriptions below
as design intent — the implementation is data.

**Layer 1 — The House.** Bedroom, hallway, kitchen, bathroom, living room, basement, yard.
Starts ordinary. Abnormalities escalate on an objective-progress clock, not a wall clock:
clock hands stop, a photo's subject changes, a door is now where a wall was, a chair faces
the player, a window shows the hospital from Layer 4. The monster is not seen before the
second objective step — only heard. Objective pool: find 3 missing objects / find the basement
key / restore the fuse box / find the exit door.

**Layer 2 — Abandoned School.** Classrooms, lockers, cafeteria, gym, library, principal's
office, basement, long corridors. Fluorescent flicker, distant footsteps, a bell that rings
when nobody is near it, lockers that slam behind the player, a silhouette at the end of a
corridor that is gone when the flashlight sweeps back. Objective pool: three classroom keys /
restore power / find the missing student's notebook / open the emergency exit.

**Layer 3 — The Endless Corridor.** The signature area. Fully procedural, seeded. A modular
segment system assembles a corridor graph with loops, dead ends, and 4–7 candidate exits of
which one is real. Events: the corridor extends behind the player, a door they came through
is gone, lights shift to red, they see a copy of themselves walking away, the geometry loops
back onto itself, a room appears that was not there. Objective: identify and reach the real
exit. Falseness is determined by seeded generation, and clues (a scuffed floor, a specific
sound, a repeated number) are placed by the generator so the correct exit is *findable*, not
a coin flip.

**Layer 4 — Dream Hospital.** Reception, patient rooms, operating theatres, ER, elevators,
basement labs. Heartbeat monitors, a PA system, radio static, emergency lighting. Players
collect medical records; some are forged. Cross-referencing dates/names/room numbers across
records reveals which are real. Only real records advance the objective; submitting a forged
one raises fear and attracts the monster. Two monster profiles active, more aggressive.

**Layer 5 — The Broken Dream.** Reality failing: floating rooms, inverted buildings, stairs
that connect impossibly, duplicated props, a distorted skybox, fragments of Layers 1–4
appearing in the void. Objective: activate 5 dream anchors. On the fifth, the collapse
begins — a 90 s countdown, geometry destroyed progressively behind the players, a permanent
chase, and a final portal. Reaching it is the Normal Ending. Failing the countdown is the
Bad Ending. Having collected the hidden collectibles across all layers opens a sixth anchor
and the Secret Ending.

---

## 6. Fear, flashlight, and audio design rules

**Fear.** 0–100, server-owned, replicated to the owning client only.
Rises: monster within 40 studs (scaled by proximity and line of sight), being alone
(> 60 studs from every teammate), standing in darkness, being chased, witnessing an event.
Falls: near a teammate, in a safe zone, on objective progress.
Effects gate at thresholds 25 / 50 / 75 / 90 and must be **subtractive, not obstructive**:
heartbeat and breathing audio, a slow vignette, mild chromatic aberration, occasional
peripheral whisper, and above 90 a rare hallucination (a false monster that despawns silently
and never damages). Never blur the screen to the point of unplayability. Never lock input.

**Flashlight.** Three tiers — Basic, Advanced, VIP — differing in battery capacity, beam
range, and recharge convenience only. Range difference between Basic and VIP ≤ 20%. Drains
only while on, flickers below 15%, dies at 0 but recharges slowly when off. Batteries spawn
per layer via the seeded loot table. A lit flashlight aimed at the monster increases its
detection of you — the light is a trade-off, not a free win.

**Audio.** One `SoundGroup` per category (Ambient, SFX, Monster, UI, Music) so settings can
mix them. All world sounds are parented to parts with `RollOffMode = InverseTapered`.
Rules: no more than one stinger per 90 seconds; at least one deliberate 20-second silence per
layer; the monster's audio must sometimes play with no monster present (an event, not a lie —
use a dedicated invisible emitter). Every sound ID may be empty; the game must still function.

---

## 7. Configuration

Every tunable value lives in `shared/Config/`, one module per domain, all `--!strict`, all
exporting a frozen table with a documented type:

`GameConfig` · `LayerConfig` · `MonsterConfig` · `ItemConfig` · `ShopConfig` ·
`ProductConfig` · `FearConfig` · `FlashlightConfig` · `AssetConfig` · `EventConfig` ·
`RewardConfig` · `DebugConfig`

Rules:
- No magic numbers anywhere else in the codebase. If a number affects gameplay, it is in a config.
- `DebugConfig` exposes `forceSeed`, `skipToLayer`, `disableMonster`, `infiniteBattery`,
  `verboseLogging`. All default `false`/`nil` and are ignored unless the place is in Studio
  (`RunService:IsStudio()`).
- Configs are validated at startup by a `ConfigValidator` that errors loudly on a malformed
  entry rather than failing silently mid-round.

---

## 8. Testing — what is actually verifiable

Be honest about what can be automated. Do both halves.

### 8.1 Automated (must pass, runs headless in CI)

```bash
cd game
rojo build default.project.json -o /tmp/dreamlayers.rbxl   # project compiles
selene src                                                  # lint
stylua --check src                                          # format
luau-lsp analyze --defs=globalTypes.d.luau src              # strict typecheck
lune run tests/run.luau                                     # unit tests
```

Add `game/scripts/check.sh` running all five. Unit tests must cover, at minimum:
- corridor generator: same seed → identical graph; every generated graph has exactly one
  reachable true exit; no orphaned segments; segment count within configured bounds.
- objective machine: each `ObjectiveKind` completes only on valid events; duplicate events
  do not double-count; optional objectives do not gate completion.
- inventory: capacity enforced, invalid slot indices rejected, combination recipes.
- fear model: monotonic under sustained threat, decays to 0 in a safe zone, clamped 0–100.
- monster brain: given a perception snapshot with no line of sight, never returns `Chase`;
  respects `detectionCooldown`; honours the grace period; `lingerChance = 1` never chases.
- receipt idempotency: the same `PurchaseId` grants once across simulated retries.
- data migration: a v1 profile upgrades to the current schema with no field loss.
- rate limiter: a burst above budget is rejected and recovers after the window.

Target: **≥ 40 assertions across ≥ 8 suites.** Tests that only assert `require` succeeded do
not count.

### 8.2 Manual (write it, do not claim to have run it)

Produce `game/TESTING.md` — a Studio checklist a human executes, with expected results:
solo run, 2-player, 6-player (Studio local server), one death mid-round, all players dead,
revive flow with a real product ID, a player leaving mid-round, a player joining mid-round,
save/rejoin persistence, shop purchase paths, every objective type, every layer transition,
monster in each state, mobile emulation, gamepad emulation, private server.

**Do not report manual checks as passed.** State plainly that they require Studio.

---

## 9. Security checklist

Before declaring done, verify each line against the code:

- [ ] No remote handler trusts a client-supplied amount, ID, position, or completion claim.
- [ ] Every remote has a rate limit with a documented budget.
- [ ] Interaction distance is verified server-side against the prompt's `MaxActivationDistance`.
- [ ] Currency and XP are only ever mutated by server code, never in response to a raw client value.
- [ ] Purchases grant only inside `ProcessReceipt` / verified gamepass ownership.
- [ ] Inventory contents are never sent to non-owning clients.
- [ ] The monster's target list is never replicated.
- [ ] Objective state cannot be advanced by a client message alone.
- [ ] Teleports/respawns are server-initiated only.
- [ ] Any string from a client is length-capped and never used to index a table directly
      without a whitelist lookup.
- [ ] Failed validation is logged with the player and reason, and does not error the thread.

---

## 10. Milestones and commit discipline

Do **not** generate the whole project in one pass. Work in these milestones; after each,
run the automated checks and commit before continuing.

| # | Milestone | Definition of done |
|---|---|---|
| M1 | Tooling + architecture skeleton | `rojo build` succeeds; lint/typecheck/test commands run; service lifecycle, Remotes, Trove, Rng, scheduler, configs exist and are tested |
| M2 | Lobby + match state machine | 1–6 players queue, count down, cancel, transition; late join safe; round state unit-tested |
| M3 | Layer 1 + builder + props | `LayerDescriptor` → instances; House playable end to end; part budget met |
| M4 | Items, inventory, interactions, objectives | Full objective chain completable solo; all server-validated |
| M5 | Monster AI + fear + flashlight | Brain unit-tested; linger behaviour observable; fear effects tuned |
| M6 | Death, spectator, game over | All-dead path returns to lobby cleanly with zero leaked connections |
| M7 | Layers 2–5 + procedural corridor + events | Seeded generation tested; all five layers reachable |
| M8 | Data, rewards, XP, levels | Session locking, migration, `BindToClose` verified |
| M9 | Shop, gamepasses, products, revive | Works fully with all IDs set to `0` |
| M10 | Secrets, endings, replayability | Three endings reachable; collectibles persist |
| M11 | Mobile/console, optimization, security pass | Budgets measured; checklist in §9 signed off |
| M12 | Polish + documentation | README, TESTING.md, config documentation complete |

Commit message format: `M<n>: <what changed>`. One milestone per commit minimum, more is fine.
Never commit a state where `check.sh` fails.

---

## 11. Horror design philosophy (binding, not decorative)

Atmosphere over jumpscares. Concretely, this means the following are **requirements**:

- The player must be able to complete a full layer without the monster ever attacking them.
- At least three implemented events produce **no** threat at all — they only make the player
  doubt what they saw. A prop that moved. A door that is open now. A sound with no source.
- Rare events (< 2% per round) must be memorable enough that a player would describe them to
  someone else. Implement at least five of these and gate them behind the seeded RNG.
- Silence is a tool: the ambient bed must fully drop out at scripted moments.
- Nothing may flash, strobe, or shake hard enough to be uncomfortable. Provide a
  `ReducedMotion` setting that halves camera shake and disables chromatic aberration, and
  persist it in the profile.

The target feeling is *"did I actually see that?"* — if a system can only produce certainty,
it is the wrong system.

---

## 12. Definition of done

The project is complete when **all** of the following hold:

**Machine-verifiable:**
1. `game/scripts/check.sh` exits 0 (build, lint, format, typecheck, tests).
2. ≥ 40 assertions across ≥ 8 unit-test suites, all passing.
3. Zero `TODO`, `FIXME`, or `error("not implemented")` in `game/src`.
4. Zero uses of `wait(`, `spawn(`, `delay(`, `tick(`, `math.random` (outside client cosmetics).
5. Every config value referenced by code exists in a config module; `ConfigValidator` passes.
6. `git diff --stat` shows no changes outside `game/`.
7. Grep confirms exactly one `ProcessReceipt` assignment and one `Heartbeat` connection per side.

**Human-verifiable (documented in `TESTING.md`, not claimed as tested):**
8. The 20-step player journey — join lobby, start, Layer 1 through 5, explore, collect,
   complete objectives, encounter events and the monster, die or survive, spectate, revive,
   reach an ending, receive rewards, return to lobby, save, rejoin with progress intact,
   purchase safely, replay with a different experience — is walkable in Studio.

**Reported honestly:**
9. `game/README.md` states exactly what was implemented, what was stubbed and why, which
   asset/product IDs must be filled in before publishing, and which checks were run versus
   which require Studio.

If a system cannot be completed, say so explicitly in the README and in your final message.
A truthful "Layer 5's collapse sequence is implemented but untuned" is worth more than a
silent gap.
