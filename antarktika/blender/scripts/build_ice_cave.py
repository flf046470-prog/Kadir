"""HELIKON ice cave — the 'blue mark in the ice' from the prologue, made walkable.

Produces blender/source/ice_cave.blend, blender/textures/cave_*.png and
ios/Antarktika/Game/models/ice_cave.glb.

A serac mound north of the camp with a descending tunnel (entrance z = -29.5)
that opens into a chamber holding the HELIKON glyph wall, three resonance
crystals (puzzle: blue -> gold -> violet) and the sealed A1 resonance core.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402  (must precede bmesh when used as a module)
import bmesh  # noqa: E402
from mathutils import Vector, noise  # noqa: E402
from PIL import Image, ImageDraw, ImageFilter  # noqa: E402

import a3d_common as C  # noqa: E402
import terrain as T  # noqa: E402

scene = C.reset_scene()
col_src = C.collection("SRC_procedural")
col_game = C.collection("GAME_export")
col_meta = C.collection("META_gameplay")
col_help = C.collection("BAKE_helpers")

Z_START, Z_END = -29.5, -52.0
RINGS = 40
ARCH = 26


def smooth(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def centre_x(z):
    return -8.0 + 1.1 * math.sin((z + 30) * 0.16)


def half_width(z):
    return 1.75 + 0.35 * smooth(-30, -38, z) + 2.75 * smooth(-41, -45.5, z)


def height(z):
    return 2.9 + 0.3 * smooth(-30, -38, z) + 2.2 * smooth(-41, -46, z)


def floor_ref(z):
    return T.terrain_y(centre_x(z), z)


def n3(x, y, z, s=0.5):
    return noise.noise(Vector((x * s, y * s, z * s)))


def ring_points(z, inner=True):
    cxz, w, h, yf = centre_x(z), half_width(z), height(z), floor_ref(z)
    pts = []
    for k in range(ARCH):
        th = k / (ARCH - 1) * math.pi
        if inner:
            r = 1.0 + 0.09 * n3(th * 3, z, 0.0, 1.0) + 0.05 * n3(th * 9, z * 2, 3.0, 1.0)
            x = cxz + w * r * math.cos(th)
            ytop = yf + h * r
        else:
            r = 1.0 + 0.22 * n3(th * 2, z * 0.6, 7.0, 1.0) + 0.08 * n3(th * 6, z, 9.0, 1.0)
            thick = 2.4 + 1.4 * math.sin(th) + 0.8 * n3(th, z * 0.3, 5.0, 1.0)
            x = cxz + (w + thick) * r * math.cos(th)
            ytop = yf + (h + thick * 0.9) * r + 0.6 * math.sin(th) * (1 + n3(z * 0.2, th, 1.0, 1.0))
        yb = T.terrain_y(x, z) - 0.5
        s = math.sin(th) ** 0.8
        pts.append((x, yb + (ytop - yb) * s, z))
    return pts


# ------------------------------------------------------------------ materials
M_OUT = [C.mat_snow("M_CaveSnow"), C.mat_ice("M_CaveIceOut", deep=(0.10, 0.36, 0.50), light=(0.70, 0.90, 0.97))]
M_IN = [C.mat_ice("M_CaveIceIn", deep=(0.02, 0.16, 0.30), light=(0.36, 0.72, 0.88), interior=True),
        C.mat_snow("M_CaveFloor", interior=True),
        C.mat_ice("M_Icicle", deep=(0.30, 0.62, 0.78), light=(0.85, 0.96, 1.0), interior=True, cracks=False),
        C.mat_wood("M_FrozenCrate", interior=True),
        C.mat_painted_metal("M_FrozenCase", (0.55, 0.12, 0.05), rough=0.5, metal=0.3, seams=False, interior=True)]

zs = [Z_START + (Z_END - Z_START) * i / (RINGS - 1) for i in range(RINGS)]
inner = [ring_points(z, True) for z in zs]
outer = [ring_points(z, False) for z in zs]

def axis_point(z):
    return C.G(centre_x(z), floor_ref(z) + height(z) * 0.35, z)


def orient(f, outward):
    """Flip f so its normal points away from (outward=True) or toward the tunnel axis."""
    f.normal_update()
    c = f.calc_center_median()
    ref = c - axis_point(-c.y)
    if (f.normal.dot(ref) < 0) == outward:
        f.normal_flip()


# ------------------------------------------------------------------ outer shell (snow on top, blue ice flanks)
bo = bmesh.new()
vo = [[bo.verts.new(C.G(*p)) for p in ring] for ring in outer]
vi_o = [[bo.verts.new(C.G(*p)) for p in ring] for ring in (inner[0],)]
for i in range(RINGS - 1):
    for k in range(ARCH - 1):
        f = bo.faces.new((vo[i][k], vo[i][k + 1], vo[i + 1][k + 1], vo[i + 1][k]))
        f.smooth = True
        orient(f, True)
# entrance lip (outer ring 0 -> inner ring 0), facing the approach (+z game = -y Blender)
for k in range(ARCH - 1):
    f = bo.faces.new((vo[0][k + 1], vo[0][k], vi_o[0][k], vi_o[0][k + 1]))
    f.smooth = True
    f.normal_update()
    if f.normal.y > 0:
        f.normal_flip()
# back cap
c_back = bo.verts.new(C.G(centre_x(Z_END), floor_ref(Z_END) + height(Z_END) * 0.8, Z_END - 4.5))
for k in range(ARCH - 1):
    f = bo.faces.new((vo[-1][k + 1], vo[-1][k], c_back))
    f.smooth = True
    f.normal_update()
    if f.normal.y < 0:
        f.normal_flip()
bo.normal_update()
for f in bo.faces:
    f.material_index = 0 if f.normal.z > 0.62 else 1
# entrance snow drift + chunks
for (x, z, rx, rz, h) in ((-11.8, -28.6, 2.2, 1.6, 1.0), (-4.6, -28.9, 2.0, 1.4, 0.8)):
    sph = bmesh.ops.create_uvsphere(bo, u_segments=18, v_segments=8, radius=1.0)
    for v in sph["verts"]:
        gx, gz = x + v.co.x * rx, z - v.co.y * rz
        v.co = C.G(gx, T.terrain_y(gx, gz) - 0.3 + max(0.0, v.co.z) * h, gz)
    dfaces = list({f for v in sph["verts"] for f in v.link_faces})
    bmesh.ops.recalc_face_normals(bo, faces=dfaces)
    for f in dfaces:
        f.material_index = 0
        f.smooth = True
ob_out = C.mesh_object("SRC_cave_exterior", bo, M_OUT, col_src)

# ------------------------------------------------------------------ inner surface, floor, icicles, debris
bi = bmesh.new()
vi = [[bi.verts.new(C.G(*p)) for p in ring] for ring in inner]
for i in range(RINGS - 1):
    for k in range(ARCH - 1):
        f = bi.faces.new((vi[i][k + 1], vi[i][k], vi[i + 1][k], vi[i + 1][k + 1]))
        f.smooth = True
        orient(f, False)
c_in = bi.verts.new(C.G(centre_x(Z_END), floor_ref(Z_END) + height(Z_END) * 0.55, Z_END - 1.6))
for k in range(ARCH - 1):
    f = bi.faces.new((vi[-1][k], vi[-1][k + 1], c_in))
    f.smooth = True
    f.normal_update()
    if f.normal.y > 0:
        f.normal_flip()
# floor: follows the *rendered* terrain triangles, 7 cm above them
FL = 0.07
rows = []
for z in [Z_START - 0.6] + zs:
    zz = max(z, Z_END)
    w = half_width(zz) * 1.02
    row = []
    for k in range(13):
        x = centre_x(zz) - w + 2 * w * k / 12
        row.append(bi.verts.new(C.G(x, T.terrain_mesh_y(x, z) + FL, z)))
    rows.append(row)
for i in range(len(rows) - 1):
    for k in range(12):
        f = bi.faces.new((rows[i][k], rows[i][k + 1], rows[i + 1][k + 1], rows[i + 1][k]))
        f.material_index = 1
        f.smooth = True
rr = C.rng(42)
icicles = 0
for i in range(2, RINGS - 1):
    for _ in range(4 if zs[i] > -41 else 7):
        k = rr.randint(int(ARCH * 0.22), int(ARCH * 0.78))
        p = inner[i][k]
        x, y, z = p[0], p[1] - 0.05, p[2] + rr.uniform(-0.25, 0.25)
        ln = rr.uniform(0.25, 1.5) * (1.3 if zs[i] < -41 else 1.0)
        verts = C.bm_cylinder(bi, (x, y - ln, z), rr.uniform(0.004, 0.012), ln, 6, radius_top=rr.uniform(0.05, 0.16), mat_index=2)
        icicles += 1
# stalagmites / ice columns in the chamber
for (x, z, r, h) in ((-12.2, -45.0, 0.35, 1.6), (-3.6, -46.0, 0.3, 1.2), (-12.5, -50.5, 0.55, 3.5), (-4.0, -50.8, 0.5, 2.8)):
    C.bm_cylinder(bi, (x, T.terrain_y(x, z) - 0.2, z), r, h, 8, radius_top=r * 0.25, mat_index=2)
# lost expedition debris frozen into the wall
C.bm_box(bi, (centre_x(-36) - 1.55, T.terrain_y(-9.8, -36) + 0.35, -36.0), (0.8, 0.7, 0.9), 0.4, mat_index=3)
C.bm_box(bi, (centre_x(-39) + 1.65, T.terrain_y(-6.4, -39) + 0.25, -39.0), (0.5, 0.36, 0.9), -0.3, mat_index=4)
C.bm_cylinder(bi, (centre_x(-33) + 1.3, T.terrain_y(-6.7, -33) - 0.1, -33.0), 0.03, 2.2, 6, mat_index=4)
bmesh.ops.recalc_face_normals(bi, faces=[f for f in bi.faces if f.material_index in (2, 3, 4)])
ob_in = C.mesh_object("SRC_cave_interior", bi, M_IN, col_src)
print("icicles", icicles)

# ------------------------------------------------------------------ emissive atlas: glyph + swatches


def build_cave_atlas(path):
    img = Image.new("RGB", (512, 256), (0, 0, 0))
    d = ImageDraw.Draw(img)
    cx, cy = 128, 128
    for r, wdt in ((118, 3), (96, 2), (70, 4), (40, 2)):
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(80, 230, 255), width=wdt)
    for k in range(3):
        a = k * math.tau / 3 - math.pi / 2
        px, py = cx + 96 * math.cos(a), cy + 96 * math.sin(a)
        d.line([cx, cy, px, py], fill=(120, 245, 255), width=3)
        d.ellipse([px - 11, py - 11, px + 11, py + 11], fill=(200, 255, 255))
    for k in range(24):
        a = k * math.tau / 24
        r0, r1 = 100, 112 if k % 2 else 118
        d.line([cx + r0 * math.cos(a), cy + r0 * math.sin(a), cx + r1 * math.cos(a), cy + r1 * math.sin(a)], fill=(90, 220, 250), width=2)
    rnd = C.rng(91)
    for k in range(9):
        a = k * math.tau / 9 + 0.3
        gx, gy = cx + 55 * math.cos(a), cy + 55 * math.sin(a)
        for s in range(3):
            d.line([gx + rnd.uniform(-7, 7), gy + rnd.uniform(-7, 7), gx + rnd.uniform(-7, 7), gy + rnd.uniform(-7, 7)], fill=(150, 250, 255), width=2)
    d.ellipse([cx - 14, cy - 14, cx + 14, cy + 14], fill=(230, 255, 255))
    glow = img.filter(ImageFilter.GaussianBlur(5))
    img = Image.blend(img, glow, 0.45)
    d = ImageDraw.Draw(img)
    for i, c in enumerate([(70, 220, 255), (255, 196, 100), (190, 130, 255), (120, 255, 240)]):
        x0, y0 = 256 + (i % 2) * 128, (i // 2) * 128
        d.rectangle([x0, y0, x0 + 127, y0 + 127], fill=c)
    img.save(path)


atlas_path = os.path.join(C.TEX_DIR, "cave_emissive.png")
build_cave_atlas(atlas_path)
img_atlas = bpy.data.images.load(atlas_path)
M_EMI = C.mat_emissive("GM_CaveEmissive", (1, 1, 1), 2.5, img_atlas)
SW = {"blue": (320 / 512, 1 - 64 / 256), "gold": (448 / 512, 1 - 64 / 256), "violet": (320 / 512, 1 - 192 / 256), "cyan": (448 / 512, 1 - 192 / 256)}


def emissive_object(name, builder, loc, **props):
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    builder(bm, uv)
    ob = C.mesh_object(name, bm, M_EMI, col_game)
    ob.location = C.G(*loc)
    for k, v in props.items():
        ob[k] = v
    return ob


def crystal_builder(color, seed):
    def b(bm, uv):
        r = C.rng(seed)
        u, v = SW[color]
        for n in range(5):
            h = r.uniform(0.6, 1.7) * (1.0 if n else 1.25)
            rad = r.uniform(0.07, 0.16)
            tilt = Vector((r.uniform(-0.35, 0.35), r.uniform(-0.35, 0.35), 1)).normalized()
            base = Vector((r.uniform(-0.25, 0.25), r.uniform(-0.25, 0.25), -0.1))
            ring = []
            side = tilt.orthogonal().normalized()
            side2 = tilt.cross(side)
            for k in range(6):
                a = k * math.tau / 6
                ring.append(bm.verts.new(base + (side * math.cos(a) + side2 * math.sin(a)) * rad))
            top_ring = [bm.verts.new(vv.co + tilt * h * 0.8) for vv in ring]
            tip = bm.verts.new(base + tilt * h)
            faces = []
            for k in range(6):
                faces.append(bm.faces.new((ring[k], ring[(k + 1) % 6], top_ring[(k + 1) % 6], top_ring[k])))
                faces.append(bm.faces.new((top_ring[k], top_ring[(k + 1) % 6], tip)))
            for f in faces:
                for loop in f.loops:
                    loop[uv].uv = (u, v)
    return b


CRYS = [("blue", -10.9, -47.4), ("gold", -8.0, -49.4), ("violet", -5.1, -47.4)]
crystals = []
for i, (colname, x, z) in enumerate(CRYS):
    ob = emissive_object("CRYSTAL_%d" % (i + 1), crystal_builder(colname, 7 + i), (x, T.terrain_y(x, z), z),
                         a3d_group="crystal%d" % (i + 1), a3d_scan=1, a3d_pulse=0.0, a3d_cull=70.0)
    crystals.append(ob)

GZ = Z_END - 0.45
gy0 = floor_ref(Z_END) + 1.0


def glyph_builder(bm, uv):
    w, h = 1.6, 1.6
    pts = [(-w, 0, 0), (w, 0, 0), (w, 2 * h, 0), (-w, 2 * h, 0)]
    f = C.bm_quad(bm, pts)
    for loop, c in zip(f.loops, [(0.0, 0.0), (0.5, 0.0), (0.5, 1.0), (0.0, 1.0)]):
        loop[uv].uv = c


glyph = emissive_object("GLYPH_wall", glyph_builder, (centre_x(Z_END), gy0, GZ), a3d_group="glyph", a3d_scan=1, a3d_pulse=0.35, a3d_cull=80.0)


def core_builder(bm, uv):
    ico = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=0.28)
    u, v = SW["cyan"]
    for f in {f for vv in ico["verts"] for f in vv.link_faces}:
        for loop in f.loops:
            loop[uv].uv = (u, v)


CORE = (centre_x(Z_END) + 0.0, floor_ref(Z_END) + 0.55, Z_END + 0.9)
core = emissive_object("A1_core", core_builder, CORE, a3d_group="a1core", a3d_spin=1.2, a3d_bob=0.05, a3d_scan=1, a3d_hidden=1, a3d_cull=60.0)

# ------------------------------------------------------------------ gameplay metadata


def wall_colliders(points_l, points_r, tag):
    for side, pts in (("l", points_l), ("r", points_r)):
        for i in range(len(pts) - 1):
            (x0, z0), (x1, z1) = pts[i], pts[i + 1]
            mx, mz = (x0 + x1) / 2, (z0 + z1) / 2
            ln = math.hypot(x1 - x0, z1 - z0)
            yaw = math.atan2(-(x1 - x0), z1 - z0)   # helpers rotate by R_y(-yaw)
            C.collider("%s_%s%d" % (tag, side, i), (mx, 0.0, mz), (0.25, 4.0, ln / 2 + 0.15), yaw=yaw, col=col_meta)


def wall_x_at(ring, east, y_target):
    """x of the inner arch where it reaches y_target (narrowest point the head can touch)."""
    pts = ring[: ARCH // 2 + 1] if east else ring[::-1][: ARCH // 2 + 1]
    for a, b in zip(pts, pts[1:]):
        if b[1] >= y_target >= a[1]:
            t = (y_target - a[1]) / max(1e-6, b[1] - a[1])
            return a[0] + (b[0] - a[0]) * t
    return pts[-1][0]


step = 3
idx = list(range(0, RINGS, step)) + ([RINGS - 1] if (RINGS - 1) % step else [])
head = [min(abs(wall_x_at(inner[i], e, floor_ref(zs[i]) + h) - centre_x(zs[i])) for e in (True, False) for h in (0.3, 1.2, 2.05)) for i in idx]
inner_l = [(centre_x(zs[i]) - head[n] - 0.25, zs[i]) for n, i in enumerate(idx)]
inner_r = [(centre_x(zs[i]) + head[n] + 0.25, zs[i]) for n, i in enumerate(idx)]
wall_colliders(inner_l, inner_r, "cave_in")
outer_l = [(outer[i][-1][0] + 0.3, zs[i]) for i in idx]
outer_r = [(outer[i][0][0] - 0.3, zs[i]) for i in idx]
wall_colliders(outer_l, outer_r, "cave_out")
bw = half_width(Z_END) + 0.4
C.collider("cave_back", (centre_x(Z_END), 0.0, Z_END - 0.45), (bw, 4.0, 0.3), col=col_meta)
C.collider("cave_backout", (centre_x(Z_END), 0.0, Z_END - 4.0), (bw + 4.0, 4.0, 1.2), col=col_meta)
# front faces of the mound either side of the entrance
for side in (-1, 1):
    xa = centre_x(Z_START) + side * (half_width(Z_START) + 0.35)
    xb = outer[0][0 if side > 0 else -1][0]
    C.collider("cave_front%s" % ("r" if side > 0 else "l"), ((xa + xb) / 2, 0.0, Z_START + 0.1), (abs(xb - xa) / 2, 4.0, 0.3), col=col_meta)
for i, (_, x, z) in enumerate(CRYS):
    C.collider("crystal%d" % (i + 1), (x, 0.0, z), (0.4, 2.0, 0.4), col=col_meta)
for (x, z, r) in ((-12.2, -45.0, 0.35), (-3.6, -46.0, 0.3), (-12.5, -50.5, 0.55), (-4.0, -50.8, 0.5)):
    C.collider("column%d" % int(-z * 10), (x, 0.0, z), (r, 2.0, r), col=col_meta)
C.volume("cave_tunnel", (centre_x(-36.0), floor_ref(-36.0) + 1.5, -36.0), (2.3, 3.0, 6.8), "cave", col=col_meta)
C.volume("cave_chamber", (centre_x(-47.5), floor_ref(-47.5) + 2.5, -47.5), (5.2, 4.0, 5.0), "cave", col=col_meta)
C.anchor("glyph", (centre_x(Z_END), floor_ref(Z_END), Z_END + 1.6), col_meta, a3d_id="glyph", a3d_radius=2.8, a3d_label="HELIKON İŞARETİ")
for i, (_, x, z) in enumerate(CRYS):
    C.anchor("crystal%d" % (i + 1), (x, T.terrain_y(x, z), z + (0.9 if i != 1 else 1.0)), col_meta,
             a3d_id="crystal%d" % (i + 1), a3d_radius=1.55, a3d_label=["MAVİ KRİSTAL", "ALTIN KRİSTAL", "MOR KRİSTAL"][i])
C.anchor("a1core", (CORE[0], CORE[1], CORE[2] + 0.4), col_meta, a3d_id="a1core", a3d_radius=2.0, a3d_label="REZONANS ÇEKİRDEĞİ")
C.anchor("cargo_e1", (-10.4, T.terrain_y(-10.4, -44.6), -44.6), col_meta, a3d_id="cargo_e1", a3d_radius=1.5, a3d_label="YANKI KAPSÜLÜ")
C.anchor("entrance", (centre_x(Z_START), floor_ref(Z_START), Z_START + 1.5), col_meta, a3d_id="entrance", a3d_radius=4.0, a3d_label="BUZ MAĞARASI")
for name, pos, color, inten, rng_m, flick in (
    ("glyph", (centre_x(Z_END), gy0 + 1.4, Z_END + 1.2), (0.3, 0.85, 1.0), 1.3, 9.0, 0.15),
    ("crystal1", (CRYS[0][1], T.terrain_y(CRYS[0][1], CRYS[0][2]) + 1.0, CRYS[0][2]), (0.3, 0.8, 1.0), 0.0, 4.5, 0.0),
    ("crystal2", (CRYS[1][1], T.terrain_y(CRYS[1][1], CRYS[1][2]) + 1.0, CRYS[1][2]), (1.0, 0.75, 0.35), 0.0, 4.5, 0.0),
    ("crystal3", (CRYS[2][1], T.terrain_y(CRYS[2][1], CRYS[2][2]) + 1.0, CRYS[2][2]), (0.75, 0.5, 1.0), 0.0, 4.5, 0.0),
    ("entrance", (centre_x(Z_START), floor_ref(Z_START) + 2.0, Z_START - 1.0), (0.75, 0.88, 0.95), 0.7, 7.0, 0.0),
):
    e = C.light(name, pos, color, inten, rng_m, col_meta, flick)
    if name.startswith("crystal"):
        e["a3d_group"] = name

# ------------------------------------------------------------------ bake
game_out = C.join_copies([ob_out], "cave_exterior", col_game)
ob_out.hide_render = True
C.unwrap(game_out, margin=0.004)
C.bake_atlas(game_out, "cave_exterior", 1024, ao_distance=3.0, ao_samples=48, extra_props={"a3d_ice": 1})
game_in = C.join_copies([ob_in], "cave_interior", col_game)
ob_in.hide_render = True
C.unwrap(game_in, margin=0.003)
# large AO distance inside: deep chamber = dark, entrance = light spill (used as transmitted light)
C.bake_atlas(game_in, "cave_interior", 1024, ao_distance=7.0, ao_samples=96, interior=True, extra_props={"a3d_ice": 1, "a3d_zone": "cave"})
game_in["a3d_cull"] = 70.0
lod1 = C.make_lod(game_out, 0.3, "cave_exterior_LOD1")
game_out["a3d_lod_far"] = 80.0
lod1["a3d_lod_near"] = 80.0

export = [game_out, lod1, game_in, glyph, core] + crystals + list(col_meta.objects)
root = bpy.data.objects.new("CAVE_root", None)
col_game.objects.link(root)
root["a3d_model"] = "ice_cave"
for o in export:
    o.parent = root
glb = os.path.join(C.GAME_MODELS, "ice_cave.glb")
size = C.export_glb([root] + export, glb)
stats = {o.name: C.tri_count(o) for o in export if o.type == "MESH"}
print("STATS", stats, "total_tris", sum(stats.values()), "glb_bytes", size)
C.save_blend("ice_cave")
