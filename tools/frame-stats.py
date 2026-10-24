#!/usr/bin/env python3
"""
Score captured trailer frames on whether there is anything in them.

Brightness was the first metric and it is the wrong one twice over: a frame is dark because the
cave is dark, and also because the camera is pitched down at brown ground, and it is bright
because the sand shoreline is bright and completely empty. Five captures were tuned against it
before the failure it kept missing became obvious — the trailer kept finding the emptiest parts
of a map whose scenery is dense around the spawn and thins out in every direction.

What a trailer frame needs is *stuff*: silhouettes, edges, colour variety. So:

  detail   fraction of pixels that differ from their neighbour — props, trunks, foliage edges.
           Flat sky, flat ground and flat sand all score near zero however bright they are.
  colours  distinct quantised colours, which separates a scene from a gradient.

Usage: python3 tools/frame-stats.py dist/trailer/frames
"""

import os
import statistics
import sys

from PIL import Image, ImageChops, ImageFilter, ImageStat


def main() -> int:
    d = sys.argv[1] if len(sys.argv) > 1 else "dist/trailer/frames"
    files = sorted(f for f in os.listdir(d) if f.endswith(".png"))
    if not files:
        print(f"no frames in {d}", file=sys.stderr)
        return 1

    detail, colours, bright, empty = [], [], [], 0
    for name in files:
        im = Image.open(os.path.join(d, name)).convert("RGB").resize((320, 180))
        grey = im.convert("L")
        bright.append(ImageStat.Stat(grey).mean[0])
        # Edge energy: how much of the frame is a boundary between two things.
        edges = grey.filter(ImageFilter.FIND_EDGES)
        px = list(edges.getdata())
        share = sum(1 for v in px if v > 18) / len(px)
        detail.append(share * 100)
        colours.append(len(im.quantize(colors=64).convert("RGB").getcolors(4096) or []))
        if share * 100 < 4.0:
            empty += 1

    print(f"frames        {len(files)}")
    print(f"detail        median {statistics.median(detail):.1f}%  min {min(detail):.1f}%")
    print(f"colours       median {statistics.median(colours):.0f}")
    print(f"brightness    median {statistics.median(bright):.0f}")
    print(f"empty frames  {empty}/{len(files)}  (under 4% edge cover)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
