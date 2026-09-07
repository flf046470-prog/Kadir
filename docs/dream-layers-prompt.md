# DREAM LAYERS: DON'T WAKE UP — Build Specification

> Build prompt for an autonomous coding agent. Read **all** of section 0–3 before writing
> a single line of code. Sections 0–3 are binding constraints; sections 4–12 are the
> content spec. Where they conflict, sections 0–3 win.

---

## 0. Mission, delivery format, and repository placement

### 0.1 What you are building

A **Roblox multiplayer horror game** for 1–6 players called *Dream Layers: Don't Wake Up*.

Players lie down on beds in a waking room, take a sedative, and go under together. Inside,
they work through five dreams, each locked behind a puzzle whose answer is not in the room
they are standing in — it is one dream-layer further down. Failing a puzzle, or being caught
by the server-authoritative monster that hunts them, does not kill anyone: **it drops them a
level deeper**, into the same dream, distorted. Getting back up is a designed action with a
cost. The run ends when the sedative wears off, and only the players standing together at
the surface wake up.

The full model — the two axes, descent, the kick, stability, and Limbo — is section 3.2.
Read it before writing anything, because it is the game.

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
- Real time dilation across depths (deeper layers running on a slower clock). The sedative
  clock is real seconds at every depth; deeper layers only *display* wrong time. See 3.2.7.
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
| Layers built simultaneously (3.2.10) | ≤ 3 |
| Parts across all concurrent layers | ≤ 10,000 |
| Simultaneously active monster instances | ≤ 3 — one per active layer |
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

### 3.2 The dream stack — the core loop

**Read this subsection before anything else in section 3. It defines what the game is.**

Players do not walk into a dream. They lie down on a bed in the waking room, take a
sedative, and go under together. From that moment the run is a stack, navigated on two
independent axes:

- **The dream axis** — *which* dream you are in: House → School → Corridor → Hospital →
  Broken Dream (section 5). Advancing along it is the goal.
- **The depth axis** — *how deep inside the current dream* you are: `0, 1, 2, 3, Limbo`.
  Depth 0 is the dream as authored. Every level below is that same dream, distorted.

**Failing does not kill. Failing drops you a level.**

#### 3.2.1 The loop

1. You arrive at depth 0 of a dream. Its objective is locked behind something you do not
   yet know — a code, a symbol order, a name, a room number.
2. The information needed to unlock it is **not at depth 0**. It is one level down, held in
   distorted form: a number written backwards on a deeper wall, a photograph whose subject
   is the answer, the same corridor with exactly one door numbered differently.
3. You can descend deliberately (at a descent point) or involuntarily (puzzle stability
   exhausted, or caught by the monster). Both use the same code path. There is no death
   screen mid-run.
4. Down there you find the fragment — and you must **kick** back up to apply it.
5. Objectives may only be completed at depth 0. Knowledge travels up; progress happens at
   the surface.

That is the entire design: **depth is not a punishment, it is where the answers live, and
the price of going there is that you have to climb back out.**

This replaces the old "death → spectator" loop completely. A player who fails at minute
three does not sit and watch for seventeen minutes; they are somewhere worse, still playing.

#### 3.2.2 Depth is a pure distortion of one descriptor

No new level is authored for depth. Depth 1 of the House **is** the House descriptor put
through a pure function:

```lua
export type DistortionProfile = {
    depth: number,
    saturation: number,             -- 1.0 at depth 0, falling with depth
    fogEnd: number,
    lightRangeScale: number,
    gravityScale: number,
    monsterSpeedScale: number,
    monsterDetectionScale: number,
    propDuplicationChance: number,
    geometryJitterStuds: number,
    hudTruthfulness: number,        -- 1.0 = the HUD never lies; below 1.0 it may
}

Distortion.forDepth(depth: number): DistortionProfile
LayerDistorter.apply(d: LayerDescriptor, depth: number, seed: number): LayerDescriptor
```

Both are pure `f(data) -> data` per section 0.4 — plain numbers only, no `Color3`, no
`Vector3`, no `game` — so both are unit-tested headlessly. The builder from 3.4 is unchanged;
it receives a distorted descriptor and does not know the difference.

The one thing depth *does* add per dream is the answer itself:

```lua
export type FragmentDescriptor = {
    id: string,
    depth: number,                  -- which level down it lives on
    answersObjective: string,       -- ObjectiveDescriptor id it unlocks
    presentation: "Written" | "Spoken" | "Spatial" | "Numeric",
    roomId: string,
    propKind: string,
    payloadKey: string,             -- resolved against the round seed
}
```

`LayerDescriptor` gains `depthFragments: { FragmentDescriptor }`.

**The payload is derived from the round seed, never hardcoded.** The code on the safe is
different every round, so the answer cannot be memorised or looked up on a wiki — only found.
This is the strongest replayability lever in the project and it costs one seeded lookup.

#### 3.2.3 Descent

Three triggers, one code path:

| Trigger | Cost |
|---|---|
| Puzzle stability exhausted | involuntary |
| Downed by the monster and not revived within `reviveWindow` | involuntary |
| Stepping into a descent point (a bathtub, a stairwell, an open lift shaft) | voluntary |

Descent is never an instant teleport. It is a three-second fall: control is kept, the camera
inverts, the ambient bed cuts to nothing, and the new layer fades in underneath. The player
must be able to tell they fell rather than lagged.

#### 3.2.4 The kick

Climbing is a designed action, not a menu button.

- Every layer at depth ≥ 1 contains one or two **kick points**, placed by the builder and
  guaranteed reachable — the generator must prove reachability, not assume it.
- A kick raises **exactly one** level. Depth 3 → surface is three kicks.
- A kick costs `Stability` (3.2.5). It is cheaper when a teammate one level up triggers it
  with you — a *synchronised kick* — and full price solo.
- **Kicks never fail.** A failed kick strands a player with no counterplay, which is not
  tension, it is a dead session.
- Solo runs must stay completable: the spec is 1–6 players, so every kick point must be
  operable by one person at a higher cost, never *only* by a pair.

#### 3.2.5 Stability — the run's real resource

One team-wide value, 0–100. It replaces lives. Illustrative starting values; the real ones
live in `DepthConfig` and are tuned:

| Event | Δ |
|---|---|
| Round start | 100 |
| Failed puzzle attempt | −4 |
| Involuntary descent | −10 |
| Voluntary descent | −5 |
| Synchronised kick | −6 |
| Solo kick | −12 |
| Monster attack landing | −8 |
| Objective step completed | +15 |
| Sedative dose found in loot | +20 |
| Per minute elapsed | −2 |

At **0 stability no kick is available** and depth becomes one-way. That is the death spiral,
and it must be audible before it is fatal: the ambient bed acquires a low sub-bass that was
not there before, so players feel the run turning without being told.

#### 3.2.6 Limbo

Depth 4, reached only by descending from depth 3 — three total failures with no recovery
in between.

- No objectives, no monster, no items. A grey shore at the wrong scale with one authored
  structure in it.
- You cannot kick yourself out. A teammate at depth ≤ 2 must complete a call ritual at a
  kick point to pull you up, costing 30 stability.
- A solo player who reaches Limbo is finished. This is the **only** unrecoverable state in
  the game, and `YOU NEVER WOKE UP` belongs here rather than at the first mistake.
- Limbo must be quiet and beautiful, not hostile. It is the failure players will describe to
  someone else afterwards, which is the entire point of section 11.

#### 3.2.7 The sedative clock

- One global timer, `GameConfig.sedativeSeconds` (default 900), in **real** seconds,
  unaffected by depth.
- Deeper layers *show* wrong time — clocks read impossible values, the HUD timer stutters
  and skips. This is presentation only.
- **Do not implement real time dilation.** Inception's deeper-is-slower rule makes round
  length unpredictable and the state machine untestable. If it is ever wanted it belongs in
  a P2 modifier, never in the core loop.
- On expiry: every player at depth 0 standing on the wake point wakes, and their run resolves
  by how far along the dream axis they reached. Everyone deeper does not wake.

#### 3.2.8 Waking up — the finale

The old `Escape` state becomes a **synchronised kick**: every surviving player must be at
depth 0 and on the wake point inside the same ten-second window.

Reaching depth 0 alone is not enough. One player stuck deep strands the team, which is the
strongest cooperative pressure this design has, and the sedative clock is what makes it
urgent instead of merely annoying.

#### 3.2.9 Round state machine

One authoritative enum, one owner (`MatchService`), one replicated snapshot.

```
Lobby → Bedding → Countdown → Loading → InDream ⇄ DepthTransition → Waking → Results → Lobby
                                           ↑                                      |
                                           |______________________________________|
```

- `Bedding` is the ready-up state: players lie down on beds instead of pressing a queue
  button. Keep a plain button as well — the diegetic version must not be the only way in.
- `DepthTransition` covers **both** directions; descent and kick share it.
- Only `MatchService` may change state. Everything else observes.
- The snapshot is `{ state, dreamIndex, roundId, seed, endsAt, stability }`. Each player's
  own `depth` replicates to them in full and to teammates as a bare integer.
- Late joiners receive the snapshot immediately and are placed in the lobby, never dropped
  into a running dream at any depth.
- `roundId` increments every round; every deferred callback checks its captured `roundId`
  against the current one and no-ops on mismatch. With layers now living and dying mid-round
  this matters more than before, not less: a descent callback that fires after its layer was
  destroyed must do nothing.

#### 3.2.10 Concurrency — the real technical risk of this design

Players split across depths, so several layers are alive at once. This is the cost of the
whole idea and it must be bounded explicitly:

- **At most three layer instances built simultaneously.** A fourth requires an empty one to
  be destroyed first.
- Layers stack in one `Workspace` at `Y = -3000 * depth`, are built lazily when the first
  player arrives, and are destroyed twenty seconds after the last one leaves.
- `workspace.StreamingEnabled = true`, with the monster model and objective props marked
  `Persistent`. Three concurrent layers do not fit the budget without streaming.
- Section 2.8's part and memory budgets are **per active layer**, and the sum across
  concurrent layers must stay within 2.5× the single-layer budget.
- Each active layer runs its own monster instance. Section 3.6's AI budget is per instance,
  and `MonsterService` must stagger think ticks across frames so N brains do not cost N×
  the raycasts in a single frame.

#### 3.2.11 Splitting the team

- Players at different depths cannot see or collide with one another.
- They can *hear* one another across exactly one depth boundary — footsteps, breathing, doors,
  heavily low-passed and delayed. Two levels apart is silence. This is positional game audio,
  not voice chat, which stays out of scope per section 1.
- The HUD lists each teammate's name and depth. Never their position.
- Treat this as a feature, not a failure mode: **design at least one puzzle per dream that is
  easier with a player deliberately parked one level down**, so descending is sometimes the
  clever play rather than the punished one.

#### 3.2.12 What the game is allowed to lie about

At depth ≥ 2, `hudTruthfulness < 1` permits the depth indicator to occasionally show the
wrong number. Against that, every player starts with a **totem**: hold it still for two
seconds and it reports your true depth, on a 45-second cooldown.

Totem *skins* may be sold. Totem *function* may never be sold, upgraded, timed, or gated —
see the balance guardrail in section 4. An information item that paying players read faster
is a pay-to-win item wearing a costume.

### 3.3 Player state

```lua
export type PlayerRuntimeState = "Lobby" | "Alive" | "Downed" | "Falling" | "Kicking"
    | "Lost" | "Awake"

export type PlayerDepthState = {
    depth: number,          -- 0..3, or DepthConfig.limboDepth
    enteredAt: number,
    lastKickAt: number?,
}
```

Stored server-side in a `PlayerStateService`. Replicated to the owning client in full and
to other clients in a redacted form (teammate name, alive/dead, and **depth as a bare
integer** — never position, never inventory, never fear).

`Downed` is a real state with a timer, not a synonym for dead: a downed player is revivable
by a teammate at the same depth for `reviveWindow` seconds, and descends when it expires
(3.2.3). `Lost` is Limbo. `Awake` is a resolved run. There is **no mid-round spectator
state** — that is the point of the whole design.

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
    depthFragments: { FragmentDescriptor },   -- the answers, living below (3.2.2)
    monster: MonsterProfile,
    eventTable: EventWeightTable,
    descentPoints: { { roomId: string, propKind: string } },
    kickPoints: { { roomId: string, requiresPartner: boolean } },
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
| `RequestPurchase` | C→S | `sku: string` | sku exists; server calls `PromptProductPurchase` |
| `RequestEquipCosmetic` | C→S | `cosmeticId: string` | owned per server-side profile |
| `InventorySync` | S→C | own inventory only | — |
| `ObjectiveSync` | S→C | objective display state | — |
| `FearSync` | S→C | own fear only | — |
| `DepthSync` | S→C | own depth, teammate depths as integers | — |
| `StabilitySync` | S→C | team stability | — |
| `HorrorCue` | S→C | `cueId, params` | — |
| `EndingCinematic` | S→C | `endingId` | — |

**The dream stack adds no client→server remotes.** Bedding down, descending, kicking,
reviving a downed teammate, the Limbo call ritual, and the wake point are all
`ProximityPrompt` interactions on world instances, so they arrive through the existing
`RequestInteract` and are validated by tag and distance like everything else. Reading the
totem is `RequestUseItem` on the slot holding it. If you find yourself adding
`RequestKickUp`, you have moved a decision to the client that belongs on the server.

Notice what is absent: no `GrantCoins`, no `CompleteObjective`, no `DealDamage`, no
`ReviveMe`, no `SetDepth`. Those are server-internal.

---

## 4. Feature scope, tiered

Build **P0 completely before starting P1.** A finished P0 is worth more than a broken P2.

### P0 — Playable vertical slice (must ship)

**One dream, two depths.** That is the slice. It proves the core loop; five dreams do not
make it truer, they only make it longer.

1. Rojo project builds; lint, typecheck, and tests pass.
2. Waking room with beds: lie down to ready up, plain button as the accessible equivalent,
   10 s countdown, cancel-before-start.
3. `MatchService` state machine including `DepthTransition`, 1–6 players, late joiners safe.
4. Dream 1 (The House) built from descriptors at **depth 0 and depth 1**, the second produced
   entirely by `LayerDistorter` — no second authored layout.
5. One objective chain whose answer is a seeded fragment placed at depth 1.
6. Descent from all three triggers, and a working kick, both through `DepthTransition`.
7. Team-wide stability with the full ledger, the 0-stability lockout, and its audio tell.
8. Item + inventory system, 6 slots, server-authoritative, `ProximityPrompt` pickups.
9. Flashlight with battery drain, flicker, and findable batteries.
10. Monster AI with all seven states, one profile, and the linger/retreat behaviour, running
    correctly with **two layer instances alive at once**.
11. Downed state with teammate revive, and descent when the revive window expires.
12. Fear system with heartbeat/breathing/vignette/whisper response curve.
13. Sedative clock, wake point, and the synchronised-kick finale.
14. HUD: objective, stamina, battery, fear, inventory, **own depth, teammate depths**,
    stability, sedative timer. Plus the totem.
15. DataStore save/load of coins, XP, level, with session locking and `BindToClose`.
16. Rate limiting and validation on every remote.
17. Mobile + gamepad input parity via `ContextActionService` and `ProximityPrompt`.

### P1 — Full content
18. Dreams 2 (School), 3 (Endless Corridor, procedural), 4 (Hospital), 5 (Broken Dream),
    each with fragments authored for depths 1–3.
19. Depths 2 and 3, Limbo, and the call ritual that pulls a teammate out of it.
20. `RandomEventService` with the five rarity tiers.
21. Puzzle system (codes, symbol matching, switch sequences, audio cues), all seed-derived.
22. At least one puzzle per dream that is *easier* with a teammate parked one level down.
23. Dream transitions with portals, loading screen, and per-dream lighting/audio profiles.
24. Cross-depth teammate audio: one boundary, low-passed and delayed; two is silence.
25. Rewards, XP curve, levels, collectibles.
26. Three endings (Normal / Bad / Secret) with cinematic screens.

### P2 — Economy and polish
27. Shop (flashlights, totem skins, cosmetics, emotes, boosts) with `sku`-driven catalogue.
28. Gamepasses (VIP, Extra Emotes, Premium Flashlight, Cosmetic Pack).
29. Developer products (Revive, Coin Pack, XP Boost, Temporary Protection) + `ProcessReceipt`.
30. VIP perks: nametag, cosmetic, flashlight skin, totem skin, waking-room area, emotes.
    **No gameplay advantage.**
31. Secrets, hidden rooms, mysterious NPC dialogue in the waking room, daily reward.
32. Nightmare modifiers: a `ModifierDescriptor` layer over the existing descriptors
    (*No Flashlight*, *Two Monsters*, *Silent Monster*, *Fragile*, *Inverted*), rotating on a
    seed derived from the week number. Zero new art, zero new levels, a different game weekly.
33. Private-server compatibility (`game.PrivateServerId ~= ""` → same rules, saving intact).

### Balance guardrail
A player who has spent nothing must be able to reach every ending. Paid items may only grant
convenience (a second revive, faster battery recharge, cosmetics, XP rate). No paid item may
increase damage, reduce monster detection, or unlock content gates.

Three additions this design makes explicit, because they are the tempting ones:
**stability may not be bought**, **kicks may not be discounted**, and **the totem's function
may not be improved**. Information and mobility are the two things depth costs you; selling
either sells the game.

---

## 5. Content spec per layer

For each dream, produce a `LayerDescriptor` plus its prop kinds. Keep the descriptions below
as design intent — the implementation is data.

**Everything here describes depth 0.** Depths 1–3 of each dream are generated from these same
descriptors by `LayerDistorter` (3.2.2) and are never authored by hand. What *is* authored per
dream is its `depthFragments`: the answers, and which level down each one lives on. When you
read "objective pool" below, assume each objective's answer is a fragment somewhere beneath it.

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
appearing in the void. Objective: activate 5 dream anchors, whose sequence is a
fragment held at depth 3. On the fifth, the collapse begins — a 90 s countdown, geometry
destroyed progressively behind the players, a permanent chase, and the wake point. Everyone
reaching it and kicking together (3.2.8) is the Normal Ending. Failing the countdown, or
kicking while a teammate is still deep, is the Bad Ending. Having collected the hidden
collectibles across all dreams opens a sixth anchor and the Secret Ending.

This is also the one place where descent is not a setback but the intended route: the fifth
anchor cannot be reached from the surface at all.

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

`GameConfig` · `LayerConfig` · `DepthConfig` · `MonsterConfig` · `ItemConfig` · `ShopConfig` ·
`ProductConfig` · `FearConfig` · `FlashlightConfig` · `AssetConfig` · `EventConfig` ·
`RewardConfig` · `DebugConfig`

`DepthConfig` owns everything in 3.2: `maxDepth`, `limboDepth`, `sedativeSeconds`, the
stability table, kick costs, `reviveWindow`, `maxConcurrentLayers`, `layerYSpacing`,
`layerDestroyGraceSeconds`, and the per-depth distortion curve.

Rules:
- No magic numbers anywhere else in the codebase. If a number affects gameplay, it is in a config.
- `DebugConfig` exposes `forceSeed`, `skipToLayer`, `forceDepth`, `disableMonster`,
  `infiniteBattery`, `infiniteStability`, `verboseLogging`. All default `false`/`nil` and are ignored unless the place is in Studio
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
- distortion: `Distortion.forDepth` is monotonic in the fields that should be (light range
  falls, monster speed rises), clamped at `maxDepth`, and identical for identical input.
- layer distorter: `LayerDistorter.apply(d, 0, seed)` returns a descriptor equivalent to `d`;
  the same `(d, depth, seed)` always produces an identical table; room and doorway counts are
  preserved so a distorted layer is never made unreachable.
- fragment placement: every objective that requires a fragment has exactly one reachable
  fragment placed at some depth ≥ 1; two different seeds produce two different payloads.
- stability ledger: a pure `applyEvent(stability, event) -> stability` clamps to 0–100,
  and a scripted sequence of failures reaches 0 in the expected number of steps.
- kick legality: a kick is refused at 0 stability, refused from Limbo, always available at
  depth ≥ 1 with stability, and raises depth by exactly one.
- descent: all three triggers produce the same depth delta; descending from `maxDepth`
  yields Limbo; nothing descends past Limbo.

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
| M2 | Waking room + match state machine | 1–6 players bed down, count down, cancel, transition; late join safe; round state unit-tested |
| M3 | Dream 1 + builder + props | `LayerDescriptor` → instances; the House playable end to end at depth 0; part budget met |
| M4 | Distortion + depth 1 | `Distortion` and `LayerDistorter` pure and unit-tested; depth 1 built from the same descriptor; two layers alive at once inside budget |
| M5 | Descent, kick, stability | All three descent triggers, kick, the stability ledger, and the 0-stability lockout; every rule in 3.2 unit-tested |
| M6 | Items, inventory, interactions, objectives, fragments | Objective chain completable solo, requiring a real descent to find its seeded fragment; all server-validated |
| M7 | Monster AI + fear + flashlight | Brain unit-tested; linger behaviour observable; N brains staggered across frames; downed → revive → descent path clean with zero leaked connections |
| M8 | Sedative clock + waking | Timer, wake point, synchronised kick, Limbo, the call ritual, and the three run resolutions |
| M9 | Dreams 2–5, depths 2–3, procedural corridor, events | Seeded generation tested; all five dreams and every depth reachable |
| M10 | Data, rewards, XP, levels | Session locking, migration, `BindToClose` verified |
| M11 | Shop, gamepasses, products, revive | Works fully with all IDs set to `0` |
| M12 | Secrets, endings, modifiers, replayability | Three endings reachable; collectibles persist; modifier rotation deterministic |
| M13 | Mobile/console, optimization, security pass | Budgets measured with three concurrent layers; checklist in §9 signed off |
| M14 | Polish + documentation | README, TESTING.md, config documentation complete |

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
8. The full player journey — enter the waking room, lie down, go under, explore dream 1,
   fail a puzzle and *fall* rather than die, find the fragment below, kick back up, apply it,
   watch stability drop, be downed and revived, be downed and not revived, reach Limbo and be
   pulled out, advance through dreams 2–5, encounter events and the monster at more than one
   depth simultaneously, reach the wake point, kick together, receive rewards, return to the
   waking room, save, rejoin with progress intact, purchase safely, and replay to find the
   seeded answers are different — is walkable in Studio.

**Reported honestly:**
9. `game/README.md` states exactly what was implemented, what was stubbed and why, which
   asset/product IDs must be filled in before publishing, and which checks were run versus
   which require Studio.

If a system cannot be completed, say so explicitly in the README and in your final message.
A truthful "Layer 5's collapse sequence is implemented but untuned" is worth more than a
silent gap.
