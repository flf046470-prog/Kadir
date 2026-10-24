# Desktop VR simulator

Play and test the VR version of Kangaroo Chase with a keyboard and a mouse, no headset.

The page replaces the browser's WebXR with **IWER** (Meta's Immersive Web Emulation Runtime, MIT,
`iwer@2.5.0`) emulating a Meta Quest 3. The game cannot tell: it boots as VR and runs the code a
headset runs — `VRInput`, the VR menu, arms-first locomotion, the comfort code — so what you test is
the real VR path, not a mock of it.

## Start it

```sh
npm install
npm run play:xrsim          # builds, starts the server, prints the address
```

Open **http://localhost:8787/?xrsim** in Chrome or Edge, press **Enter VR**, and you are in. F5
reloads and keeps the simulator; the same address without `?xrsim` is the normal game.

While developing, run `npm run dev:server` and `npm run dev` in two terminals and open
**http://localhost:5173/?xrsim** instead: Vite reloads on every save.

## Controls

Click into the view once to capture the mouse (Esc releases it). Press **H** in VR to show or hide
this list on screen.

| key | controller | in the game |
| --- | --- | --- |
| Mouse | head | look |
| W A S D | left thumbstick | move (Assisted or Seated VR movement only — arms-first has no stick) |
| ← → | right thumbstick | turn (snap, or smooth if set) |
| Left mouse | right trigger | Use gadget; selects in the VR menu |
| Right mouse | right grip | close the right hand: hold on, climb |
| Q | left trigger | Next gadget |
| E | left grip | close the left hand |
| Space | A | Hop (Assisted mode) |
| R | B | Emote |
| F | X | Shop / board |
| G | Y | Emote |
| Shift | right stick press | Sprint |
| V | left stick press | Talk (held) |
| Hold 1 / 2 + mouse | — | move the left / right hand instead of the head |
| Mouse wheel (with 1 / 2) | — | push that hand out or draw it in |
| J / K | — | jab with the left / right hand (0.4 m at 8 m/s, a real hand movement) |
| Hold C | — | duck your head (crouching in VR is ducking) |
| X | — | put both hands back and look level |

The buttons' meanings are read from `VR_BINDINGS`, the table the game itself samples, so the
on-screen list cannot describe a different game.

**Arms-first** (the default VR movement): look down, hold **1** or **2**, move the mouse to put that
hand on the floor, close it (**E** / right mouse), then pull it back with the wheel. That is how
the game walks in VR. **Settings → Comfort → VR movement → Assisted** turns on the stick and the hop.

## Safety

- **Only with `?xrsim`.** Nothing is stored; a reload without it is the normal game.
- **Never over a real headset or an emulator extension.** If the browser can already enter VR, the
  simulator stays off and says so. (Meta's *Immersive Web Emulator* extension is IWER too; with it
  installed, use the extension's own panel and leave `?xrsim` off.)
- **Not downloaded otherwise.** IWER is its own `xrsim-*.js` chunk, excluded from the service
  worker's precache, and loaded only by `?xrsim`.

## When VR cannot start

On a PC with a VR runtime installed (SteamVR, Meta Quest Link, Windows Mixed Reality) and the
headset off, the browser still says it can present, so the game boots as VR. Pressing **Enter VR**
then shows **"VR could not start"** with the browser's reason, and **Play on desktop** reloads with
`?platform=pc` — the keyboard-and-mouse game. **Back to VR** on that page reloads without it.

## The automated check

`npm run check:xrsim` (CI, browser job) drives all of the above in Chromium and reads the result out
of the simulation (`__kcSelf`, automation only): the head turns, each grip closes its own hand, each
button reaches the intent, W walks the way the head looks, a ducked head crouches, a refused session
falls back to a playable desktop page where D steps to the right of the screen (judged by the drawn
camera, not the game's own arithmetic), and the simulator stays off beside a headset.

What it cannot tell you: comfort, tracking quality, frame rate on a Quest, or how a real punch or
climb feels. That still needs a headset.
