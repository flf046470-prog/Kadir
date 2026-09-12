# Dream Layers — trailer

`dream-layers-trailer.webm` — 37 s, 1920×1080, 24 fps, VP8.

```sh
sh docs/art/trailer/render.sh          # re-render after editing trailer.html
FPS=30 QUALITY=95 sh docs/art/trailer/render.sh
```

## What this is, and what it is not

**Hand-authored motion graphics, not gameplay.** The game does not exist yet; nothing here
is a capture of anything running. Every frame is drawn by `trailer.html` in the same visual
language as the store art in the parent directory — same palette, same one-point corridor,
same falling figure.

That honesty is the same standard the store art holds itself to, and it matters more here:
a trailer that implies footage it does not have is the fastest way to earn a "misleading"
rating on Roblox. When the game runs, the corridor and dissolution beats should be replaced
with real captures. The type cards and the split-screen construction can stay.

## The cut

| # | Beat | Says |
|---|---|---|
| 1 | Cold open | "SIX PEOPLE IN ONE ROOM. / NOT THE SAME ROOM." |
| 2 | The waking room | Lie down, take the sedative, go under |
| 3 | The dream stack | Failing drops you a layer; the answers are below |
| 4 | **Divergence** | Split screen: Ada sees a door, Mert sees a wall, nobody is lying |
| 5 | Dissolution | A room nobody agrees on stops holding you up |
| 6 | Agreement | Say what you see; the room goes solid, and poorer |
| 7 | The Final Layer | "IS WAKING UP AN EXIT?", then the title |

Beat 4 is the trailer's whole job. It is the one thing this game has that nothing else on
Roblox does, and it is the one thing a screenshot physically cannot show — a screenshot is
one player's view. The split screen is the only honest way to put it on screen, which is why
it gets the longest slot in the cut.

Note what the trailer never shows, because the game never has one: anything chasing anybody.

## How it is rendered

`trailer.html` exposes `window.__seek(t)` and draws frame `t` as a pure function of the
clock — nothing carries over between calls. `render.mjs` drives Chromium over the DevTools
Protocol, steps that clock, screenshots each frame, and pipes JPEGs into ffmpeg.

Stepping the clock rather than recording playback is what makes the render reproducible: a
wall-clock capture drops frames under load and produces a different file every run.

**WebM/VP8 is not a preference, it is the only option here.** The ffmpeg that ships with
Playwright is a stripped build with H.264, GIF and every other muxer compiled out; `ffmpeg
-encoders` lists exactly `png` and `libvpx`. WebM plays in every browser and YouTube accepts
it directly. For anywhere that demands MP4, re-encode on a machine with a full ffmpeg:

```sh
ffmpeg -i dream-layers-trailer.webm -c:v libx264 -crf 18 -pix_fmt yuv420p dream-layers-trailer.mp4
```

Two details in `render.mjs` are load-bearing and easy to lose:

- The encoder is `libvpx`, not `libvpx-vp8` — the latter is not a valid name in this build.
- The input needs an explicit `-vcodec mjpeg`. `image2pipe` cannot probe the codec from a
  live pipe, and without it ffmpeg opens the output with no stream and fails.

There is no audio track. Sound design is not something that can be authored here, and a
silent trailer is better than one carrying a temp track that would have to be stripped.
