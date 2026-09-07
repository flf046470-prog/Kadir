# Dream Layers — store art

Source art for the Roblox experience page. The `.svg` files under `src/` are the
editable originals; the `.png` files beside this README are the artefacts you upload.
Re-render everything after editing a source:

```sh
sh docs/art/build.sh          # needs a Chromium binary; set CHROME=... to override
```

## What is here

| File | Size | Roblox slot |
|---|---|---|
| `icon-512.png` | 512×512 | Experience icon |
| `thumbnail-01-dream-stack.png` | 1920×1080 | Thumbnail — explains the core loop |
| `thumbnail-02-waking-room.png` | 1920×1080 | Thumbnail — the premise |
| `thumbnail-03-corridor.png` | 1920×1080 | Thumbnail — the threat |
| `wordmark.png` | 1600×560, transparent | Logo for anywhere else |

Roblox accepts PNG or JPG. Icons are square and are cropped to a circle in some
surfaces, so nothing important sits in the corners. Thumbnails are 16:9 and are
displayed as small as ~250 px wide in the games list, which is why the type is
large and the silhouettes are high-contrast.

## What this art is, and what it is not

This is **hand-authored vector graphic design**, not rendered gameplay. It is
honest about that: nothing here depicts a scene the game does not contain, and no
frame claims to be a screenshot.

Once the game exists, the strongest thumbnails on Roblox are in-engine captures.
Treat `thumbnail-02` and `thumbnail-03` as placeholders to be replaced by real
screenshots of the waking room and of a corridor encounter. `thumbnail-01` earns
its place permanently: it teaches the depth mechanic in one glance, which a
screenshot cannot do.

## Design rules these follow

- The palette runs cold at the surface and warm underneath. Depth drains colour —
  slate blue at 0, green-grey at 2, neutral grey at Limbo. This matches the
  `DistortionProfile` curve in §3.2.2 of the build specification.
- The falling figure is the identity. Every asset that has room for one shows a
  person tumbling head-down, because that is what the game is about.
- No gore, no dismemberment, no graphic body horror — §1 of the specification puts
  it out of scope, and it constrains the age rating.
- No content that the game does not have. A thumbnail promising a layer that is not
  in §5 is the fastest way to earn a "misleading" rating.

## Colours

| Token | Hex | Use |
|---|---|---|
| Surface | `#3a6379` | Depth 0 |
| Depth 1 | `#1d343e` | |
| Depth 2 | `#122026` | green shift begins |
| Depth 3 | `#0a1013` | |
| Limbo | `#1e1e22` | neutral grey, no hue |
| Beam | `#f2b45e` | flashlight, seams, accents |
| Beam highlight | `#ffe0ad` | light sources |
| Ink | `#eef4f7` | headline type |
| Muted | `#8fa8b4` | body type |
