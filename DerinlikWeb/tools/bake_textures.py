"""Real-world PBR texture sets for DERINLIK, baked in Blender from procedural shader-node materials.

Run headless from the repository root (Blender 4.0.2, Cycles on the CPU):

    blender -b --factory-startup -P DerinlikWeb/tools/bake_textures.py
    blender -b --factory-startup -P DerinlikWeb/tools/bake_textures.py -- --sets tuff,soil --samples 4
    blender -b --factory-startup -P DerinlikWeb/tools/bake_textures.py -- --preview-only

Writes DerinlikWeb/textures/<set>_albedo.jpg (sRGB), <set>_normal.jpg (tangent space, OpenGL +Y) and
<set>_orm.jpg (R ambient occlusion, G roughness, B metalness; linear), and a 2x2-tiled contact sheet of every set
under a raking light at DerinlikWeb/dist/texture_previews.png.

How it works
1. Blender stage. Every set is a shader-node graph (written with the small expression builder below, so
   `a * b + c` becomes Math nodes). The graph produces albedo, height (millimetres), roughness, metalness and
   optional extras. Each is routed into an Emission shader and baked with Cycles (EMIT pass) into float images.
   Every noise and Voronoi texture is 4D and sampled on a flat torus,
       x = cos(2πu), y = sin(2πu), z = cos(2πv), w = sin(2πv)   (scaled),
   so all four edges of every map meet exactly. Structures (bricks, tiles, planks, blocks, tool marks,
   footprints) are laid out on integer grids in UV and wrap the same way.
2. Post stage (system python3 with numpy + Pillow; Blender's Python has no Pillow). Normals come from the
   baked height with central differences that wrap around the edges; ambient occlusion is a horizon-based
   estimate on the same wrapped height field. Real heights in mm and the set's physical size give physically
   scaled slopes. The JPEGs are written and every map's seam is measured: the colour step across the wrap
   edge is compared with the average step between neighbouring pixels inside the image.
3. Preview stage (Blender again): each set on a plane, tiled 2x2, lit by a low raking light, then the
   contact sheet is assembled.

Physical scale: `SETS[name]['size_m']` is the edge length one texture tile represents. The game's box UVs use
1.6 m per UV unit (boxUV tile 1.6), so most sets are authored for 1.6 m and need no extra repeat.
"""
import json
import math
import os
import pathlib
import random
import subprocess
import sys
import tempfile
import time
import zlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
TEXDIR = ROOT / "textures"
DIST = ROOT / "dist"
CACHE = pathlib.Path(os.environ.get("DERINLIK_BAKE_CACHE", os.path.join(tempfile.gettempdir(), "derinlik_bake")))

# name: px = texture size, size_m = metres covered by one tile, q = JPEG quality (albedo, normal, orm),
# ao = (radius mm, strength), nrm = normal gain on top of the physical slope.
SETS = {
    "concrete_wet":  dict(px=1024, size_m=1.6, ao=(12, 1.0), nrm=1.0),
    "plaster_damp":  dict(px=1024, size_m=1.6, ao=(10, 1.0), nrm=1.0),
    "brick_old":     dict(px=1024, size_m=1.6, ao=(30, 1.0), nrm=1.0),
    "rock_rough":    dict(px=1024, size_m=1.6, ao=(60, 1.0), nrm=1.0),
    "tuff":          dict(px=1024, size_m=1.6, ao=(40, 1.0), nrm=1.0),
    "soil":          dict(px=1024, size_m=1.6, ao=(15, 1.0), nrm=1.0),
    "mud":           dict(px=1024, size_m=1.6, ao=(20, 1.0), nrm=1.0),
    "limestone":     dict(px=1024, size_m=1.6, ao=(30, 1.0), nrm=1.0),
    "paint_peeling": dict(px=1024, size_m=1.6, ao=(6, 1.0), nrm=1.0),
    "tile_ceramic":  dict(px=1024, size_m=1.6, ao=(8, 1.0), nrm=1.0),
    "metal_rust":    dict(px=512, size_m=1.0, ao=(6, 0.8), nrm=1.0),
    "wood_old":      dict(px=512, size_m=1.0, ao=(8, 1.0), nrm=1.0),
    "ice":           dict(px=512, size_m=1.0, ao=(6, 0.5), nrm=1.0),
    "frost":         dict(px=512, size_m=0.5, ao=(3, 0.8), nrm=1.0),
    "snow":          dict(px=512, size_m=1.0, ao=(20, 0.7), nrm=1.0),
    "bone":          dict(px=512, size_m=0.3, ao=(4, 1.0), nrm=1.0),
}
JPEG_Q = dict(albedo=84, normal=80, orm=78)


def seed_of(name, k=0):
    return zlib.crc32(f"{name}:{k}".encode()) & 0x7FFFFFFF


# ============================================================================ Blender stage
try:
    import bpy  # noqa: F401
    IN_BLENDER = True
except ImportError:
    IN_BLENDER = False

if IN_BLENDER:
    import numpy as np

    TAU = 2 * math.pi
    _g = None  # graph being built

    def srgb(hexstr):
        """'rrggbb' (sRGB) -> linear RGB tuple, the space shader nodes work in."""
        c = [int(hexstr[i:i + 2], 16) / 255 for i in (0, 2, 4)]
        return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)

    def _num(x):
        return isinstance(x, (int, float))

    class F:
        """A scalar node output. Arithmetic with F or numbers builds Math nodes."""
        __slots__ = ("s",)

        def __init__(self, s):
            self.s = s

        def __add__(a, b): return math_op("ADD", a, b)
        def __radd__(a, b): return math_op("ADD", b, a)
        def __sub__(a, b): return math_op("SUBTRACT", a, b)
        def __rsub__(a, b): return math_op("SUBTRACT", b, a)
        def __mul__(a, b): return cscale(b, a) if isinstance(b, (tuple, C)) else math_op("MULTIPLY", a, b)
        def __rmul__(a, b): return cscale(b, a) if isinstance(b, (tuple, C)) else math_op("MULTIPLY", b, a)
        def __truediv__(a, b): return math_op("DIVIDE", a, b)
        def __rtruediv__(a, b): return math_op("DIVIDE", b, a)
        def __pow__(a, b): return math_op("POWER", a, b)
        def __neg__(a): return math_op("MULTIPLY", a, -1.0)

    class C:
        """A colour/vector node output (3 channels). Supports + - with C/tuple and * with C/tuple/scalar."""
        __slots__ = ("s",)

        def __init__(self, s):
            self.s = s

        def __add__(a, b): return vec_op("ADD", a, b)
        def __radd__(a, b): return vec_op("ADD", b, a)
        def __sub__(a, b): return vec_op("SUBTRACT", a, b)
        def __rsub__(a, b): return vec_op("SUBTRACT", b, a)

        def __mul__(a, b):
            if _num(b) or isinstance(b, F):
                return cscale(a, b)
            return vec_op("MULTIPLY", a, b)
        __rmul__ = __mul__

    def _set(inp, val):
        if isinstance(val, (F, C)):
            _g.L.new(val.s, inp)
        elif isinstance(val, tuple):
            n = len(inp.default_value)
            inp.default_value = tuple(val[:n]) + (1.0,) * (n - len(val))
        else:
            inp.default_value = float(val)

    def node(kind, **props):
        n = _g.N.new(kind)
        for k, v in props.items():
            setattr(n, k, v)
        _g.count += 1
        return n

    def math_op(op, a, b=None, c=None, clamp=False):
        if _num(a) and (b is None or _num(b)) and (c is None or _num(c)) and op in ("ADD", "SUBTRACT", "MULTIPLY", "DIVIDE"):
            return {"ADD": a + b, "SUBTRACT": a - b, "MULTIPLY": a * b, "DIVIDE": a / b}[op]
        n = node("ShaderNodeMath", operation=op, use_clamp=clamp)
        for i, x in enumerate((a, b, c)):
            if x is not None:
                _set(n.inputs[i], x)
        return F(n.outputs[0])

    def _cv(x):
        return x if isinstance(x, C) else (tuple(x) if isinstance(x, tuple) else (float(x),) * 3)

    def vec_op(op, a, b):
        n = node("ShaderNodeVectorMath", operation=op)
        _set(n.inputs[0], _cv(a))
        _set(n.inputs[1], _cv(b))
        return C(n.outputs[0])

    def cscale(a, k):
        n = node("ShaderNodeVectorMath", operation="SCALE")
        _set(n.inputs[0], _cv(a))
        _set(n.inputs[3], k)
        return C(n.outputs[0])

    def cmix(a, b, t):
        """Linear blend of two colours: a at t=0, b at t=1 (t clamped)."""
        if _num(t):
            t = min(1.0, max(0.0, t))
        n = node("ShaderNodeMix", data_type="RGBA", blend_type="MIX", clamp_factor=True)
        _set(n.inputs[0], t)
        _set(n.inputs[6], _cv(a) if isinstance(a, C) else tuple(a) + (1.0,))
        _set(n.inputs[7], _cv(b) if isinstance(b, C) else tuple(b) + (1.0,))
        return C(n.outputs[2])

    def cblend(mode, a, b, t=1.0):
        n = node("ShaderNodeMix", data_type="RGBA", blend_type=mode, clamp_factor=True)
        _set(n.inputs[0], t)
        _set(n.inputs[6], _cv(a) if isinstance(a, C) else tuple(a) + (1.0,))
        _set(n.inputs[7], _cv(b) if isinstance(b, C) else tuple(b) + (1.0,))
        return C(n.outputs[2])

    def lum(c):
        n = node("ShaderNodeVectorMath", operation="DOT_PRODUCT")
        _set(n.inputs[0], _cv(c))
        _set(n.inputs[1], (0.2126, 0.7152, 0.0722))
        return F(n.outputs[1])

    def combine(x, y, z):
        n = node("ShaderNodeCombineXYZ")
        for i, v in enumerate((x, y, z)):
            _set(n.inputs[i], v)
        return C(n.outputs[0])

    def split(c):
        n = node("ShaderNodeSeparateXYZ")
        _set(n.inputs[0], _cv(c))
        return F(n.outputs[0]), F(n.outputs[1]), F(n.outputs[2])

    # ---- scalar helpers (accept F or numbers)
    def mix(a, b, t): return math_op("MULTIPLY_ADD", t, math_op("SUBTRACT", b, a), a) if not (_num(a) and _num(b) and _num(t)) else a + (b - a) * t
    def fmin(a, b): return math_op("MINIMUM", a, b)
    def fmax(a, b): return math_op("MAXIMUM", a, b)
    def fabs(a): return math_op("ABSOLUTE", a)
    def floor(a): return math_op("FLOOR", a)
    def fract(a): return math_op("FRACT", a)
    def fsin(a): return math_op("SINE", a)
    def fcos(a): return math_op("COSINE", a)
    def fsqrt(a): return math_op("SQRT", fmax(a, 0.0))
    def fmod(a, m): return math_op("FLOORED_MODULO", a, m)
    def sat(a): return math_op("ADD", a, 0.0, clamp=True)
    def less(a, b): return math_op("LESS_THAN", a, b)
    def greater(a, b): return math_op("GREATER_THAN", a, b)
    def smin(a, b, k): return math_op("SMOOTH_MIN", a, b, k)
    def smax(a, b, k): return math_op("SMOOTH_MAX", a, b, k)

    def smooth(e0, e1, x):
        """smoothstep from e0 to e1 (e0 > e1 gives the falling edge)."""
        if not (_num(e0) and _num(e1)):  # node-driven edges: explicit smoothstep, valid for either edge order
            t = sat((x - e0) / (e1 - e0))
            return t * t * (3.0 - 2.0 * t)
        if e0 > e1:
            return 1.0 - smooth(e1, e0, x)
        n = node("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP", clamp=True)
        _set(n.inputs[0], x)
        _set(n.inputs[1], e0)
        _set(n.inputs[2], e1)
        return F(n.outputs[0])

    def remap(x, a0, a1, b0=0.0, b1=1.0, clamp=True):
        n = node("ShaderNodeMapRange", interpolation_type="LINEAR", clamp=clamp)
        for i, v in enumerate((x, a0, a1, b0, b1)):
            _set(n.inputs[i], v)
        return F(n.outputs[0])

    def band(x, center, width, soft):
        """1 inside |x-center| < width, smooth edge of `soft`."""
        return smooth(width + soft, width, fabs(x - center))

    # ---- textures on the flat torus
    def _torus(uv, fu, fv, seed):
        """4D point for (u, v) on a flat torus with fu features per tile along u and fv along v."""
        u, v = uv
        key = (id(u), id(v))
        if key not in _g.trig:
            a, b = u * TAU, v * TAU
            _g.trig[key] = (fcos(a), fsin(a), fcos(b), fsin(b), (u, v))  # keep u, v alive so ids stay unique
        ca, sa, cb, sb, _ = _g.trig[key]
        r = random.Random(seed)
        off = [r.uniform(-60, 60) for _ in range(4)]
        ru, rv = fu / TAU, fv / TAU
        vec = combine(ca * ru + off[0], sa * ru + off[1], cb * rv + off[2])
        return vec, sb * rv + off[3]

    def noise(uv, f, seed, detail=4.0, rough=0.5, lac=2.0, dist=0.0, fv=None, color=False):
        """4D Perlin fBm, periodic over the tile. f = features per tile along u (fv along v). Returns F in ~[0, 1]."""
        vec, w = _torus(uv, f, f if fv is None else fv, seed)
        n = node("ShaderNodeTexNoise", noise_dimensions="4D", normalize=True)
        _set(n.inputs["Vector"], vec)
        _set(n.inputs["W"], w)
        _set(n.inputs["Scale"], 1.0)
        _set(n.inputs["Detail"], detail)
        _set(n.inputs["Roughness"], rough)
        _set(n.inputs["Lacunarity"], lac)
        _set(n.inputs["Distortion"], dist)
        if color:
            return F(n.outputs["Fac"]), C(n.outputs["Color"])
        return F(n.outputs["Fac"])

    def snoise(uv, f, seed, **kw):
        """Signed noise, roughly -1..1 (std ~0.35)."""
        return (noise(uv, f, seed, **kw) - 0.5) * 2.0

    def musgrave(uv, f, seed, kind="RIDGED_MULTIFRACTAL", detail=6.0, dim=1.0, lac=2.0, offset=1.0, gain=2.0, fv=None):
        vec, w = _torus(uv, f, f if fv is None else fv, seed)
        n = node("ShaderNodeTexMusgrave", musgrave_dimensions="4D", musgrave_type=kind)
        _set(n.inputs["Vector"], vec)
        _set(n.inputs["W"], w)
        _set(n.inputs["Scale"], 1.0)
        _set(n.inputs["Detail"], detail)
        _set(n.inputs["Dimension"], dim)
        _set(n.inputs["Lacunarity"], lac)
        _set(n.inputs["Offset"], offset)
        _set(n.inputs["Gain"], gain)
        return F(n.outputs["Fac"])

    class Vor:
        __slots__ = ("d", "col", "pos", "w")

    def voronoi(uv, f, seed, feature="F1", rand=1.0, metric="EUCLIDEAN", fv=None, smooth_k=0.0):
        """4D Voronoi on the torus. d = distance in 'feature' units (1 = one cell), col = random colour per cell."""
        vec, w = _torus(uv, f, f if fv is None else fv, seed)
        n = node("ShaderNodeTexVoronoi", voronoi_dimensions="4D", feature=feature, distance=metric)
        _set(n.inputs["Vector"], vec)
        _set(n.inputs["W"], w)
        _set(n.inputs["Scale"], 1.0)
        _set(n.inputs["Randomness"], rand)
        if feature == "SMOOTH_F1":
            _set(n.inputs["Smoothness"], smooth_k)
        o = Vor()
        out = {s.name: s for s in n.outputs if s.enabled}  # DISTANCE_TO_EDGE has no Color/Position/W
        o.d = F(out["Distance"])
        o.col = C(out["Color"]) if "Color" in out else None
        o.pos = C(out["Position"]) if "Position" in out else None
        o.w = F(out["W"]) if "W" in out else None
        return o

    def white(x, y=0.0, z=0.0, color=False):
        """Hash of (x, y, z): the same input always gives the same value. Use with integer cell ids."""
        n = node("ShaderNodeTexWhiteNoise", noise_dimensions="3D")
        _set(n.inputs["Vector"], combine(x, y, z))
        return C(n.outputs["Color"]) if color else F(n.outputs["Value"])

    def warp(uv, amount, f, seed, detail=3.0):
        """Domain warp in UV space; the result is still periodic because the offsets are."""
        u, v = uv
        return (u + snoise(uv, f, seed, detail=detail) * amount, v + snoise(uv, f, seed + 1, detail=detail) * amount)

    # ---- structures on integer grids (periodic as long as counts are integers)
    def wrapped_delta(a, b):
        """Shortest signed difference a-b on a unit circle (for features placed on the torus)."""
        d = a - b
        return d - floor(d + 0.5)

    class Cells:
        pass

    def bond(uv, nx, ny, seed, shift=0.5, jitter=0.0, row_rand=0.0):
        """Running-bond grid: ny rows (ny even for shift 0.5), nx cells per row, joint positions jittered by
        `jitter` cell widths. Returns cell ids, local coords (0..1) and the cell's size in UV."""
        u, v = uv
        y = v * ny
        row = floor(y)
        rowm = fmod(row, ny)
        x = u * nx + rowm * shift + (white(rowm, seed, 7.0) * row_rand if row_rand else 0.0)
        c0 = floor(x)
        fx = x - c0

        def j(k):
            return (white(fmod(k, nx), rowm, seed) - 0.5) * (2 * jitter)
        if jitter:
            jl, jr = j(c0), j(c0 + 1.0)
            c = c0 - less(fx, jl) + math_op("GREATER_THAN", fx, 1.0 + jr - 1e-6)
            left = c + j(c)
            right = c + 1.0 + j(c + 1.0)
        else:
            c, left, right = c0, c0, c0 + 1.0
        o = Cells()
        o.col = fmod(c, nx)
        o.row = rowm
        o.lx = (x - left) / (right - left)
        o.ly = y - row
        o.w = (right - left) / nx
        o.h = 1.0 / ny
        o.id = white(o.col, o.row, seed + 0.5)
        o.rnd = white(o.col, o.row, seed + 0.25, color=True)
        return o

    def rbox_in(lx, ly, w, h, r):
        """Inside distance (>0 inside) of a rounded rectangle of size w x h (same units), local coords 0..1."""
        px = fabs(lx - 0.5) * w
        py = fabs(ly - 0.5) * h
        qx = px - (w * 0.5 - r)
        qy = py - (h * 0.5 - r)
        outside = fsqrt(fmax(qx, 0.0) * fmax(qx, 0.0) + fmax(qy, 0.0) * fmax(qy, 0.0))
        inside = fmin(fmax(qx, qy), 0.0)
        return r - outside - inside

    def dot(a, b):
        n = node("ShaderNodeVectorMath", operation="DOT_PRODUCT")
        _set(n.inputs[0], _cv(a))
        _set(n.inputs[1], _cv(b))
        return F(n.outputs[1])

    def scatter(uv, nx, ny, seed, fn, jit=0.7, op="max", k=0.0):
        """One feature per cell of an nx x ny grid, evaluated over the 3x3 neighbouring cells so features may
        overlap their cell. fn(dx, dy, r) gets the offset from the feature centre in UV units and six random
        numbers per feature; the results are combined with max (or smooth max with k)."""
        u, v = uv
        px, py = u * nx, v * ny
        cx, cy = floor(px), floor(py)
        res = None
        for dj in (-1.0, 0.0, 1.0):
            for di in (-1.0, 0.0, 1.0):
                ix, iy = cx + di, cy + dj
                mx, my = fmod(ix, nx), fmod(iy, ny)
                r1 = split(white(mx, my, seed, color=True))
                r2 = split(white(mx, my, seed + 0.37, color=True))
                dx = (px - ix - 0.5 - (r1[0] - 0.5) * jit) / nx
                dy = (py - iy - 0.5 - (r1[1] - 0.5) * jit) / ny
                val = fn(dx, dy, r1 + r2)
                if res is None:
                    res = val
                elif k:
                    res = smax(res, val, k)
                else:
                    res = fmax(res, val) if op == "max" else fmin(res, val)
        return res

    def rot(dx, dy, ang):
        c, s = fcos(ang), fsin(ang)
        return dx * c + dy * s, dy * c - dx * s

    def crack(uv, f, seed, width, mask_f=2.0, mask_t=0.55, jag=0.003, detail=2.5):
        """Long thin cracks: zero-crossings of smooth noise, jagged by a fine warp, partly masked out.
        Returns (line 0..1, distance-ish field)."""
        cuv = warp(uv, jag, f * 30, seed, detail=2)
        n = noise(cuv, f, seed + 1, detail=detail, rough=0.5)
        d = fabs(n - 0.5)
        line = smooth(width, width * 0.25, d)
        m = smooth(mask_t, mask_t + 0.1, noise(uv, mask_f, seed + 2, detail=2))
        return line * m, d

    def blotch(uv, f, seed, t, soft=0.03, detail=6.0, rough=0.6):
        return smooth(t - soft, t + soft, noise(uv, f, seed, detail=detail, rough=rough))

    def grains(uv, f, seed, rand=1.0):
        """Voronoi grains: (random colour per grain C, distance to the grain centre F)."""
        g = voronoi(uv, f, seed, rand=rand)
        return g.col, g.d

    def wet_darken(col, amount):
        """Water in the pores: albedo moves towards albedo^2 (darker, more saturated)."""
        return cmix(col, sat_c(col * col * 2.4), amount)

    def sat_c(c):
        n = node("ShaderNodeMix", data_type="RGBA", blend_type="MIX", clamp_result=True)
        _set(n.inputs[0], 0.0)
        _set(n.inputs[6], c)
        return C(n.outputs[2])

    class Graph:
        def __init__(self, name):
            mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
            mat.use_nodes = True
            self.mat = mat
            self.nt = mat.node_tree
            self.N, self.L = self.nt.nodes, self.nt.links
            for n in list(self.N):
                self.N.remove(n)
            self.count = 0
            self.trig = {}
            tc = self.N.new("ShaderNodeTexCoord")
            sep = self.N.new("ShaderNodeSeparateXYZ")
            self.L.new(tc.outputs["UV"], sep.inputs[0])
            self.u, self.v = F(sep.outputs[0]), F(sep.outputs[1])
            self.emit = self.N.new("ShaderNodeEmission")
            self.emit.inputs["Strength"].default_value = 1.0
            out = self.N.new("ShaderNodeOutputMaterial")
            self.L.new(self.emit.outputs[0], out.inputs["Surface"])
            self.img = self.N.new("ShaderNodeTexImage")
            self._emit_link = None

        def show(self, value):
            if self._emit_link:
                self.L.remove(self._emit_link)
                self._emit_link = None
            inp = self.emit.inputs["Color"]
            if isinstance(value, (F, C)):
                self._emit_link = self.L.new(value.s, inp)
            else:
                inp.default_value = tuple(_cv(value)) + (1.0,)

    # ============================================================== materials
    # Each builder gets (uv, S) where S is the tile size in metres, and returns a dict with
    #   albedo (C, linear), height (F, millimetres), rough (F 0..1), metal (F or number),
    # and optionally tilt = (F, F, F) for a per-pixel normal tilt (x, y, weight) added after the height normal.
    MATERIALS = {}

    def material(fn):
        MATERIALS[fn.__name__] = fn
        return fn

    @material
    def concrete_wet(uv, S, sd):
        """Cast basement floor: fine sand grain, pores, a few hairline cracks with salt, dried stains, wet patches."""
        macro = noise(uv, 2.5, sd + 1, detail=5, rough=0.55)
        mid = noise(uv, 11, sd + 2, detail=6, rough=0.6)
        g1, _ = grains(uv, 620, sd + 3)
        g2c, g2d = grains(uv, 240, sd + 4)
        tone = (macro - 0.5) * 0.8 + (mid - 0.5) * 0.55
        col = cmix(srgb("78756f"), srgb("a6a39b"), sat(tone + 0.5))
        col = cmix(col, col * srgb("a8a49a"), blotch(uv, 5, sd + 5, 0.6, 0.06) * 0.35)  # cement-paste clouds
        g1r, g1g, _ = split(g1)
        col = col * (0.9 + g1r * 0.2)
        g2r, g2g, g2b = split(g2c)
        dark_sand = greater(g2r, 0.86) * smooth(0.42, 0.3, g2d)
        light_sand = less(g2r, 0.07) * smooth(0.4, 0.28, g2d)
        col = cmix(col, col * 0.62, dark_sand)
        col = cmix(col, srgb("c9c5bb"), light_sand * 0.6)
        # exposed aggregate where the surface wore through
        wear = blotch(uv, 4, sd + 6, 0.62, 0.05)
        agg = voronoi(uv, 120, sd + 7)
        ar, ag, ab = split(agg.col)
        stone = smooth(0.4, 0.3, agg.d) * greater(ar, 0.4) * wear
        acol = cmix(srgb("5f5c58"), srgb("a9a49a"), ag)
        acol = cmix(acol, srgb("7d6650"), greater(ab, 0.8))
        col = cmix(col, acol, stone * 0.85)
        # pores: many tiny, some medium, a few large bugholes
        pores = None
        for f, p, r, i in ((430, 0.84, 0.3, 8), (150, 0.9, 0.22, 9), (45, 0.965, 0.14, 10)):
            pv = voronoi(uv, f, sd + i)
            one = smooth(r, r * 0.5, pv.d) * greater(split(pv.col)[0], p)
            pores = one if pores is None else fmax(pores, one)
        col = cmix(col, col * srgb("4d4a46"), pores)
        # hairline cracks (two families)
        c1, d1 = crack(uv, 1.6, sd + 11, 0.0016, mask_t=0.5)
        c2, d2 = crack(uv, 3.1, sd + 12, 0.0011, mask_t=0.6)
        cr = fmax(c1, c2 * 0.8)
        col = cmix(col, srgb("3c3a36"), cr * 0.85)
        # efflorescence: chalky salt along cracks and in a few crusty blotches
        crys, _ = grains(uv, 300, sd + 13)
        near = smooth(0.02, 0.0, d1) * smooth(0.5, 0.6, noise(uv, 8, sd + 14, detail=5))
        eff = sat(blotch(uv, 7, sd + 15, 0.68, 0.04, detail=7, rough=0.7) + near) * (0.6 + split(crys)[0] * 0.4)
        col = cmix(col, srgb("dcd9d0"), eff * 0.8)
        # dried stains with faint, broken tide rims
        st = noise(uv, 2.4, sd + 16, detail=5, rough=0.6)
        stain = smooth(0.585, 0.6, st)
        rim = band(st, 0.598, 0.002, 0.004) * blotch(uv, 9, sd + 17, 0.45, 0.1)
        col = cmix(col, col * srgb("cdc4b6"), stain * 0.6)
        col = cmix(col, col * srgb("8e8170"), rim * 0.5)
        # wet patches with a defined drying front, standing water in the lowest spots
        wn = noise(uv, 2.0, sd + 18, detail=6, rough=0.62)
        wet = smooth(0.535, 0.55, wn)
        front = band(wn, 0.542, 0.003, 0.004)
        puddle = smooth(0.585, 0.6, wn)
        col = wet_darken(col, wet * 0.85 + front * 0.15)
        h = (macro - 0.5) * 2.4 + (mid - 0.5) * 0.7 + (g1r - 0.5) * 0.08 - dark_sand * 0.05
        h = h + stone * 0.3 - pores * 1.8 - cr * 0.7 + eff * 0.15
        h = mix(h, fmax(h, 0.25), puddle)
        rough = 0.84 + (mid - 0.5) * 0.12 + eff * 0.1 - stone * 0.12 - stain * 0.06
        rough = mix(rough, 0.3, wet)
        rough = mix(rough, 0.05, puddle)
        return dict(albedo=col, height=h, rough=rough, metal=0.0)

    @material
    def plaster_damp(uv, S, sd):
        """Old lime plaster with lime-wash paint. Rising damp occupies v 0..0.4 (map v=0 to the floor); the last
        6% of the tile ramps back into it so the tile still wraps."""
        u, v = uv
        macro = noise(uv, 2.5, sd + 1, detail=5, rough=0.55)
        mid = noise(uv, 14, sd + 2, detail=6, rough=0.6)
        g, gd = grains(uv, 520, sd + 3)
        gr = split(g)[0]
        # rising damp profile with an irregular tide line
        vt = v + snoise(uv, 5, sd + 4, detail=5) * 0.045 + snoise(uv, 26, sd + 5, detail=3) * 0.008
        damp = fmax(smooth(0.37, 0.24, vt), smooth(0.94, 1.0, v))
        tide = band(vt, 0.37, 0.006, 0.018) * smooth(0.8, 0.5, v)
        salt_band = band(vt, 0.33, 0.025, 0.02) * smooth(0.8, 0.5, v)
        # substrate plaster and lime-wash paint
        plaster = cmix(srgb("9a917f"), srgb("b3aa97"), sat((macro - 0.5) + (mid - 0.5) * 0.8 + 0.5)) * (0.88 + gr * 0.24)
        paint = cmix(srgb("cfc8b6"), srgb("e0dbcc"), sat((mid - 0.5) * 1.4 + 0.5))
        paint = cmix(paint, paint * srgb("c8bca4"), blotch(uv, 3, sd + 6, 0.55, 0.12) * 0.6)  # yellowed, grubby
        pn = noise(warp(uv, 0.01, 8, sd + 7), 4.5, sd + 8, detail=8, rough=0.66)
        lim = 0.66 - damp * 0.12
        loss = smooth(lim - 0.004, lim + 0.004, pn)
        chips = smooth(0.35, 0.25, voronoi(uv, 70, sd + 9).d) * greater(split(voronoi(uv, 70, sd + 9).col)[0], 0.93)
        loss = fmax(loss, chips)
        edge = band(pn, lim - 0.006, 0.004, 0.006) * (1.0 - loss)
        col = cmix(paint, plaster, loss)
        col = cmix(col, col * 0.8, edge * 0.5)
        # cracks
        c1, d1 = crack(uv, 1.3, sd + 10, 0.0014, mask_t=0.45)
        col = cmix(col, srgb("4a443b"), c1 * 0.85)
        # damp: darker, greyer-browner; salts at the tide line; mould colonies inside
        col = cmix(col, wet_darken(col * srgb("d9cdb6"), 0.7), damp * 0.85)
        col = cmix(col, col * srgb("a68a5c"), tide * 0.8)
        salt = salt_band * blotch(uv, 18, sd + 11, 0.5, 0.08, detail=7) * (0.5 + gr * 0.5)
        col = cmix(col, srgb("e8e4da"), salt * 0.85)
        colonies = blotch(uv, 9, sd + 12, 0.6, 0.06, detail=7, rough=0.7) * sat(damp * 1.3)
        dots = smooth(0.45, 0.2, gd) * greater(gr, 0.5)
        mould = sat(colonies * (0.35 + dots)) * smooth(0.45, 0.7, noise(uv, 40, sd + 13, detail=4))
        col = cmix(col, cmix(srgb("20211b"), srgb("3c3f2d"), split(g)[1]), mould * 0.9)
        crumble = damp * blotch(uv, 10, sd + 14, 0.7, 0.03, detail=7) * smooth(0.2, 0.05, vt)
        col = cmix(col, srgb("6f6658"), crumble * 0.7)
        h = (macro - 0.5) * 3.0 + (mid - 0.5) * 0.6 + (gr - 0.5) * 0.12
        h = h + (1.0 - loss) * 0.35 + edge * 0.45 - c1 * 0.8 + salt * 0.3 - crumble * 2.5
        rough = mix(0.8, 0.93, loss) + (gr - 0.5) * 0.06
        rough = mix(rough, 0.68, damp * 0.7) + salt * 0.2 + mould * 0.05
        return dict(albedo=col, height=h, rough=rough, metal=0.0)

    @material
    def brick_old(uv, S, sd):
        """Hand-made bricks (~22 x 6.6 cm, 7 per row, 20 courses per 1.6 m) in recessed, crumbling lime mortar,
        sooted and salt-bloomed."""
        b = bond(uv, 7, 20, sd + 1, shift=0.5, jitter=0.1)
        wmm, hmm = b.w * S * 1000.0, b.h * S * 1000.0
        dch = (noise(uv, 70, sd + 2, detail=4, rough=0.6) - 0.5) * 9.0 + (noise(uv, 18, sd + 3, detail=3) - 0.5) * 6.0
        din = rbox_in(b.lx, b.ly, wmm, hmm, 7.0) - 6.0 + dch
        brick = smooth(0.0, 1.5, din)
        rx, ry, rz = split(b.rnd)
        bc = cmix(srgb("8e4430"), srgb("6c3428"), rx)
        bc = cmix(bc, srgb("4c2c28"), greater(ry, 0.86))
        bc = cmix(bc, srgb("b07454"), less(ry, 0.1))
        bc = cmix(bc, srgb("9a5a3c"), less(rz, 0.15) * 0.7)
        mott = noise(uv, 34, sd + 4, detail=6, rough=0.6)
        g, gd = grains(uv, 520, sd + 5)
        gr = split(g)[0]
        bc = bc * (0.8 + mott * 0.4) * (0.92 + gr * 0.16)
        specks = smooth(0.3, 0.15, gd) * greater(gr, 0.85)
        bc = cmix(bc, bc * 0.45, specks)
        limepop = smooth(0.3, 0.15, voronoi(uv, 160, sd + 6).d) * greater(split(voronoi(uv, 160, sd + 6).col)[0], 0.96)
        bc = cmix(bc, srgb("c9bfae"), limepop * 0.8)
        spall = blotch(uv, 9, sd + 7, 0.7, 0.015, detail=7) * greater(rz, 0.45)
        bc = cmix(bc, bc * srgb("d7b39c"), spall * 0.6)
        mc = cmix(srgb("8f877a"), srgb("aaa294"), noise(uv, 40, sd + 8, detail=5)) * (0.85 + gr * 0.3)
        mc = cmix(mc, srgb("5d564d"), blotch(uv, 12, sd + 9, 0.55, 0.08) * 0.6)
        col = cmix(mc, bc, brick)
        soot = blotch(uv, 1.6, sd + 10, 0.52, 0.12, detail=6, rough=0.62)
        col = cmix(col, col * srgb("3f3a37"), soot * 0.7)
        bloom = blotch(uv, 4, sd + 11, 0.6, 0.06, detail=8, rough=0.7)
        joint_salt = (1.0 - brick) * blotch(uv, 9, sd + 12, 0.5, 0.1)
        salt = sat(bloom * (0.4 + gr * 0.6) + joint_salt * 0.7)
        col = cmix(col, srgb("dedad0"), salt * 0.75)
        hb = -7.0 * (1.0 - smooth(0.0, 9.0, din)) + (mott - 0.5) * 1.6 + (gr - 0.5) * 0.25 - specks * 0.4 - spall * 3.5
        hm = -10.0 + (noise(uv, 140, sd + 13, detail=3) - 0.5) * 2.5 - blotch(uv, 22, sd + 14, 0.6, 0.06) * 4.0
        h = mix(hm, hb, brick) + salt * 0.2
        rough = mix(0.95, 0.86, brick) + (gr - 0.5) * 0.06 - soot * 0.08 + salt * 0.05
        return dict(albedo=col, height=h, rough=rough, metal=0.0)

    @material
    def rock_rough(uv, S, sd):
        """Hand-hewn dark tunnel rock: angular fracture facets at three scales, pick gouges, quartz veins,
        iron and calcite staining, damp streaks."""
        h = 0.0
        for f, amp, i in ((5, 38.0, 1), (16, 12.0, 2), (48, 3.0, 3)):
            vo = voronoi(uv, f, sd + i)
            vec, w = _torus(uv, f, f, sd + i)
            diff = vec - vo.pos
            dvec = vo.col * 2.0 - (1.0, 1.0, 1.0)
            facet = dot(diff, dvec) + (w - vo.w) * (split(vo.col)[2] - 0.5)
            h = h + facet * amp
        def gouge(dx, dy, r):
            a = 1.15 + (r[2] - 0.5) * 0.5
            al, ac = rot(dx * S * 1000.0, dy * S * 1000.0, a)
            L, Wd = 45.0 + r[3] * 35.0, 9.0 + r[4] * 6.0
            return sat(1.0 - (al / L) * (al / L) - (ac / Wd) * (ac / Wd)) * (4.0 + r[5] * 6.0) * greater(r[5], 0.25)
        marks = scatter(uv, 16, 24, sd + 4, gouge)
        h = h - marks
        edges = voronoi(uv, 5, sd + 1, feature="DISTANCE_TO_EDGE").d
        frac = smooth(0.025, 0.004, edges) * blotch(uv, 3, sd + 5, 0.5, 0.1)
        h = h - frac * 6.0
        tone = noise(uv, 4, sd + 6, detail=6, rough=0.6)
        g, gd = grains(uv, 700, sd + 7)
        gr, gg, gb = split(g)
        col = cmix(srgb("3b3a38"), srgb("5e5b56"), sat((tone - 0.5) * 1.6 + 0.5))
        col = cmix(col, srgb("454a4b"), blotch(uv, 2.5, sd + 8, 0.55, 0.15) * 0.6)
        col = col * (0.82 + gr * 0.36)
        col = cmix(col, srgb("9b968c"), greater(gg, 0.93) * smooth(0.4, 0.25, gd) * 0.7)
        vn, vd = crack(uv, 1.2, sd + 9, 0.0035, mask_t=0.4, jag=0.002)
        col = cmix(col, srgb("b9b4aa"), vn * 0.85)
        h = h + vn * 1.0
        iron = blotch(uv, 3.5, sd + 10, 0.64, 0.05, detail=7)
        col = cmix(col, col * srgb("c58a5a"), iron * 0.7)
        calc = smooth(0.62, 0.7, noise(uv, 2, sd + 11, detail=5, fv=1.0)) * smooth(0.5, 0.65, noise(uv, 40, sd + 12, detail=3, fv=3))
        col = cmix(col, srgb("a8a49b"), calc * 0.5)
        damp = smooth(0.5, 0.6, noise(uv, 6, sd + 13, detail=5, fv=1.5))
        col = wet_darken(col, damp * 0.8)
        col = cmix(col, col * 0.8, marks / 10.0 * 0.4)
        rough = 0.78 + (gr - 0.5) * 0.1 + calc * 0.1
        rough = mix(rough, 0.3, damp)
        return dict(albedo=col, height=h, rough=rough, metal=0.0)

    @material
    def tuff(uv, S, sd):
        """Cappadocian ignimbrite cut by hand: overlapping pick scoops in loose diagonal rows, pumice (pale,
        eroded into pits) and dark lithic chips, dust in the hollows, lamp soot."""
        macro = noise(uv, 2.0, sd + 1, detail=5, rough=0.55)
        strata = noise(uv, 1.2, sd + 2, detail=5, rough=0.6, fv=6)
        row_dir = (noise(uv, 1.5, sd + 3, detail=2) - 0.5) * 0.8
        def scoop(dx, dy, r):
            a = 0.95 + row_dir + (r[2] - 0.5) * 0.35
            al, ac = rot(dx * S * 1000.0, dy * S * 1000.0, a)
            L, Wd = 38.0 + r[3] * 22.0, 13.0 + r[4] * 8.0
            q = (al / L) * (al / L) + (ac / Wd) * (ac / Wd)
            return sat(1.0 - q) * (4.0 + r[5] * 7.0)
        marks = scatter(uv, 30, 34, sd + 4, scoop, jit=0.9, k=1.5)
        tone = (macro - 0.5) * 0.9 + (strata - 0.5) * 0.7
        col = cmix(srgb("b89f86"), srgb("d8c4ad"), sat(tone + 0.5))
        col = cmix(col, srgb("cfae96"), blotch(uv, 3, sd + 5, 0.55, 0.15) * 0.5)
        g, gd = grains(uv, 650, sd + 6)
        gr, gg, gb = split(g)
        col = col * (0.9 + gr * 0.2)
        col = cmix(col, srgb("3a3330"), greater(gg, 0.965) * smooth(0.35, 0.2, gd))  # biotite flecks
        wuv = warp(uv, 0.006, 40, sd + 7)
        pum = voronoi(wuv, 55, sd + 8)
        pr, pg, pb = split(pum.col)
        prad = 0.12 + pg * 0.25
        pumice = smooth(prad, prad - 0.05, pum.d) * greater(pr, 0.55)
        ppore = smooth(0.35, 0.15, voronoi(uv, 900, sd + 9).d)
        col = cmix(col, cmix(srgb("e9e3d8"), srgb("cfc9c0"), pb), pumice * 0.85)
        col = cmix(col, col * 0.7, pumice * ppore * 0.6)
        lit = voronoi(warp(uv, 0.004, 60, sd + 10), 110, sd + 11)
        lr, lg, lb = split(lit.col)
        lithic = smooth(0.24, 0.17, lit.d) * greater(lr, 0.8)
        col = cmix(col, cmix(srgb("4a403b"), srgb("7b4a36"), lg), lithic * 0.9)
        depth01 = sat(marks / 9.0)
        col = cmix(col, col * srgb("e9e2d8"), (1.0 - depth01) * 0.25)  # ridges catch less dust... lighter scoops
        col = cmix(col, srgb("d9cbb8"), depth01 * blotch(uv, 6, sd + 12, 0.5, 0.15) * 0.4)
        soot = blotch(uv, 1.5, sd + 13, 0.6, 0.12, detail=6, rough=0.62)
        col = cmix(col, col * srgb("5a514b"), soot * 0.65)
        h = (macro - 0.5) * 10.0 - marks - pumice * (1.0 + ppore * 1.5) + lithic * 0.7 + (gr - 0.5) * 0.3
        rough = 0.93 + (gr - 0.5) * 0.05 - lithic * 0.15
        return dict(albedo=col, height=h, rough=rough, metal=0.0)

    @material
    def soil(uv, S, sd):
        """Compacted earth floor: sand and grit, embedded pebbles, shoe prints and scuffs, damp and dry areas
        with faint shrinkage cracks."""
        macro = noise(uv, 2.5, sd + 1, detail=6, rough=0.58)
        damp = blotch(uv, 1.8, sd + 2, 0.53, 0.06, detail=6)
        g, gd = grains(uv, 720, sd + 3)
        gr, gg, gb = split(g)
        col = cmix(srgb("6a5442"), srgb("8d7660"), sat((macro - 0.5) * 1.6 + 0.5))
        col = cmix(col, srgb("7a6550"), blotch(uv, 6, sd + 4, 0.55, 0.1) * 0.5)
        col = col * (0.8 + gr * 0.4)
        col = cmix(col, srgb("c3b49c"), greater(gg, 0.9) * smooth(0.45, 0.3, gd) * 0.8)
        col = cmix(col, srgb("2e2620"), less(gg, 0.06) * smooth(0.45, 0.3, gd) * 0.8)
        grit = voronoi(uv, 260, sd + 5)
        gt = greater(split(grit.col)[0], 0.75)
        gritd = sat(1.0 - grit.d / 0.38) * gt
        col = cmix(col, cmix(srgb("8b8073"), srgb("b19a7c"), split(grit.col)[1]), smooth(0.0, 0.3, gritd) * 0.7)
        hp = 0.0
        pc = None
        for f, p, i in ((40, 0.6, 6), (95, 0.55, 7)):
            pv = voronoi(warp(uv, 0.08 / f, f * 3, sd + i + 20), f, sd + i)
            pr, pg, pb = split(pv.col)
            rad = 0.18 + pg * 0.2
            dome = fsqrt(rad * rad - pv.d * pv.d) / rad * greater(pr, p)
            peb = smooth(0.0, 0.08, dome)
            pcol = cmix(cmix(srgb("6d6a66"), srgb("a49f95"), pb), srgb("9a7a52"), greater(pg, 0.75))
            pcol = pcol * (0.8 + noise(uv, f * 4, sd + i + 30, detail=2) * 0.4)
            col = cmix(col, pcol, peb)
            hp = fmax(hp, dome * (S * 1000.0 / f) * rad * 0.9 - 0.8)
            pc = peb if pc is None else fmax(pc, peb)
        def print_(dx, dy, r):
            al, ac = rot(dx * S * 1000.0, dy * S * 1000.0, r[2] * 6.2832)
            fore = ((al - 55.0) / 75.0) ** 2 + (ac / 46.0) ** 2
            heel = ((al + 95.0) / 42.0) ** 2 + (ac / 38.0) ** 2
            inside = smooth(1.05, 0.85, fmin(fore, heel))
            tread = smooth(0.2, 0.6, fsin(al * 0.55)) * 0.6
            return inside * (2.5 + tread) * greater(r[3], 0.45) * (0.6 + r[4] * 0.6)
        prints = scatter(uv, 5, 5, sd + 8, print_, jit=0.4)
        pin = sat(prints / 2.0)
        col = cmix(col, col * srgb("cdc4b8"), pin * 0.35)
        scuff = smooth(0.55, 0.7, noise(uv, 3, sd + 9, detail=5, fv=40)) * blotch(uv, 2.5, sd + 10, 0.55, 0.08)
        col = cmix(col, col * 1.15, scuff * 0.5)
        cr = smooth(0.02, 0.006, voronoi(warp(uv, 0.006, 30, sd + 11), 16, sd + 12, feature="DISTANCE_TO_EDGE").d) * (1.0 - damp) * blotch(uv, 3, sd + 13, 0.5, 0.1)
        col = cmix(col, col * 0.55, cr * 0.8)
        col = wet_darken(col, damp * 0.75)
        h = (macro - 0.5) * 5.0 + (gr - 0.5) * 0.3 + gritd * 0.5 + hp * 1.0 - prints - cr * 0.8 - scuff * 0.3
        rough = 0.95 - damp * 0.18 - pin * 0.06 - scuff * 0.08 - pc * 0.1
        return dict(albedo=col, height=h, rough=rough, metal=0.0)

    @material
    def mud(uv, S, sd):
        """Wet dark mud: trampled hummocks, deep prints with squeezed rims, water standing in hollows (mirror
        smooth), drier cracked crust on the high spots."""
        macro = noise(uv, 2.2, sd + 1, detail=6, rough=0.6)
        mid = noise(uv, 9, sd + 2, detail=5, rough=0.6)
        def print_(dx, dy, r):
            al, ac = rot(dx * S * 1000.0, dy * S * 1000.0, r[2] * 6.2832)
            q = fmin(((al - 50.0) / 80.0) ** 2 + (ac / 50.0) ** 2, ((al + 95.0) / 45.0) ** 2 + (ac / 42.0) ** 2)
            return (smooth(1.05, 0.8, q) * 9.0 - band(q, 1.15, 0.12, 0.25) * 3.0 + 3.0) * greater(r[3], 0.35)
        pr = scatter(uv, 5, 5, sd + 3, print_, jit=0.5) - 3.0
        h = (macro - 0.5) * 22.0 + (mid - 0.5) * 6.0 - fmax(pr, -3.0)
        g, gd = grains(uv, 600, sd + 4)
        gr = split(g)[0]
        h = h + (gr - 0.5) * 0.25 + (noise(uv, 60, sd + 5, detail=4) - 0.5) * 0.8
        level = -2.0
        water = smooth(level + 0.6, level - 0.2, h)
        crustm = smooth(2.0, 5.0, h) * blotch(uv, 3, sd + 6, 0.45, 0.1)
        polys = voronoi(warp(uv, 0.005, 40, sd + 7), 22, sd + 8, feature="DISTANCE_TO_EDGE").d
        crk = smooth(0.06, 0.02, polys) * crustm
        col = cmix(srgb("3a2f26"), srgb("4c3e31"), noise(uv, 5, sd + 9, detail=5))
        col = col * (0.88 + gr * 0.24)
        col = cmix(col, cmix(srgb("7a6753"), srgb("8f7c66"), gr), crustm * 0.9)
        col = cmix(col, srgb("231c17"), crk)
        col = cmix(col, srgb("2a221c"), water * 0.85)
        stones = smooth(0.2, 0.12, voronoi(uv, 70, sd + 10).d) * greater(split(voronoi(uv, 70, sd + 10).col)[0], 0.9) * (1.0 - water)
        col = cmix(col, srgb("5e5a55"), stones * 0.7)
        h = h - crk * 2.0 + stones * 1.5
        h = fmax(h, level)  # the water surface
        rough = mix(0.3, 0.88, crustm) + (gr - 0.5) * 0.1
        rough = mix(rough, 0.03, water)
        return dict(albedo=col, height=h, rough=rough, metal=0.0)

    @material
    def limestone(uv, S, sd):
        """Paris catacomb wall: roughly squared Lutetian limestone blocks (5 courses per 1.6 m) in recessed
        lime mortar; tooled faces, shell fragments and dissolved-shell pores, seepage streaks."""
        b = bond(uv, 3, 5, sd + 1, shift=0.5, jitter=0.2, row_rand=0.3)
        wmm, hmm = b.w * S * 1000.0, b.h * S * 1000.0
        dch = (noise(uv, 40, sd + 2, detail=5, rough=0.6) - 0.5) * 14.0
        din = rbox_in(b.lx, b.ly, wmm, hmm, 12.0) - 8.0 + dch
        block = smooth(0.0, 2.0, din)
        rx, ry, rz = split(b.rnd)
        bc = cmix(srgb("bfa985"), srgb("d2c09d"), rx)
        bc = cmix(bc, srgb("aea692"), greater(ry, 0.75) * 0.7)
        macro = noise(uv, 6, sd + 3, detail=6, rough=0.6)
        g, gd = grains(uv, 600, sd + 4)
        gr, gg, gb = split(g)
        bc = bc * (0.85 + macro * 0.3) * (0.94 + gr * 0.12)
        sh = voronoi(warp(uv, 0.003, 80, sd + 5), 180, sd + 6)
        sr, sg, sb = split(sh.col)
        shell = smooth(0.3, 0.22, sh.d) * greater(sr, 0.82)
        bc = cmix(bc, cmix(srgb("e8e0cc"), srgb("8f8068"), greater(sg, 0.6)), shell * 0.7)
        mold = smooth(0.3, 0.15, voronoi(uv, 320, sd + 7).d) * greater(split(voronoi(uv, 320, sd + 7).col)[0], 0.9)
        bc = cmix(bc, bc * 0.45, mold)
        ang = 0.6 + (rz - 0.5) * 0.8
        tal, tac = rot(b.lx * wmm, b.ly * hmm, ang)
        tool = smooth(0.3, 0.9, fsin(tac * 1.2 + noise(uv, 30, sd + 8, detail=3) * 4.0)) * blotch(uv, 5, sd + 9, 0.45, 0.15)
        mc = cmix(srgb("a39c8d"), srgb("bdb6a7"), noise(uv, 50, sd + 10, detail=5)) * (0.85 + gr * 0.3)
        col = cmix(mc, bc, block)
        seep = smooth(0.56, 0.68, noise(uv, 3, sd + 11, detail=6, fv=0.8)) * smooth(0.4, 0.6, noise(uv, 30, sd + 12, detail=4, fv=2.0))
        col = cmix(col, col * srgb("847b6a"), seep * 0.6)
        flow = smooth(0.66, 0.74, noise(uv, 4, sd + 13, detail=6, fv=1.0)) * smooth(0.5, 0.62, noise(uv, 50, sd + 14, detail=3, fv=3.0))
        col = cmix(col, srgb("ece7dc"), flow * 0.5)
        grime = blotch(uv, 1.7, sd + 15, 0.55, 0.15, detail=6)
        col = cmix(col, col * srgb("8b8579"), grime * 0.5)
        hb = -9.0 * (1.0 - smooth(0.0, 14.0, din)) + (macro - 0.5) * 5.0 - tool * 0.5 - mold * 1.2 + shell * 0.2 + (gr - 0.5) * 0.25
        hm = -14.0 + (noise(uv, 120, sd + 16, detail=3) - 0.5) * 3.0 - blotch(uv, 20, sd + 17, 0.62, 0.05) * 4.0
        h = mix(hm, hb, block) + flow * 0.4
        rough = 0.9 + (gr - 0.5) * 0.06 - seep * 0.35 - flow * 0.15
        return dict(albedo=col, height=h, rough=rough, metal=0.0)

    @material
    def paint_peeling(uv, S, sd):
        """Cream oil/lime paint over concrete (Soviet walls): peeling sheets with lifted edges, chips, rust bleeding
        from embedded steel, water run streaks. The darker lower paint band is added in world space by JS."""
        macro = noise(uv, 3, sd + 1, detail=5, rough=0.55)
        g, gd = grains(uv, 600, sd + 2)
        gr = split(g)[0]
        conc = cmix(srgb("7e7b75"), srgb("9b978f"), noise(uv, 12, sd + 3, detail=6)) * (0.86 + gr * 0.28)
        pv = voronoi(uv, 140, sd + 4)
        cpore = smooth(0.22, 0.1, pv.d) * greater(split(pv.col)[0], 0.8)
        conc = cmix(conc, conc * 0.5, cpore)
        paint = cmix(srgb("d4ccb3"), srgb("e3ddc8"), sat((macro - 0.5) * 1.5 + 0.5))
        paint = cmix(paint, paint * srgb("cdbf9e"), blotch(uv, 2.5, sd + 5, 0.55, 0.12) * 0.6)
        pn = noise(warp(uv, 0.012, 7, sd + 6), 3.5, sd + 7, detail=8, rough=0.68)
        lim = 0.665
        peel = smooth(lim - 0.003, lim + 0.003, pn)
        cv = voronoi(warp(uv, 0.004, 50, sd + 8), 45, sd + 9)
        chip = smooth(0.3, 0.24, cv.d) * greater(split(cv.col)[0], 0.88)
        loss = fmax(peel, chip)
        lift = band(pn, lim - 0.007, 0.006, 0.005) * (1.0 - loss)
        col = cmix(paint, conc, loss)
        col = cmix(col, col * 0.82, lift * 0.4)
        # rust bleeding from embedded steel: spots with long streaks running down (v decreasing)
        src = voronoi(uv, 7, sd + 10)
        spot = smooth(0.12, 0.05, src.d) * greater(split(src.col)[0], 0.55)
        streak_n = noise(uv, 60, sd + 11, detail=3, fv=1.2)
        streak = smooth(0.62, 0.75, streak_n) * blotch(uv, 4, sd + 12, 0.55, 0.1, detail=4)
        rust = sat(streak * 0.6 + spot)
        col = cmix(col, cmix(srgb("8a4b27"), srgb("5c3320"), gr), spot * 0.9)
        col = cmix(col, col * srgb("b5794c"), streak * 0.55)
        water = smooth(0.6, 0.72, noise(uv, 45, sd + 13, detail=4, fv=1.5)) * blotch(uv, 2, sd + 14, 0.5, 0.15)
        col = cmix(col, col * srgb("aaa190"), water * 0.6)
        grime = blotch(uv, 6, sd + 15, 0.58, 0.1, detail=7)
        col = cmix(col, col * srgb("b3ab9a"), grime * 0.5)
        h = (macro - 0.5) * 1.5 + (gr - 0.5) * 0.08 - cpore * 0.8 * loss + (1.0 - loss) * 0.35 + lift * 0.7 + spot * 0.3
        rough = mix(0.62, 0.92, loss) + (gr - 0.5) * 0.05 + rust * 0.15 - water * 0.1
        return dict(albedo=col, height=h, rough=rough, metal=0.0)

    @material
    def tile_ceramic(uv, S, sd):
        """Soviet unglazed (Metlakh) floor tiles, 10 x 10 per 1.6 m (15.5 cm tile + 5 mm grout), beige/grey
        checker; per-tile shade and lippage, chipped edges, a few cracked tiles, dirty grout, traffic wear."""
        b = bond(uv, 10, 10, sd + 1, shift=0.0)
        tw = b.w * S * 1000.0
        din = rbox_in(b.lx, b.ly, tw, tw, 3.0) - 2.5
        chipn = noise(uv, 45, sd + 2, detail=5, rough=0.6)
        chip = smooth(5.0, 1.5, din) * smooth(0.66, 0.7, chipn)
        rx, ry, rz = split(b.rnd)
        r2x, r2y, r2z = split(white(b.col, b.row, sd + 3.5, color=True))
        checker = fmod(b.col + b.row, 2.0)
        tc = cmix(srgb("b9a88a"), srgb("8a8680"), checker)
        tc = tc * (0.9 + rx * 0.2)
        fine, fd = grains(uv, 1100, sd + 4)
        tc = tc * (0.94 + split(fine)[0] * 0.12)
        tc = cmix(tc, tc * 0.7, greater(split(fine)[1], 0.94) * smooth(0.4, 0.2, fd))
        wear = blotch(uv, 1.5, sd + 5, 0.5, 0.15, detail=4)
        tc = cmix(tc, tc * 1.08, wear * 0.5)
        ca = r2x * 3.1416
        cdist = fabs((b.lx - 0.5) * fcos(ca) + (b.ly - 0.5) * fsin(ca) - (r2y - 0.5) * 0.5 + snoise(uv, 160, sd + 6, detail=3) * 0.012)
        cracked = greater(r2z, 0.86) * smooth(0.006, 0.0015, cdist)
        tile = smooth(0.0, 0.8, din) * (1.0 - chip)
        dirt_edge = smooth(6.0, 0.0, din) * 0.5 + blotch(uv, 5, sd + 7, 0.6, 0.1) * 0.4
        tc = cmix(tc, tc * srgb("7d7366"), sat(dirt_edge))
        tc = cmix(tc, srgb("3a352f"), cracked)
        gc = cmix(srgb("3f3a34"), srgb("5d564c"), noise(uv, 60, sd + 8, detail=4)) * (0.85 + split(fine)[2] * 0.3)
        body = srgb("8f7f68")
        col = cmix(gc, tc, tile)
        col = cmix(col, body, chip * smooth(0.0, 1.0, din) * 0.8)
        stain = blotch(uv, 2.2, sd + 9, 0.6, 0.03, detail=6)
        col = cmix(col, col * srgb("b6aa98"), stain * 0.4)
        tilt = (rx - 0.5) * 0.9 * (b.lx - 0.5) + (ry - 0.5) * 0.9 * (b.ly - 0.5) + (rz - 0.5) * 0.4
        ht = 0.0 + tilt + (split(fine)[0] - 0.5) * 0.04 - cracked * 0.3
        ht = ht - (1.0 - smooth(0.0, 2.0, din)) * 1.2
        hg = -2.0 + (noise(uv, 200, sd + 10, detail=3) - 0.5) * 0.6
        h = mix(hg, ht, smooth(0.0, 0.8, din)) - chip * 1.0
        rough = mix(0.95, 0.62 - wear * 0.15 + dirt_edge * 0.1, tile) + chip * 0.2
        return dict(albedo=col, height=h, rough=rough, metal=0.0)

    @material
    def metal_rust(uv, S, sd):
        """Painted steel (grey-green enamel) with rust blooms and blisters, run streaks, and scratches through to
        bright bare steel (metalness 1 only there)."""
        u, v = uv
        macro = noise(uv, 3, sd + 1, detail=5)
        peel = noise(uv, 300, sd + 2, detail=2)
        paint = cmix(srgb("4b564f"), srgb("5c6760"), sat((macro - 0.5) * 1.5 + 0.5))
        paint = cmix(paint, paint * srgb("c9c2b2"), blotch(uv, 2.5, sd + 3, 0.55, 0.1) * 0.5)  # faded, chalky
        rn = noise(warp(uv, 0.01, 10, sd + 4), 5, sd + 5, detail=8, rough=0.68)
        rust = smooth(0.635, 0.665, rn)
        blister = band(rn, 0.62, 0.008, 0.01)
        g, gd = grains(uv, 260, sd + 6)
        gr, gg, gb = split(g)
        rc = cmix(srgb("6a3a20"), srgb("9a5a2c"), gr)
        rc = cmix(rc, srgb("3a261b"), greater(gg, 0.7) * 0.8)
        rc = rc * (0.8 + noise(uv, 40, sd + 7, detail=5) * 0.4)
        streak = smooth(0.6, 0.72, noise(uv, 40, sd + 8, detail=3, fv=1.5)) * blotch(uv, 3, sd + 9, 0.5, 0.12)
        col = cmix(paint, paint * srgb("b98a62"), streak * 0.6)
        col = cmix(col, rc, rust)
        col = cmix(col, col * 0.85, blister * 0.6)
        scr = None
        for (p, q), f, i in ((((u + v), (v - u)), 9, 10), ((u, v), 7, 11), (((u * 2.0 + v), (v - u * 2.0 + 0.0)), 11, 12)):
            n = noise((p, q), 1.5, sd + i, detail=2, fv=f)
            line = smooth(0.004, 0.001, fabs(n - 0.5)) * smooth(0.6, 0.66, noise(uv, 6, sd + i + 20, detail=3))
            scr = line if scr is None else fmax(scr, line)
        scr = scr * (1.0 - rust)
        col = cmix(col, srgb("a7a7a3"), scr)
        metal = scr
        h = (macro - 0.5) * 0.6 + (peel - 0.5) * 0.06 + rust * (0.3 + (gr - 0.5) * 0.5) + blister * 0.4 - scr * 0.15
        rough = mix(0.5, 0.88, rust) + (peel - 0.5) * 0.08 + streak * 0.1
        rough = mix(rough, 0.32, scr)
        return dict(albedo=col, height=h, rough=rough, metal=metal)

    @material
    def wood_old(uv, S, sd):
        """Old pine boards (8 per metre, ~12.5 cm): weathered grain with raised latewood, grey and brown boards,
        dark gaps and butt joints, rusty nail holes, a few knots."""
        b = bond(uv, 2, 8, sd + 1, shift=0.37, jitter=0.25, row_rand=1.0)
        wmm, hmm = b.w * S * 1000.0, b.h * S * 1000.0
        din = rbox_in(b.lx, b.ly, wmm, hmm, 2.0) - 1.5 + (noise(uv, 80, sd + 2, detail=3) - 0.5) * 1.5
        board = smooth(0.0, 1.0, din)
        rx, ry, rz = split(b.rnd)
        u, v = uv
        ring = v * S * 1000.0 / (3.0 + rx * 2.5) + snoise(uv, 3, sd + 3, detail=4, fv=8) * 4.0 + snoise(uv, 1, sd + 4, detail=2, fv=16) * 3.0 + rz * 50.0
        rf = fract(ring)
        late = smooth(0.55, 0.8, rf) * smooth(1.0, 0.9, rf)
        pores = smooth(0.62, 0.75, noise(uv, 6, sd + 5, detail=3, fv=220))
        # knots
        def knot(dx, dy, r):
            dd = fsqrt((dx * S * 1000.0) ** 2 + (dy * S * 1000.0 * 1.6) ** 2)
            return smooth(9.0 + r[3] * 6.0, 4.0, dd) * greater(r[2], 0.7)
        kn = scatter(uv, 4, 8, sd + 6, knot)
        brown = cmix(srgb("7a5a3c"), srgb("8f6c49"), ry)
        grey = cmix(srgb("7d776c"), srgb("948d80"), ry)
        wc = cmix(brown, grey, sat(rx * 1.4 - 0.2 + blotch(uv, 2, sd + 7, 0.5, 0.2) * 0.5))
        wc = cmix(wc, wc * 0.62, late * 0.8)
        wc = cmix(wc, wc * 0.75, pores * 0.5)
        wc = cmix(wc, srgb("3a2a1e"), kn * 0.9)
        dirt = blotch(uv, 4, sd + 8, 0.55, 0.1)
        wc = cmix(wc, wc * srgb("8a8072"), dirt * 0.5)
        # nails near both ends of each board, at 1/3 and 2/3 of its width
        nail = 0.0
        for ex in (0.035, 0.965):
            for ey in (0.3, 0.7):
                dd = fsqrt(((b.lx - ex) * wmm) ** 2 + ((b.ly - ey) * hmm) ** 2)
                nail = fmax(nail, smooth(2.6, 1.8, dd))
                wc = cmix(wc, wc * srgb("8d5a3a"), smooth(9.0, 2.0, dd) * 0.6)
        wc = cmix(wc, srgb("1c1612"), nail)
        col = cmix(srgb("16120e"), wc, board)
        h = (late * 0.45 - pores * 0.15 + (noise(uv, 4, sd + 9, detail=4) - 0.5) * 1.2 + (rx - 0.5) * 0.8 - nail * 1.5 + kn * 0.2)
        h = mix(-4.0, h, board) - (1.0 - smooth(0.0, 4.0, din)) * 1.0
        rough = mix(0.95, 0.82 - late * 0.06 + dirt * 0.05, board)
        return dict(albedo=col, height=h, rough=rough, metal=0.0)

    @material
    def ice(uv, S, sd):
        """Clear-to-milky ice: dark where it is clear (ground seen through), milky where bubble-rich, trapped
        bubbles, white internal fractures, hoarfrost fringes."""
        milky = sat((noise(uv, 2.5, sd + 1, detail=6, rough=0.6) - 0.42) * 3.0)
        col = cmix(srgb("33414c"), srgb("a7b6c1"), milky)
        col = col * (0.9 + noise(uv, 14, sd + 2, detail=5) * 0.2)
        bb = voronoi(uv, 70, sd + 3)
        br, bg, bbz = split(bb.col)
        rad = 0.08 + bg * 0.18
        bub = greater(br, 0.55) * smooth(rad, rad * 0.6, bb.d)
        brim = greater(br, 0.55) * band(bb.d, rad * 0.8, rad * 0.12, rad * 0.15)
        tiny = smooth(0.25, 0.1, voronoi(uv, 260, sd + 4).d) * greater(split(voronoi(uv, 260, sd + 4).col)[0], 0.7) * (0.3 + milky)
        col = cmix(col, col * 1.25 + (0.05, 0.06, 0.07), bub * 0.6)
        col = cmix(col, srgb("dfe8ef"), sat(brim * 0.8 + tiny * 0.7))
        frac_d = voronoi(warp(uv, 0.01, 20, sd + 5), 3.5, sd + 6, feature="DISTANCE_TO_EDGE").d
        frac = smooth(0.012, 0.002, frac_d) * blotch(uv, 2.5, sd + 7, 0.48, 0.08)
        c2, _ = crack(uv, 2.0, sd + 8, 0.0025, mask_t=0.5, jag=0.002)
        fr = fmax(frac, c2)
        col = cmix(col, srgb("e3ecf2"), fr * 0.85)
        frost = blotch(uv, 3, sd + 9, 0.64, 0.05, detail=8, rough=0.7)
        fg, fgd = grains(uv, 500, sd + 10)
        col = cmix(col, srgb("e8eef2") * (0.85 + split(fg)[0] * 0.15), frost * 0.9)
        h = (noise(uv, 4, sd + 11, detail=5) - 0.5) * 1.6 - fr * 0.25 + frost * (0.4 + split(fg)[0] * 0.4) - tiny * 0.05
        rough = mix(0.05 + milky * 0.05, 0.65, frost) + fr * 0.15
        return dict(albedo=col, height=h, rough=rough, metal=0.0)

    @material
    def frost(uv, S, sd):
        """Hoarfrost: feathery needle clusters and rime grains, white on black so the albedo doubles as a blend
        mask. Sparkle: random facet tilts at the crystal tips."""
        cover = sat((noise(uv, 2.5, sd + 1, detail=5, rough=0.6) - 0.35) * 2.5)
        def fern(dx, dy, r):
            al, ac = rot(dx * S * 1000.0, dy * S * 1000.0, r[2] * 6.2832)
            L = 6.0 + r[3] * 9.0
            spine = smooth(0.45, 0.1, fabs(ac)) * smooth(L, L * 0.6, fabs(al))
            barbs = smooth(0.5, 0.95, fsin((al + fabs(ac) * 0.9) * 3.6)) * smooth(L * 0.45, 0.5, fabs(ac)) * smooth(L, 0.0, fabs(al))
            return fmax(spine, barbs * 0.8) * (0.5 + r[4] * 0.5) * greater(r[5], 0.25)
        crystals = scatter(uv, 40, 40, sd + 2, fern, jit=0.9)
        rime_v = voronoi(uv, 260, sd + 3)
        rime = smooth(0.35, 0.15, rime_v.d) * greater(split(rime_v.col)[0], 0.45)
        dens = sat(crystals * cover * 1.2 + rime * sat(cover * 1.5) * 0.7)
        col = srgb("eef3f6") * dens
        sv = voronoi(uv, 420, sd + 4)
        sx, sy, sz = split(sv.col)
        glint = greater(sz, 0.9) * dens
        h = dens * 0.6 + rime * cover * 0.2
        rough = 0.55 - glint * 0.3
        return dict(albedo=col, height=h, rough=rough, metal=0.0, tilt=((sx - 0.5) * 1.6, (sy - 0.5) * 1.6, glint))

    @material
    def snow(uv, S, sd):
        """Packed snow: wind ripples and compacted prints, blue-grey in the hollows, grains, a few dirt specks,
        sparkle from randomly tilted crystal facets."""
        rip = noise(uv, 3, sd + 1, detail=5, rough=0.55, fv=11)
        macro = noise(uv, 2, sd + 2, detail=5)
        fine = noise(uv, 160, sd + 3, detail=3)
        def print_(dx, dy, r):
            al, ac = rot(dx * S * 1000.0, dy * S * 1000.0, r[2] * 6.2832)
            q = fmin(((al - 50.0) / 80.0) ** 2 + (ac / 50.0) ** 2, ((al + 95.0) / 45.0) ** 2 + (ac / 42.0) ** 2)
            return smooth(1.1, 0.8, q) * (4.0 + smooth(0.3, 0.7, fsin(al * 0.5)) * 1.0) * greater(r[3], 0.5)
        pr = scatter(uv, 3, 3, sd + 4, print_, jit=0.5)
        h = (macro - 0.5) * 12.0 + (rip - 0.5) * 5.0 + (fine - 0.5) * 0.6 - pr
        low = sat(-(macro - 0.5) * 3.0 + 0.4) * 0.5 + sat(pr / 4.0) * 0.5
        col = cmix(srgb("eceff2"), srgb("c3cdd8"), low)
        col = col * (0.95 + fine * 0.1)
        dirt = smooth(0.2, 0.1, voronoi(uv, 120, sd + 5).d) * greater(split(voronoi(uv, 120, sd + 5).col)[0], 0.97)
        col = cmix(col, srgb("6d6862"), dirt * 0.7)
        sv = voronoi(uv, 380, sd + 6)
        sx, sy, sz = split(sv.col)
        glint = greater(sz, 0.88)
        col = cmix(col, srgb("ffffff"), glint * 0.3)
        rough = 0.72 - sat(pr / 4.0) * 0.2 - glint * 0.35
        return dict(albedo=col, height=h, rough=rough, metal=0.0, tilt=((sx - 0.5) * 1.4, (sy - 0.5) * 1.4, glint))

    @material
    def bone(uv, S, sd):
        """Aged ossuary bone (axis along u): fibrous cortical surface with elongated vascular pores, longitudinal
        weathering cracks, patches of exposed spongy bone, soil staining."""
        fib = noise(uv, 4, sd + 1, detail=5, rough=0.6, fv=70)
        macro = noise(uv, 3, sd + 2, detail=5)
        col = cmix(srgb("cdbd9c"), srgb("e0d3b8"), sat((macro - 0.5) * 1.5 + 0.5))
        stain = blotch(uv, 2.5, sd + 3, 0.52, 0.12, detail=6)
        col = cmix(col, srgb("a68a5f"), stain * 0.7)
        col = cmix(col, col * srgb("8e8a7e"), blotch(uv, 4, sd + 4, 0.6, 0.1) * 0.5)
        col = col * (0.93 + fib * 0.14)
        pv = voronoi(uv, 40, sd + 5, fv=160)
        pore = smooth(0.25, 0.12, pv.d) * greater(split(pv.col)[0], 0.6)
        col = cmix(col, srgb("4e3f2e"), pore * 0.8)
        crk = smooth(0.006, 0.0015, fabs(noise(warp(uv, 0.004, 30, sd + 6), 1.2, sd + 7, detail=3, fv=7) - 0.5)) * blotch(uv, 2, sd + 8, 0.5, 0.1)
        col = cmix(col, srgb("3e3226"), crk * 0.85)
        spongy = blotch(uv, 3, sd + 9, 0.66, 0.02, detail=6)
        tr = voronoi(uv, 90, sd + 10, feature="DISTANCE_TO_EDGE").d
        walls = smooth(0.0, 0.12, tr)
        col = cmix(col, cmix(srgb("d1bf98"), srgb("5a4630"), walls), spongy)
        h = (macro - 0.5) * 1.0 + (fib - 0.5) * 0.3 - pore * 0.4 - crk * 0.5 - spongy * (0.5 + walls * 0.8)
        rough = mix(0.6 + stain * 0.15, 0.9, spongy) + pore * 0.1
        return dict(albedo=col, height=h, rough=rough, metal=0.0)


    # ============================================================== bake driver
    def setup_scene(samples):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        sc = bpy.context.scene
        sc.render.engine = "CYCLES"
        sc.cycles.device = "CPU"
        sc.cycles.samples = samples
        sc.cycles.use_denoising = False
        sc.cycles.filter_width = 1.2
        sc.render.bake.margin = 0
        sc.render.bake.use_clear = True
        bpy.ops.mesh.primitive_plane_add(size=1.0)
        return bpy.context.active_object

    def bake_set(name, obj, samples):
        cfg = SETS[name]
        n = cfg["px"]
        global _g
        _g = Graph(name)
        t0 = time.time()
        out = MATERIALS[name]((_g.u, _g.v), cfg["size_m"], seed_of(name) % 1000)
        nodes = _g.count
        obj.data.materials.clear()
        obj.data.materials.append(_g.mat)
        img = bpy.data.images.new(name + "_bake", n, n, alpha=False, float_buffer=True)
        img.colorspace_settings.name = "Non-Color"
        _g.img.image = img
        for nd in _g.N:
            nd.select = False
        _g.img.select = True
        _g.N.active = _g.img
        packs = {
            "A": out["albedo"],
            "B": combine(out["height"] * 0.01 + 0.5, out["rough"], out.get("metal", 0.0)),
        }
        if "tilt" in out:
            tx, ty, tw = out["tilt"]
            packs["C"] = combine(tx * 0.5 + 0.5, ty * 0.5 + 0.5, tw)
        CACHE.mkdir(parents=True, exist_ok=True)
        for key, val in packs.items():
            _g.show(val)
            bpy.ops.object.bake(type="EMIT", margin=0, use_clear=True)
            arr = np.empty(n * n * 4, np.float32)
            img.pixels.foreach_get(arr)
            np.save(CACHE / f"{name}_{key}.npy", arr.reshape(n, n, 4)[:, :, :3])
        bpy.data.images.remove(img)
        print(f"[bake] {name}: {nodes} nodes, {n}px, {time.time() - t0:.1f}s", flush=True)

    # ============================================================== preview
    def preview(names, cell=400):
        """Each set twice: the 2x2-tiled overview (top-down, tiling check) and a close-up at a grazing view,
        both under a low raking sun from the left plus a back light that shows roughness (wet = glossy)."""
        bpy.ops.wm.read_factory_settings(use_empty=True)
        sc = bpy.context.scene
        sc.render.engine = "CYCLES"
        sc.cycles.device = "CPU"
        sc.cycles.samples = 48
        sc.cycles.use_denoising = False
        sc.render.resolution_x = sc.render.resolution_y = cell
        sc.view_settings.view_transform = "AgX"
        sc.view_settings.look = "AgX - Base Contrast"
        world = bpy.data.worlds.new("w")
        world.use_nodes = True
        world.node_tree.nodes["Background"].inputs[0].default_value = (0.05, 0.05, 0.055, 1)
        world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
        sc.world = world
        bpy.ops.mesh.primitive_plane_add(size=1.0)
        plane = bpy.context.active_object

        def sun(name, elev, azim, strength, angle=2.0):
            ld = bpy.data.lights.new(name, "SUN")
            ld.energy = strength
            ld.angle = math.radians(angle)
            ob = bpy.data.objects.new(name, ld)
            # sun points along -Z; tilt it so light comes from azimuth `azim` (0 = +X) at elevation `elev`
            ob.rotation_euler = (0.0, math.radians(90 - elev), math.radians(azim))
            sc.collection.objects.link(ob)
            return ob
        sun("key", 20, 180, 4.0)   # from the left (-X), low and raking
        sun("back", 38, 90, 1.6, 6.0)  # from behind (+Y), towards the close-up camera: specular sheen
        cam_top = bpy.data.objects.new("top", bpy.data.cameras.new("top"))
        cam_top.data.type = "ORTHO"
        cam_top.location = (0, 0, 5)
        sc.collection.objects.link(cam_top)
        cam_low = bpy.data.objects.new("low", bpy.data.cameras.new("low"))
        cam_low.data.lens = 50
        sc.collection.objects.link(cam_low)
        outdir = CACHE / "preview"
        outdir.mkdir(parents=True, exist_ok=True)
        for name in names:
            paths = {k: TEXDIR / f"{name}_{k}.jpg" for k in ("albedo", "normal", "orm")}
            if not all(p.exists() for p in paths.values()):
                continue
            S = SETS[name]["size_m"]
            plane.scale = (2 * S, 2 * S, 1)  # two tiles each way at true scale
            cam_top.data.ortho_scale = 2 * S
            close = min(0.6, S * 0.55)  # metres across the close-up
            d = close / (2 * math.tan(cam_low.data.angle / 2))
            el = math.radians(42)
            cam_low.location = (S * 0.27, S * 0.2 - d * math.cos(el), d * math.sin(el))
            cam_low.rotation_euler = (math.radians(90) - el, 0, 0)
            mat = bpy.data.materials.new("p_" + name)
            mat.use_nodes = True
            nt = mat.node_tree
            bsdf = nt.nodes["Principled BSDF"]
            tc = nt.nodes.new("ShaderNodeTexCoord")
            mp = nt.nodes.new("ShaderNodeMapping")
            mp.inputs["Scale"].default_value = (2, 2, 1)
            nt.links.new(tc.outputs["UV"], mp.inputs[0])

            def tex(path, color):
                t = nt.nodes.new("ShaderNodeTexImage")
                t.image = bpy.data.images.load(str(path))
                t.image.colorspace_settings.name = "sRGB" if color else "Non-Color"
                nt.links.new(mp.outputs[0], t.inputs[0])
                return t
            ta, tn, to = tex(paths["albedo"], True), tex(paths["normal"], False), tex(paths["orm"], False)
            sep = nt.nodes.new("ShaderNodeSeparateColor")
            nt.links.new(to.outputs[0], sep.inputs[0])
            mul = nt.nodes.new("ShaderNodeMix")
            mul.data_type = "RGBA"
            mul.blend_type = "MULTIPLY"
            mul.inputs[0].default_value = 1.0
            nt.links.new(ta.outputs[0], mul.inputs[6])
            nt.links.new(sep.outputs[0], mul.inputs[7])
            nt.links.new(mul.outputs[2], bsdf.inputs["Base Color"])
            nt.links.new(sep.outputs[1], bsdf.inputs["Roughness"])
            nt.links.new(sep.outputs[2], bsdf.inputs["Metallic"])
            nm = nt.nodes.new("ShaderNodeNormalMap")
            nt.links.new(tn.outputs[0], nm.inputs["Color"])
            nt.links.new(nm.outputs[0], bsdf.inputs["Normal"])
            plane.data.materials.clear()
            plane.data.materials.append(mat)
            for cam, tag in ((cam_top, "top"), (cam_low, "low")):
                sc.camera = cam
                sc.render.filepath = str(outdir / f"{name}_{tag}.png")
                bpy.ops.render.render(write_still=True)
            print(f"[preview] {name}", flush=True)

    def blender_main():
        argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
        names = list(SETS)
        samples = 4
        do_bake, do_prev = True, True
        i = 0
        while i < len(argv):
            a = argv[i]
            if a == "--sets":
                names = [s for s in argv[i + 1].split(",") if s]
                i += 1
            elif a == "--samples":
                samples = int(argv[i + 1])
                i += 1
            elif a == "--preview-only":
                do_bake = False
            elif a == "--no-preview":
                do_prev = False
            i += 1
        unknown = [s for s in names if s not in SETS or s not in MATERIALS]
        if unknown:
            raise SystemExit(f"unknown or unimplemented set(s): {unknown}")
        if do_bake:
            obj = setup_scene(samples)
            for name in names:
                bake_set(name, obj, samples)
            subprocess.run(["python3", __file__, "--post", *names], check=True)
        if do_prev:
            preview(names)
            subprocess.run(["python3", __file__, "--sheet"], check=True)


# ============================================================================ post stage (system python3: numpy + Pillow)
def post_main(names):
    import numpy as np
    from PIL import Image

    def to_srgb8(lin):
        lin = np.clip(lin, 0.0, 1.0)
        s = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)
        return np.clip(np.round(s * 255), 0, 255).astype(np.uint8)

    def lin8(x):
        return np.clip(np.round(x * 255), 0, 255).astype(np.uint8)

    def ao_from_height(h, px_mm, radius_mm, strength, dirs=12, steps=10):
        """Horizon-based AO on a wrapped height field (mm)."""
        rpx = max(2.0, radius_mm / px_mm)
        occl = np.zeros_like(h)
        rng = np.random.default_rng(7)
        for d in range(dirs):
            ang = (d + rng.uniform(-0.3, 0.3)) / dirs * 2 * np.pi
            ca, sa = np.cos(ang), np.sin(ang)
            best = np.zeros_like(h)
            for s in range(1, steps + 1):
                r = 1.0 + (rpx - 1.0) * (s / steps) ** 1.6
                dx, dy = int(round(ca * r)), int(round(sa * r))
                if dx == 0 and dy == 0:
                    continue
                dist = math.hypot(dx, dy) * px_mm
                slope = (np.roll(h, (-dy, -dx), axis=(0, 1)) - h) / dist
                fall = 1.0 - (math.hypot(dx, dy) / (rpx + 1.0)) ** 2
                np.maximum(best, slope * fall, out=best)
            occl += best / np.sqrt(1.0 + best * best)
        return np.clip(1.0 - strength * occl / dirs, 0.0, 1.0)

    def seam_ratio(img, block=1):
        """Step across the wrap edge / mean step between neighbouring pixels inside the image, per axis
        (1.0 = the seam is indistinguishable). For decoded JPEGs pass block=8: the wrap edge is an 8x8 block
        boundary, so it is compared with the interior block boundaries."""
        a = img.astype(np.float32)
        if a.ndim == 2:
            a = a[:, :, None]
        n = a.shape[0]
        idx = np.arange(block - 1, n - 1, block)
        inner_x = np.abs(a[:, idx + 1] - a[:, idx]).mean()
        inner_y = np.abs(a[idx + 1, :] - a[idx, :]).mean()
        edge_x = np.abs(a[:, 0] - a[:, -1]).mean()
        edge_y = np.abs(a[0, :] - a[-1, :]).mean()
        return float(edge_x / max(inner_x, 1e-6)), float(edge_y / max(inner_y, 1e-6))

    TEXDIR.mkdir(parents=True, exist_ok=True)
    report = {}
    for name in names:
        cfg = SETS[name]
        n, S = cfg["px"], cfg["size_m"]
        px_mm = S * 1000.0 / n
        A = np.load(CACHE / f"{name}_A.npy")
        B = np.load(CACHE / f"{name}_B.npy")
        h = (B[:, :, 0] - 0.5) * 100.0  # mm
        rough = np.clip(B[:, :, 1], 0.02, 1.0)
        metal = np.clip(B[:, :, 2], 0.0, 1.0)
        # normals from the wrapped height (array row 0 = v 0 = bottom; OpenGL +Y = towards v 1)
        dhdx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) / (2 * px_mm)
        dhdy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) / (2 * px_mm)
        g = cfg.get("nrm", 1.0)
        nx, ny, nz = -dhdx * g, -dhdy * g, np.ones_like(h)
        cpath = CACHE / f"{name}_C.npy"
        if cpath.exists():
            Cc = np.load(cpath)
            tw = Cc[:, :, 2]
            nx = nx + (Cc[:, :, 0] - 0.5) * 2 * tw
            ny = ny + (Cc[:, :, 1] - 0.5) * 2 * tw
        ln = np.sqrt(nx * nx + ny * ny + nz * nz)
        N = np.stack([nx / ln, ny / ln, nz / ln], axis=-1)
        ao = ao_from_height(h, px_mm, cfg["ao"][0], cfg["ao"][1])
        alb8 = to_srgb8(A)
        nrm8 = lin8(N * 0.5 + 0.5)
        orm8 = lin8(np.stack([ao, rough, metal], axis=-1))
        sizes, seams = {}, {}
        raw = dict(albedo=A, height=h, rough=rough, normal=N, ao=ao)
        seam_raw = {k: [round(x, 2) for x in seam_ratio(v)] for k, v in raw.items()}
        for kind, arr, sub in (("albedo", alb8, 2), ("normal", nrm8, 0), ("orm", orm8, 0)):
            path = TEXDIR / f"{name}_{kind}.jpg"
            Image.fromarray(np.ascontiguousarray(np.flipud(arr))).save(path, "JPEG", quality=JPEG_Q[kind], subsampling=sub, optimize=True, progressive=True)
            sizes[kind] = path.stat().st_size
            seams[kind] = [round(x, 2) for x in seam_ratio(np.asarray(Image.open(path)), 8)]
        stats = dict(
            albedo_srgb_mean=[round(float(x), 1) for x in alb8.reshape(-1, 3).mean(0)],
            height_mm=[round(float(np.percentile(h, 1)), 2), round(float(np.percentile(h, 99)), 2)],
            rough=[round(float(np.percentile(rough, 5)), 2), round(float(rough.mean()), 2), round(float(np.percentile(rough, 95)), 2)],
            ao_mean=round(float(ao.mean()), 3), metal_mean=round(float(metal.mean()), 3),
        )
        report[name] = dict(px=n, size_m=S, bytes=sizes, seam_raw=seam_raw, seam_jpeg=seams, **stats)
        print(f"[post] {name}: {sum(sizes.values()) / 1024:.0f} KB {sizes}\n       seam raw {seam_raw}\n       seam jpeg {seams}\n       {stats}", flush=True)
    rp = CACHE / "report.json"
    old = json.loads(rp.read_text()) if rp.exists() else {}
    old.update(report)
    rp.write_text(json.dumps(old, indent=1))
    total = sum(p.stat().st_size for p in TEXDIR.glob("*") if p.is_file())
    print(f"[post] textures/ total {total / 1024 / 1024:.2f} MB", flush=True)


def sheet_main():
    from PIL import Image, ImageDraw, ImageFont
    pdir = CACHE / "preview"
    names = [n for n in SETS if (pdir / f"{n}_top.png").exists() and (pdir / f"{n}_low.png").exists()]
    cols, pad, lab = 4, 6, 24
    cw = ch = Image.open(pdir / f"{names[0]}_top.png").size[0]
    w, h = 2 * cw + pad, ch + lab
    rows = (len(names) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * (w + pad) + pad, rows * (h + pad) + pad), (10, 10, 10))
    d = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("DejaVuSans.ttf", 16)
    except OSError:
        font = ImageFont.load_default()
    for i, n in enumerate(names):
        x, y = pad + (i % cols) * (w + pad), pad + (i // cols) * (h + pad)
        sheet.paste(Image.open(pdir / f"{n}_top.png").convert("RGB"), (x, y + lab))
        sheet.paste(Image.open(pdir / f"{n}_low.png").convert("RGB"), (x + cw + pad, y + lab))
        d.text((x + 4, y + 3), f"{n} · {SETS[n]['px']}px · {SETS[n]['size_m']} m/tile · left 2x2 tiles, right close-up", fill=(230, 226, 214), font=font)
    DIST.mkdir(exist_ok=True)
    sheet.save(DIST / "texture_previews.png", optimize=True)
    print(f"[sheet] {DIST / 'texture_previews.png'} ({len(names)} sets)")


if __name__ == "__main__":
    if IN_BLENDER:
        blender_main()
    elif "--post" in sys.argv:
        post_main(sys.argv[sys.argv.index("--post") + 1:])
    elif "--sheet" in sys.argv:
        sheet_main()
    else:
        raise SystemExit("run inside Blender: blender -b --factory-startup -P DerinlikWeb/tools/bake_textures.py")
