# Dream Layers: Don't Wake Up — source tree

A Rojo-syncable source tree, not a `.rbxl`. Open it in Roblox Studio through Rojo.

The design this implements is `docs/dream-layers-prompt.md` at the repository root. Section
numbers referenced in comments point there. Read **3.2 (the dream stack)** and **3.6
(divergence)** first — together they are the core loop and the reason the rest is shaped this
way.

This is a multiplayer psychological dream puzzle, **not** a horror game with a monster in it.
Nothing here chases, attacks, or damages the player; the antagonist is the dream showing
different things to different people, and a room nobody can agree on eventually stopping
holding them up. If you find yourself adding pursuit, damage, health, or `PathfindingService`,
check §1 and §11 before going further — their absence is the design, not a gap.

## Milestone status

**M1 — tooling and architecture skeleton. Complete.**

M1 delivers the lifecycle, the pure utilities, the configuration set, and the remote surface,
all under test. It deliberately delivers **no gameplay services**: an empty `ServiceRegistry`
that starts and stops cleanly is the correct M1 result, and the tests exercise the lifecycle
with fakes rather than with a placeholder service that would have to be deleted later.

Nothing here is stubbed. There is no `TODO`, no `error("not implemented")`, and no function
that returns a fake value.

## Getting it running

```sh
aftman install          # or install rojo, lune, selene, stylua, luau-lsp yourself
rojo serve              # then connect from the Rojo plugin in Studio
sh scripts/check.sh     # every automated gate
```

## What is verified, and what is not

`scripts/check.sh` runs five gates. Four of them pass in the environment this milestone was
built in; the fifth could not run there, and the script **exits non-zero rather than
reporting a pass**, because a skipped check that reads as a clean run is worse than no check.

| Gate | Status when M1 was committed |
|---|---|
| `rojo build` | passes |
| `stylua --check` | passes |
| `selene` | passes, 0 warnings |
| `luau-lsp analyze` | **could not run** — see below |
| `lune run tests/run.luau` | passes: 88 tests, 1211 assertions, 8 suites |

**Why the typecheck could not run.** The build environment has no network route to the
GitHub releases that `luau-lsp` installs from. Every module is written `--!strict` and is
meant to typecheck; that has not been machine-verified. Run `sh scripts/check.sh` somewhere
with network access before trusting the type annotations.

**`selene` uses a local standard library.** `std = "roblox"` fetches Roblox's API dump over
the network, which is also blocked here, so `dreamlayers.yml` declares the Roblox globals the
source actually uses. It catches unused variables, shadowing, undefined globals, and Luau
standard library misuse; it does not check Roblox API call shapes beyond the few methods
declared in it. With network access, `selene generate-roblox-std` and `std = "roblox"` give
stricter results.

## Layout

```
src/shared/     → ReplicatedStorage.Shared     configs, remotes, utilities
src/server/     → ServerScriptService.Server   one Script, no gameplay logic in it
src/client/     → StarterPlayerScripts.Client  one LocalScript
src/testing/    not synced                     the test harness
tests/          not synced                     Lune suites
```

## The rule that shapes everything

Pure logic is separated from Roblox instances (specification 0.4). A module that can be
expressed as `f(data) -> data` never touches `game`, `workspace`, or any service, which is
what lets Lune run it headlessly.

Pure modules are also **leaves**: they require nothing. Roblox's `require(script.Parent.X)`
does not resolve under Lune, so a pure module that required a sibling would stop being
testable. Where two modules must agree on something — the monetization category vocabulary,
for instance — they each state it and `ConfigValidator` checks that they agree. That is a
cheaper coupling than a shared require the tests cannot resolve.

| Pure (tested headlessly) | Roblox adapter (not unit-tested) |
|---|---|
| `Rng`, `SchedulerCore`, `RateLimiter` | `Scheduler` (one Heartbeat, wraps `SchedulerCore`) |
| `Trove`, `ServiceRegistry` | `Remotes` (builds on server, waits on client) |
| `Distortion`, `Divergence`, `ConfigValidator` | `init.server.luau`, `init.client.luau` |
| every module in `Config/` | `Config/init.luau` (aggregate, uses `script.X`) |

## Before publishing

Every asset, gamepass, and developer product id in `src/shared/Config/AssetConfig.luau` is
`0` or `""`, and the game must stay fully playable with them unset (specification 2.7).
Fill them in from the Creator Dashboard. Nothing else in the codebase may hardcode an id.

## Two behavioural notes worth keeping

**`SchedulerCore` carries the remainder** when a task fires instead of resetting its
accumulator to zero. The obvious implementation — reset to zero — silently loses a fraction of
a period on every tick, and a 10 Hz task then runs at about 8.5 Hz. `tests/SchedulerCore.spec.luau`
asserts the rate over ten simulated seconds rather than one, because a one-second window tests
phase rather than drift.

**The FNV-1a multiply is done as shifts and adds**, in both `Rng` and `Divergence`. The obvious
`hash * 16777619` is wrong in Luau: for a hash anywhere near 2^32 the product passes 2^53, so
float64 drops low mantissa bits and the result comes back flattened at the low end. Measured
against exact arithmetic it disagrees for about 69% of 32-bit inputs.

It is worth knowing how that failed, because the shape repeats. A consumer reading all 32 bits
still looks random, so the existing `Rng` tests passed. `Divergence.lensFor` read
`hash % lensCount`, which is precisely the flattened part — so every player was assigned lens 1,
every round, and the game silently had no antagonist while the suite stayed green. Distribution
tests cannot catch it either; only the golden vectors in `tests/Rng.spec.luau` can, which is why
they are there. `lensFor` additionally reads the hash's high bits, so the two guards are
independent.
