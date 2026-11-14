"""Turns the six cube faces from preview360.mjs into the Meta Horizon Store 360° preview.

    python3 DerinlikQuest/tools/preview360.py <faces dir> <out.jpg> [--width 7680] [--front pz] [--gain 1.0]

Writes a monoscopic equirectangular JPEG (2:1, 7680x3840 by default), the image's centre looking along --front.
Meta's limit is 2.3 MB at JPEG quality 80 or better: the quality is lowered from 92 until the file fits, never below 80.
"""
import argparse, io, json, os

import numpy as np
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("faces")
ap.add_argument("out")
ap.add_argument("--width", type=int, default=7680)
ap.add_argument("--front", default="pz")
ap.add_argument("--gain", type=float, default=1.0, help="brightness multiplier (linear light)")
a = ap.parse_args()

meta = json.load(open(os.path.join(a.faces, "faces.json")))
faces = {}
for name, (f, up) in meta["faces"].items():
    f, up = np.array(f, float), np.array(up, float)
    right = np.cross(f, up)                                   # three.js: looking down f with up `up`, +x on screen is f x up
    faces[name] = (f, up, right, np.asarray(Image.open(os.path.join(a.faces, f"face_{name}.png")).convert("RGB"), np.float32) / 255)

W, H = a.width, a.width // 2
# viewing directions for every output pixel: longitude 0 at the image centre = the front face's direction
front = np.array(meta["faces"][a.front][0], float)
# seen from inside, turning right (clockwise from above, y up) moves along +x of the image: the direction at longitude
# lon is (-sin lon, 0, cos lon) rotated so lon 0 is the front face
yaw0 = np.arctan2(-front[0], front[2])
lon = (np.arange(W) + .5) / W * 2 * np.pi - np.pi + yaw0
lat = np.pi / 2 - (np.arange(H) + .5) / H * np.pi
lon, lat = np.meshgrid(lon, lat)
d = np.stack([-np.cos(lat) * np.sin(lon), np.sin(lat), np.cos(lat) * np.cos(lon)], -1)

out = np.zeros((H, W, 3), np.float32)
best = np.full((H, W), -1.0)
for name, (f, up, right, img) in faces.items():
    fz = d @ f
    with np.errstate(divide="ignore", invalid="ignore"):
        x, y = (d @ right) / fz, (d @ up) / fz
    m = (fz > 0) & (np.abs(x) <= 1) & (np.abs(y) <= 1) & (fz > best)
    if not m.any():
        continue
    n = img.shape[0]
    cx = np.clip(((x[m] + 1) / 2 * n - .5), 0, n - 1)
    cy = np.clip(((1 - y[m]) / 2 * n - .5), 0, n - 1)
    x0, y0 = np.floor(cx).astype(int), np.floor(cy).astype(int)
    x1, y1 = np.minimum(x0 + 1, n - 1), np.minimum(y0 + 1, n - 1)
    tx, ty = (cx - x0)[:, None], (cy - y0)[:, None]
    out[m] = (img[y0, x0] * (1 - tx) * (1 - ty) + img[y0, x1] * tx * (1 - ty) + img[y1, x0] * (1 - tx) * ty + img[y1, x1] * tx * ty)
    best[m] = fz[m]
if a.gain != 1.0:
    out = np.clip((out ** 2.2) * a.gain, 0, 1) ** (1 / 2.2)
im = Image.fromarray((np.clip(out, 0, 1) * 255 + .5).astype(np.uint8))
for q in range(92, 79, -2):
    buf = io.BytesIO(); im.save(buf, "JPEG", quality=q, optimize=True, progressive=True, subsampling=0 if q >= 90 else 2)
    if buf.tell() <= 2.3e6:
        break
open(a.out, "wb").write(buf.getvalue())
print(f"{a.out}: {W}x{H}, JPEG quality {q}, {buf.tell() / 1e6:.2f} MB" + ("" if buf.tell() <= 2.3e6 else "  (STILL OVER 2.3 MB)"))
