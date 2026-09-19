#!/usr/bin/env python3
"""
Assemble captured frames into an animated GIF.

Separate from the capture step because the two fail for unrelated reasons — a browser that will
not start and a palette that comes out muddy are different problems, and debugging them together
is worse than debugging them apart. Re-running this is free once the frames exist.

GIF rather than a video because it plays everywhere without a player, an autoplay policy, or a
codec argument, and because this environment has no ffmpeg. The cost is a 256-colour palette,
which suits flat-shaded low-poly art better than it suits anything else.

Usage: python3 tools/make-gif.py <frames-dir> <out.gif> [--fps 12] [--width 720] [--colors 200]
"""

import argparse
import os
import sys

try:
    from PIL import Image
except ImportError:
    print("Pillow is required:  pip install Pillow", file=sys.stderr)
    raise SystemExit(2)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("frames")
    ap.add_argument("out")
    ap.add_argument("--fps", type=int, default=12)
    ap.add_argument("--width", type=int, default=720)
    ap.add_argument("--colors", type=int, default=200)
    args = ap.parse_args()

    files = sorted(f for f in os.listdir(args.frames) if f.endswith(".png"))
    if not files:
        print(f"no frames in {args.frames}", file=sys.stderr)
        return 1

    frames = []
    for name in files:
        im = Image.open(os.path.join(args.frames, name)).convert("RGB")
        if im.width != args.width:
            im = im.resize((args.width, round(im.height * args.width / im.width)), Image.LANCZOS)
        # One palette for the whole run, taken from the first frame and reused.
        #
        # Quantising each frame on its own gives every frame a slightly different palette, and the
        # flat colour areas that dominate this art then shimmer between frames — the sky crawls.
        # Sharing a palette costs a little accuracy on the odd frame and removes the shimmer
        # entirely. Dithering is off for the same reason: it is noise, and noise is what a GIF
        # compresses worst.
        frames.append(im)

    base = frames[0].quantize(colors=args.colors, method=Image.MEDIANCUT)
    palette = base.getpalette()
    quantised = [base] + [f.quantize(palette=base, dither=Image.Dither.NONE) for f in frames[1:]]

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    quantised[0].save(
        args.out,
        save_all=True,
        append_images=quantised[1:],
        duration=round(1000 / args.fps),
        loop=0,
        optimize=True,
    )
    size = os.path.getsize(args.out)
    w, h = quantised[0].size
    print(f"{len(quantised)} frames  {w}x{h}  {args.fps} fps  {size / 1024 / 1024:.1f} MB  → {args.out}")
    void = palette  # keeps the palette read explicit; Pillow holds it on the image itself
    del void
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
