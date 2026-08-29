# Kangaroo Chase

A physical-movement social tag game. Hop, climb, swing and chase across a stylised jungle —
on **Mobile**, **PC** and **VR**, in the same match, from one codebase.

```bash
npm install
npm run dev          # client on http://localhost:5173
npm run dev:server   # authoritative server on :8787 (the client proxies to it)
npm run verify       # lint + typecheck + tests + production builds
```

Then open the client, pick a name, and press **Play**. With no server running the game still
starts: it drops into solo practice against bots.

## What it is

* **Kangaroo Chase** — chasers tag runners; being tagged makes *you* the chaser.
* **Infection** — one infected, everyone caught joins them, last survivor wins.
* **VR Boxing** — physics-driven punches with stamina and knockback.
* **Parkour Race** — a checkpoint route through jungle, canopy, canyon and cave.

Six animals at launch (Kangaroo free), nine more ready as data. Every animal moves identically
within a ±3 % feel band that is clamped at load and enforced by a test — **premium content is
cosmetic, by construction**. Fixed store prices, no loot boxes, no gacha, no randomised rewards.

## How it fits together

```
packages/core     deterministic gameplay: physics, movement, modes, content, progression
packages/net      binary protocol, delta snapshots, interpolation, prediction
packages/server   authoritative rooms, matchmaking, persistence, purchases, voice signalling
packages/client   three.js + WebXR renderer, PC/Mobile/VR platform layers, UI, audio
```

The simulation in `@kc/core` runs **unchanged on the server and on every client**: the server
is the referee, the client predicts. Platforms only supply an `InputIntent` — that single
boundary is what makes a phone, a desktop and a headset play the same match.

Read `ARCHITECTURE.md` for the design and the reasoning, `ROADMAP.md` for the plan, `TODO.md`
for honest status, and `docs/ASSETS.md` before adding art.

## Controls

| | Move | Look | Hop | Grab / climb | Punch |
| --- | --- | --- | --- | --- | --- |
| PC | W A S D | Mouse | Space (hold to charge) | Right mouse | Left mouse |
| Mobile | Floating stick | Swipe right side | HOP button | GRAB button | PUNCH button |
| VR | Pull on surfaces with your hands | Headset | A button | Grip | Throw a real punch |

VR locomotion is the heart of the game: grab a surface and your body moves the way your hand
pulls, and the momentum you build is kept when you let go.

## Deployment

```bash
npm run build      # dist/client (static) + dist/server/main.js
KC_SESSION_SECRET=... KC_PUBLIC_DIR=dist/client node dist/server/main.js
```

The server hosts the client and the API, and accepts WebSocket connections on `/ws`.
Environment: `PORT`, `HOST`, `KC_DATA_DIR`, `KC_SESSION_SECRET` (required in production),
`KC_MAX_ROOMS`, `KC_MAX_PLAYERS`, `KC_ALLOWED_ORIGINS`.
