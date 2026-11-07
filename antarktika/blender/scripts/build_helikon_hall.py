"""HELIKON hall — Chapter 3 ("HELIKON Kapısı"): the vaulted chamber behind the glyph gate.

Produces blender/source/helikon_hall.blend, blender/textures/hall_*.png and
ios/Antarktika/Game/models/helikon_hall.glb.

The hall is an instanced interior: it sits ~30 m under the plateau at HX/HZ, far from
every outdoor location, and the engine only activates its floors, colliders, volumes,
anchors and lights while the player is inside (state.inHall). The player arrives through
the portal at the south end (after Chapter 2, from the cave's glyph wall).

Contents
  * entry vestibule with the return portal                     INT_hall_exit
  * barrel-vaulted hall, 23 m x 38 m, ice above a stone base
  * five glyph steles, each carrying one constellation          INT_stele1..5
  * Kaan, an engineer of the lost team, frozen in an ice block  INT_kaan
  * a geothermal vent (the only warm spot)                      INT_vent
  * the star-map dais (puzzle: activate the steles in order)    INT_dais
  * the sealed three-ring gate (Chapter 4)                      INT_gate4
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Vector, noise  # noqa: E402
from PIL import Image, ImageDraw, ImageFilter  # noqa: E402

import a3d_common as C  # noqa: E402
import terrain as T  # noqa: E402

scene = C.reset_scene()
col_src = C.collection("SRC_procedural")
col_game = C.collection("GAME_export")
col_meta = C.collection("META_gameplay")

# ------------------------------------------------------------------ placement
HX, HZ = 200.0, -280.0           # entry (south end); the hall runs toward -z
ground = min(T.terrain_y(HX + dx, HZ + dz) for dx in range(-14, 15, 2) for dz in range(2, -50, -3))
FY = math.floor(ground) - 32.0   # floor level, well under the plateau
W = 11.6                         # half width of the hall
Z0, Z1 = -6.0, -44.0             # hall front / back wall (local z)
SPRING, RISE = 2.5, 10.5         # vault: vertical wall to SPRING, then a half-ellipse of height RISE
print("hall floor", FY, "ground min", round(ground, 2), "vault top", FY + SPRING + RISE)
assert FY + SPRING + RISE + 2.0 < ground, "hall would break the surface"


def P(lx, ly, lz):
    """hall-local (x, height above floor, z) -> game position"""
    return (HX + lx, FY + ly, HZ + lz)


# ------------------------------------------------------------------ materials (baked into one atlas)
M_HALL = [
    C.mat_rock("M_HallStone"),                                                        # 0 stone base, floor, steles
    C.mat_ice("M_HallIce", deep=(0.02, 0.12, 0.22), light=(0.30, 0.62, 0.78), interior=True),   # 1 vault ice
    C.mat_plain("M_HallBronze", (0.20, 0.17, 0.12), rough=0.45, metal=0.7, interior=True, noise=0.25),  # 2 ancient metal
    C.mat_fabric("M_KaanSuit", (0.62, 0.20, 0.06)),                                   # 3 Kaan's suit
    C.mat_plain("M_KaanGear", (0.08, 0.09, 0.10), rough=0.5, metal=0.3, interior=True),  # 4 helmet, boots
]
M_ICEBLOCK = C.mat_glass("GM_KaanIce", tint=(0.62, 0.86, 0.96), alpha=0.38)

bm = bmesh.new()

# floor slab
C.bm_box(bm, P(0, -0.25, (Z1 - 1.0 + 0.8) / 2), (2 * W + 0.4, 0.5, -(Z1 - 1.0) + 0.8), mat_index=0)
# floor inlay: a stone causeway with bronze strips toward the gate
for side in (-1, 1):
    C.bm_box(bm, P(side * 2.2, 0.02, (Z0 + Z1) / 2), (0.12, 0.06, Z0 - Z1), mat_index=2)

# vault: vertical stone wall up to SPRING, then an ice half-ellipse; ring per 2 m
ARCH = 18
zs = [Z0 + (Z1 - Z0) * i / 19 for i in range(20)]


def profile(lz):
    pts = [(W, 0.0), (W, SPRING)]
    for k in range(1, ARCH):
        a = k / ARCH * math.pi
        pts.append((W * math.cos(a), SPRING + RISE * math.sin(a)))
    pts += [(-W, SPRING), (-W, 0.0)]
    out = []
    for i, (x, y) in enumerate(pts):
        if 1 < i < len(pts) - 2:   # ice: lumpy
            n = noise.noise(Vector((x * 0.35, y * 0.35, lz * 0.35)))
            s = 1.0 + 0.045 * n
            x, y = x * s, SPRING + (y - SPRING) * s
        out.append((x, y))
    return out


rings = [[bm.verts.new(C.G(*P(x, y, lz))) for (x, y) in profile(lz)] for lz in zs]
n = len(rings[0])
axis_b = Vector(C.G(*P(0, SPRING, 0)))
for i in range(len(rings) - 1):
    for k in range(n - 1):
        f = bm.faces.new((rings[i][k + 1], rings[i][k], rings[i + 1][k], rings[i + 1][k + 1]))
        f.smooth = True
        mid_y = (rings[i][k].co.z + rings[i][k + 1].co.z) / 2 - FY
        f.material_index = 0 if mid_y < SPRING + 0.4 else 1
        f.normal_update()          # vault faces must look into the hall
        c = f.calc_center_median()
        if f.normal.dot(Vector((axis_b.x - c.x, 0.0, axis_b.z - c.z))) < 0:
            f.normal_flip()

# front wall (doorway 5.2 x 4.6) and back wall
for side in (-1, 1):
    C.bm_box(bm, P(side * (W + 2.6) / 2, 7.0, Z0 + 0.4), (W - 2.6 + 0.6, 14.0, 0.8), mat_index=0)
C.bm_box(bm, P(0, 4.6 + 4.7, Z0 + 0.4), (5.2, 9.4, 0.8), mat_index=0)
C.bm_box(bm, P(0, 7.0, Z1 - 0.4), (2 * W + 1.2, 14.0, 0.8), mat_index=0)

# vestibule: a short stone passage to the portal
for side in (-1, 1):
    C.bm_box(bm, P(side * 2.9, 2.4, (Z0 + 1.0) / 2), (0.6, 4.8, -Z0 + 1.0), mat_index=0)
C.bm_box(bm, P(0, 4.95, (Z0 + 1.0) / 2), (6.4, 0.3, -Z0 + 1.0), mat_index=0)
C.bm_box(bm, P(0, 2.4, 0.9), (6.4, 4.8, 0.6), mat_index=0)
for lz in (-1.8, -4.0):   # ribs
    C.bm_box(bm, P(0, 4.7, lz), (5.6, 0.35, 0.35), mat_index=2)

# columns with bronze bases/capitals
COLS = [(sx * 7.5, lz) for lz in (-10.0, -16.0, -22.0, -28.0, -34.0, -40.0) for sx in (-1, 1)]
for (lx, lz) in COLS:
    C.bm_cylinder(bm, P(lx, 0.0, lz), 0.55, 10.8, 12, mat_index=0, radius_top=0.48)
    C.bm_box(bm, P(lx, 0.25, lz), (1.5, 0.5, 1.5), bevel=0.05, mat_index=2)
    C.bm_box(bm, P(lx, 8.3, lz), (1.3, 0.4, 1.3), bevel=0.05, mat_index=2)

# steles (stone slabs facing the causeway)
STELES = [(-9.4, -12.5), (9.4, -18.5), (-9.4, -24.5), (9.4, -30.5), (-9.4, -36.5)]
for (lx, lz) in STELES:
    C.bm_box(bm, P(lx, 1.85, lz), (0.55, 3.7, 1.35), bevel=0.04, mat_index=0)
    C.bm_box(bm, P(lx, 0.15, lz), (0.9, 0.3, 1.7), bevel=0.03, mat_index=2)

# star-map dais
DAIS = (0.0, -25.0)
C.bm_cylinder(bm, P(DAIS[0], 0.0, DAIS[1]), 3.4, 0.2, 32, mat_index=2)
C.bm_cylinder(bm, P(DAIS[0], 0.2, DAIS[1]), 3.1, 0.15, 32, mat_index=0)


def torus(bm, centre, R, r, axis="Z", seg=32, tube=8, mat_index=2, part=1.0):
    """Torus in game space around `axis` through `centre` (part < 1 = open arc)."""
    rings_ = []
    closed = part >= 1.0
    segs = seg if closed else int(seg * part) + 1
    for i in range(segs):
        a = i / seg * math.tau if closed else i / (segs - 1) * math.tau * part
        ring = []
        for j in range(tube):
            b = j / tube * math.tau
            rr = R + r * math.cos(b)
            u, v, w = rr * math.cos(a), rr * math.sin(a), r * math.sin(b)
            if axis == "Z":
                gp = (centre[0] + u, centre[1] + v, centre[2] + w)
            elif axis == "X":
                gp = (centre[0] + w, centre[1] + v, centre[2] + u)
            else:
                gp = (centre[0] + u, centre[1] + w, centre[2] + v)
            ring.append(bm.verts.new(C.G(*gp)))
        rings_.append(ring)
    faces = []
    last = segs if closed else segs - 1
    for i in range(last):
        r0, r1 = rings_[i], rings_[(i + 1) % segs]
        for j in range(tube):
            f = bm.faces.new((r0[j], r0[(j + 1) % tube], r1[(j + 1) % tube], r1[j]))
            f.material_index = mat_index
            f.smooth = True
            faces.append(f)
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    return faces


# gate backing (stone disc) — the rings themselves are emissive, see below
C.bm_cylinder(bm, P(0, 5.6, Z1 + 0.05), 5.3, 0.5, 40, axis="Z", mat_index=0)
# frozen machines: bronze rings sunk into the floor
torus(bm, P(-6.2, 0.6, -41.0), 2.3, 0.32, axis="X", mat_index=2)
torus(bm, P(7.8, 0.4, -8.4), 1.8, 0.28, axis="Z", mat_index=2)
C.bm_box(bm, P(-6.2, 0.45, -41.0), (1.2, 0.9, 1.0), bevel=0.06, mat_index=2)

# Kaan — kneeling, head bowed (static; the ice block is a separate glass object)
KAAN = (8.9, -11.6)
kx, kz = KAAN
C.bm_box(bm, P(kx, 0.35, kz + 0.25), (0.55, 0.3, 0.75), mat_index=3)                 # shins on the floor
C.bm_box(bm, P(kx, 0.85, kz - 0.05), (0.62, 0.75, 0.42), yaw=0.0, mat_index=3)        # torso
C.bm_box(bm, P(kx - 0.36, 0.85, kz + 0.1), (0.16, 0.62, 0.18), mat_index=3)           # arms
C.bm_box(bm, P(kx + 0.36, 0.85, kz + 0.1), (0.16, 0.62, 0.18), mat_index=3)
C.bm_box(bm, P(kx, 0.62, kz + 0.42), (0.5, 0.14, 0.24), mat_index=4)                  # boots
sph = bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.17)
for v in sph["verts"]:
    v.co = v.co + Vector(C.G(*P(kx - 0.12, 1.36, kz + 0.06)))
for f in {f for v in sph["verts"] for f in v.link_faces}:
    f.material_index = 4
    f.smooth = True
C.bm_box(bm, P(kx + 0.05, 1.05, kz - 0.32), (0.42, 0.5, 0.22), mat_index=4)           # backpack

# vent: a ring of dark rock around the glowing fissure
VENT = (-9.6, -18.5)
for k in range(9):
    a = k / 9 * math.tau
    C.bm_cylinder(bm, P(VENT[0] + 1.15 * math.cos(a), -0.1, VENT[1] + 1.15 * math.sin(a)), 0.32 + 0.08 * (k % 3), 0.55 + 0.15 * (k % 2), 7, mat_index=0, radius_top=0.12)

# icicles from the vault
rr = C.rng(303)
for _ in range(70):
    lz = rr.uniform(Z1 + 1.5, Z0 - 1.0)
    a = rr.uniform(0.18, 0.82) * math.pi
    lx, ly = W * math.cos(a) * 0.985, SPRING + RISE * math.sin(a) * 0.985
    ln = rr.uniform(0.4, 2.2)
    C.bm_cylinder(bm, P(lx, ly - ln, lz), rr.uniform(0.004, 0.01), ln, 6, radius_top=rr.uniform(0.06, 0.2), mat_index=1)

bmesh.ops.recalc_face_normals(bm, faces=[f for f in bm.faces if f.material_index in (2, 3, 4)])
ob_hall = C.mesh_object("SRC_hall", bm, M_HALL, col_src)

# ------------------------------------------------------------------ emissive atlas


def build_atlas(path):
    img = Image.new("RGB", (1024, 512), (0, 0, 0))
    d = ImageDraw.Draw(img)
    rnd = C.rng(77)
    consts = []
    for i in range(5):
        x0, y0, w, h = i * 160 + 8, 8, 144, 304
        d.rectangle([x0, y0, x0 + w, y0 + h], fill=(6, 18, 26))
        d.rectangle([x0 + 6, y0 + 6, x0 + w - 6, y0 + h - 6], outline=(40, 140, 170), width=2)
        # constellation at the top: i + 3 stars
        pts = [(x0 + 24 + rnd.uniform(0, w - 48), y0 + 22 + rnd.uniform(0, 90)) for _ in range(i + 3)]
        pts.sort()
        consts.append([((px - x0) / w, (py - y0) / 120) for px, py in pts])
        d.line(pts, fill=(110, 230, 255), width=2)
        for (px, py) in pts:
            d.ellipse([px - 5, py - 5, px + 5, py + 5], fill=(225, 255, 255))
        # glyph columns
        for c in range(3):
            gx = x0 + 28 + c * 44
            for r in range(5):
                gy = y0 + 132 + r * 30
                for s in range(3):
                    d.line([gx + rnd.uniform(-10, 10), gy + rnd.uniform(-8, 8), gx + rnd.uniform(-10, 10), gy + rnd.uniform(-8, 8)], fill=(70, 200, 230), width=2)
        # order sign at the foot: i + 1 notches (the puzzle never shows it — Kaan reads it)
        for k in range(i + 1):
            d.rectangle([x0 + 20 + k * 20, y0 + h - 30, x0 + 30 + k * 20, y0 + h - 14], fill=(255, 190, 110))
    # star map disc
    cx, cy, R = 916, 108, 98
    d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=(4, 12, 22), outline=(80, 210, 240), width=3)
    for rr_ in (78, 56, 30):
        d.ellipse([cx - rr_, cy - rr_, cx + rr_, cy + rr_], outline=(40, 120, 150), width=1)
    for i, c in enumerate(consts):
        a = i / 5 * math.tau - math.pi / 2
        ox, oy = cx + 55 * math.cos(a), cy + 55 * math.sin(a)
        pts = [(ox + (u - 0.5) * 34, oy + (v - 0.5) * 30) for (u, v) in c]
        d.line(pts, fill=(90, 190, 220), width=1)
        for (px, py) in pts:
            d.ellipse([px - 2, py - 2, px + 2, py + 2], fill=(200, 240, 255))
    # portal ring
    cx, cy = 916, 316
    for r_, wdt in ((96, 4), (80, 2), (60, 3), (34, 2)):
        d.ellipse([cx - r_, cy - r_, cx + r_, cy + r_], outline=(90, 235, 255), width=wdt)
    for k in range(18):
        a = k * math.tau / 18
        d.line([cx + 84 * math.cos(a), cy + 84 * math.sin(a), cx + 94 * math.cos(a), cy + 94 * math.sin(a)], fill=(140, 245, 255), width=2)
    glow = img.filter(ImageFilter.GaussianBlur(4))
    img = Image.blend(img, glow, 0.35)
    d = ImageDraw.Draw(img)
    for i, c in enumerate([(70, 220, 255), (255, 120, 40), (255, 196, 100), (235, 250, 255), (190, 130, 255)]):
        d.rectangle([i * 128, 432, i * 128 + 127, 511], fill=c)
    img.save(path)


atlas_path = os.path.join(C.TEX_DIR, "hall_emissive.png")
build_atlas(atlas_path)
M_EMI = C.mat_emissive("GM_HallEmissive", (1, 1, 1), 2.4, bpy.data.images.load(atlas_path))
SW = {k: ((i * 128 + 64) / 1024, 1 - 472 / 512) for i, k in enumerate(["cyan", "orange", "gold", "white", "violet"])}


def emi(name, builder, **props):
    b = bmesh.new()
    uv = b.loops.layers.uv.new("UVMap")
    builder(b, uv)
    ob = C.mesh_object(name, b, M_EMI, col_game)
    for k, v in props.items():
        ob[k] = v
    return ob


def quad_uv(b, uv, pts, rect):
    """pts in game space (4, CCW seen from the front), rect = (px0, py0, px1, py1) in atlas pixels"""
    f = C.bm_quad(b, pts)
    u0, v0, u1, v1 = rect[0] / 1024, 1 - rect[3] / 512, rect[2] / 1024, 1 - rect[1] / 512
    for loop, c in zip(f.loops, [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]):
        loop[uv].uv = c
    return f


def solid_uv(b, faces, colour):
    u, v = SW[colour]
    for f in faces:
        for loop in f.loops:
            loop[uv_layer(b)].uv = (u, v)


def uv_layer(b):
    return b.loops.layers.uv.active


def octa(b, centre, s, colour):
    r = bmesh.ops.create_icosphere(b, subdivisions=1, radius=s)
    for v in r["verts"]:
        v.co = Vector((v.co.x, v.co.y, v.co.z * 1.8)) + Vector(C.G(*centre))
    solid_uv(b, {f for v in r["verts"] for f in v.link_faces}, colour)


emissive = []
# stele glyph panels (face the causeway)
for i, (lx, lz) in enumerate(STELES):
    side = -1 if lx > 0 else 1                  # inner face normal toward x = 0
    fx = lx + side * 0.285

    def b_(b, uv, fx=fx, lz=lz, side=side, i=i):
        z0, z1 = lz + 0.55 * side, lz - 0.55 * side
        quad_uv(b, uv, [P(fx, 0.55, z0), P(fx, 0.55, z1), P(fx, 3.45, z1), P(fx, 3.45, z0)],
                (i * 160 + 8, 8, i * 160 + 152, 312))
    emissive.append(emi("STELE_%d" % (i + 1), b_, a3d_group="stele%d" % (i + 1), a3d_scan=1, a3d_cull=60.0))

# star map disc + five star pins
def b_map(b, uv):
    y = 0.37
    x0, z0 = DAIS
    quad_uv(b, uv, [P(x0 - 2.9, y, z0 + 2.9), P(x0 + 2.9, y, z0 + 2.9), P(x0 + 2.9, y, z0 - 2.9), P(x0 - 2.9, y, z0 - 2.9)], (818, 10, 1014, 206))


emissive.append(emi("STARMAP", b_map, a3d_group="starmap", a3d_cull=60.0))
for i in range(5):
    a = i / 5 * math.tau - math.pi / 2
    pos = P(DAIS[0] + 1.62 * math.cos(a), 0.75, DAIS[1] + 1.62 * math.sin(a))
    emissive.append(emi("STAR_%d" % (i + 1), lambda b, uv, pos=pos: octa(b, pos, 0.12, "white"),
                        a3d_group="star%d" % (i + 1), a3d_hidden=1, a3d_bob=0.06, a3d_cull=50.0))


# return portal (vestibule back wall)
def b_portal(b, uv):
    z = 0.58
    quad_uv(b, uv, [P(2.2, 0.3, z), P(-2.2, 0.3, z), P(-2.2, 4.5, z), P(2.2, 4.5, z)], (818, 218, 1014, 414))


emissive.append(emi("PORTAL", b_portal, a3d_group="portal", a3d_pulse=0.25, a3d_cull=40.0))

# three-ring gate (Chapter 4)
def b_gate(b, uv):
    for R_, colour in ((4.4, "gold"), (3.3, "cyan"), (2.2, "violet")):
        faces = torus(b, P(0, 5.6, Z1 + 0.42), R_, 0.2, axis="Z", seg=40, tube=6, mat_index=0)
        solid_uv(b, faces, colour)


emissive.append(emi("GATE4", b_gate, a3d_group="gate4", a3d_cull=80.0))

# column lamps (small cyan crystals) and the vent glow
def b_lamps(b, uv):
    for (lx, lz) in COLS:
        octa(b, P(lx * 0.93, 3.3, lz), 0.14, "cyan")


emissive.append(emi("LAMPS", b_lamps, a3d_pulse=0.08, a3d_cull=70.0))


def b_vent(b, uv):
    x0, z0 = VENT
    pts = [P(x0 - 0.75, 0.04, z0 + 0.75), P(x0 + 0.75, 0.04, z0 + 0.75), P(x0 + 0.75, 0.04, z0 - 0.75), P(x0 - 0.75, 0.04, z0 - 0.75)]
    f = C.bm_quad(b, pts)
    solid_uv(b, [f], "orange")


emissive.append(emi("VENT", b_vent, a3d_group="vent", a3d_pulse=0.6, a3d_cull=60.0))

# Kaan's ice block (blended glass, hidden once he is thawed)
bi = bmesh.new()
C.bm_box(bi, P(KAAN[0], 0.95, KAAN[1]), (1.35, 1.9, 1.45), bevel=0.12)
ob_ice = C.mesh_object("KAAN_ice", bi, M_ICEBLOCK, col_game)
ob_ice["a3d_group"] = "kaan_ice"
ob_ice["a3d_cull"] = 60.0

# ------------------------------------------------------------------ gameplay metadata (all hall-local)
cm = col_meta
C.floor("hall", P(0, -0.5, (Z1 + 1.0) / 2), (W, 0.5, -(Z1 - 1.0) / 2), col=cm)
C.floor("dais", P(DAIS[0], 0.35 - 0.175, DAIS[1]), (2.2, 0.175, 2.2), col=cm)
C.volume("hall", P(0, 6.0, (Z1 + 1.0) / 2), (W + 0.5, 7.0, -(Z1 - 1.0) / 2 + 0.5), "hall", col=cm)
# walls
for side in (-1, 1):
    C.collider("hall_side%d" % side, P(side * (W - 0.1), 0, (Z0 + Z1) / 2), (0.4, 4.0, (Z0 - Z1) / 2), col=cm)
    C.collider("hall_front%d" % side, P(side * (W + 2.6) / 2, 0, Z0 + 0.4), ((W - 2.6) / 2, 4.0, 0.4), col=cm)
    C.collider("vest_side%d" % side, P(side * 2.9, 0, (Z0 + 1.0) / 2), (0.3, 4.0, (-Z0 + 1.0) / 2), col=cm)
C.collider("hall_back", P(0, 0, Z1 - 0.2), (W, 4.0, 0.5), col=cm)
C.collider("vest_back", P(0, 0, 0.9), (3.2, 4.0, 0.3), col=cm)
for i, (lx, lz) in enumerate(COLS):
    C.collider("column%d" % i, P(lx, 0, lz), (0.6, 4.0, 0.6), col=cm)
for i, (lx, lz) in enumerate(STELES):
    C.collider("stele%d" % (i + 1), P(lx, 0, lz), (0.3, 4.0, 0.7), col=cm)
C.collider("kaan", P(KAAN[0], 0, KAAN[1]), (0.72, 4.0, 0.76), col=cm)
C.collider("machine", P(-6.2, 0, -41.0), (0.6, 4.0, 2.4), col=cm)
C.collider("machine2", P(7.8, 0, -8.4), (2.0, 4.0, 0.35), col=cm)
# anchors
C.anchor("hall_exit", P(0, 0, -1.6), cm, a3d_id="hall_exit", a3d_radius=2.4, a3d_label="DÖNÜŞ KAPISI")
for i, (lx, lz) in enumerate(STELES):
    ax = lx - 1.3 if lx > 0 else lx + 1.3
    C.anchor("stele%d" % (i + 1), P(ax, 0, lz), cm, a3d_id="stele%d" % (i + 1), a3d_radius=1.9, a3d_label="TAŞ STEL %d" % (i + 1))
C.anchor("kaan", P(KAAN[0] - 1.35, 0, KAAN[1]), cm, a3d_id="kaan", a3d_radius=2.0, a3d_label="BUZDAKİ ADAM")
C.anchor("vent", P(VENT[0] + 1.6, 0, VENT[1]), cm, a3d_id="vent", a3d_radius=2.4, a3d_label="ISI KUYUSU")
C.anchor("dais", P(DAIS[0], 0.35, DAIS[1] + 2.6), cm, a3d_id="dais", a3d_radius=2.6, a3d_label="YILDIZ HARİTASI")
C.anchor("gate4", P(0, 0, Z1 + 2.4), cm, a3d_id="gate4", a3d_radius=2.6, a3d_label="ÜÇ CEVAP KAPISI")
C.anchor("hall_spawn", P(0, 0, -3.4), cm, a3d_id="hall_spawn", a3d_radius=0.1, a3d_label="")
# lights
for name, pos, colour, inten, rng_m, flick, group in (
    ("portal", P(0, 2.6, -1.0), (0.35, 0.85, 1.0), 1.0, 7.0, 0.0, "portal"),
    ("lamp_a", P(-6.8, 3.5, -16.0), (0.40, 0.80, 1.0), 0.8, 11.0, 0.0, None),
    ("lamp_b", P(6.8, 3.5, -28.0), (0.40, 0.80, 1.0), 0.8, 11.0, 0.0, None),
    ("lamp_c", P(-6.8, 3.5, -40.0), (0.40, 0.80, 1.0), 0.6, 11.0, 0.0, None),
    ("lamp_d", P(6.8, 3.5, -10.0), (0.40, 0.80, 1.0), 0.6, 10.0, 0.0, None),
    ("vent", P(VENT[0], 1.0, VENT[1]), (1.0, 0.45, 0.15), 1.4, 8.0, 0.25, "vent"),
    ("starmap", P(DAIS[0], 1.6, DAIS[1]), (0.55, 0.85, 1.0), 0.5, 9.0, 0.0, "starmap"),
    ("gate4", P(0, 5.6, Z1 + 2.0), (1.0, 0.8, 0.45), 0.0, 14.0, 0.0, "gate4"),
):
    e = C.light(name, pos, colour, inten, rng_m, cm, flick)
    if group:
        e["a3d_group"] = group

# ------------------------------------------------------------------ bake + export
game = C.join_copies([ob_hall], "hall_interior", col_game)
ob_hall.hide_render = True
C.unwrap(game, margin=0.003)
C.bake_atlas(game, "hall_interior", 1024, ao_distance=6.0, ao_samples=64, interior=True, extra_props={"a3d_zone": "hall"})
game["a3d_cull"] = 120.0

export = [game, ob_ice] + emissive + list(col_meta.objects)
root = bpy.data.objects.new("HALL_root", None)
col_game.objects.link(root)
root["a3d_model"] = "helikon_hall"
for o in export:
    o.parent = root
glb = os.path.join(C.GAME_MODELS, "helikon_hall.glb")
size = C.export_glb([root] + export, glb)
stats = {o.name: C.tri_count(o) for o in export if o.type == "MESH"}
print("STATS", stats, "total_tris", sum(stats.values()), "glb_bytes", size, "FY", FY, "HX", HX, "HZ", HZ)
C.save_blend("helikon_hall")
