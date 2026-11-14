"""Generates the emissive 'screens' atlas used by station consoles, signs and lamps.

Original artwork drawn with Pillow. Text uses DejaVu Sans Mono (Bitstream Vera /
DejaVu licence: free for commercial use, rendering into images is permitted).
Layout: 1024x512, 4x2 cells of 256x256.
    0 radio console      1 lab terminal (03:17 clue)   2 control monitor (map)
    3 generator panel    4 uplink terminal             5 station sign
    6 solid swatches (lamp white / warm / HELIKON blue / beacon red)
    7 frequency console
"""
import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont

CELL = 256
FONT_PATHS = ["/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"]


def _font(size):
    for p in FONT_PATHS:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def _cell(img, idx):
    x, y = (idx % 4) * CELL, (idx // 4) * CELL
    return x, y


def _crt(draw, ox, oy, bg=(4, 22, 30)):
    draw.rectangle([ox, oy, ox + CELL - 1, oy + CELL - 1], fill=bg)
    for yy in range(oy, oy + CELL, 3):
        draw.line([ox, yy, ox + CELL, yy], fill=(bg[0] + 4, bg[1] + 8, bg[2] + 10))
    draw.rectangle([ox + 4, oy + 4, ox + CELL - 5, oy + CELL - 5], outline=(60, 200, 210), width=2)


def build(path):
    rnd = random.Random(317)
    img = Image.new("RGB", (CELL * 4, CELL * 2), (0, 0, 0))
    d = ImageDraw.Draw(img)
    f_big, f_med, f_small = _font(30), _font(19), _font(14)

    # 0 radio console: spectrum waterfall + header
    ox, oy = _cell(img, 0)
    _crt(d, ox, oy)
    d.text((ox + 14, oy + 12), "TELSİZ / KANAL 6", font=f_med, fill=(130, 240, 240))
    for row in range(26):
        for col in range(56):
            v = rnd.random() ** 3
            peak = math.exp(-((col - 31) ** 2) / 8.0) * (0.6 + 0.4 * math.sin(row * 0.7))
            c = min(255, int(40 + 215 * max(v * 0.6, peak)))
            d.rectangle([ox + 14 + col * 4, oy + 46 + row * 5, ox + 17 + col * 4, oy + 50 + row * 5], fill=(c // 4, c, min(255, c + 30)))
    d.text((ox + 14, oy + 186), "SİNYAL ▮▮▮▯▯", font=f_med, fill=(255, 196, 120))
    d.text((ox + 14, oy + 214), "03:17 / ARAMA", font=f_small, fill=(150, 210, 220))

    # 1 lab terminal with the frequency clue
    ox, oy = _cell(img, 1)
    _crt(d, ox, oy, (3, 18, 12))
    lines = ["HELIKON-14 LAB", "> NUMUNE B7 KARARSIZ", "> SAATLER DURDU:", " 03:17  03:17","> FREKANS = ZAMAN", "> SON KAYIT: ADA", "_"]
    for i, t in enumerate(lines):
        d.text((ox + 14, oy + 16 + i * 30), t, font=f_med if i != 3 else f_big, fill=(120, 255, 160) if i != 3 else (255, 220, 140))

    # 2 control monitor: coastline map + grid + target
    ox, oy = _cell(img, 2)
    _crt(d, ox, oy)
    pts = []
    for k in range(80):
        a = k / 80 * math.tau
        r = 82 + 14 * math.sin(a * 3) + 9 * math.sin(a * 7 + 1) + 5 * math.sin(a * 13)
        pts.append((ox + 128 + r * math.cos(a), oy + 132 + r * 0.8 * math.sin(a)))
    d.polygon(pts, outline=(140, 240, 250), fill=(10, 50, 64))
    for g in range(0, CELL, 32):
        d.line([ox + g, oy + 8, ox + g, oy + CELL - 8], fill=(20, 70, 80))
        d.line([ox + 8, oy + g, ox + CELL - 8, oy + g], fill=(20, 70, 80))
    d.ellipse([ox + 100, oy + 150, ox + 116, oy + 166], outline=(255, 150, 90), width=3)
    d.text((ox + 12, oy + 12), "86°G / SEKTÖR 14", font=f_small, fill=(170, 240, 250))

    # 3 generator panel: two gauges
    ox, oy = _cell(img, 3)
    d.rectangle([ox, oy, ox + CELL - 1, oy + CELL - 1], fill=(30, 30, 26))
    for i, (cx, val) in enumerate(((70, 0.72), (186, 0.38))):
        cy = oy + 110
        d.ellipse([ox + cx - 52, cy - 52, ox + cx + 52, cy + 52], fill=(222, 220, 205), outline=(80, 80, 70), width=4)
        for t in range(11):
            a = math.radians(220 - t * 26)
            d.line([ox + cx + 40 * math.cos(a), cy - 40 * math.sin(a), ox + cx + 48 * math.cos(a), cy - 48 * math.sin(a)], fill=(40, 40, 40), width=2)
        a = math.radians(220 - val * 260)
        d.line([ox + cx, cy, ox + cx + 42 * math.cos(a), cy - 42 * math.sin(a)], fill=(200, 40, 20), width=4)
    d.text((ox + 20, oy + 186), "JENERATÖR  400V", font=f_med, fill=(255, 200, 90))
    d.rectangle([ox + 20, oy + 220, ox + 60, oy + 240], fill=(40, 220, 90))

    # 4 uplink terminal: signal bars + satellites
    ox, oy = _cell(img, 4)
    _crt(d, ox, oy, (6, 12, 30))
    d.text((ox + 14, oy + 12), "BİRLİK UPLINK", font=f_med, fill=(160, 200, 255))
    for i in range(8):
        h = 20 + i * 14
        d.rectangle([ox + 20 + i * 27, oy + 210 - h, ox + 38 + i * 27, oy + 210], fill=(90, 160, 255) if i < 5 else (40, 60, 100))
    d.text((ox + 14, oy + 222), "UYDU 3/8 BAĞLI", font=f_small, fill=(200, 220, 255))

    # 5 station sign (white plate, dark text)
    ox, oy = _cell(img, 5)
    d.rectangle([ox, oy, ox + CELL - 1, oy + CELL - 1], fill=(232, 236, 236))
    d.rectangle([ox + 6, oy + 6, ox + CELL - 7, oy + CELL - 7], outline=(190, 40, 20), width=6)
    d.text((ox + 22, oy + 40), "HELIKON-14", font=_font(36), fill=(20, 28, 36))
    d.text((ox + 22, oy + 100), "ARAŞTIRMA", font=f_big, fill=(20, 28, 36))
    d.text((ox + 22, oy + 140), "İSTASYONU", font=f_big, fill=(20, 28, 36))
    d.text((ox + 22, oy + 196), "86°G  2091", font=f_med, fill=(190, 40, 20))

    # 6 solid swatches 2x2 (lamp white, warm, HELIKON blue, beacon red)
    ox, oy = _cell(img, 6)
    sw = [(235, 245, 255), (255, 214, 160), (90, 235, 255), (255, 60, 40)]
    for i, c in enumerate(sw):
        x0, y0 = ox + (i % 2) * 128, oy + (i // 2) * 128
        d.rectangle([x0, y0, x0 + 127, y0 + 127], fill=c)

    # 7 frequency console
    ox, oy = _cell(img, 7)
    _crt(d, ox, oy, (14, 8, 30))
    d.text((ox + 14, oy + 12), "FREKANS ÇÖZÜCÜ", font=f_med, fill=(220, 180, 255))
    for k in range(240):
        x = ox + 8 + k
        y = oy + 120 + 34 * math.sin(k * 0.11) * math.sin(k * 0.017 + 1) + rnd.uniform(-4, 4)
        d.point((x, y), fill=(210, 160, 255))
        d.point((x, y + 1), fill=(150, 100, 220))
    d.text((ox + 14, oy + 190), "?.?? MHz", font=f_big, fill=(255, 210, 140))

    glow = img.filter(ImageFilter.GaussianBlur(1.2))
    img = Image.blend(img, glow, 0.35)
    img.save(path)
    return path


SWATCH_UV = {  # centre UVs (Blender UV, origin bottom-left) of the solid swatches in cell 6
    "white": ((2 * CELL + 64) / 1024, 1 - (CELL + 64) / 512),
    "warm": ((2 * CELL + 192) / 1024, 1 - (CELL + 64) / 512),
    "blue": ((2 * CELL + 64) / 1024, 1 - (CELL + 192) / 512),
    "red": ((2 * CELL + 192) / 1024, 1 - (CELL + 192) / 512),
}


def cell_uv_rect(idx, inset=6):
    """Blender UV rect (u0, v0, u1, v1) of a cell."""
    x, y = (idx % 4) * CELL, (idx // 4) * CELL
    u0, u1 = (x + inset) / 1024, (x + CELL - inset) / 1024
    v1, v0 = 1 - (y + inset) / 512, 1 - (y + CELL - inset) / 512
    return u0, v0, u1, v1


if __name__ == "__main__":
    print(build("/tmp/claude-0/screens_test.png"))
