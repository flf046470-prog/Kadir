# GO VIRAL — Build Specification

> Build prompt for an autonomous coding agent. Sections 0–4 are binding constraints;
> sections 5–14 are the design and delivery spec. Where they conflict, 0–4 win.
>
> Companion document to `docs/dream-layers-prompt.md`. That game is slow, dark and
> atmospheric. This one is fast, bright and loud. They share engineering discipline and
> share nothing else.

---

## 0. The concept, in one paragraph

You are a street performer in a city square. You do stunts. People stop and watch. The
people who watch you **physically follow you around** — a visible, growing crowd trailing
behind your character. Your crowd is your score, and everyone can see it from across the
map. The bigger your crowd, the slower and clumsier you move, the more attention you draw,
and the more you have to lose — because any other player can **steal your crowd** by
out-performing you within earshot. Rounds are eight minutes. At the end you cash your crowd
out for permanent upgrades, or gamble it on one last stunt.

Working title: **GO VIRAL**. Section 12 covers shipping names.

---

## 1. Why this design has trend potential — and what that claim is worth

Be clear-eyed: virality is not engineerable. What *is* engineerable is the set of properties
that trending Roblox games reliably share. This design targets them deliberately, and you
should preserve them when you make implementation trade-offs.

| Property | How this design gets it |
| --- | --- |
| **Instantly legible from a thumbnail** | A tiny player dragging a huge crowd is one image that explains the whole game with no text. |
| **Score is physical, not a UI number** | The crowd is rendered in the world. Players read each other's standing at a glance, without opening a leaderboard. |
| **A clip moment every few minutes** | Losing a 400-person crowd to one steal, at second 470 of 480, is a complete story in six seconds. |
| **Risk that grows with success** | A large crowd applies a movement penalty and a louder "attention" radius. Winning makes you a target. That is what keeps rounds from being decided at minute two. |
| **Zero skill floor, real skill ceiling** | Anyone can do a stunt by pressing one button. Chaining stunts, timing steals, and managing crowd weight take practice. |
| **Short sessions with a hard stop** | Eight minutes. A player can try "one more round" without committing an evening. |
| **Progression that survives the round** | Cash-out converts a round's crowd into permanent upgrades, so a bad round still advances you. |
| **Something to show off** | Cosmetic crowds (your followers can be flamingos, robots, tiny copies of you) are visible to every other player, which is the only cosmetic placement on Roblox that reliably sells. |

What this design does **not** have, on purpose: no offline idle progress, no trading economy,
no loot boxes. Those pull in retention and revenue, but idle progress kills the "everyone is
in the square right now" energy the crowd mechanic depends on, and loot boxes carry policy
risk with a 13+ audience.

**Do not treat this table as a promise.** Treat it as the design's load-bearing structure: if
a change would break one of these rows, it is the wrong change.

---

## 2. Delivery format and repository placement

Identical discipline to the Dream Layers spec.

```
goviral/
├── default.project.json        # Rojo 7
├── aftman.toml                 # rojo, selene, stylua, lune pinned
├── selene.toml
├── stylua.toml
├── .luaurc                     # strict mode
├── README.md
├── TESTING.md
├── scripts/check.sh
├── src/
│   ├── shared/                 # → ReplicatedStorage.Shared
│   ├── server/                 # → ServerScriptService.Server
│   └── client/                 # → StarterPlayer.StarterPlayerScripts.Client
└── tests/                      # Lune suites
```

- Everything lives under `goviral/`. **Do not modify any file outside it.** The repository
  contains an unrelated Next.js application and the Dream Layers spec; both stay untouched.
- `.luau` extension, `--!strict` on every module, 4-space indent, English comments.
- Exactly one `Script` (`src/server/init.server.luau`) and one `LocalScript`
  (`src/client/init.client.luau`), both bootstrappers only.
- Same service lifecycle contract as Dream Layers: modules export
  `{ Name, Priority?, Init?, Start?, Stop? }`, resolved through a registry inside `Start`,
  never required at module scope.

### Reuse rule

`docs/dream-layers-prompt.md` sections 2.1–2.6 (API currency, lifecycle correctness,
networking contract, monetization correctness, data correctness, determinism) apply to this
project **verbatim**. Read them and obey them. They are not repeated here. The additions
below are specific to this game.

---

## 3. Non-goals

- Custom meshes, textures, animations or audio files. Crowd members are built from primitives
  and Roblox's default emote/animation set; if an asset ID is empty the effect is skipped.
- Any invented asset, gamepass, product or place ID. All default to `0` / `""`, and the game
  must be fully playable and testable with every one of them unset.
- Physics-replicated crowds. Followers are **not** simulated rigid bodies and never collide
  with players. See section 6 — this is the single most important technical decision.
- Cross-server anything: no global trading, no shared world state, no `MemoryStoreService`.
- Loot boxes, spinning wheels, or any randomised paid reward.
- Real-money-adjacent framing: no "influencer earnings", no fake follower counts presented as
  a real platform's. The satire stays obviously fictional.
- User-generated text displayed to other players. If you ever add it, it goes through
  `TextService:FilterStringAsync` first — but the simplest correct choice is not to add it.

---

## 4. Hard constraints specific to this game

### 4.1 The crowd is server-authoritative state, client-rendered illusion

- The server owns exactly one number per player: `crowdSize`. Nothing else about the crowd
  is authoritative.
- The server replicates `crowdSize` per player, at most **5 times per second**, and only when
  it changed.
- Every visual follower is created, moved and destroyed **on the client**, for that client's
  view only. Followers exist in no server-side data structure. They are decoration driven by
  a number.
- A client that lies about its rendering changes nothing about the game.

### 4.2 Performance budgets

| Budget | Limit |
| --- | --- |
| Rendered followers per player, all clients | ≤ 24 |
| Rendered followers total, per client | ≤ 120 |
| Parts per follower | ≤ 4 |
| `RunService` connections, server | 1 |
| `RunService` connections, client | 2 (one `PreRender`, one `Heartbeat`) |
| Remote events per player per second | ≤ 15 sustained |
| Crowd position updates | client-side only, no network cost |
| Round map part count | ≤ 6,000, all `Anchored` |

A player with a crowd of 500 renders **24 followers and a floating number**. This is not a
compromise, it is the design: 24 bodies plus a big number reads as "enormous crowd" and costs
nothing, while 500 bodies would cost the frame budget and read as a lag spike.

### 4.3 Follower motion

Followers use no pathfinding and no `Humanoid`. Each follower is a `Model` with a primary
part, moved every `PreRender` by a pure function:

```
followerCFrame(i, leaderCFrame, t, seed) -> CFrame
```

A trailing formation with per-follower phase offset, bobbing, and lag proportional to index.
This is a pure module, unit-tested for: determinism given the same inputs, no follower ever
placed more than `maxTrailDistance` from the leader, and stable output when the leader is
stationary (no jitter).

---

## 5. Core loop

```
Join → City square hub → Queue (auto-fills, 1–12 players) → Round starts
                                                                  ↓
     ┌────────────────────────────────────────────────────────────┘
     ↓
  Perform stunts → gain crowd → crowd slows you → rivals hear you
     ↓                                                  ↓
  Manage weight (dump crowd at a Stage for banked points)  ← Steal attempts
     ↓
  8-minute timer ends → Cash-out screen → permanent upgrades → back to hub
```

- **1–12 players.** Solo is playable: NPC rival performers fill empty slots so the steal
  mechanic still exists at low population. NPC rivals use the same server-side rules as
  players, never privileged information.
- **Late joiners** enter the hub, never a running round. They see the round timer and join
  the next one.
- **Leaving mid-round** banks nothing beyond what was already deposited at a Stage. This is
  what makes depositing a real decision.

### Stunts

Five stunt types, each a short input mini-interaction, each with a different risk profile:

| Stunt | Input | Crowd gain | Risk |
| --- | --- | --- | --- |
| Shout | Tap once | Small, instant | None; the baseline |
| Juggle | Rhythm taps, 3 s | Medium, scales with accuracy | A miss loses a little crowd |
| Highwire | Hold and balance, 5 s | Large | Falling loses half the gain |
| Fire-breath | Charge and release | Large, area effect | Overcharge stuns you 2 s |
| Encore | Only above 100 crowd | Huge multiplier | Doubles your attention radius for 20 s |

All stunt resolution is server-side. The client sends `RequestStunt(stuntId, inputPayload)`;
the server validates the payload shape, the cooldown, the player's state, and computes the
result. The client never reports its own score.

### Attention radius

Every performing player emits an **attention radius** proportional to `crowdSize`. Any rival
inside it can start a steal. Success makes you loud. This is the mechanism that stops a
runaway leader, and it must not be tuned away.

---

## 6. The crowd system — signature system, deepest spec

### 6.1 State

```lua
export type CrowdState = {
    size: number,           -- server-authoritative, integer ≥ 0
    banked: number,         -- deposited at a Stage, safe from steals
    weight: number,         -- derived: movement penalty, pure function of size
    attentionRadius: number,-- derived: pure function of size
    lastGainAt: number,     -- server clock, for decay
}
```

`weight` and `attentionRadius` are **derived, never stored independently**. Both come from
pure functions in `shared/Crowd/CrowdMath.luau`:

```lua
CrowdMath.weightPenalty(size: number): number      -- 0 → 1, walkspeed multiplier
CrowdMath.attentionRadius(size: number): number    -- studs
CrowdMath.stealYield(attacker: number, victim: number): number
CrowdMath.decayPerSecond(size: number, idleFor: number): number
```

All four are unit-tested. Required properties:

- `weightPenalty` is monotonically decreasing in `size`, never below `minWalkSpeedMultiplier`
  (a crowd must never make you unable to move — that is unfun, not risky).
- `attentionRadius` is monotonically increasing, capped so it never covers the whole map.
- `stealYield` is strictly less than the victim's crowd (a steal never zeroes someone
  instantly) and strictly greater than zero when the steal succeeds.
- `decayPerSecond` is zero while `idleFor < decayGraceSeconds`, then positive. Crowds get
  bored. This forces continuous play instead of camping a big number.

### 6.2 Rendering

`client/Crowd/CrowdRenderer.luau` maintains a **pool** of follower models. Pool size is fixed
at startup (`maxRenderedFollowersTotal`). Followers are never created or destroyed during a
round — they are claimed from and returned to the pool. This is the difference between a
smooth 60 FPS and a stutter every time someone lands a stunt.

Allocation per leader:

```
rendered(leader) = clamp(ceil(sqrt(crowdSize) * k), 1, 24)
```

Square-root scaling: a crowd of 25 renders ~10 followers, a crowd of 400 renders ~24. Growth
stays visible at small sizes and saturates before it costs anything.

Above the saturation point, additional crowd is communicated by:
- the floating count above the player's head, scaling in size and switching colour tiers,
- follower density (tighter formation),
- an audio bed that thickens with size,
- a ground decal ring that widens with `attentionRadius`.

### 6.3 What must never happen

- Followers must never block movement, push players, or be `CanCollide = true`.
- Followers must never be parented to `Workspace` on the server.
- The renderer must handle `crowdSize` jumping from 500 to 0 in one replication tick without
  allocating, erroring, or leaving orphaned models.
- A player who joins mid-render must see correct crowds within one second.

---

## 7. Stealing and sabotage

The steal is the emotional core. It must feel earned by the attacker and survivable by the
victim.

```
Rival enters your attention radius
   → they perform a stunt that scores higher than your last stunt within 6 s
   → a 3-second contest window opens, visible to both players
   → both can act: attacker chains another stunt, victim can Encore or flee the radius
   → resolution: attacker takes CrowdMath.stealYield(attacker, victim) from the victim
```

Rules:
- Only **unbanked** crowd can be stolen. Depositing at a Stage is always safe.
- A player cannot be stolen from twice within `stealImmunitySeconds`.
- Stealing while your own crowd is larger yields less (`stealYield` accounts for both sides),
  so the mechanic pulls toward the middle rather than snowballing.
- The contest window is fully server-resolved. The client renders it; it does not decide it.
- Both players get an unmissable audiovisual cue. A steal the victim did not notice is a bug,
  not a stealth mechanic.

Unit-test the contest resolver as a pure function over `(attackerState, victimState, actions,
elapsed) -> outcome`. Every rule above is a test case.

---

## 8. Progression, economy, persistence

- **Fame** (soft currency): earned by banking crowd. Buys permanent upgrades.
- **Level**: derived from lifetime Fame, gates cosmetic unlocks only.
- **Upgrades**: small, capped, and explicitly *not* power. Examples: +5% stunt input window,
  −5% crowd weight, one extra Encore per round, faster Stage deposit. Every upgrade's total
  effect must be under 15% so a level-1 player can beat a level-50 player.
- **Cosmetics**: crowd skins (flamingos, robots, tiny copies of you, cardboard cutouts),
  performer outfits, stunt effects, deposit animations.

Persistence follows the Dream Layers data contract exactly: one profile DataStore, session
locking, `schemaVersion` with a migration chain, `UpdateAsync` with a pure transform,
exponential backoff, jittered 120 s autosave, `BindToClose` flush.

Save: Fame, level, owned cosmetics, equipped cosmetics, settings, lifetime stats,
`schemaVersion`. Nothing else.

---

## 9. Monetization

Free to play. Everything paid is cosmetic or convenience, and section 8's 15% rule is
absolute.

**Gamepasses:** VIP (crowd skin, hub area, +1 daily cash-out bonus), Cosmetic Pack,
Extra Stunt Slot (a cosmetic stunt variant, not a stronger one).

**Developer products:** Fame packs, a round-end double-bank (offered after the round, never
during), cosmetic unlock tokens.

All IDs live in `shared/Config/ProductConfig.luau`, default `0`, and a `0` renders the entry
as "Coming soon" with the purchase path disabled. One `ProcessReceipt` assignment, receipt
idempotency by `PurchaseId` inside the granting `UpdateAsync`, `NotProcessedYet` on any
failure. `PolicyService` respected.

**Explicitly forbidden:** paid crowd multipliers, paid steal protection, paid stunt power,
anything that makes a paying player win a round.

---

## 10. Accessibility and platform

- Every stunt must be completable with a single input method: one tap, one hold, or one
  rhythm sequence. No stunt may require simultaneous inputs, precise mouse aim, or a keyboard.
- `ContextActionService` for all actions; `ProximityPrompt` for all world interaction. Touch,
  gamepad and keyboard reach parity by construction, not by a separate mobile code path.
- A `ReducedMotion` setting halves camera shake, disables screen-space distortion, and caps
  follower bobbing. Persisted in the profile.
- Crowd count must be readable without colour: the tier is shown by numeral and shape, not
  hue alone.
- Target 60 FPS on a mid-range phone with 12 players and 12 saturated crowds on screen. This
  is the worst case; measure it, do not assume it.

---

## 11. Audio

One `SoundGroup` per category (Crowd, Stunt, UI, Ambience, Music).

The crowd bed is the game's signature sound: a looping murmur whose volume and layer count
scale with `crowdSize`, so players *hear* how big someone is before they see them. A steal
resolves with a hard audio break — the murmur cuts, then swells behind the winner. Getting
this transition right matters more than any individual sound effect.

Every sound ID may be empty; the game must run silently without error.

---

## 12. Discovery surface — treat this as engineering, not marketing

A Roblox game that could trend lives or dies on three things a player sees before they play
and in their first thirty seconds. Build for them.

**Name.** Ship-name candidates, to be chosen by the owner: `GO VIRAL`, `CROWD SURF`,
`STEAL A CROWD`, `FAMOUS FOR 8 MINUTES`. Roblox discovery favours a verb-led two-or-three word
name. Do not hardcode the name in twenty places — it lives in `GameConfig.displayName` and is
read from there everywhere, including the UI, so changing it is one edit.

**Thumbnail readability.** The game must be *capable* of producing the key image: one small
player, one enormous crowd, clear silhouette. Ensure a debug command (Studio-only, per
`DebugConfig`) can set an arbitrary `crowdSize` and pose the camera, so the owner can capture
promotional shots without playing for an hour.

**First thirty seconds.** A new player must gain their first crowd within **fifteen seconds**
of spawning, without reading anything. Implement this as a scripted opening: spawn facing a
Stage, one prompt, one stunt, immediate visible crowd. Instrument it — log a funnel event at
spawn, at first stunt, at first crowd gain, at first steal, at first cash-out, via
`AnalyticsService`. If the first-stunt event does not fire for most players inside fifteen
seconds, the onboarding is broken regardless of how good the game is.

**Session shape.** Round length is `GameConfig.roundSeconds`, default 480. It is a config
value because it is the most likely thing to need tuning after launch.

---

## 13. Testing

### Automated, headless, must pass

```bash
cd goviral
rojo build default.project.json -o /tmp/goviral.rbxl
selene src
stylua --check src
luau-lsp analyze --defs=globalTypes.d.luau src
lune run tests/run.luau
```

`scripts/check.sh` runs all five. Minimum **35 assertions across 7 suites**. Required
coverage:

- `CrowdMath`: every property listed in section 6.1, plus boundary values (0, 1, huge).
- Follower placement: determinism, max trail distance, no jitter when stationary.
- Steal contest resolver: every rule in section 7, including double-steal immunity and the
  banked-crowd exemption.
- Stunt resolution: cooldowns enforced, malformed payloads rejected, accuracy scoring
  monotonic.
- Round state machine: 1 player, 12 players, all-leave, late join, timer expiry.
- Rate limiter: burst rejected, recovers after the window.
- Data: v1 → current migration with no field loss; receipt idempotency across retries.

Tests that only assert `require` succeeded do not count toward the minimum.

### Manual, documented in `TESTING.md`, not to be reported as passed

Studio checklist: 1 / 4 / 12 players, twelve saturated crowds on one screen with a frame-time
measurement, steal in both directions, mid-round leave and rejoin, cash-out and persistence
across a rejoin, every stunt on touch and on gamepad, purchase paths with real IDs, and the
first-thirty-seconds funnel walked by someone who has not seen the game.

---

## 14. Milestones and definition of done

Work in order. Run `check.sh` and commit after each. Never commit a failing state.
Commit format: `M<n>: <what changed>`.

| # | Milestone | Done when |
| --- | --- | --- |
| M1 | Tooling, service lifecycle, configs, test harness | `check.sh` green on an empty game |
| M2 | Hub, queue, round state machine, 1–12 players | Late join and all-leave handled, unit-tested |
| M3 | `CrowdMath` + crowd state + replication | All section 6.1 properties tested and passing |
| M4 | Follower pool and renderer | 12 saturated crowds hold frame budget, measured |
| M5 | Stunts, server-authoritative resolution | All five stunts, all validated server-side |
| M6 | Attention radius, steal contest, sabotage | Every section 7 rule covered by a test |
| M7 | Stages, banking, round end, cash-out | A full round is completable solo and at 12 |
| M8 | Fame, levels, upgrades, persistence | Session locking and migration verified |
| M9 | Cosmetics, shop, gamepasses, products | Fully playable with all IDs `0` |
| M10 | NPC rivals for low population | Solo round has real steal pressure |
| M11 | Onboarding, funnel analytics, discovery hooks | First crowd within 15 s, events firing |
| M12 | Accessibility, mobile pass, polish, docs | README and TESTING.md complete |

### Definition of done

**Machine-verifiable:**
1. `goviral/scripts/check.sh` exits 0.
2. ≥ 35 assertions across ≥ 7 suites, all passing.
3. Zero `TODO`, `FIXME`, or `error("not implemented")` in `goviral/src`.
4. Zero `wait(`, `spawn(`, `delay(`, `tick(`, or `math.random` outside client cosmetics.
5. Exactly one `ProcessReceipt` assignment; one server `RunService` connection; two on client.
6. No follower model is ever parented under a server-owned instance (grep the renderer).
7. `git diff --stat` shows no changes outside `goviral/`.
8. Every config value referenced by code exists; `ConfigValidator` passes at startup.

**Human-verifiable, documented not claimed:**
9. The `TESTING.md` checklist is walkable in Studio, including the twelve-crowd frame-time
   measurement and the fifteen-second onboarding funnel.

**Reported honestly:**
10. `goviral/README.md` states what was built, what was stubbed and why, which IDs must be
    filled before publishing, and which checks were run versus which need Studio.

If a system cannot be finished, say so in the README and in your final message. A stated gap
is worth more than a silent one.
