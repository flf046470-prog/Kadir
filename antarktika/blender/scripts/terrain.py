"""Python port of the game's terrain height function.

The Blender build scripts need the exact ground height the WebGL engine uses so
that foundations, cave shells and NPC paths sit on the same surface the player
walks on. The heightfield payload is read from the game's own index.html, so
there is a single source of truth.

Ported from `terrainY()` and `ICEWALK_TERRAIN.sample()` in Game/index.html.
Verified against the JavaScript original by tools/verify_terrain_port.mjs.
"""
import base64
import math
import os
import re
import struct

_HERE = os.path.dirname(os.path.abspath(__file__))
GAME_HTML = os.path.normpath(os.path.join(_HERE, "..", "..", "ios", "Antarktika", "Game", "index.html"))

SIZE = 257
XMIN, XMAX, ZMIN, ZMAX = -325.0, 325.0, -390.0, 135.0
_values = None


def _load():
    global _values
    if _values is not None:
        return _values
    with open(GAME_HTML, "r", encoding="utf-8") as fh:
        text = fh.read()
    m = re.search(r'const terrainPayload="([A-Za-z0-9+/=]+)"', text)
    if not m:
        raise RuntimeError("terrainPayload not found in " + GAME_HTML)
    raw = base64.b64decode(m.group(1))
    _values = struct.unpack("<%dh" % (SIZE * SIZE), raw[: SIZE * SIZE * 2])
    return _values


def sample(x, z):
    v = _load()
    if x < XMIN or x > XMAX or z < ZMIN or z > ZMAX:
        return 0.0
    u = (x - XMIN) / (XMAX - XMIN) * (SIZE - 1)
    w = (z - ZMIN) / (ZMAX - ZMIN) * (SIZE - 1)
    col = min(SIZE - 2, int(math.floor(u)))
    row = min(SIZE - 2, int(math.floor(w)))
    a = u - col
    b = w - row
    k = row * SIZE + col
    return ((v[k] * (1 - a) + v[k + 1] * a) * (1 - b) + (v[k + SIZE] * (1 - a) + v[k + SIZE + 1] * a) * b) * 0.01


def _clamp(n, a, b):
    return min(b, max(a, n))


def terrain_y(x, z):
    y = (1.2 * math.sin(x * 0.029 + z * 0.01) + 0.85 * math.cos(z * 0.042 - x * 0.017)
         + 0.37 * math.sin(x * 0.21 + z * 0.12) + 0.25 * math.cos(z * 0.28 - x * 0.19))
    edge = max(0.0, (abs(x + 9) - 130) / 120)
    y += 22 * edge * edge + 3.4 * math.sin(z * 0.045 + x * 0.033) * min(1.0, edge)
    cut = abs((x + 57) - 0.21 * (z + 50))
    cap = _clamp((z + 150) / 20, 0, 1) * _clamp((-z - 12) / 15, 0, 1)
    y -= 19 * (1 - _clamp((cut - 1.7) / 8.5, 0, 1)) ** 2 * cap
    cut2 = abs((x - 76) + 0.28 * (z + 180))
    cap2 = _clamp((z + 250) / 25, 0, 1) * _clamp((-z - 95) / 20, 0, 1)
    y -= 15 * (1 - _clamp((cut2 - 1.4) / 7, 0, 1)) ** 2 * cap2
    return y + sample(x, z)


def footprint_range(cx, cz, half_x, half_z, step=0.5):
    """Min/max terrain height over an axis-aligned rectangle (game coordinates)."""
    lo, hi = 1e9, -1e9
    nx = int(2 * half_x / step) + 1
    nz = int(2 * half_z / step) + 1
    for i in range(nx):
        for j in range(nz):
            h = terrain_y(cx - half_x + i * step, cz - half_z + j * step)
            lo, hi = min(lo, h), max(hi, h)
    return lo, hi


if __name__ == "__main__":
    import json, sys
    pts = json.loads(sys.argv[1]) if len(sys.argv) > 1 else [[0, 35], [23, 27], [-8, -42]]
    print(json.dumps([round(terrain_y(x, z), 6) for x, z in pts]))


# The engine renders terrain as a RES x RES grid with linear triangles. Meshes that
# must lie flush on the visible ground (decals, cave floors) use this instead of
# terrain_y so they are parallel to the drawn triangles, not the analytic surface.
RES = 246


def terrain_mesh_y(x, z):
    dx, dz = (XMAX - XMIN) / RES, (ZMAX - ZMIN) / RES
    fi, fj = (x - XMIN) / dx, (z - ZMIN) / dz
    i, j = int(math.floor(fi)), int(math.floor(fj))
    a, b = fi - i, fj - j
    x0, z0 = XMIN + i * dx, ZMIN + j * dz
    h00 = terrain_y(x0, z0)
    h01 = terrain_y(x0, z0 + dz)
    h10 = terrain_y(x0 + dx, z0)
    h11 = terrain_y(x0 + dx, z0 + dz)
    # triangles (i,j)(i,j+1)(i+1,j) and (i+1,j)(i,j+1)(i+1,j+1): split on a + b = 1
    if a + b <= 1:
        return h00 + (h10 - h00) * a + (h01 - h00) * b
    return h11 + (h01 - h11) * (1 - a) + (h10 - h11) * (1 - b)
