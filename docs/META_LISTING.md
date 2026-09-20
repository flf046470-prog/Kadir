# Meta Horizon Store listing

The text and art to paste into the Developer Dashboard (App Submissions → App Metadata / Assets),
once a real developer account and app entry exist. Nothing here is speculative — every character
count was checked against Meta's own published limits, and every image dimension against Meta's
own asset design guidelines
(developers.meta.com/horizon/resources/asset-guidelines/, fetched 2026-09-20). What is genuinely
missing is called out at the bottom rather than guessed at.

## App name

```
Kangaroo Chase
```

14 of a maximum 40 characters. Matches the manifest (`manifest.webmanifest`), the Bubblewrap
config (`packaging/meta-quest/twa-manifest.template.json`) and every store package already built
— the name is not a separate decision made here, it is the one decision made once and reused.

## Short description

423 of a maximum 500 characters.

```
A social tag game built on real movement, not a stick: your hands and body drive locomotion in
VR, no separate control scheme bolted on. Hop, climb and vault across a jungle in Kangaroo Chase,
earn cash for traps and armour in The Hunt, or settle it with fists in Conversion Duel. Cross-play
with friends on PC and mobile. Every animal and every gadget is free — nothing purchasable is
faster, jumps higher, or hits harder.
```

## Long description

1424 of a maximum 1500 characters.

```
Kangaroo Chase is a physical-movement social game: in VR your hands and body are the controller,
not a joystick standing in for one. Climb a ledge by reaching for it, throw a punch by throwing
one, and cover ground the way a kangaroo does — leaning into a hop instead of pressing a button
for one.

Nine modes, one shared world:
- Kangaroo Chase — the tag mode the game is named for. Hop, climb and wall-bounce across jungle
  parkour to escape the chaser, or close the gap if you are it.
- The Hunt — one armed hunter, several survivors racing the clock. Earn cash mid-round for traps,
  smoke and armour.
- Conversion Duel — a fistfight for keeps. Lose, and you convert to the winner's species.
- Freeze Tag, King of the Hill, Infection, Parkour Race, VR Boxing and a Training Room round out
  the roster, plus a mode editor for your own rules.

Play with up to sixteen people per room, voice chat included with proximity falloff so you hear
who is actually near you. Cross-play means a friend on a phone or PC can share a match with you
in a headset.

Fairness is a hard rule: every animal and every cosmetic is free, and nothing purchasable moves
faster, jumps higher, deals more damage, or has more health. The server checks every purchase,
win and round result — never the client.

Comfort options: snap or smooth turning, a motion vignette that scales with how much you turn,
seated play, and adjustable height calibration.
```

Every claim in it is checkable against this repository rather than aspirational: nine mode files
under `packages/core/src/modes/` (`chase`, `hunt`, `duel`, `freezetag`, `hill`, `infection`,
`parkour`, `boxing`, `social`) plus the custom-mode editor (`packages/core/src/modes/custom.ts`);
`KC_MAX_PLAYERS` defaults to 16 (`docs/DEPLOY.md`); voice falloff is `proximityGainAt` in
`packages/core/src/modes/social.ts`, applied by `packages/client/src/audio/VoiceChat.ts`; the
free-item and no-pay-to-win claims are
`validateCatalog` refusing any priced item at boot and the ±3% animal "feel" band clamp; the
comfort list is `packages/core/src/settings/index.ts`'s `ComfortSettings` (`snapTurn`,
`smoothTurnSpeed`, `vignette`, `seated`, `heightCalibration`), all of it actually read by
`platform/vr/VRInput.ts` and `platform/vr/comfort.ts` — not merely declared, per the standing
rule that a setting nothing reads is a bug.

## Category and genre

Meta's category list is enumerated only inside the live Developer Dashboard (Distribution → App
Submissions → App Metadata), not published anywhere fetchable from outside it, so the exact
option strings cannot be pinned down here the way the character limits above could be. What can
be said with confidence, checked against the actual mechanics:

- **Category:** Games.
- **Primary genre:** Action (tag, combat and a timed hunt are the core loops).
- **Secondary genre:** Social (voice chat, up to 16 per room, a room-based lobby).

Pick the closest match from whatever the dashboard currently offers; do not invent option strings
that are not in front of you at submission time.

## Player modes, controllers, comfort (dashboard "Specifications" section)

- **Game modes:** Multiplayer (online), with an offline single-player practice mode against bots
  (`soloPractice` in `GameClient`) for anyone without a room to join.
- **Player count:** Up to 16 per room (`KC_MAX_PLAYERS`).
- **Controllers:** Touch controllers (primary) and hand tracking — both drive the same
  `InputIntent`, so nothing about the mode selection changes what a player can do. There is no
  gamepad-only VR path; the stick input this game does support is the PC/mobile accessibility
  fallback, not a VR controller scheme.
- **Play area:** Standing or seated, room-scale not required. `ComfortSettings.seated` exists
  specifically so a player without floor space can still play everything.
- **Comfort rating:** the honest answer is "depends on the player" the way it does for any
  locomotion-heavy title — snap turn is the default specifically to keep the floor lower, smooth
  turn is there for players who prefer it, and the turn vignette scales with how much you are
  turning rather than being flat. Whatever comfort tier the dashboard's own questionnaire derives
  from those answers is the one to accept; this file states the mechanics, not a self-assigned
  label Meta might score differently.
- **Internet connectivity:** Required for real matches (the server is authoritative); the
  practice mode against bots works fully offline.
- **In-app purchases:** None at launch — `LAUNCH_STORE` is empty and `validateCatalog` refuses
  any priced item at boot. If that changes later, Horizon Billing needs a Meta Horizon
  Application ID and receipts are already routed through `packages/server/src/receipts.ts`
  (`meta:<userId>` prefix), server-verified before anything is granted.
- **Languages:** English only at launch. No i18n system exists yet (`locale` was removed from
  `Settings` for exactly this reason — see CLAUDE.md's Settings section).

## Publisher details

- **Website:** the live deployment, `https://game-server-production-d3a6.up.railway.app`, until
  a dedicated marketing domain exists.
- **Privacy policy:** **not written yet — this blocks submission.** Meta requires a live URL
  here; there is no page to point at. It has to cover what the server actually collects: guest
  account tokens, a chosen display name, purchase/receipt records once any exist, and voice
  audio, which is peer-to-peer WebRTC and never touches the server (see CLAUDE.md's Voice
  section for exactly what that mesh does and does not enforce). Write it against the real data
  flows in `packages/server/src/`, not a generic template — a policy that describes a server this
  one is not would be worse than none.
- **Terms of service:** optional; not written.
- **Support contact:** optional; not set.

## Content rating

Needs a developer contact email matching whatever IARC submission is filed, and an IARC
certificate. Not filed — this is a real account-holder action, not something buildable from this
repository.

## Assets

Generated by `npm run pack:meta:listing` (after `npm run build:client`), written to
`packaging/meta-quest/listing/`:

| File | Size | Format | Note |
| --- | --- | --- | --- |
| `AppIcon-512x512.png` | 512x512 | 24-bit PNG | squared corners, solid fill |
| `01`–`05-*.png` | 2560x1440 | 24-bit PNG | 5 screenshots, one per mode — see below |
| `HeroCover-3000x900.png` | 3000x900 | 24-bit PNG | 10:3 hero |
| `CoverLandscape-2560x1440.png` | 2560x1440 | 24-bit PNG | 16:9 |
| `CoverSquare-1440x1440.png` | 1440x1440 | 24-bit PNG | 1:1 |
| `CoverPortrait-1008x1440.png` | 1008x1440 | 24-bit PNG | 7:10 |
| `CoverMini-1080x360.png` | 1080x360 | 24-bit PNG | 3:1 |
| `TrailerCover-2560x1440.png` | 2560x1440 | 24-bit PNG | static cover only — see gap below |

"24-bit PNG" is Meta's own term for the bit depth (no alpha channel), not a description of
"looks opaque" — every file above is written through `encodePngRGB` in `scripts/lib/png.mjs`,
which emits true colour-type-2 PNGs, specifically so an upload checker that reads the file format
rather than the pixels cannot reject it. `npm run pack:meta:listing -- --check` verifies sizes
without a browser; the full run needs Playwright and drives the real, built game.

## What this cannot produce, said plainly rather than guessed at

- **First-person screenshots.** Meta prefers first-person POV ("1-2 third-person/mixed reality
  shots allowed") because the product is judged by what a headset wearer sees. There is no
  headset in this environment and, per CLAUDE.md, there never will be — so the five screenshots
  here are captured from the desktop third-person camera every non-VR platform genuinely uses.
  Real gameplay, not a mockup, but not the headset's own view. Replacing them with real captures
  from an actual Quest session is the one asset upgrade worth doing before submission if a
  headset becomes available.
- **The trailer video.** Meta wants 30 seconds to 2 minutes of MP4/H.264/AAC. What
  `capture:trailer` produces from this environment is a 12 fps GIF assembled from swiftshader
  frames (`dist/trailer/kangaroo-chase-trailer.gif`) — real footage, wrong container and frame
  rate for the requirement. The static trailer *cover image* is produced above; the video needs
  either a real headset/PC capture re-encoded with `ffmpeg`, or accepting the listing without a
  trailer (optional, per Meta's own guidelines) until one exists.
- **The privacy policy, IARC filing and developer account itself.** All three require a legal or
  administrative action by the account holder, not a build step. See "Publisher details" and
  "Content rating" above.

Everything else in this file is real: the copy is checked against the running game, the art is
generated from the actual build with the actual dimensions the Store's own upload form checks
for, and the app itself is buildable today (`npm run build:quest`, `docs/STORES.md`).
