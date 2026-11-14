"""The trailer's live-action prologue, finished: Blender's photoreal frames become consumer-camcorder footage, and on
the same camera path the footage turns into the game.

    python3 DerinlikSteam/tools/prologue_post.py --real <blender frames dir> --frames <trailer frames dir> \
        --path path.json [--only 0,120,215] [--preview <dir>]

Reads <real>/0001.png ... (tools/prologue_blender.py) and, for the turn, the game's frames that trailer.mjs rendered on
the same path (<frames>/<n>.jpg; the originals are kept in <frames>/_game/ the first time, so a rerun starts clean).
Writes <frames>/00001.jpg ... for the real part and the turn, at 1920x1080. --only/--preview write chosen frames to a
separate folder to look at.

The camcorder: auto-exposure that settles after power-on, tungsten light only half corrected, sensor noise heavier in
the shadows with blotchy colour noise, 4:1:1 colour smear, edge-enhancement halos, a soft SD picture blown up to HD,
a cheap zoom lens (barrel, colour fringes, vignette, glow round the bulb), and the on-screen display: REC, tape
counter, battery, zoom bar while zooming, date and time (02:51, the minute the game's own camcorder clock starts).
The turn: a tape glitch, then the picture is re-drawn from the top down as the game, the front a line of blocks.
Needs numpy, Pillow and opencv-python-headless.
"""
import argparse
import json
import math
import os
import shutil

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

W, H = 1920, 1080
FONT = os.path.join(os.path.dirname(__file__), '..', '..', 'DerinlikWeb', 'node_modules', '@fontsource', 'vt323', 'files', 'vt323-latin-400-normal.woff')
ap = argparse.ArgumentParser()
ap.add_argument('--real', required=True)
ap.add_argument('--frames', required=True)
ap.add_argument('--path', required=True)
ap.add_argument('--only')
ap.add_argument('--preview')
a = ap.parse_args()
P = json.load(open(a.path))
FPS, REAL, TURN = P['fps'], P['real'], P['turn']
ZOOM = P.get('zoom') or []
ZMAX = 10.0                                            # the bar's tele end: a cheap camcorder's 10x optical zoom
rng = np.random.default_rng(2028)


def smooth(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def font(px):
    return ImageFont.truetype(FONT, px)


F_BIG, F_SMALL = font(64), font(52)


def osd(img, i, alpha=1.0, flicker=False):
    """The camcorder's on-screen display, white with a hard dark shadow."""
    if alpha <= 0:
        return img
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    t = i / FPS
    a8 = int(255 * alpha)

    def txt(xy, s, f, col=(238, 238, 232)):
        d.text((xy[0] + 3, xy[1] + 3), s, font=f, fill=(0, 0, 0, int(a8 * .7)))
        d.text(xy, s, font=f, fill=col + (a8,))
    if i >= 8:
        if (t % 1.0) < .62 or flicker:
            d.ellipse((120, 108, 152, 140), fill=(226, 38, 32, a8))
        txt((166, 92), 'REC', F_BIG)
        sec = int(max(0, t - 8 / FPS))
        txt((120, 160), f'0:{sec // 60:02d}:{sec % 60:02d}', F_SMALL)
        # battery: three of four bars
        x, y = 1660, 104
        d.rectangle((x, y, x + 120, y + 44), outline=(238, 238, 232, a8), width=5)
        d.rectangle((x + 120, y + 12, x + 132, y + 32), fill=(238, 238, 232, a8))
        for b in range(3):
            d.rectangle((x + 12 + b * 35, y + 11, x + 38 + b * 35, y + 33), fill=(238, 238, 232, a8))
        txt((1660, 160), 'SP', F_SMALL)
        z = ZOOM[i] if i < len(ZOOM) else 1.0
        near = [ZOOM[j] for j in range(max(0, i - FPS * 3 // 2), min(len(ZOOM), i + 1))]
        if max(near, default=1.0) > 1.01:              # the zoom bar, while zooming and a moment after
            x0, x1, y = 760, 1160, 128
            txt((x0 - 46, y - 30), 'W', F_SMALL)
            txt((x1 + 18, y - 30), 'T', F_SMALL)
            d.rectangle((x0, y - 4, x1, y + 4), outline=(238, 238, 232, a8), width=3)
            k = x0 + (x1 - x0) * (z - 1) / (ZMAX - 1)
            d.rectangle((k - 6, y - 22, k + 6, y + 22), fill=(238, 238, 232, a8))
        clock = 2 * 3600 + 51 * 60 + 4 + int(t)
        txt((120, 900), '07.11.2028', F_SMALL)
        txt((120, 954), f'{clock // 3600:02d}:{clock // 60 % 60:02d}:{clock % 60:02d}', F_SMALL)
    base = Image.fromarray(img).convert('RGBA')
    return np.array(Image.alpha_composite(base, layer).convert('RGB'))


def lens_maps():
    """Barrel distortion with colour fringing: per-channel remap tables (zoom lens at its wide end)."""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    nx, ny = (xx - W / 2) / (W / 2), (yy - H / 2) / (W / 2)
    r2 = nx * nx + ny * ny
    maps = []
    for scale in (1.0016, 1.0, .9984):            # red a hair wider than blue: lateral chromatic aberration
        k = (1 + .045 * r2) / (1 + .045 * .56) * scale
        maps.append(((nx * k) * (W / 2) + W / 2, (ny * k) * (W / 2) + H / 2))
    vig = 1 - .38 * np.clip(r2 / .56, 0, 1) ** 1.4
    return maps, vig.astype(np.float32)


MAPS, VIG = lens_maps()


def camcorder(src, i):
    """One Blender frame (sRGB, 640x360) as a 2000s consumer camcorder would have recorded it."""
    img = src.astype(np.float32) / 255
    # fireflies: a pixel far above its neighbourhood is path-tracing noise, not light
    med = cv2.medianBlur(src, 3).astype(np.float32) / 255
    img = np.where(img - med > .18, med, img)
    lin = img ** 2.2
    lin *= np.array([.84, .96, 1.2], np.float32)       # auto white balance, half way to neutral under tungsten
    t = i / FPS
    gain = 1.0 + 1.6 * math.exp(-max(0, i - 8) / 7) + .035 * math.sin(t * 2.1) + .02 * math.sin(t * 5.3)
    lin *= gain                                         # power-on: the iris opens wide, then settles; then it breathes
    img = np.clip(lin, 0, 4) ** (1 / 2.2)
    grey = img.mean(axis=2, keepdims=True)
    img = grey + (img - grey) * .82
    # SD sensor: work at 960x540, noise heavier in the dark, colour noise in blotches
    img = cv2.resize(img, (960, 540), interpolation=cv2.INTER_CUBIC)
    lum = img.mean(axis=2, keepdims=True)
    img += rng.standard_normal((540, 960, 1)).astype(np.float32) * (.018 + .05 * (1 - np.clip(lum * 1.6, 0, 1)))
    blot = cv2.resize(rng.standard_normal((68, 120, 3)).astype(np.float32), (960, 540), interpolation=cv2.INTER_LINEAR)
    img += blot * .02 * (1 - np.clip(lum * 1.4, 0, 1))
    img = np.clip(img, 0, 1.2)
    # 4:1:1 colour: chroma kept at a quarter width, smeared sideways
    ycc = cv2.cvtColor(np.clip(img, 0, 1), cv2.COLOR_RGB2YCrCb)
    for c in (1, 2):
        ch = cv2.resize(ycc[:, :, c], (240, 540), interpolation=cv2.INTER_AREA)
        ycc[:, :, c] = cv2.GaussianBlur(cv2.resize(ch, (960, 540), interpolation=cv2.INTER_LINEAR), (9, 1), 0)
    img = cv2.cvtColor(ycc, cv2.COLOR_YCrCb2RGB)
    # edge enhancement: the camcorder's own sharpening, halos and all
    img = np.clip(img + (img - cv2.GaussianBlur(img, (0, 0), 1.4)) * .9, 0, 1)
    img = cv2.resize(img, (W, H), interpolation=cv2.INTER_CUBIC)
    # lens
    out = np.empty_like(img)
    for c, (mx, my) in enumerate(MAPS):
        out[:, :, c] = cv2.remap(img[:, :, c], mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    hi = np.clip(out - .8, 0, None)
    out += cv2.GaussianBlur(hi, (0, 0), 28) * 1.6 + cv2.GaussianBlur(hi, (0, 0), 6) * .6
    out *= VIG[:, :, None]
    out[1::2] *= .975                                   # interlaced fields, barely
    if i < 8:                                           # power-on: black, then the picture rolls in
        out *= 0
    elif i < 13:
        out *= (i - 8) / 5
    return (np.clip(out, 0, 1) * 255).astype(np.uint8)


def tear(img, amount, seed):
    """Tape glitch: bands of lines shifted sideways, colour channels pulled apart."""
    r = np.random.default_rng(seed)
    out = img.copy()
    for _ in range(int(3 + 9 * amount)):
        y0 = int(r.integers(0, H - 8))
        h = int(r.integers(4, int(18 + 90 * amount)))
        dx = int(r.normal(0, 70 * amount))
        out[y0:y0 + h] = np.roll(out[y0:y0 + h], dx, axis=1)
    s = int(12 * amount)
    if s:
        out[:, :, 0] = np.roll(out[:, :, 0], s, axis=1)
        out[:, :, 2] = np.roll(out[:, :, 2], -s, axis=1)
    if amount > .4:                                     # a band of white snow across the frame
        y0 = int(r.integers(0, H - 60))
        band = r.integers(0, 255, (int(20 + 60 * amount), W, 1), dtype=np.uint8)
        out[y0:y0 + band.shape[0]] = np.clip(out[y0:y0 + band.shape[0]] * .3 + band * .7, 0, 255).astype(np.uint8)
    return out


def turn(real, game, k):
    """Frame k of the turn: the footage glitches, then is re-drawn from the top as the game."""
    u = k / max(1, TURN - 1)
    if u < .14:                                         # the tape catches
        return np.clip(tear(real, .35 + 3 * u, 900 + k), 0, 255).astype(np.uint8)
    v = smooth((u - .14) / .74)
    front = -80 + v * (H + 160)
    B = 40                                              # the front is a row of blocks, each at its own height
    r = np.random.default_rng(1200 + k)
    cols = W // B
    jitter = r.normal(0, 46, cols).astype(np.float32)
    edge = np.repeat(front + jitter, B)[:W]
    yy = np.arange(H, dtype=np.float32)[:, None]
    m = (yy < edge[None, :]).astype(np.float32)        # 1 = already the game
    out = real * (1 - m[:, :, None]) + game * m[:, :, None]
    near = np.abs(yy - edge[None, :]) < 46
    if near.any():                                      # at the front: both pictures pixelated into blocks
        mosaic = cv2.resize(cv2.resize(out.astype(np.uint8), (W // 16, H // 16), interpolation=cv2.INTER_AREA), (W, H), interpolation=cv2.INTER_NEAREST)
        out[near] = mosaic[near]
    line = np.exp(-((yy - edge[None, :]) / 3.0) ** 2)
    out += line[:, :, None] * np.array([150, 205, 255], np.float32) * (1 - v * .6)
    out = np.clip(out, 0, 255).astype(np.uint8)
    if u > .88:                                         # the last of the tape settles out of the game picture
        out = tear(out, (1 - u) * 2.5, 1500 + k)
    return out


frames_dir = a.frames
keep = os.path.join(frames_dir, '_game')
os.makedirs(keep, exist_ok=True)
todo = [int(x) for x in a.only.split(',')] if a.only else list(range(REAL + TURN))
out_dir = a.preview or frames_dir
os.makedirs(out_dir, exist_ok=True)
for i in todo:
    src = np.array(Image.open(os.path.join(a.real, f'{i + 1:04d}.png')).convert('RGB'))
    real = camcorder(src, i)
    if i < REAL:
        img = osd(real, i)
    else:
        k = i - REAL
        name = f'{i + 1:05d}.jpg'
        g_keep = os.path.join(keep, name)
        if not os.path.exists(g_keep):
            shutil.copy(os.path.join(frames_dir, name), g_keep)
        game = np.array(Image.open(g_keep).convert('RGB').resize((W, H)))
        u = k / max(1, TURN - 1)
        real = osd(real, i, alpha=1 - smooth(u / .5), flicker=u < .14)
        img = turn(real.astype(np.float32), game.astype(np.float32), k)
    Image.fromarray(img).save(os.path.join(out_dir, f'{i + 1:05d}.jpg'), quality=92)
    if a.only:
        print('wrote', os.path.join(out_dir, f'{i + 1:05d}.jpg'))
print(f'{len(todo)} frames: real {sum(1 for i in todo if i < REAL)}, turn {sum(1 for i in todo if i >= REAL)}')
