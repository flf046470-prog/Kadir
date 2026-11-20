"""App icon (1024x1024 RGB, no alpha): the HELIKON sigil glowing inside an ice-cave arch.
Original artwork drawn with Pillow; no third-party images."""
import math
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFilter

S = 1024
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'ios', 'Antarktika', 'Assets.xcassets', 'AppIcon.appiconset', 'Icon.png')
rnd = random.Random(2091)
img = Image.new('RGB', (S, S))
px = img.load()
for y in range(S):
    t = y / S
    for x in range(S):
        r = math.hypot(x - S / 2, y - S * 0.46) / (S * 0.75)
        c0 = (6, 22, 38); c1 = (18, 74, 96)
        k = max(0.0, 1 - r) ** 1.4
        px[x, y] = tuple(int(c0[i] + (c1[i] - c0[i]) * k + 10 * t) for i in range(3))
# ice arch (cave mouth) — two layered translucent bands
arch = Image.new('L', (S, S), 0)
d = ImageDraw.Draw(arch)
d.ellipse([90, 120, S - 90, S + 520], fill=255)
d.ellipse([200, 250, S - 200, S + 420], fill=0)
arch = arch.filter(ImageFilter.GaussianBlur(6))
ice = Image.new('RGB', (S, S), (120, 205, 230))
img = Image.composite(Image.blend(img, ice, 0.55), img, arch)
# glow core
glow = Image.new('RGB', (S, S), (0, 0, 0))
g = ImageDraw.Draw(glow)
cx, cy = S // 2, int(S * 0.56)
for rr, col in ((300, (20, 90, 120)), (220, (40, 160, 200)), (140, (90, 220, 250))):
    g.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=col)
glow = glow.filter(ImageFilter.GaussianBlur(90))
img = Image.eval(Image.merge('RGB', [Image.eval(a, lambda v: v) for a in img.split()]), lambda v: v)
img = Image.fromarray(__import__('numpy').clip(__import__('numpy').asarray(img, dtype='int32') + __import__('numpy').asarray(glow, dtype='int32'), 0, 255).astype('uint8'))
# sigil
sig = Image.new('RGB', (S, S), (0, 0, 0))
d = ImageDraw.Draw(sig)
for r, w in ((230, 10), (180, 6), (120, 14), (60, 6)):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(140, 245, 255), width=w)
for k in range(3):
    a = k * math.tau / 3 - math.pi / 2
    x, y = cx + 180 * math.cos(a), cy + 180 * math.sin(a)
    d.line([cx, cy, x, y], fill=(170, 250, 255), width=10)
    d.ellipse([x - 30, y - 30, x + 30, y + 30], fill=(235, 255, 255))
for k in range(36):
    a = k * math.tau / 36
    r0, r1 = 236, 258 if k % 2 else 272
    d.line([cx + r0 * math.cos(a), cy + r0 * math.sin(a), cx + r1 * math.cos(a), cy + r1 * math.sin(a)], fill=(120, 230, 250), width=6)
d.ellipse([cx - 34, cy - 34, cx + 34, cy + 34], fill=(255, 255, 255))
bloom = sig.filter(ImageFilter.GaussianBlur(16))
import numpy as np
a = np.asarray(img, dtype='int32') + np.asarray(sig, dtype='int32') + (np.asarray(bloom, dtype='int32') * 1.2).astype('int32')
img = Image.fromarray(np.clip(a, 0, 255).astype('uint8'))
# station beacon accent + snow
d = ImageDraw.Draw(img)
d.ellipse([cx + 300, 175, cx + 322, 197], fill=(255, 150, 90))
for _ in range(260):
    x, y, r = rnd.uniform(0, S), rnd.uniform(0, S), rnd.uniform(1.2, 4.2)
    v = int(rnd.uniform(170, 255))
    d.ellipse([x - r, y - r, x + r, y + r], fill=(v, v, min(255, v + 10)))
img = img.filter(ImageFilter.SMOOTH)
img.convert('RGB').save(out, optimize=True)
print('icon', out, img.size, img.mode)
