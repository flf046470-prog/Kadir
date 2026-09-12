# DREAM LAYERS: DON'T WAKE UP — Build Specification

> Build prompt for an autonomous coding agent. Read **all** of section 0–3 before writing
> a single line of code. Sections 0–3 are binding constraints; sections 4–12 are the
> content spec. Where they conflict, sections 0–3 win.

---

## 0. Mission, delivery format, and repository placement

### 0.1 What you are building

A **multiplayer psychological dream puzzle** for 1–6 players called *Dream Layers: Don't Wake
Up*.

Players lie down on beds in a waking room, take a sedative, and go under together. Inside,
they work through five dreams, each locked behind a task whose answer is not in the room they
are standing in — it is one dream-layer further down. Failing does not kill anyone: **it drops
them a level deeper**, into the same dream, distorted. Climbing back up is a designed action
with a cost. The run ends when the sedative wears off, and only the players standing together
at the surface wake up. Then the last layer asks whether waking up was an exit.

**There is no monster.** Nothing in this game chases the player, attacks them, or kills them.
The antagonist is the dream itself — specifically, the fact that **it does not show the same
thing to everyone inside it**. A corridor is longer for you than for the player beside you.
Two clocks in one room disagree. A door you walked through is on the other wall when your
teammate describes it. The pressure is not *something is behind me*. It is *we are standing in
the same room, we cannot agree on what is in it, and in ninety seconds we have to act on one
answer.*

That system is **Divergence** (3.6). Read it and the dream stack (3.2) before writing
anything, because together they are the game.

The genre framing is deliberate, and it costs something worth naming up front. "Roblox horror"
is a discovery funnel with millions of players in it; "multiplayer psychological dream puzzle"
is a much narrower one, and this game will surface more slowly for it. What the narrower
framing buys is that the game is not competing against a thousand chase games on chase-game
terms, and that its best moments — the argument in the corridor, the concession that turns out
to have been wrong — are moments no chase game can produce. Take the narrower funnel
knowingly. Do not hedge by adding a monster back "for the trailer".

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
- doubt accumulation math
- lens assignment and room incoherence (3.6)
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

- **Any pursuing, attacking, or damaging entity.** No monster, no AI hunter, no combat, no
  damage, no health bar. This is the load-bearing non-goal: if an idea needs something to
  chase the player, it is the wrong idea for this game (0.1, 3.6, 11).
- **Speech-to-text.** Roblox exposes no transcription API. NPCs react to *typed* chat only,
  and store copy must not imply otherwise (3.8).
- Custom 3D meshes, textures, animations, or audio files. You cannot author binary assets.
- Any invented Roblox asset ID, gamepass ID, developer product ID, or place ID.
- Cross-server matchmaking (`MemoryStoreService` queues, `TeleportService` reserved servers).
  This is a **single-place, single-server, round-based** game. Layers are built and destroyed
  inside one running server.
- Trading, and leaderboards backed by `OrderedDataStore` beyond one simple global level board.
  (Voice and text chat were previously excluded here and are now **core** — see 3.8. Badges
  and friend-group features were also previously excluded and are now in scope — see 4.6.
  Both are Roblox's own primitives, and neither can touch what happens inside a round.)
- Anti-cheat that inspects the client (memory scanning, injected-script detection). Server
  authority and validation only. The one client-side exploit this design cannot close is
  named and bounded in 3.6.3; do not build machinery to chase it.
- A web dashboard, analytics backend, or anything outside Roblox.
- Real time dilation across depths (deeper layers running on a slower clock). The sedative
  clock is real seconds at every depth; deeper layers only *display* wrong time. See 3.2.7.
- Gore, dismemberment, or explicit body horror. Roblox moderation constrains this, and the
  unease here is cognitive rather than graphic anyway. Keep it 13+ appropriate.
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
  runs registered tasks at their own tick rates (incoherence at 5 Hz, doubt at 4 Hz, battery
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
- **Never send a player's lens to any other client, in any payload.** A client may know its
  own lens and nothing about anybody else's; every mechanic in 3.6 collapses the moment one
  player can read another's. Treat it like a password, not like a position.
- A client may report *that it interacted with an instance*, never *what it saw*. The server
  derives the variant from the lens it computed itself (3.6.3).

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
  distortion must all be implemented procedurally so the game reads as intended with zero
  uploaded assets.
- Do not invent numeric asset IDs. A fabricated ID that resolves to unrelated content is
  worse than silence.

### 2.8 Performance budgets

Hard numbers. Measure them; do not assert them.

| Budget | Limit |
|---|---|
| Active `RunService` connections (server) | 1 |
| Active `RunService` connections (client) | 2 |
| Parts per built layer, **counting every variant of every contested set** | ≤ 4,000 |
| Contested variant sets per layer | ≤ 24 |
| Variants per contested set | ≤ 4 |
| Lenses in play simultaneously | ≤ 4 |
| Layers built simultaneously (3.2.10) | ≤ 3 |
| Parts across all concurrent layers | ≤ 10,000 |
| Collision groups | ≤ 10 (`Lens1..4`, `Player1..6`) |
| Client variant-resolution passes | 1 per set per layer entry or lens change — **never per frame** |
| Remote traffic per player | ≤ 20 events/sec sustained |
| Post-processing effects active at once | ≤ 4 |
| ParticleEmitters emitting at once | ≤ 12 |
| Layer build time (server) | ≤ 2 s, yielding so the server never stalls > 30 ms |

The variant row is the one that bites: a room with four `Door` variants costs four doors' worth
of parts even though any given player sees one. Budget it at authoring time by contesting
*few* things *well* rather than everything a little — 24 sets across a layer is already more
disagreement than a team can process.

What pays for it is what was removed. There is no monster, so there is no
`PathfindingService:ComputeAsync`, no per-frame perception raycasting, no `Humanoid` AI, and
no navmesh cost — comfortably the most expensive server system the design used to carry.
Divergence spends that budget on geometry, which is static, anchored, and streamable, rather
than on pathfinding, which is neither.

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
  Broken Dream → the Final Layer (section 5). Advancing along it is the goal.
- **The depth axis** — *how deep inside the current dream* you are: `0, 1, 2, 3, Limbo`.
  Depth 0 is the dream as authored. Every level below is that same dream, distorted.

**Failing does not kill. Failing drops you a level.**

#### 3.2.1 The loop

1. You arrive at depth 0 of a dream. Its objective is locked behind something you do not
   yet know — a code, a symbol order, a name, a room number.
2. The information needed to unlock it is **not at depth 0**. It is one level down, held in
   distorted form: a number written backwards on a deeper wall, a photograph whose subject
   is the answer, the same corridor with exactly one door numbered differently.
3. You can descend deliberately (at a descent point) or involuntarily (task stability
   exhausted, or a room dissolving under you because nobody in it could agree on what was
   in it). Both use the same code path. There is no death screen mid-run, because there is
   no death.
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
    divergenceScale: number,        -- multiplies team divergence here (3.6.2)
    incoherenceScale: number,       -- multiplies how fast a room diverges (3.6.4)
    propDuplicationChance: number,
    geometryJitterStuds: number,
    hudTruthfulness: number,        -- 1.0 = the HUD never lies; below 1.0 it may
}

Distortion.forDepth(stops: { DistortionProfile }, depth: number): DistortionProfile
LayerDistorter.apply(d: LayerDescriptor, depth: number, seed: number): LayerDescriptor
```

Both are pure `f(data) -> data` per section 0.4 — plain numbers only, no `Color3`, no
`Vector3`, no `game` — so both are unit-tested headlessly. The builder from 3.4 is unchanged;
it receives a distorted descriptor and does not know the difference.

The two divergence scales are what make depth frightening rather than merely dim. The same
team divergence buys more lenses one level down, and rooms there disagree with themselves
faster. A team that is holding together at the surface can be unable to finish a sentence at
depth 3.

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
    -- Whether this fragment tells the truth. Rolled per round from the seed against
    -- Distortion.forDepth(depth).fragmentTruthfulness; see below.
    truthful: boolean,
}
```

`LayerDescriptor` gains `depthFragments: { FragmentDescriptor }`.

#### Depth degrades the information, not only the distance

`DistortionProfile` gains `fragmentTruthfulness`, alongside `hudTruthfulness` and falling the
same way: 1.0 at depth 1, lower at 2, lower again at 3. A fragment found at depth 3 is more
likely to be a forgery than one found at depth 1.

This is what turns depth into an actual gamble rather than a toll. Going deeper finds you
*more* answers and *worse* ones, so a team has a real decision — climb back with the shallow
answer they half-trust, or push down for another and risk acting on a lie. The Hospital's
forged medical records (section 5) generalise into the stack this way.

It also rhymes with divergence rather than duplicating it, and the distinction is worth
keeping straight while implementing: **a forged fragment is the dream lying to one player
about the world; a contested set is the dream telling two players different truths.** The
first has a right answer that the player failed to find. The second does not have one until
the players make one.

Rules that keep it fair rather than cruel:
- **Depth 1 is always truthful.** The first level down must reward descending, or nobody
  learns the loop.
- **At least one truthful fragment always exists** for every objective, at some depth. A round
  where the answer does not exist is a bug, not a difficulty setting.
- A forged fragment is **findable as forged** by cross-referencing another fragment, exactly
  as the Hospital's records work. It is never a coin flip.
- Submitting a forgery costs a failed attempt, raises doubt and divergence, and makes noise.
  It does not end the run.

**The payload is derived from the round seed, never hardcoded.** The code on the safe is
different every round, so the answer cannot be memorised or looked up on a wiki — only found.
This is the strongest replayability lever in the project and it costs one seeded lookup.

#### 3.2.3 Descent

Three triggers, one code path:

| Trigger | Cost |
|---|---|
| Task stability exhausted | involuntary |
| The room dissolves under you (3.6.4) and you did not walk out | involuntary |
| Stepping into a descent point (a bathtub, a stairwell, an open lift shaft) | voluntary |

Descent is never an instant teleport. It is a three-second fall: control is kept, the camera
inverts, the ambient bed cuts to nothing, and the new layer fades in underneath. The player
must be able to tell they fell rather than lagged.

**Descending is not an escape.** The naive reading of dissolution is that a dissolving room
has an exit sign in it: step into the bathtub, drop a level, leave the problem upstairs. It
must not work — and unlike a monster, the fix is not a special case. It falls out of the
system:

- **Divergence is team-wide and depth-scaled.** `divergenceScale` rises with depth, so the
  same divergence value buys more lenses and faster incoherence one level down. You did not
  leave the disagreement; you went to where it is worse.
- **Your lens is re-rolled on arrival** (3.6.2). You now disagree with the teammates you left
  by exactly one boundary — the only boundary you can still hear across (3.2.11). The people
  best placed to talk you through it are the people you can now least agree with.
- **A room does not stop dissolving because you left it.** Anyone still standing in it
  inherits your share of its incoherence, because a report you never conceded stays contested.

Arrival grace — `DivergenceConfig.graceSecondsAfterLayerEnter`, during which a room's
incoherence does not accrue — is for arrivals that were *earned*: the first entry into a
dream, and a descent taken from a coherent room. It does not apply to a descent taken out of a
dissolving one. You got away from *that* room. This one has not agreed on you yet.

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
| Failed task attempt | −4 |
| Involuntary descent | −10 |
| Voluntary descent | −5 |
| Synchronised kick | −6 |
| Solo kick | −12 |
| A concession proven false | −8 |
| First corroboration of a contested set | +4 |
| Objective step completed | +15 |
| Sedative dose found in loot | +20 |
| Per minute elapsed | −2 |

Two of those rows are the whole cooperative economy. **Corroborating a teammate pays**, once
per set, so the act of saying what you see is worth doing before you need to. **A concession
proven false costs**, which is the price of having agreed on the wrong thing — the exact
replacement for a hit landing, and better, because the team chose it.

**Sedative doses spawn only at depth ≥ 1.** The resource that pays for climbing is found only
by going down. One line in the loot table, and it makes the economy breathe: a team that never
descends slowly starves, and descending stops being purely a punishment without ever becoming
free. It also gives the surface a job — depth 0 is where you spend, everywhere below is where
you earn.

At **0 stability no kick is available** and depth becomes one-way. That is the death spiral,
and it must be audible before it is fatal: the ambient bed acquires a low sub-bass that was
not there before, so players feel the run turning without being told.

**One player may not spend the team's run.** A shared pool with no limit is a griefing surface:
one person descending on purpose, over and over, ends everybody's round. Cap it —
`DepthConfig.maxDrainSharePerPlayer` (default 0.5) is the fraction of the round's total
stability loss any single player may account for. Past their share, that player's further
*voluntary* costs come out of nothing: they still descend, they still cannot kick, but the
team's pool stops falling.

Deliberately asymmetric. Involuntary costs — a failed task, a room dissolving under someone —
are never capped, because those are the game working. Only the costs a player chooses are,
because those are the ones that can be weaponised.

Stability is not divergence and the two must stay separate in code as well as in the reader's
head. **Stability is what the team spends; divergence is what the dream does** (3.6.7). A team
can be rich in stability and hopelessly diverged, and that is the interesting failure: plenty
of resources, no way to agree on what to spend them on.

#### 3.2.6 Limbo

Depth 4, reached only by descending from depth 3 — three total failures with no recovery in
between.

- No tasks, no items, no contested sets. A grey shore at the wrong scale with one authored
  structure in it.
- **Limbo is the only place in the game where everyone sees the same thing.** Divergence is
  zero here, there is one lens, and nothing disagrees. The one coherent place in the dream is
  the one you cannot leave alone, and the fact that it is finally restful is the joke.
- You cannot kick yourself out. A teammate at depth ≤ 2 must complete a call ritual at a kick
  point to pull you up, costing 30 stability.
- A solo player who reaches Limbo is finished. This is the **only** unrecoverable state in the
  game, and `YOU NEVER WOKE UP` belongs here rather than at the first mistake.
- Limbo must be quiet and beautiful, not hostile. It is the failure players will describe to
  somebody else afterwards, which is the entire point of section 11.

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

The synchronised kick out of the last dream does not end the run. It lands the team in the
Final Layer, where the decision in section 5 is taken. Implement `Waking` as a state the
team arrives *in*, not a cutscene they trigger.

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
- The snapshot is `{ state, dreamIndex, roundId, seed, endsAt, stability, divergence }`. Each
  player's own `depth` replicates to them in full and to teammates as a bare integer.
- **The snapshot's `seed` is not the lens salt.** It is replicated, so anything derived from it
  is public. The lens salt is separate, server-only, and never enters this table — see 3.6.2.
- Late joiners receive the snapshot immediately and are placed in the lobby, never dropped
  into a running dream at any depth.
- `roundId` increments every round; every deferred callback checks its captured `roundId`
  against the current one and no-ops on mismatch. With layers now living and dying mid-round
  this matters more than before, not less: a descent callback that fires after its layer was
  destroyed must do nothing.

**One server is one round.** `Players.MaxPlayers = 6`, matching `GameConfig.maxPlayers`. Late
arrivals wait in the waking room for the next round; nobody is dropped into a running dream.

This is a decision, not a default, and it is worth stating why. The alternatives both fail
against constraints already set: parallel rounds in separate places need
`TeleportService:ReserveServer`, which section 1 rules out; parallel rounds inside one server
need more than the three concurrent layers 3.2.10 allows, because each round is up to three of
its own.

The honest cost: Roblox's discovery favours servers that fill, and a 6-cap server fills
shallowly, so the experience will surface more slowly than a 20-player lobby would. That is
paid deliberately. A 15-minute round where one player stranded deep can end it for everyone
only works among six people who are talking to each other.

#### 3.2.10 Concurrency — the real technical risk of this design

Players split across depths, so several layers are alive at once. This is the cost of the
whole idea and it must be bounded explicitly:

- **At most three layer instances built simultaneously.** A fourth requires an empty one to be
  destroyed first.
- Layers stack in one `Workspace` at `Y = -3000 * depth`, are built lazily when the first
  player arrives, and are destroyed twenty seconds after the last one leaves.
- `workspace.StreamingEnabled = true`, with objective props **and every variant of every
  contested set** marked `Persistent`. This is not an optimisation detail: a variant that
  streams out becomes an answer a player cannot see, and the player will read that as the game
  lying to them rather than as a bug. Three concurrent layers do not fit the budget without
  streaming, and streaming does not fit the design without this.
- Section 2.8's part budget is **per active layer and counts every variant**, and the sum
  across concurrent layers must stay within 2.5× the single-layer budget.
- Each active layer holds its own contested-set table and its own room-incoherence map.
  `DivergenceService` recomputes lenses only on layer entry and on threshold crossings, never
  per frame (2.8), so N concurrent layers cost N tables and no extra per-frame work. Compare
  what this replaced: N monster brains raycasting every tick was the reason this section used
  to be the risky one.

#### 3.2.11 Splitting the team

- Players at different depths cannot see or collide with one another.
- They can *hear* one another across exactly one depth boundary — footsteps, breathing, doors,
  heavily low-passed and delayed. Two levels apart is silence. This is positional game audio;
  cross-depth voice is deliberately not a feature (3.8).
- The HUD lists each teammate's name and depth. Never their position, and **never their lens**.
- **Divergence carries across the same one boundary.** You hear a room dissolving one level
  below you — the ambient bed dropping out under your feet — and you hear the muffled shape of
  a teammate calling out a variant you do not have. You know they are disagreeing with someone
  and you cannot hear about what. This costs one emitter and it is the cheapest unsettling
  thing in the design.
- Treat this as a feature, not a failure mode: **design at least one task per dream that is
  easier with a player deliberately parked one level down**, so descending is sometimes the
  clever play rather than the punished one.

#### The mechanic that makes cross-depth play real

"Easier with someone below" needs something to actually do, or it stays a note. Add one
interaction kind: a **paired prompt**, the same object present at depth *d* and at *d+1*, which
resolves only when two players hold both within the same `pairedPromptWindowSeconds` (default
2). Neither can see the other; they have to talk, and they are talking across a boundary that
low-passes and delays their voices.

It costs nothing new on the wire — both halves arrive through `RequestInteract` (3.7), and the
server matches them by object id and timestamp. Every dream should contain at least one, and
none of them may be the only route to an objective, because the specification supports solo
runs: a paired prompt is always a shortcut, never a gate.

#### 3.2.12 Leaving, dropping, and being left

The stack makes disconnection worse than it is in a flat game, because a player can vanish
somewhere the rest of the team physically cannot reach. Specify it rather than discovering it:

- **A player who disconnects is suspended, not deleted.** Their character is removed, their
  depth and inventory are held for `DepthConfig.rejoinGraceSeconds` (default 120), and the
  round continues without them.
- **Rejoining inside the grace window restores depth and inventory.** They come back where
  they fell. Rejoining after it, or into a later round, puts them in the waking room.
- **Their stability spend is not refunded.** It was spent. Refunding it would make
  disconnecting a way to undo a bad descent.
- **Their lens is re-rolled on rejoin, and their reports stand.** A report they made before
  dropping keeps holding its set contested, because the team heard it and acted on it. What
  they cannot do is come back on a convenient lens: if rejoining re-rolled to order, a
  player who disliked their reading of a room could reconnect until they got a better one.
- **A disconnect never strands the team.** If the leaver was the only player below and the
  round cannot otherwise resolve, their depth stops being a blocker: the wake condition
  (3.2.8) counts *connected* players only.
- **Limbo is the exception that needs a rule.** A player suspended in Limbo cannot be called
  out by anyone, because the ritual needs them present. On rejoin they are still in Limbo. On
  grace expiry the run records them as `Lost` and the team's finale proceeds without them.

The same path handles a deliberate leave. There is no surrender button and no vote to end the
round: the sedative clock already guarantees a round ends.

#### 3.2.13 What the game is allowed to lie about

At depth ≥ 2, `hudTruthfulness < 1` permits the depth indicator to occasionally show the
wrong number. Against that, every player starts with a **totem**: hold it still for two
seconds and it reports your true depth, on a 45-second cooldown.

Totem *skins* may be sold. Totem *function* may never be sold, upgraded, timed, or gated —
see the balance guardrail in section 4. An information item that paying players read faster
is a pay-to-win item wearing a costume.

The totem reports depth and **nothing else**. It must never report your lens, whether a set
near you is contested, or which variant is the real one. There is no instrument in this game
for resolving disagreement, because the instrument is the other players — adding one would
delete the game while appearing to be a quality-of-life feature, which is exactly how it
would get built.

Note the division of labour, and keep it: **the HUD may lie to you about your own state; a
teammate's report is never a lie the game tells.** A contested set is two truths, not a
deception, and the only false report in the whole game is the doubt-90 hallucination in
section 6, which is always contradicted within thirty seconds. If players come to believe
the game fakes reports, they stop trusting each other, and then nothing works.

### 3.3 Player state

```lua
export type PlayerRuntimeState = "Lobby" | "Alive" | "Dissolving" | "Falling" | "Kicking"
    | "Lost" | "Awake"

export type PlayerDepthState = {
    depth: number,          -- 0..3, or DepthConfig.limboDepth
    lens: number,           -- 1..DivergenceConfig.maxLenses, server-side only
    enteredAt: number,
    lastKickAt: number?,
}
```

Stored server-side in a `PlayerStateService`. Replicated to the owning client in full and to
other clients in a redacted form: teammate name, runtime state, and **depth as a bare
integer**. Never position, never inventory, never doubt, and **never lens** — a player's lens
is the one field this design requires to stay private, because knowing it turns every
conversation in the game into a formality (3.6.3).

`Dissolving` is a real state with a timer, not a synonym for dead. It begins when the room's
incoherence crosses `dissolveThreshold` (3.6.4), it is telegraphed before it bites, and it ends
in exactly three ways: the player walks out of the room, the room's contested sets collapse by
agreement, or the timer expires and they descend (3.2.3). Note the shape of that list — two of
the three are things a player *does*, and the third takes long enough that not acting was a
choice.

`Lost` is Limbo. `Awake` is a resolved run. There is **no mid-round spectator state** and no
death state at all — that is the point of the whole design.

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
    spawnWeights: { itemSpawns: number, eventNodes: number, contestedSets: number },
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
    variantSets: { VariantSet },              -- where the dream disagrees (3.6.1)
    eventTable: EventWeightTable,
    descentPoints: { { roomId: string, propKind: string } },
    kickPoints: { { roomId: string, requiresPartner: boolean } },
}
```

`LayerBuilder.luau` turns any `LayerDescriptor` into instances. Prop kinds resolve through a
`PropFactory` that builds furniture, doors, lockers, beds, desks, and gurneys **procedurally
from primitives** (`Part`, `WedgePart`; `UnionOperation` is not available at runtime, so
compose from anchored parts inside a `Model`). Roughly 25 prop kinds cover all six layers.

The builder is also where 3.6.6's guarantees are enforced rather than assumed. It builds every
variant of every set, assigns each variant's parts to its `Lens<i>` collision group, and
**proves reachability per lens before accepting the layer** — for each lens separately, not
for the union of them. Checking the union is the easy mistake, it passes on a layout that is
unplayable for one lens in four, and the resulting bug is nearly impossible to reproduce from
a report.

Adding a room becomes a table entry, not a new script. This is mandatory.

### 3.5 Objectives are declarative

```lua
export type ObjectiveKind =
    "CollectSymbols"        -- layer 1: find five of a thing
  | "OrderSequence"         -- layer 2: put known things in an unknown order
  | "DeduceRule"            -- layer 3: name the rule the world is running on
  | "SynchroniseAnchors"    -- layer 4: n points active inside one window
  | "IdentifyReal"          -- layer 5: choose between things claiming to be real
  | "ReachExit"             -- utility: get somewhere
  | "RepairDevice"          -- utility: restore something
  | "SolveCode"             -- utility: a seeded code, used inside the others

export type ObjectiveDescriptor = {
    id: string,
    kind: ObjectiveKind,
    displayText: string,           -- "Find the five symbols."
    progressText: string?,         -- "%d / %d found"
    target: number,
    params: { [string]: any },
    optional: boolean,             -- optional objectives feed the secret ending
    soloVariant: { [string]: any }?,  -- overrides when one player is in the round
}
```

The first five kinds are section 5's waking tasks, one per layer, in the order that teaches
them. They are a ladder, so `ObjectiveMachine` should not be made generic enough to hide that:
the kind is what says which layer's lesson is being tested.

`soloVariant` is not an afterthought. `SynchroniseAnchors` is impossible for one player as
written, so its solo override turns simultaneity into a decay timer (section 5). A kind that
cannot express its own solo case will silently break the specified 1–6 player range, so every
kind must either be solo-safe by construction or declare the override.

`ObjectiveService` holds a pure `ObjectiveMachine` (unit-tested) that takes
`(descriptors, events) -> newState`. Each layer picks 1 required objective plus 0–2 optional
ones from its pool using the round seed, so runs differ.

### 3.6 Divergence — the world as the antagonist

There is no monster. This section is what replaces it, and after the dream stack it is the
most important system in the project.

The premise: **the dream does not show the same thing to everyone inside it.** Two players
stand in one room. One sees a door on the north wall; the other sees unbroken plaster and a
door on the east wall. Neither is hallucinating and neither is wrong. The room genuinely has
both, and the dream has decided which of them each player gets.

#### 3.6.1 One truth, several views

The server owns exactly one authoritative world. What differs per player is which **variant**
of each contested element they are shown.

```lua
export type Variant = {
    index: number,                  -- 1..maxLenses, stable for the round
    props: { { kind: string, cframe: CFrame, attributes: { [string]: any }? } },
    doorways: { { side: "N"|"S"|"E"|"W", offset: number, kind: "Door"|"Open"|"Locked" } }?,
    payloadKey: string?,            -- Clock and Text kinds: what it reads, seed-resolved
}

export type VariantSet = {
    id: string,
    roomId: string,
    kind: "Door" | "Extent" | "Clock" | "Text" | "Prop" | "Gravity",
    weight: number,                 -- how much disagreement here costs (3.6.4)
    variants: { Variant },          -- 2..4
    carriesFragment: boolean,       -- whether an answer hides behind one of them
}
```

`LayerDescriptor` gains `variantSets: { VariantSet }`. The six kinds cover everything the
design asks for: corridors that extend (`Extent`), clocks showing different times (`Clock`),
rooms that changed on re-entry (`Prop`), text that reads differently (`Text`), gravity that
is not the same for everyone (`Gravity`), and one player opening a door another sees
elsewhere (`Door`).

#### 3.6.2 Lenses, not private worlds

The obvious implementation — resolve every set independently per player — is wrong twice
over. It is unimplementable on Roblox (3.6.3), and it is bad design: six players each in a
private world produces noise, not a puzzle. There is nothing to corroborate.

So players are not given per-set variants. Each player is assigned one **lens** per layer:

```lua
Divergence.lensCount(divergence: number, thresholds: { number }): number
Divergence.lensFor(slot: number, salt: number, lensCount: number): number
Divergence.variantFor(set: VariantSet, lens: number): number
```

All three pure, all three unit-tested. A lens is an integer `1..DivergenceConfig.maxLenses`
(4). Every contested set in the layer shows you the variant at your lens index, wrapped when
the set has fewer variants than there are lenses.

The consequence is the entire game: with up to six players and at most four lenses, **players
share lenses**. Two agree, a third contradicts them, a fourth sees something else again. That
is a puzzle. Six private worlds is not.

Three things about that signature are load-bearing and none of them is obvious:

**`lensFor` is an even rotation, not a hash.** With six seats over four lenses a rotation always
produces the multiset `{2,2,1,1}` — two pairs who can corroborate each other and two players who
are the odd one out. A hash gives that *on average*, and also, a few rounds in every thousand,
puts the whole team on one lens: a round with nothing contested in it, which is a round with no
antagonist. Here the guarantee is worth more than the unpredictability, and section 6 depends on
it — it hangs the largest source of doubt on being the odd one out, so there has to reliably be
one. Assert the exact split in a test rather than sampling it.

**`slot` is the player's 1..maxPlayers seat, not their UserId.** It is the same index that names
their `Player<slot>` collision group in 3.6.3. Rotating raw UserIds would put any two players
whose ids happen to differ by a multiple of `lensCount` on the same lens in every round they ever
played together — a bug that is invisible in testing and permanent for the pair who have it.

**`salt` is server-only state and must never be the round seed.** This one is a real hole and it
is easy to walk into: `lensFor` is a pure function living in shared code, the round snapshot
replicates `seed` (3.2.9), and a client that has both can compute every teammate's lens. That
does not break a rule somewhere — it deletes the game, silently, while every test still passes,
because the conversation in 3.6.5 becomes a formality. So the lens salt is a **separate value,
generated server-side per layer and replicated to nobody.** Reproducibility for debugging comes
from `DebugConfig.forceLens` in Studio, not from deriving the salt from anything a client holds.

`lensCount` is driven by team divergence:

| Divergence | Lenses | What it feels like |
|---|---|---|
| 0–24 | 1 | The dream agrees with itself. Nothing is contested. |
| 25–49 | 2 | Occasionally someone is looking at a different door. |
| 50–74 | 3 | Most rooms hold something two people describe differently. |
| 75–100 | 4 | No two descriptions of a room match. |

Depth scales it: the effective value is `divergence * DistortionProfile.divergenceScale`,
clamped to 100. Depth 3 is more contested than depth 0 at the same team divergence, which is
why descending is not a refuge (3.2.3).

**Lenses are re-rolled on layer entry and on threshold crossings, never per frame.** A
teammate who agrees with you must keep agreeing with you long enough for the two of you to
act on it.

#### 3.6.3 How this is actually replicated — the hard part, answered

Roblox replicates `workspace` to every client, and offers no supported per-player visibility
filter for a workspace part. A spec that says "each player sees their own version" without
saying how is hand-waving. Here is how.

1. **The server builds every variant of every set**, in place, at once. All of them are real
   instances and all of them replicate to everybody.
2. **Each client hides the variants its lens was not given.** `DivergenceController` receives
   its lens over `DivergenceSync` and, for every other variant, sets `Transparency = 1`,
   `CanCollide = false`, `CanQuery = false`, `CanTouch = false`. Local changes do not
   replicate, so this costs no bandwidth and cannot be observed by other clients.
3. **Collision is per-lens, through collision groups.** Register `Lens1..Lens4` and
   `Player1..Player6` — ten groups, comfortably inside Roblox's limit of 32. A variant's parts
   go in `Lens<i>`, a character goes in `Player<slot>`, and `Lens<i>` is collidable with
   `Player<slot>` exactly when that slot's lens is `i`. **This is the reason lenses are a
   per-player property rather than a per-set roll**: per-set resolution would need one
   collision group per subset of players, which is 2^6 and does not fit. The engine
   constraint chose the better design.
4. **The server never asks a client what it saw.** It computes `lensFor` itself. When a player
   interacts with a variant, the server recomputes their lens and rejects the interaction if
   that variant is not theirs.

**The accepted exploit, stated plainly.** An exploiter can un-hide what their client hid and
see all four possibilities at once. This cannot be prevented short of not building the
variants, and building them is what makes step 3 work.

It is bounded deliberately, and the design is shaped so that winning the exploit is not
winning the game:

- They learn the *set* of possibilities. They never learn **which one a teammate is being
  shown** — that is `lensFor(otherPlayer, …)`, and it is never replicated to anyone. Every
  task in section 5 is about reconciling *reports*, not about enumerating options.
- Step 4 means they cannot act on a variant they were not given. Seeing the other door does
  not open it.
- What they gain is knowing that a set is contested — information the game gives away anyway,
  the moment a teammate describes the room.

Do not spend engineering effort trying to close this. Spend it making sure step 4 holds
everywhere, because that is the part that matters.

#### 3.6.4 Incoherence, and what replaces being caught

A room accrues **incoherence** while the players standing in it disagree about it:

```lua
Divergence.roomIncoherence(
    sets: { VariantSet },           -- the room's unresolved sets
    lensesPresent: { number },      -- distinct lenses standing in the room
    scale: number                   -- the depth's incoherenceScale
): number
```

Pure. It is the summed `weight` of the room's unresolved sets, multiplied by **one less than**
the number of *distinct* lenses present, multiplied by the depth's scale.

The "one less than" is the whole rule, so do not simplify it away: a room with one reading in
it has **zero** incoherence no matter how heavily it is contested or how many players are
standing there. A room only disagrees with itself once somebody is there to disagree. Two
players on the same lens are restful; two players on different lenses are work; three lenses in
a heavily contested room is a room nobody is going to be standing in shortly.

`sets` is the room's *unresolved* sets — the caller removes a set once it collapses by
agreement, which is why collapsing one drops the room's incoherence by exactly its weight.

Above `DivergenceConfig.dissolveThreshold` the room begins to **dissolve**, and this is the
system that replaces being hunted:

- The player enters `Dissolving` (3.3). It is telegraphed, never instant: colour drains, the
  ambient bed drops to nothing, and the variants they were *not* given start ghosting through
  the ones they were. You begin to see the room the way somebody else does.
- After `DivergenceConfig.dissolveSeconds` the floor stops agreeing about them and they
  descend involuntarily (3.2.3).
- **Walking out of the room ends it. Always.** There is no state in this game a player cannot
  walk away from, and nothing in the game moves faster than a player.
- A teammate can also end it — 3.6.5, which is the cooperative half.

Note what is absent. Nothing pursues. Nothing attacks. There is no damage, no health, no line
of sight to break, and no `PathfindingService`. The pressure is that the room is a place you
cannot stay, and the thing you need is in it.

#### 3.6.5 Report, corroborate, concede — the actual verb

This is the interaction the game is built on, and it adds no client→server remotes (3.7).

Every contested set carries two `ProximityPrompt`s:

- **Call it out.** The player reports what they see. The server does not take their word for
  it — it recomputes their lens and records *that* variant. The report reaches every player in
  the room as a caption and an audio cue, phrased inside their own reading of the room: "Ada
  says the door is on the north wall", while you are looking at unbroken plaster.
- **Concede.** The player withdraws their reading in favour of a named other player's.

When every player currently in the room has either reported the same variant or conceded to
it, the set **collapses**: that variant becomes true, for everyone, permanently for the round.
The others are destroyed on the server, the room's incoherence falls by that set's weight, and
a dissolving room stops dissolving.

Three rules make this a decision rather than a chore:

1. **Collapsing is lossy.** The variant you collapse to becomes the only one that ever
   existed. If the fragment was behind the door you conceded away, it is gone — the objective
   stays completable (3.6.6 guarantees it) but by a longer route. Agreement makes the world
   solid, and can make it poorer.
2. **The first corroboration of each set pays.** Two players independently reporting the same
   variant returns stability (3.2.5). A set collapses once, so this cannot be farmed.
3. **A concession is attributable.** The run records who conceded to whom on which set, and
   3.6.7 reads that ledger at the ending. Players should remember who talked them out of what.

A solo player reports and the set collapses immediately, because there is nobody to disagree
with. Solo runs are quieter and much less interesting, which is honest: this is a game about
other people. It must stay *completable* alone without pretending to be *good* alone.

#### 3.6.6 The guarantees that keep this fair

Divergence can trivially produce unwinnable rounds. It must not, and these are unit-testable
rather than hoped for:

- **Every variant of a set is individually traversable.** A `Door` variant never seals a room
  off for the lens that receives it. The builder proves reachability *per lens, for every
  lens* — not for the union of them, which is the easy mistake and hides the bug.
- **At least one route to every objective survives every possible collapse.** If collapsing a
  set could strand the team, that set may not be contested. The collapse space is small enough
  to enumerate: at most 24 sets of at most 4 variants, and only those on the objective's route
  matter.
- **No fragment sits behind more than one contested set.** Two contested doors between the
  team and an answer is a compounding probability, and it is not more interesting than one.
- **Divergence stays at 0 in the first dream at depth 0** until the first objective step
  completes. A player learns the room before the room starts disagreeing with them.
- **Divergence never reaches the top band from time alone.** Its passive rise asymptotes below
  75; only failures buy the fourth lens. A team playing well never meets the worst case, and a
  team playing badly earns it.

#### 3.6.7 Where divergence comes from

One team-wide value, 0–100, server-owned, ledger in `DivergenceConfig`:

| Event | Δ |
|---|---|
| Round start | 0 |
| Per minute elapsed | +1.5 |
| Per minute, per depth level any player is below the surface | +0.5 |
| Failed task attempt | +6 |
| Involuntary descent | +8 |
| Concession later proven false | +10 |
| First corroboration of a set | −3 |
| A set collapsed by agreement | −5 |
| Objective step completed | −12 |

It is the mirror of stability and deliberately not the same number: **stability is what the
team spends; divergence is what the dream does.** A team can be rich in stability and badly
diverged, which is the interesting failure state — plenty of resources and no way to agree on
what to spend them on.

The **concession ledger** — every collapsed set, which variant it collapsed to, who conceded,
and whether that variant turned out to hold the answer — is kept for the whole round. Section
5's Final Layer reads it to decide whether waking up was real.

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
| `DoubtSync` | S→C | own doubt only | — |
| `DepthSync` | S→C | own depth, teammate depths as integers | — |
| `StabilitySync` | S→C | team stability | — |
| `DivergenceSync` | S→C | team divergence, **own lens**, own room's incoherence | — |
| `ReportSync` | S→C | reports and concessions in the room you are in | — |
| `DreamCue` | S→C | `cueId, params` | — |
| `EndingCinematic` | S→C | `endingId` | — |

**Neither the dream stack nor divergence adds a client→server remote.** Bedding down,
descending, kicking, the Limbo call ritual, the wake point, **calling out what you see, and
conceding to a teammate** are all `ProximityPrompt` interactions on world instances, so they
arrive through `RequestInteract` and are validated by tag and distance like everything else.
Reading the totem is `RequestUseItem` on the slot holding it.

That is not an accident of convenience, it is the security property. A report is *"I
interacted with this object"*, never *"I saw variant 3"* — the server derives the variant from
`Divergence.lensFor` and rejects the interaction outright if the instance belongs to a variant
the player was not given (3.6.3, step 4). A client that could name its own variant could claim
to have seen whatever was most useful. If you find yourself adding `RequestReport(setId,
variantIndex)`, you have handed the client the one thing it must never own.

Notice what else is absent: no `GrantCoins`, no `CompleteObjective`, no `DealDamage`, no
`SetDepth`, no `SetLens`. Those are server-internal.

`DivergenceSync` sends a player **their own lens only**. Another player's lens is never
replicated to anyone, at any time, for any reason — it is the single piece of state the whole
design rests on staying private (3.6.3).

### 3.8 Talking is the interface

Section 1 previously excluded chat. It is now **core**, because 3.6.5 does not function
without it: "call it out" tells the room *that* somebody disagrees, and working out *why*
happens between the players.

- **Text chat is the guaranteed channel.** `TextChatService`, default channels, no custom
  transport. Every mechanic must be fully playable with text alone.
- **Proximity voice is an enhancement, never a requirement.** `VoiceChatService` is opt-in,
  needs age verification, and a large share of Roblox players will never have it. Design and
  test as though nobody does; players who do get a better version of the same game, not a
  different game.
- **The in-world channel must work with no chat at all.** Very many Roblox accounts have chat
  disabled entirely and must still be able to play. That is what the report and concede
  prompts are for: structured communication through the world, producing captions rather than
  typed text, carrying everything section 5's tasks strictly require. Chat makes coordination
  *good*; the prompts make it *possible*. If a task cannot be finished by a team using only
  prompts and captions, the task is broken.
- **Cross-depth voice is not a feature.** Roblox proximity voice does not respect 3.2.11, and
  a player one level down should sound wrong. Route cross-depth communication through the
  low-passed positional audio and the report captions, which the server controls.

**NPCs that react to what players say** are typed-chat only. Roblox exposes no speech-to-text,
so there is nothing in voice to react to — do not imply otherwise in store copy. The mechanic:

- A `DreamListener` on specific NPCs subscribes to `TextChatService.MessageReceived` within a
  radius, matches against a **whitelist of keywords declared in config**, and plays a scripted
  response. It never interprets free text and never repeats it.
- Anything a player typed that is displayed or spoken back goes through
  `TextService:FilterStringAsync` first, per recipient, and the unfiltered string never leaves
  the server. This is a Roblox policy requirement, not a nicety.
- **No NPC reaction may be the only route to anything**, for the same reason as above.
- The keyword list is a moderation surface. Keep it small, keep it in config, and never match
  on anything a player would be embarrassed to have the game repeat back at them.

---

## 4. Feature scope, tiered

Build **P0 completely before starting P1.** A finished P0 is worth more than a broken P2.

### P0 — Playable vertical slice (must ship)

**One dream, two depths, two lenses.** That is the slice. It proves the core loop; five dreams
do not make it truer, they only make it longer. And two lenses is not a reduced version of
divergence — it is the whole idea, at its minimum size.

1. Rojo project builds; lint, typecheck, and tests pass.
2. Waking room with beds: lie down to ready up, plain button as the accessible equivalent,
   10 s countdown, cancel-before-start.
3. `MatchService` state machine including `DepthTransition`, 1–6 players, late joiners safe.
4. Dream 1 (The House) built from descriptors at **depth 0 and depth 1**, the second produced
   entirely by `LayerDistorter` — no second authored layout.
5. The five-symbol task, with its answer a seeded fragment placed at depth 1.
6. Descent from all three triggers, and a working kick, both through `DepthTransition`.
7. Team-wide stability with the full ledger, the 0-stability lockout, and its audio tell.
8. **Divergence at two lenses**: at least four contested sets in the House, per-lens hiding,
   the `Lens`/`Player` collision groups, and the server rejecting an interaction with a variant
   the player was not given.
9. **Report, corroborate, concede, collapse** — the full 3.6.5 cycle, including the lossy case
   where the fragment was behind the conceded variant.
10. Team divergence with its ledger, the lens-count thresholds, and the pin at 0 until the
    first symbol is found.
11. Room incoherence, dissolution with its telegraph, walking out to cancel it, and involuntary
    descent when it completes.
12. Item + inventory system, 6 slots, server-authoritative, `ProximityPrompt` pickups.
13. Flashlight with battery drain, flicker, findable batteries, and the assertion behaviour.
14. Doubt with its response curve, including the odd-one-out term.
15. Sedative clock, wake point, and the synchronised-kick finale.
16. Text chat working, reports rendered as captions, and a full layer completable with chat
    disabled.
17. HUD: objective, stamina, battery, doubt, inventory, **own depth, teammate depths**,
    stability, divergence, sedative timer. Plus the totem.
18. DataStore save/load of coins, XP, level, with session locking and `BindToClose`.
19. Rate limiting and validation on every remote.
20. Mobile + gamepad input parity via `ContextActionService` and `ProximityPrompt`.

### P1 — Full content
21. Layers 2 (School), 3 (Endless Corridor, procedural), 4 (Hospital), 5 (Broken Dream), and
    the Final Layer, each with fragments authored for depths 1–3 and its own contested sets.
22. Depths 2 and 3, Limbo, and the call ritual that pulls a teammate out of it.
23. Three and four lenses, and the depth scaling of divergence.
24. The corridor's **rule pool** — at least five rules, seeded, each deducible by comparing
    reports. This is the single highest-value item in P1.
25. The Hospital's simultaneous-anchor task, and its solo decay-timer variant.
26. `RandomEventService` with the five rarity tiers.
27. Puzzle system (symbol order, codes, switch sequences, audio cues), all seed-derived.
28. At least one task per dream that is *easier* with a teammate parked one level down.
29. Dream transitions with portals, loading screen, per-dream lighting/audio profiles.
30. Cross-depth teammate audio: one boundary, low-passed and delayed; two is silence.
31. Proximity voice as an enhancement, with everything still playable without it.
32. NPC `DreamListener` keyword reactions, filtered, never gating anything (3.8).
33. Rewards, XP curve, levels, collectibles.
34. The Final Layer's decision and all its resolutions, including Split.
35. **Localisation scaffolding.** Every player-visible string goes through a `Strings` module
    keyed by identifier, backed by a `LocalizationTable`, from the first line of UI. Only
    English need be filled in. Doing this on day one is nearly free; retrofitting it means
    touching every UI file, and the Turkish, Portuguese and Russian audiences on Roblox are
    each large enough to be worth not locking out by accident. It matters more here than in
    most games: a game whose core loop is players describing rooms to each other is a game
    people will want to play in their own language.
36. **First-party analytics.** `AnalyticsService` funnel events for the moments that decide
    whether the design works: bedded down, first descent, first kick, first fragment found,
    **first report, first concession, first collapse that lost a fragment**, stability hit
    zero, divergence hit the top band, reached Limbo, woke up. This is Roblox's own service,
    so it does not conflict with the "nothing outside Roblox" non-goal in section 1 — and
    without it, tuning two coupled ledgers is guesswork.

### P2 — Economy and polish
37. Shop with a `sku`-driven catalogue, every entry declaring its `category` (4.1).
38. Gamepasses — the nine in 4.2. **`ProcessReceipt` assigned exactly once**, in one module.
39. Developer products — the two in 4.3, plus the receipt-idempotency machinery.
40. The Nightmare Pass season track (4.4), free and paid lanes, cosmetics only.
41. Secrets, hidden rooms, NPC dialogue in the waking room, daily reward.
42. Nightmare modifiers: a `ModifierDescriptor` layer over the existing descriptors
    (*No Flashlight*, *Four Lenses From The Start*, *Silent* — no reports, only chat —
    *Fragile*, *Inverted*), rotating on a seed derived from the week number. Zero new art,
    zero new levels, a different game weekly.
43. Private-server compatibility (`game.PrivateServerId ~= ""` → same rules, saving intact).

---

## 4.1 The balance guardrail, as a test rather than a hope

A player who has spent nothing must be able to reach every ending. That sentence is easy to
agree with and easy to violate, so here it is as something you can actually apply:

> **The observer test.** Put two players in the same round: one has spent nothing, one has
> bought everything. An observer watching *the round* — not the lobby, not the results
> screen — must not be able to tell which is which from what happens.

Anything that fails that test is forbidden no matter how it is priced, bundled, or named.

**The three permitted categories.** Every purchasable entry declares exactly one:

| `category` | What it may touch | Example |
|---|---|---|
| `Appearance` | How you and your things look, to you and to others | Totem skin, sleepwear, nameplate |
| `OwnHistory` | Information about runs **you have already finished** | Dream Journal |
| `OutOfRoundRate` | How fast cosmetic currency and levels accrue | Double coins, XP boost |

There is no fourth category. If an idea needs one, it fails the test.

**Machine-checked, not reviewed.** `ConfigValidator` rejects the build when any catalogue
entry declares a category outside those three, when a paid entry sets
`grantsGameplayAdvantage`, or when a developer product declares anything but
`OutOfRoundRate`. A guardrail nobody enforces is a comment.

### Why `OwnHistory` is narrow on purpose

The Dream Journal may show which dreams you have cleared, your personal bests, and the
fragments you personally found **in runs that are already over**. It may never show anything
about the round in progress, and it may never show a fragment's location for the current
seed. Fragment payloads are derived from the round seed precisely so that knowledge cannot be
looked up (3.2.2); selling a lookup would undo the single strongest replayability lever in
the project.

---

## 4.2 Gamepasses

Nine, all one-time and permanent. Every id lives in `AssetConfig.gamepasses`, defaults to
`0`, and the game must be fully playable with all of them unset.

| Pass | Grants | `category` |
|---|---|---|
| **VIP** | Nameplate, chat colour, a private alcove with your own bed in the waking room, one exclusive emote, +25% coins | `Appearance` + `OutOfRoundRate` |
| **Sleepwear Pack** | Outfit set — pyjamas, hospital gown, nightshirt, bare feet | `Appearance` |
| **Totem Collection** | Totem skins. Identical read time, identical cooldown, identical truth | `Appearance` |
| **Flashlight Skins** | Housing and beam colour. **No** range, battery, or detection change | `Appearance` |
| **Emote Pack** | Extra emotes, usable in the waking room and mid-dream | `Appearance` |
| **Dream Journal** | Your finished-run history, per 4.1 | `OwnHistory` |
| **Waking Room Décor** | Decorate your bed area; other players see it | `Appearance` |
| **Double Coins** | Coin rate, stacking additively with VIP, capped at ×2 total | `OutOfRoundRate` |
| **Founder's Mark** | Time-limited on sale, permanent once owned: nameplate and badge | `Appearance` |

### One deliberate removal: the Premium Flashlight tier

Earlier drafts sold a flashlight tier with up to 20% more range, capped by the guardrail.
**Cut it.** It fails the observer test outright — the paid player's light visibly reaches
further, in the round, in front of everyone.

All three tiers (Basic, Advanced, Premium) stay in the game and stay findable as loot. What
is sold is the *skin*. This costs one revenue line and buys the only thing that makes the
other eight defensible.

---

## 4.3 Developer products

**No developer product may affect a round in progress.** Two survive that rule:

| Product | Grants | `category` |
|---|---|---|
| **Coin Pack** | Cosmetic currency | `OutOfRoundRate` |
| **XP Boost** | Doubles XP for a period | `OutOfRoundRate` |

### Two deliberate removals

**Revive.** Under the dream stack nobody dies. A player whose room dissolves under them
descends (3.2.3), so a purchased revive is not a second chance at life — it is a **purchased
kick**, and 4.5 forbids selling mobility. This is the clearest example of a redesign
invalidating an old monetization assumption; resolve it by removing the product, not by
carving an exception.

**Temporary Protection.** It protected against the monster, and there is no monster. Even
reworked into something divergence-shaped — a room that dissolves more slowly for you, a
lens that agrees with more people — it fails harder than before: it would sell an advantage
in the one system the whole game is made of, and an observer would spot the buyer inside a
minute. Do not rework it. It was never defensible in either design.

Receipt handling is unchanged and non-negotiable: exactly one `ProcessReceipt` assignment,
`PurchaseId` recorded in the same `UpdateAsync` that grants, `NotProcessedYet` on any failure.

---

## 4.4 The Nightmare Pass

A season track that rotates with the weekly modifier (P2 item 32), with a free lane and a
paid lane. **Cosmetics only, in both lanes.** Progress comes from playing: dreams cleared,
teammates corroborated, fragments found, wakes survived.

This is the commercially serious part of the catalogue, and it is fully compliant, because a
cosmetic track rewards time rather than selling advantage. Note the honest trade: a game that
refuses to sell power earns less per paying player and must earn it back on volume and
retention. That is the deal this specification is making on purpose.

Private servers are Roblox's own feature and a separate revenue line; P2 item 33 already
requires that a private server run identical rules with saving intact.

---

## 4.5 Forbidden, with reasons

Not a style preference. Each of these has been considered and rejected:

| Forbidden | Why |
|---|---|
| Extra inventory slot | Six slots is a puzzle constraint (3.5), not a convenience limit |
| Second totem, or a faster totem read | Information is what depth costs you (3.2.13) |
| Stability top-up | Stability *is* the run's difficulty (3.2.5) |
| Cheaper, free, or extra kicks | Mobility is the other thing depth costs you (3.2.4) |
| A starting item, key, or fragment | Skips the objective chain |
| Slower dissolution, a friendlier lens, or any divergence advantage | It sells the one system the game is made of (3.6) |
| Seeing a teammate's lens, or which variant they were shown | It replaces the conversation the game exists to create |
| Skipping a depth or a dream | A content gate by another name |
| Choosing or rerolling the weekly modifier | Everyone plays the same week |
| Seeing a teammate's position, or depth beyond what all players see | 3.2.11 shows names and depth, never position |
| Paid loot boxes or randomised crates | Roblox policy, and the audience is 13+ |
| Anything priced in Robux that changes a live round | The observer test, restated |

If a proposed item is not on this list and not obviously in one of the three categories,
it is forbidden by default. The burden is on the item.

---

## 4.6 Achievements, friends, and optional content

Everything in this section is measured against the observer test in 4.1 before it is measured
against anything else. Several of these ideas are only safe in one specific shape, and the
shape is the point.

### Badges and achievements

Roblox badges, granted by `BadgeService`, ids in `AssetConfig.badges`, all `0` until published.
They are a record of what happened, shown on a profile, and they grant **nothing** — no
currency, no cosmetic, no stability, no shortcut. A badge that unlocks something stops being a
record and becomes a gate.

Grant them for the things this design is actually about, not for playtime:

| Badge | For |
|---|---|
| **First Waking** | Wake up once |
| **Never Fell** | Clear a dream without descending involuntarily |
| **Down and Back** | Kick out of depth 3 |
| **Called Back** | Pull a teammate out of Limbo |
| **Alone Down There** | Wake from a solo run |
| **Sleepless** | Reach every ending |

`Alone Down There` and `Never Fell` are the two worth caring about: one says a player learned
the loop well enough not to need it, the other says they beat it without a team.

### Playing with friends

- `SocialService:PromptGameInvite` in the waking room. A game whose core loop is arguing
  about a door is a friends game before it is anything else, and the invite is one button.
- **Private dream rooms** are Roblox private servers, already required to run identical rules
  with saving intact (P2 item 33). That is the friend-group experience: six people who chose
  each other, no strangers, same game.
- A **friend bonus is permitted only out of round**: extra coins and XP when you wake with
  someone on your friends list. That is `OutOfRoundRate` and it survives 4.1.
- A friend bonus that touched a live round — more stability, cheaper kicks, a longer
  sedative, or friends placed on the same lens — would fail the observer test immediately,
  and is forbidden by 4.5 like any other. The lens one is the tempting one and the worst:
  putting friends on matching lenses would quietly delete the game for the group that
  bought it.

### Optional bonus puzzles

Every dream carries one or two **optional** puzzles, placed at depth ≥ 1, that no objective
requires. They exist to give descending a second reason and to reward a team that is ahead of
the clock.

- Solving one grants a collectible (feeding the Secret Ending) and stability, never an
  objective step. The critical path stays the critical path.
- They are **never sold, never gated, and never behind a gamepass.** A paid bonus puzzle is a
  content gate wearing a nicer name, which 4.5 forbids.
- They are seeded like everything else, so which ones appear varies by round.
- At least one per dream must be *harder* than the objective it sits beside. Optional content
  that is easier than the main path is filler.

### Dream effects, and the line through the middle of them

"Special dream effects" splits into two piles, and only one of them may ever be sold:

| Sellable | Forbidden |
|---|---|
| How **you** look to others: a trailing wake, a distorted silhouette at depth, a totem's glow | How the **dream** looks to you |
| Cosmetic flourishes on your own emotes and animations | Anything that brightens, de-fogs, de-noises, or steadies what you perceive |
| A personal effect on your own bed in the waking room | Anything that makes a fragment easier to read, or a distortion easier to see through |

The rule underneath: **you may buy how you appear, never how you perceive.** Section 3.2.12
already makes perception the thing depth costs you, so selling clarity would sell the game
itself. Every purchasable effect declares `category = "Appearance"` and ConfigValidator holds
it there like any other entry.

### Replayable random events

`RandomEventService` and its five rarity tiers are already required (P1 item 20), and section
11 already binds three of them to produce no threat at all. Two additions the dream stack
makes possible:

- **Events are depth-aware.** The same event id reads differently at depth 2 than at the
  surface — the harmless ones especially, because a moved chair means something else when the
  room is already wrong.
- **A rare event may reference your own history**, but only through the `OwnHistory` channel
  in 4.1: a bed made up the way you left it in a run you already finished. Never another
  player's history, and never anything about the round in progress.

Both are seeded, so a round remains reproducible from `roundId` and its seed, and two players
describing the same round to each other are describing the same thing.

---

## 5. Content spec per layer

Six layers. Five are a task; the sixth is a question.

The ladder is deliberate — each dream teaches one way of using divergence and the next
assumes you learned it. **Do not reorder them.**

| # | Layer | The waking task | What it teaches |
|---|---|---|---|
| 1 | The House | Find five symbols | That the room shows different things to different people |
| 2 | Abandoned School | Discover the right order | That a teammate's reading is data, not noise |
| 3 | The Endless Corridor | Work out the rule the world is running on | That the divergence itself is legible |
| 4 | Dream Hospital | Three points, activated together | That agreement has to survive being split up |
| 5 | The Broken Dream | Find which one is real | That collapsing a set is a choice with a cost |
| — | The Final Layer | Decide whether to wake | Whether any of it was worth agreeing to |

**Everything below describes depth 0.** Depths 1–3 are generated from these descriptors by
`LayerDistorter` (3.2.2) and are never authored by hand. What *is* authored per dream is its
`depthFragments` — the answers, and which level down each one lives on — and its
`variantSets`: the places where the dream is allowed to disagree with itself.

**Layer 1 — The House. Find the five symbols.**
Bedroom, hallway, kitchen, bathroom, living room, basement, yard. It starts ordinary, and
that is mechanical rather than atmospheric: divergence is pinned at 0 until the first symbol
is found (3.6.6), so for the first few minutes the House is the same house for everybody.
Then it stops being.
Five symbols are hidden in it. **Two are plain**, so the task is legible before anyone
understands the system; **three sit in rooms with contested sets**, so a player ends up
staring at a wall while a teammate describes an alcove. The two that matter most are behind a
`Door` set and an `Extent` set, which is where a team first says "there is no door there" out
loud and discovers that both of them are right.
Abnormalities escalate on objective progress, not a wall clock: a photograph's subject
changes, a clock's hands stop, a door is where a wall was, a window shows the hospital from
layer 4.

**Layer 2 — Abandoned School. Discover the right order.**
Classrooms, lockers, cafeteria, gym, library, principal's office, long corridors. Fluorescent
flicker, a bell that rings when nobody is near it, a silhouette at the end of a corridor that
is gone when the beam sweeps back — none of it a threat, all of it a `Prop` or `Extent` set
resolving differently for two people.
The five symbols from layer 1 have an order, and the order is written down nowhere as a list.
It is distributed: each lens is shown a **different subset** of the ordering clues — a number
scratched into a desk, a class register, a locker combination, a timetable — and no single
lens holds enough. **The task cannot be completed from one reading**, which is the point.
For a solo player the same clues are split across depths instead of across people: the
fragments at depth 1 and depth 2 hold the halves that two players would otherwise pool. Slower
and lonelier, never impossible.

**Layer 3 — The Endless Corridor. Work out the rule.**
Fully procedural, seeded. A modular segment system assembles a corridor graph with loops, dead
ends, and 4–7 candidate exits.
Here divergence is not decoration, it is the puzzle. The corridor runs exactly one **rule**
this round, drawn from a seeded pool, and the rule decides which lens sees what:

- the corridor is longer for whoever is carrying the light;
- a door exists only for players who have not reported anything in the last minute;
- the corridor extends behind whoever is walking alone;
- your exit is the one the player who conceded to you cannot see;
- the corridor is shorter every time somebody agrees in it.

The rule is never stated. It is deduced by comparing reports across the team — *"it got longer
when you took the torch"* — and the true exit is the one the rule points at. The generator
places clues so the rule is **findable, never a coin flip**, and the round seed picks it, so
it cannot be looked up on a wiki. Solo, the rule is deducible by carrying and dropping the
light, walking alone and not, and watching what changes.
This is the layer the entire design exists to make possible. If content has to be cut, build
this one second, immediately after the House.

**Layer 4 — Dream Hospital. Three points, together.**
Reception, patient rooms, operating theatres, ER, elevators, basement labs. Heartbeat
monitors, a PA system, radio static, emergency lighting.
Three anchors in three wings must be active inside the same
`DivergenceConfig.synchroniseWindowSeconds`. The wings are far enough apart that the team must
split, and splitting is the cost: alone in a wing, nobody can corroborate you, your reports go
uncontested, incoherence climbs, and rooms start dissolving under people who cannot afford to
walk out of them. You are holding an anchor and the floor is going.
The medical records are still here and still forged; cross-referencing dates, names and room
numbers across records is how you learn which anchor is which. Submitting a forged record
costs an attempt and raises divergence.
**Solo rule:** the three anchors become holdable in sequence by one player against a decay
timer (`DivergenceConfig.anchorDecaySeconds`) rather than simultaneously. Slower, harder,
always possible. A task that genuinely required three people would make the stated 1–6 range
a lie.

**Layer 5 — The Broken Dream. Find which one is real.**
Reality failing: floating rooms, inverted buildings, impossible stairs, duplicated props, a
distorted skybox, fragments of layers 1–4 hanging in the void.
Five dream anchors, and the sequence that activates them is a fragment held at depth 3 — so
this is the one layer where descending is the intended route rather than a setback. The fifth
anchor cannot be reached from the surface at all.
Every anchor here is a contested set with four variants and no plain option, so the team must
collapse each one to proceed. Collapsing is lossy (3.6.5), which makes the run's last real
decision *which reading of reality to make true*. Get them right and the collapse begins: a
90-second countdown, geometry destroyed progressively behind the players, and the way up.

**The Final Layer — is waking up an exit?**
The team kicks out of layer 5 and arrives in the waking room. It is the room they started in.
The beds are there, their bodies are not, and the door to outside is open.
This is not a puzzle. It is a decision taken together at the wake point, and the run's own
history decides what it means. Read the concession ledger (3.6.7):

- **Wake.** If the team's collapsed sets were mostly the variants that actually held the
  answers, they wake — *Coherent Waking*, the good ending: the dream agreed with itself
  because they made it agree. If most of their agreements were the wrong ones, they wake into
  the waking room again, and on the third repetition a player will notice the door is on the
  other wall. *Recursive Waking* is not a punishment; it is the answer to the question.
- **Stay.** Refuse the door. Open only to a team that found the run's hidden collectibles, and
  it is the *Secret Ending*: they stop trying to agree with each other, and the layers stop
  disagreeing. The dream becomes coherent because nobody left it.
- **Split.** Some wake, some stay. This must be permitted and must resolve correctly per
  player. It is the ending players will describe to somebody afterwards, and forbidding it
  would make the whole decision fake.

The Bad Ending belongs to the sedative clock, not to this room: run out of time, or kick while
a teammate is still deep, and the run ends without the question ever being asked.
---

## 6. Doubt, light, and audio design rules

**Doubt.** The system previously called fear, renamed in code as well as here, because the
name was shaping the design. 0–100, server-owned, replicated to the owning client only.

Rises:

- standing in a room whose incoherence is above zero, scaled by how far above;
- **being the odd one out** — your lens matches nobody else's in the room. This is the largest
  single source and it is exactly right: the frightening thing in this game is being the only
  person who can see something;
- being alone (> 60 studs from every teammate) in a contested room;
- a set you conceded to being proven false later;
- standing in darkness; witnessing a rare event.

Falls: corroborating a teammate, a set collapsing by agreement, objective progress, a safe
zone, standing beside someone who shares your lens.

Effects gate at 25 / 50 / 75 / 90 and must be **subtractive, never obstructive**: heartbeat
and breathing audio, a slow vignette, mild chromatic aberration, an occasional peripheral
whisper, and above 90 a **false report** — a caption naming a teammate who did not say
anything. It never damages, it is always contradicted within thirty seconds by that teammate's
real report, and it is the only place in the entire game where the HUD lies about another
player. Never blur the screen to the point of unplayability. Never lock input.

**Light.** Three flashlight tiers — Basic, Advanced, Premium — differing in battery capacity,
beam range, and recharge convenience. **All three are findable loot; none is purchasable**
(4.2). What is sold is the skin: housing and beam colour, with range, battery and behaviour
identical across every skin. Drains only while on, flickers below 15%, dies at 0, recharges
slowly when off. Batteries and the better tiers spawn per layer from the seeded loot table, so
a tier is something a run gives you, never something an account has.

The trade-off that used to be *the monster notices you* is now sharper. **Light forces
resolution.** A contested set held in a beam for two seconds snaps hard to your lens's
variant — loudly, audibly to everyone in the room — and adds `DivergenceConfig.assertionWeight`
to that room's incoherence. You made the room commit to your version of it. That is exactly
what you want when you are alone and need to see, and exactly the wrong thing to do in a room
three people are already standing in.

**Audio.** One `SoundGroup` per category (Ambient, SFX, World, UI, Music) so settings can mix
them. All world sounds are parented to parts with `RollOffMode = InverseTapered`. Rules: no
more than one stinger per 90 seconds; at least one deliberate 20-second silence per layer; a
room's dissolution must be audible before it is visible. Every sound ID may be empty and the
game must still function.

**Accessibility is load-bearing, not optional.** The core loop of this game is communication,
which makes exclusion both easy and cheap to avoid. Required:

- **Captions for all gameplay audio and every report**, on by default the first time and
  toggleable. Reports and concessions are **captions first and audio second**, not the other
  way round — that ordering is what makes the game playable for a deaf player and for a player
  with chat disabled, at the same time and with the same feature.
- **A directional audio indicator.** An arc at the screen edge pointing at the source of any
  gameplay-relevant sound, fading with distance. Direction and rough proximity only, never an
  exact position: it conveys what hearing conveys and nothing more.
- **A photosensitivity setting** capping flicker rate and depth across the fluorescent
  profiles, the flashlight, the dissolution effect and every distortion. Reachable before the
  first round, not buried mid-run. It is a health matter and it is not the same control as
  `ReducedMotion`.
- Neither the indicator nor the captions may reveal anything the audio does not already carry
  — never another player's lens, never a variant they were shown. They translate the channel;
  they do not widen it.
---

## 7. Configuration

Every tunable value lives in `shared/Config/`, one module per domain, all `--!strict`, all
exporting a frozen table with a documented type:

`GameConfig` · `LayerConfig` · `DepthConfig` · `DivergenceConfig` · `ItemConfig` ·
`ShopConfig` · `ProductConfig` · `DoubtConfig` · `FlashlightConfig` · `AssetConfig` ·
`EventConfig` · `RewardConfig` · `DebugConfig`

`DepthConfig` owns everything in 3.2: `maxDepth`, `limboDepth`, the stability ledger, kick
costs, `dissolveSeconds`, `anchorHoldSeconds`, `maxConcurrentLayers`, `layerYSpacing`,
`layerDestroyGraceSeconds`, and the per-depth distortion curve.

`DivergenceConfig` owns everything in 3.6: `maxLenses`, the `lensThresholds` that turn a
divergence value into a lens count, the divergence ledger, `dissolveThreshold`,
`assertionWeight`, `graceSecondsAfterLayerEnter`, `graceAppliesToDescentFromDissolvingRoom`,
`synchroniseWindowSeconds`, `anchorDecaySeconds`, and the NPC keyword whitelist (3.8).

Rules:

- No magic numbers anywhere else in the codebase. If a number affects gameplay, it is in a
  config.
- `DebugConfig` exposes `forceSeed`, `skipToLayer`, `forceDepth`, `forceLens`,
  `freezeDivergence`, `infiniteBattery`, `infiniteStability`, `verboseLogging`. All default
  `false`/`nil` and are ignored unless the place is in Studio (`RunService:IsStudio()`).
  `forceLens` is the one that makes 3.6 testable at all by a single developer: it lets one
  person walk the same room twice and see both readings.
- Configs are validated at startup by a `ConfigValidator` that errors loudly on a malformed
  entry rather than failing silently mid-round. The fairness guarantees in 3.6.6 and the
  monetization guardrail in 4.1 are enforced there, because a rule nobody checks is a comment.
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

- corridor generator: same seed → identical graph; exactly one reachable true exit; no
  orphaned segments; segment count within configured bounds.
- objective machine: each `ObjectiveKind` completes only on valid events; duplicate events do
  not double-count; optional objectives do not gate completion.
- inventory: capacity enforced, invalid slot indices rejected, combination recipes.
- doubt model: monotonic under sustained incoherence, decays to 0 in a safe zone, clamped
  0–100, and rises fastest for a player whose lens matches nobody else's in the room.
- receipt idempotency: the same `PurchaseId` grants once across simulated retries.
- data migration: a v1 profile upgrades to the current schema with no field loss.
- rate limiter: a burst above budget is rejected and recovers after the window.
- distortion: `Distortion.forDepth` is monotonic in the fields that should be (light range
  falls, `divergenceScale` rises), clamped at `maxDepth`, identical for identical input.
- layer distorter: `apply(d, 0, seed)` returns a descriptor equivalent to `d`; the same
  `(d, depth, seed)` always produces an identical table; room and doorway counts are preserved
  so a distorted layer is never made unreachable.
- fragment placement: every objective needing a fragment has exactly one reachable fragment at
  some depth ≥ 1; two different seeds produce two different payloads.
- stability ledger: a pure `applyEvent(stability, event) -> stability` clamps to 0–100, and a
  scripted sequence of failures reaches 0 in the expected number of steps.
- kick legality: refused at 0 stability, refused from Limbo, always available at depth ≥ 1
  with stability, and raises depth by exactly one.
- descent: all three triggers produce the same depth delta; descending from `maxDepth` yields
  Limbo; nothing descends past Limbo.

And, for section 3.6, the tests that make divergence shippable rather than hopeful:

- **lens count**: monotonic in divergence, never exceeds `maxLenses`, is exactly 1 below the
  first threshold, and is clamped rather than erroring outside 0–100.
- **lens assignment**: deterministic for the same `(playerKey, seed, lensCount)`; at
  `lensCount = 1` every player is on lens 1 — the "the dream agrees with itself" case must be
  exact, not merely likely.
- **lens sharing**: with 6 players and 4 lenses, at least two players share a lens. This is the
  property the whole cooperative design rests on, so assert it rather than assuming it.
- **variant wrapping**: a set with 2 variants resolves to a valid index for all 4 lenses, and
  two lenses that wrap to the same variant genuinely agree.
- **room incoherence**: zero when one lens is present, strictly increasing in the number of
  distinct lenses present, strictly increasing in the depth scale, and unchanged by adding a
  second player who shares an already-present lens.
- **dissolution**: a room crosses `dissolveThreshold` only above it; collapsing a set drops
  incoherence by exactly that set's weight; a room below threshold never dissolves.
- **the fairness guarantees of 3.6.6, as tests, not prose**: every variant of every shipped set
  is traversable for its lens; at least one route to each objective survives every collapse
  combination on that objective's route; no fragment sits behind two contested sets; the
  passive divergence rise over a full `sedativeSeconds` round never reaches the top band.
- **collapse is lossy but never fatal**: collapsing every contested set to its *worst* variant
  still leaves each objective completable.
- **the divergence ledger**: clamped 0–100; an objective step always lowers it more than a
  failed attempt raises it, or a team that is playing well still drowns.

Target: **≥ 40 assertions across ≥ 8 suites.** Tests that only assert `require` succeeded do
not count.

### 8.2 Manual (write it, do not claim to have run it)

Produce `game/TESTING.md` — a Studio checklist a human executes, with expected results: solo
run, 2-player, 6-player (Studio local server), a room dissolving under one player, a report
and a concession between two players, a collapse that loses the fragment, a purchase flow with
a real product ID, a player leaving mid-round, a player joining mid-round, save/rejoin
persistence, shop purchase paths, every objective type, every layer transition, mobile
emulation, gamepad emulation, private server.

Two checks matter more than the rest and are easy to skip because they need two machines:

- **Two clients, same room, different lenses** (use `DebugConfig.forceLens`): confirm each sees
  a different variant, that neither can interact with the other's, and that the collapse
  resolves for both.
- **A client with chat disabled** completes a full layer using only prompts and captions (3.8).

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
- [ ] **No player's lens is ever replicated to another player**, in any payload, at any time.
- [ ] **The lens salt is never replicated, and is not derived from the round seed** or from
      anything else a client can read (3.6.2). Grep the snapshot and every S→C payload for it.
- [ ] **A report records the variant the server computed, never one the client named**, and an
      interaction with a variant the player was not given is rejected and logged (3.6.3).
- [ ] Objective state cannot be advanced by a client message alone.
- [ ] Teleports, respawns, descents and kicks are server-initiated only.
- [ ] Any string from a client is length-capped and never used to index a table directly
      without a whitelist lookup.
- [ ] **Chat text a player typed is filtered through `TextService:FilterStringAsync`, per
      recipient, before anything echoes it**, and the unfiltered string never leaves the
      server (3.8).
- [ ] Failed validation is logged with the player and reason, and does not error the thread.
---

## 10. Milestones and commit discipline

Do **not** generate the whole project in one pass. Work in these milestones; after each, run
the automated checks and commit before continuing.

| # | Milestone | Definition of done |
|---|---|---|
| M1 | Tooling + architecture skeleton | `rojo build` succeeds; lint/typecheck/test commands run; service lifecycle, Remotes, Trove, Rng, scheduler, configs exist and are tested |
| M2 | Waking room + match state machine | 1–6 players bed down, count down, cancel, transition; late join safe; round state unit-tested |
| M3 | Dream 1 + builder + props | `LayerDescriptor` → instances; the House playable end to end at depth 0; part budget met |
| M4 | Distortion + depth 1 | `Distortion` and `LayerDistorter` pure and unit-tested; depth 1 built from the same descriptor; two layers alive at once inside budget |
| M5 | Descent, kick, stability | All three descent triggers, kick, the stability ledger, the 0-stability lockout; every rule in 3.2 unit-tested |
| M6 | **Divergence: lenses and variants** | `Divergence` pure and unit-tested; variant sets built; per-lens hiding and the ten collision groups working with two clients; the server rejecting a foreign variant |
| M7 | **Reports, concession, collapse** | The two prompts, corroboration, collapse, the lossy-collapse case, and the concession ledger; 3.6.6's guarantees enforced as tests |
| M8 | Items, inventory, interactions, objectives, fragments | Objective chain completable solo, requiring a real descent to find its seeded fragment; all server-validated |
| M9 | Incoherence, dissolution, doubt, light | Rooms dissolve and stop dissolving; walking out always works; doubt responds to being the odd one out; the flashlight assertion |
| M10 | Chat, captions, accessibility | Text chat, reports as captions, the directional indicator, the photosensitivity setting; a full layer completed with chat disabled |
| M11 | Sedative clock + waking + the Final Layer | Timer, wake point, synchronised kick, Limbo, the call ritual, and all endings including Split |
| M12 | Dreams 2–5, depths 2–3, procedural corridor, events | Seeded generation tested; all six layers and every depth reachable; the corridor's rule pool |
| M13 | Data, rewards, XP, levels | Session locking, migration, `BindToClose` verified |
| M14 | Shop, gamepasses, products, season track | Every entry declares a category; ConfigValidator rejects a fourth; works fully with all IDs set to `0` |
| M15 | Secrets, endings, modifiers, replayability | Every ending reachable; collectibles persist; modifier rotation deterministic |
| M16 | Mobile/console, optimization, security pass | Budgets measured with three concurrent layers and every variant built; checklist in §9 signed off |
| M17 | Polish + documentation | README, TESTING.md, config documentation complete |

M6 and M7 are the two that decide whether this game exists. If they slip, cut content from
M12, never from them: five dreams over a system that does not work is five times nothing.

Commit message format: `M<n>: <what changed>`. One milestone per commit minimum, more is fine.
Never commit a state where `check.sh` fails.
---

## 11. Design philosophy (binding, not decorative)

Doubt over threat. Concretely, these are **requirements**, not preferences:

- **Nothing in this game chases the player.** No entity pursues, attacks, or damages. If a
  proposed feature needs one, the proposal is wrong. The tension comes from disagreement and
  from the clock, and both of those are things the players produce themselves.
- **A player must be able to complete a full layer without ever entering `Dissolving`.**
  Dissolution is what happens when a team stops talking, not a tax on playing well.
- At least three implemented events produce **no** mechanical effect at all — they only make a
  player doubt what they saw. A prop that moved. A door that is open now. A teammate's report
  that matches nothing in front of you.
- Rare events (< 2% per round) must be memorable enough that a player would describe them to
  somebody else afterwards. Implement at least five, gated behind the seeded RNG.
- Silence is a tool: the ambient bed must fully drop out at scripted moments, and a room going
  quiet must always mean something.
- Nothing may flash, strobe, or shake hard enough to be uncomfortable. `ReducedMotion` halves
  camera shake and disables chromatic aberration, and persists in the profile.

The target feeling is ***"are you looking at the same thing I am?"*** A system that can only
produce certainty is the wrong system — and a system that can only produce confusion is worse.
**Every disagreement in this game must be resolvable by two people talking to each other.**
That sentence is the line between a psychological puzzle and a broken build, and it is the one
to check a new idea against before building it.
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
8. **Grep confirms zero occurrences of `PathfindingService`, `Humanoid:TakeDamage`, and
   `Health` in gameplay code.** Nothing in this game hunts anyone, and the cheapest way for
   that to erode is for somebody to add "just a little" of it back.
9. **Grep confirms no payload sent to a client contains another player's lens.**

**Human-verifiable (documented in `TESTING.md`, not claimed as tested):**

10. The full player journey — enter the waking room, lie down, go under, explore dream 1,
    watch it start disagreeing with itself after the first symbol, argue with a teammate about
    a door, concede, watch the room become solid, fail a task and *fall* rather than die, find
    the fragment below, kick back up, apply it, be caught in a dissolving room and walk out of
    it, be caught in one and not, reach Limbo and be pulled out, advance through layers 2–5,
    deduce the corridor's rule, collapse an anchor to the wrong variant and finish anyway,
    reach the Final Layer, take the decision, receive rewards, return to the waking room, save,
    rejoin with progress intact, purchase safely, and replay to find both the seeded answers
    and the corridor's rule are different — is walkable in Studio.
11. **Two clients on two machines, in one room, on different lenses**, complete a report →
    concession → collapse cycle correctly (3.6.3). This one cannot be faked from a single
    client and it is the thing most likely to be quietly skipped.

**Reported honestly:**

12. `game/README.md` states exactly what was implemented, what was stubbed and why, which
    asset/product IDs must be filled in before publishing, and which checks were run versus
    which require Studio.

If a system cannot be completed, say so explicitly in the README and in your final message. A
truthful "the corridor's rule pool has two rules implemented of five" is worth more than a
silent gap.
