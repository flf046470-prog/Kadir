#!/usr/bin/env python3
"""Draws the First Recorders' sigil (original artwork for DERINLIK) -> SourceArt/Textures/T_FirstRecorderSigil.png.
White lines on transparent background, 1024x1024, for the camcorder-only decal. Requires Pillow."""
import math
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[2] / "SourceArt" / "Textures" / "T_FirstRecorderSigil.png"
S, W = 4096, (255, 255, 255, 255)   # drawn at 4x and downsampled for clean anti-aliasing
c = S / 2

img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

def ring(r, w):
    d.ellipse([c - r, c - r, c + r, c + r], outline=W, width=w)

ring(1900, 70); ring(1700, 28); ring(1080, 56); ring(380, 48)

# 64 tally marks between the outer rings, every 8th long: the Recorders' count
for i in range(64):
    a = 2 * math.pi * i / 64
    r0, r1 = 1720, (1880 if i % 8 else 1960)
    d.line([c + r0 * math.cos(a), c + r0 * math.sin(a), c + r1 * math.cos(a), c + r1 * math.sin(a)],
           fill=W, width=34 if i % 8 else 56)

# four nodes = the four sealed centres (Sakarya, Nevsehir, Kola, Paris), wired to the core
for k in range(4):
    a = math.pi / 4 + k * math.pi / 2
    x, y = c + 1380 * math.cos(a), c + 1380 * math.sin(a)
    d.ellipse([x - 210, y - 210, x + 210, y + 210], outline=W, width=48)
    d.ellipse([x - 70, y - 70, x + 70, y + 70], fill=W)
    d.line([x, y, c + 400 * math.cos(a), c + 400 * math.sin(a)], fill=W, width=40)
for k in range(4):
    a0 = math.degrees(math.pi / 4 + k * math.pi / 2) + 12
    d.arc([c - 1380, c - 1380, c + 1380, c + 1380], a0, a0 + 66, fill=W, width=30)

# lens-shaped eye (two circular arcs meeting at c +/- 760) with a vertical slit: "the eye that records"
half_width, sagitta = 760, 430
R = (half_width ** 2 + sagitta ** 2) / (2 * sagitta)
off = R - sagitta
ang = math.degrees(math.atan2(off, half_width))
d.arc([c - R, c + off - R, c + R, c + off + R], 180 + ang, 360 - ang, fill=W, width=52)
d.arc([c - R, c - off - R, c + R, c - off + R], ang, 180 - ang, fill=W, width=52)
d.rounded_rectangle([c - 60, c - 300, c + 60, c + 300], radius=60, fill=W)

OUT.parent.mkdir(parents=True, exist_ok=True)
img.resize((1024, 1024), Image.LANCZOS).save(OUT)
print(f"wrote {OUT}")
