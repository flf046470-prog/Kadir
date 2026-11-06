"""HELIKON-14 research station — playable vertical-slice building.

Produces:
    blender/source/station.blend        editable source (procedural materials + baked game meshes)
    blender/textures/station_*.png      baked PBR texture sets (base colour, ORM, normal)
    ios/Antarktika/Game/models/station.glb

Layout (game metres, x east / z south, floor height F):
    airlock      x 12-16   door in west wall, ramp + landing to the west
    laboratory   x 16-25   bench + lab terminal (03:17 clue), HELIKON artifact containment
    control room x 25-34   radio desk (prologue / mission), frequency console (puzzle), monitors
Outside: diesel generator + fuel drums, uplink mast with rotating dish, HELIKON drill site.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402  (must precede bmesh when used as a module)
import bmesh  # noqa: E402
from mathutils import Vector  # noqa: E402

import a3d_common as C  # noqa: E402
import screens as S  # noqa: E402
import terrain as T  # noqa: E402

scene = C.reset_scene()
X0, X1, Z0, Z1 = 12.0, 34.0, 23.0, 31.0
_lo, _hi = T.footprint_range((X0 + X1) / 2, (Z0 + Z1) / 2, (X1 - X0) / 2, (Z1 - Z0) / 2)
F = round(_hi + 0.6, 2)          # floor top
H = 3.0                          # interior height
DOOR_Z = (26.3, 27.7)
RAMP_X = (2.0, 9.8)
RAMP_BOTTOM = round(T.terrain_y(RAMP_X[0], 27.0) + 0.04, 3)
print("station floor", F, "ramp bottom", RAMP_BOTTOM)

col_src = C.collection("SRC_procedural")
col_game = C.collection("GAME_export")
col_meta = C.collection("META_gameplay")
col_help = C.collection("BAKE_helpers")


def ground(x, z):
    return T.terrain_y(x, z)


def ground_min(x, z, hx, hz):
    return T.footprint_range(x, z, hx, hz, 0.4)[0]


def wall(bm, axis, fixed, u0, u1, y0, y1, thick, openings, mi):
    """Wall along `axis` ('x' or 'z') at coordinate `fixed`, split around openings (ua, ub, ya, yb)."""
    cur = u0

    def piece(a, b, ya, yb):
        if b - a < 1e-3 or yb - ya < 1e-3:
            return
        if axis == "x":
            C.bm_box(bm, ((a + b) / 2, (ya + yb) / 2, fixed), (b - a, yb - ya, thick), mat_index=mi)
        else:
            C.bm_box(bm, (fixed, (ya + yb) / 2, (a + b) / 2), (thick, yb - ya, b - a), mat_index=mi)

    for a, b, ya, yb in sorted(openings):
        piece(cur, a, y0, y1)
        piece(a, b, y0, ya)
        piece(a, b, yb, y1)
        cur = b
    piece(cur, u1, y0, y1)


def hexa(bm, b, t, mi):
    """Solid from 4 bottom + 4 top game points (counter-clockwise from above)."""
    vb = [bm.verts.new(C.G(*p)) for p in b]
    vt = [bm.verts.new(C.G(*p)) for p in t]
    faces = [vb[::-1], vt] + [[vb[i], vb[(i + 1) % 4], vt[(i + 1) % 4], vt[i]] for i in range(4)]
    for f in faces:
        try:
            bm.faces.new(f).material_index = mi
        except ValueError:
            pass


def uv_rect(ob_bm_faces, rect):
    """Planar-map faces into a UV rectangle (used for emissive atlas cells)."""
    pass


# ------------------------------------------------------------------ materials
M_EXT = [
    C.mat_painted_metal("M_Cladding", (0.52, 0.11, 0.05), rough=0.42, metal=0.25, spacing=1.1),   # 0
    C.mat_painted_metal("M_Frame", (0.09, 0.10, 0.11), rough=0.5, metal=0.6, seams=False),         # 1
    C.mat_painted_metal("M_Steel", (0.42, 0.45, 0.47), rough=0.35, metal=0.85, seams=False, grime=0.55),  # 2
    C.mat_snow("M_Snow"),                                                                           # 3
    C.mat_painted_metal("M_WhitePanel", (0.78, 0.80, 0.80), rough=0.5, metal=0.15, spacing=1.5),  # 4
    C.mat_painted_metal("M_Yellow", (0.78, 0.56, 0.07), rough=0.45, metal=0.3, spacing=0.9),       # 5
    C.mat_painted_metal("M_DrumBlue", (0.07, 0.20, 0.45), rough=0.4, metal=0.4, seams=False, grime=0.6),  # 6
    C.mat_wood("M_Crate"),                                                                          # 7
    C.mat_plain("M_Rubber", (0.03, 0.03, 0.035), rough=0.85),                                       # 8
    C.mat_painted_metal("M_MastRed", (0.62, 0.08, 0.05), rough=0.45, metal=0.3, seams=False),      # 9
    C.mat_grating("M_ExtGrating", interior=False),                                                 # 10
    C.mat_ice("M_IceCore", cracks=False),                                                          # 11
]
M_INT = [
    C.mat_painted_metal("M_IntWall", (0.60, 0.63, 0.62), rough=0.55, metal=0.05, spacing=1.2, grime=0.2, interior=True),  # 0
    C.mat_plain("M_Lino", (0.26, 0.31, 0.34), rough=0.55, interior=True, noise=0.18),             # 1
    C.mat_grating("M_Grating", interior=True),                                                     # 2
    C.mat_painted_metal("M_Ceiling", (0.82, 0.83, 0.82), rough=0.6, metal=0.0, spacing=0.6, grime=0.1, interior=True),  # 3
    C.mat_plain("M_Desk", (0.55, 0.53, 0.48), rough=0.45, interior=True),                         # 4
    C.mat_painted_metal("M_Console", (0.13, 0.15, 0.17), rough=0.4, metal=0.5, seams=True, spacing=0.5, interior=True),  # 5
    C.mat_painted_metal("M_Locker", (0.20, 0.30, 0.38), rough=0.45, metal=0.4, spacing=0.52, interior=True),  # 6
    C.mat_plain("M_RedEquip", (0.62, 0.05, 0.03), rough=0.35, interior=True),                     # 7
    C.mat_painted_metal("M_IntSteel", (0.50, 0.53, 0.55), rough=0.3, metal=0.85, seams=False, interior=True),  # 8
    C.mat_wood("M_IntCrate", interior=True),                                                       # 9
    C.mat_plain("M_ParkaOrange", (0.80, 0.25, 0.04), rough=0.8, interior=True),                   # 10
    C.mat_plain("M_IntRubber", (0.04, 0.04, 0.045), rough=0.85, interior=True),                   # 11
]
screens_path = os.path.join(C.TEX_DIR, "screens_atlas.png")
S.build(screens_path)
img_screens = bpy.data.images.load(screens_path)
M_SCREEN = C.mat_emissive("GM_Screens", (1, 1, 1), 3.0, img_screens)
M_GLASS = C.mat_glass("GM_Glass")


def flat(name, color, rough=0.5, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return m


# ------------------------------------------------------------------ exterior
ext = bmesh.new()
cx, cz = (X0 + X1) / 2, (Z0 + Z1) / 2
# floor platform under the module
C.bm_box(ext, (cx, F - 0.24, cz), (X1 - X0, 0.42, Z1 - Z0), mat_index=1)
# shell walls with openings
y0, y1 = F - 0.45, F + H + 0.05
WIN_N = [(18.2, 19.8, F + 1.05, F + 2.15), (21.6, 23.2, F + 1.05, F + 2.15), (27.5, 29.1, F + 1.05, F + 2.15)]
WIN_S = [(19.0, 20.6, F + 1.05, F + 2.15), (27.9, 29.5, F + 1.05, F + 2.15)]
DOOR = [(DOOR_Z[0], DOOR_Z[1], F, F + 2.25)]
wall(ext, "x", Z0 + 0.1, X0, X1, y0, y1, 0.2, WIN_N, 0)
wall(ext, "x", Z1 - 0.1, X0, X1, y0, y1, 0.2, WIN_S, 0)
wall(ext, "z", X0 + 0.1, Z0 + 0.2, Z1 - 0.2, y0, y1, 0.2, DOOR, 0)
wall(ext, "z", X1 - 0.1, Z0 + 0.2, Z1 - 0.2, y0, y1, 0.2, [], 0)
# roof slab, corner posts, trims
C.bm_box(ext, (cx, F + H + 0.22, cz), (X1 - X0 + 0.3, 0.34, Z1 - Z0 + 0.3), mat_index=4)
for x in (X0 - 0.02, X1 + 0.02):
    for z in (Z0 - 0.02, Z1 + 0.02):
        C.bm_box(ext, (x, F + H / 2 - 0.2, z), (0.32, H + 0.5, 0.32), mat_index=1)
for z in (Z0 - 0.04, Z1 + 0.04):
    C.bm_box(ext, (cx, F - 0.32, z), (X1 - X0 + 0.2, 0.2, 0.1), mat_index=1)
    C.bm_box(ext, (cx, F + H + 0.02, z), (X1 - X0 + 0.2, 0.14, 0.1), mat_index=1)
# window frames (outside)
for (a, b, ya, yb) in WIN_N:
    C.bm_box(ext, ((a + b) / 2, yb + 0.07, Z0 - 0.04), (b - a + 0.3, 0.14, 0.12), mat_index=1)
    C.bm_box(ext, ((a + b) / 2, ya - 0.07, Z0 - 0.06), (b - a + 0.3, 0.12, 0.18), mat_index=1)
for (a, b, ya, yb) in WIN_S:
    C.bm_box(ext, ((a + b) / 2, yb + 0.07, Z1 + 0.04), (b - a + 0.3, 0.14, 0.12), mat_index=1)
    C.bm_box(ext, ((a + b) / 2, ya - 0.07, Z1 + 0.06), (b - a + 0.3, 0.12, 0.18), mat_index=1)
# door frame + lamp housing
C.bm_box(ext, (X0 - 0.06, F + 2.35, 27.0), (0.16, 0.22, 1.9), mat_index=1)
for z in (DOOR_Z[0] - 0.12, DOOR_Z[1] + 0.12):
    C.bm_box(ext, (X0 - 0.06, F + 1.12, z), (0.16, 2.3, 0.2), mat_index=1)
C.bm_box(ext, (X0 - 0.25, F + 2.62, 27.0), (0.5, 0.16, 0.7), mat_index=1)
# stilts with feet and braces
legs_x = [13.2, 18.6, 23.0, 28.4, 32.8]
for x in legs_x:
    for z in (Z0 + 0.6, Z1 - 0.6):
        g = ground(x, z) - 0.35
        C.bm_cylinder(ext, (x, g, z), 0.17, F - 0.45 - g, 10, mat_index=2)
        C.bm_box(ext, (x, g + 0.38, z), (0.7, 0.08, 0.7), mat_index=1)
    za, zb = Z0 + 0.6, Z1 - 0.6
    ga = ground(x, za) + 0.5
    C.bm_beam(ext, (x, ga, za), (x, F - 0.55, zb), 0.09, mat_index=2)
for i in range(len(legs_x) - 1):
    for z in (Z0 + 0.6, Z1 - 0.6):
        C.bm_beam(ext, (legs_x[i], F - 0.55, z), (legs_x[i + 1], ground(legs_x[i + 1], z) + 0.5, z), 0.08, mat_index=2)
# roof equipment: vents, small dish, railing
for x, z in ((15.0, 24.5), (21.0, 29.6), (30.5, 24.2)):
    C.bm_cylinder(ext, (x, F + H + 0.38, z), 0.22, 0.9, 10, mat_index=2)
    C.bm_cylinder(ext, (x, F + H + 1.26, z), 0.32, 0.12, 10, mat_index=1)
C.bm_box(ext, (26.0, F + H + 0.75, 28.5), (2.2, 0.75, 1.3), mat_index=4)
for x in range(13, 34, 3):
    for z in (Z0 + 0.05, Z1 - 0.05):
        C.bm_cylinder(ext, (x, F + H + 0.38, z), 0.03, 0.9, 6, mat_index=1)
for z in (Z0 + 0.05, Z1 - 0.05):
    C.bm_beam(ext, (13, F + H + 1.28, z), (33, F + H + 1.28, z), 0.05, mat_index=1)
# landing + ramp + railings (exterior grating)
C.bm_box(ext, (10.9, F - 0.14, 27.0), (2.2, 0.28, 2.8), mat_index=10)
hexa(ext, [(RAMP_X[0], RAMP_BOTTOM - 0.25, 27.9), (RAMP_X[1], F - 0.25, 27.9), (RAMP_X[1], F - 0.25, 26.1), (RAMP_X[0], RAMP_BOTTOM - 0.25, 26.1)],
     [(RAMP_X[0], RAMP_BOTTOM, 27.9), (RAMP_X[1], F, 27.9), (RAMP_X[1], F, 26.1), (RAMP_X[0], RAMP_BOTTOM, 26.1)], 10)
for side in (26.05, 27.95):
    for k in range(7):
        x = RAMP_X[0] + 0.15 + k * (RAMP_X[1] - RAMP_X[0] - 0.3) / 6
        y = RAMP_BOTTOM + (x - RAMP_X[0]) / (RAMP_X[1] - RAMP_X[0]) * (F - RAMP_BOTTOM)
        C.bm_cylinder(ext, (x, y, side), 0.035, 1.05, 6, mat_index=2)
    C.bm_beam(ext, (RAMP_X[0] + 0.15, RAMP_BOTTOM + 1.05, side), (RAMP_X[1], F + 1.05, side), 0.05, mat_index=9)
for z in (25.65, 28.35):
    C.bm_beam(ext, (9.8, F + 1.05, z), (X0 - 0.1, F + 1.05, z), 0.05, mat_index=9)
    for x in (9.85, 10.9, 11.85):
        C.bm_cylinder(ext, (x, F, z), 0.035, 1.05, 6, mat_index=2)
for za, zb in ((25.65, 26.05), (27.95, 28.35)):
    C.bm_beam(ext, (9.85, F + 1.05, za), (9.85, F + 1.05, zb), 0.05, mat_index=9)
# ramp support legs
for x in (4.5, 7.2, 9.6):
    y = RAMP_BOTTOM + (x - RAMP_X[0]) / (RAMP_X[1] - RAMP_X[0]) * (F - RAMP_BOTTOM) - 0.25
    for z in (26.3, 27.7):
        g = ground(x, z) - 0.3
        C.bm_box(ext, (x, (g + y) / 2, z), (0.12, y - g, 0.12), mat_index=2)

# generator container + drums + crates
GX, GZ = 15.6, 35.2
g0 = ground_min(GX, GZ, 1.6, 1.25) - 0.12
C.bm_box(ext, (GX, g0 + 1.15, GZ), (3.0, 2.3, 2.3), mat_index=5)
C.bm_box(ext, (GX, g0 + 0.1, GZ), (3.3, 0.2, 2.6), mat_index=1)
C.bm_cylinder(ext, (GX + 0.9, g0 + 2.3, GZ - 0.5), 0.12, 1.4, 8, mat_index=2)
C.bm_cylinder(ext, (GX + 0.9, g0 + 3.7, GZ - 0.5), 0.17, 0.12, 8, mat_index=1)
C.bm_box(ext, (GX - 1.52, g0 + 1.25, GZ), (0.06, 0.9, 1.1), mat_index=1)   # control panel frame (west face)
for i in range(5):
    C.bm_box(ext, (GX - 1.2 + i * 0.6, g0 + 2.33, GZ + 1.16), (0.4, 0.06, 0.02), mat_index=1)
# cable from generator to station underside
pts = [(GX - 0.3, g0 + 0.4, GZ - 1.15), (GX - 0.3, ground(GX - 0.3, 32.5) + 0.1, 32.5), (GX - 0.3, F - 0.5, Z1 - 0.7)]
for a, b in zip(pts, pts[1:]):
    C.bm_beam(ext, a, b, 0.06, mat_index=8)
rr = C.rng(14)
for i, (dx, dz) in enumerate(((0, 0), (0.65, 0.1), (0.3, 0.6), (-0.4, 0.5), (1.1, 0.75))):
    x, z = 12.6 + dx, 36.2 + dz
    C.bm_cylinder(ext, (x, ground(x, z) - 0.05, z), 0.29, 0.9, 12, mat_index=6 if i % 3 else 9)
for (x, z, s, yaw) in ((19.3, 36.0, 0.9, 0.2), (20.1, 36.4, 0.7, -0.4), (19.6, 37.0, 0.8, 0.6), (6.5, 22.0, 0.9, 0.3)):
    C.bm_box(ext, (x, ground(x, z) + s / 2 - 0.08, z), (s, s, s), yaw, mat_index=7)

# uplink mast
MX, MZ = 40.0, 25.0
mg = ground(MX, MZ) - 0.3
MH = 14.0
legs = [(MX + 0.55 * math.cos(a), MZ + 0.55 * math.sin(a)) for a in (0, 2.094, 4.189)]
segs = 9
for i in range(segs):
    ya, yb = mg + i * MH / segs, mg + (i + 1) * MH / segs
    mi = 9 if i % 2 == 0 else 4
    for k, (lx, lz) in enumerate(legs):
        nx, nz = legs[(k + 1) % 3]
        C.bm_beam(ext, (lx, ya, lz), (lx, yb, lz), 0.07, mat_index=mi)
        C.bm_beam(ext, (lx, ya, lz), (nx, yb, nz), 0.035, mat_index=2)
        C.bm_beam(ext, (lx, yb, lz), (nx, yb, nz), 0.04, mat_index=2)
C.bm_box(ext, (MX, mg + 0.15, MZ), (2.0, 0.3, 2.0), mat_index=1)
C.bm_cylinder(ext, (MX, mg + MH, MZ), 0.05, 2.2, 6, mat_index=2)
for a in (0.0, 2.094, 4.189):
    ax, az = MX + 7.0 * math.cos(a), MZ + 7.0 * math.sin(a)
    C.bm_beam(ext, (ax, ground(ax, az) + 0.2, az), (MX, mg + 10.0, MZ), 0.018, mat_index=2)
    C.bm_box(ext, (ax, ground(ax, az) + 0.1, az), (0.5, 0.35, 0.5), mat_index=1)
SHX, SHZ = 38.3, 25.0
sg = ground_min(SHX, SHZ, 0.8, 0.9) - 0.1
C.bm_box(ext, (SHX, sg + 1.0, SHZ), (1.4, 2.0, 1.7), mat_index=4)
C.bm_box(ext, (SHX - 0.72, sg + 1.35, SHZ), (0.06, 0.8, 0.9), mat_index=1)

# HELIKON drill site
DX, DZ = 29.5, 37.6
dg = ground(DX, DZ)
apex = (DX, dg + 4.6, DZ)
for a in (0.3, 2.394, 4.489):
    fx, fz = DX + 1.9 * math.cos(a), DZ + 1.9 * math.sin(a)
    C.bm_beam(ext, (fx, ground(fx, fz) - 0.1, fz), apex, 0.12, mat_index=5)
C.bm_cylinder(ext, (DX, dg - 0.5, DZ), 0.09, 4.8, 8, mat_index=2)
C.bm_box(ext, (DX, dg + 3.7, DZ), (0.6, 0.5, 0.6), mat_index=1)
C.bm_cylinder(ext, (DX, dg - 0.06, DZ), 0.95, 0.12, 16, mat_index=8, radius_top=0.85)
for k in range(8):
    a = k * math.tau / 8
    sx, sz = DX + 3.4 * math.cos(a), DZ + 3.4 * math.sin(a)
    C.bm_cylinder(ext, (sx, ground(sx, sz) - 0.2, sz), 0.04, 1.3, 6, mat_index=9)
    a2 = (k + 1) * math.tau / 8
    tx, tz = DX + 3.4 * math.cos(a2), DZ + 3.4 * math.sin(a2)
    C.bm_beam(ext, (sx, ground(sx, sz) + 0.95, sz), (tx, ground(tx, tz) + 0.95, tz), 0.02, mat_index=5)
RX, RZ = 26.4, 39.0
C.bm_box(ext, (RX, ground(RX, RZ) + 0.45, RZ), (1.6, 0.08, 0.5), mat_index=7)
C.bm_box(ext, (RX, ground(RX, RZ) + 0.2, RZ), (1.6, 0.5, 0.06), mat_index=7)
for k in range(5):
    C.bm_cylinder(ext, (RX - 0.6 + k * 0.3, ground(RX, RZ) + 0.5, RZ), 0.08, 0.45, 8, axis="Y", mat_index=11)

# snow: roof cap and drifts
grid = bmesh.ops.create_grid(ext, x_segments=44, y_segments=16, size=1.0)
_gx = [v.co.x for v in grid["verts"]]
_gy = [v.co.y for v in grid["verts"]]
_gxm, _gym = max(abs(min(_gx)), max(_gx)), max(abs(min(_gy)), max(_gy))
for v in grid["verts"]:
    gx, gz = cx + v.co.x / _gxm * (X1 - X0) / 2, cz - v.co.y / _gym * (Z1 - Z0) / 2
    edge = min((gx - X0), (X1 - gx), (gz - Z0), (Z1 - gz))
    h = 0.06 + min(1.0, edge / 1.6) * (0.18 + 0.12 * math.sin(gx * 0.7) * math.cos(gz * 0.9) + 0.08 * math.sin(gx * 2.3 + gz))
    v.co = C.G(gx, F + H + 0.39 + h, gz)
for f in {f for v in grid["verts"] for f in v.link_faces}:
    f.material_index = 3
for (x, z, rx, rz, h) in ((13.0, 22.2, 2.6, 1.2, 0.9), (19.0, 22.0, 3.0, 1.4, 0.7), (27.5, 22.3, 2.4, 1.1, 0.8), (11.0, 30.8, 1.6, 1.3, 0.6), (35.0, 26.5, 1.4, 2.6, 0.7)):
    sph = bmesh.ops.create_uvsphere(ext, u_segments=14, v_segments=7, radius=1.0)
    for v in sph["verts"]:
        lx, ly, lz = v.co.x * rx, v.co.z, v.co.y * rz
        gxx, gzz = x + lx, z - lz
        v.co = C.G(gxx, ground(gxx, gzz) - 0.25 + max(0.0, ly) * h, gzz)
    for f in {f for v in sph["verts"] for f in v.link_faces}:
        f.material_index = 3
bmesh.ops.recalc_face_normals(ext, faces=ext.faces)
ob_ext = C.mesh_object("SRC_station_exterior", ext, M_EXT, col_src)

# ------------------------------------------------------------------ interior
it = bmesh.new()
IX0, IX1, IZ0, IZ1 = X0 + 0.2, X1 - 0.2, Z0 + 0.2, Z1 - 0.2
C.bm_box(it, ((IX0 + 16) / 2, F - 0.025, cz), (16 - IX0, 0.05, IZ1 - IZ0), mat_index=2)
C.bm_box(it, ((16 + IX1) / 2, F - 0.025, cz), (IX1 - 16, 0.05, IZ1 - IZ0), mat_index=1)
C.bm_box(it, (cx, F + H + 0.025, cz), (IX1 - IX0, 0.05, IZ1 - IZ0), mat_index=3)
lin = 0.05
wall(it, "x", IZ0 + lin / 2, IX0, IX1, F, F + H, lin, WIN_N, 0)
wall(it, "x", IZ1 - lin / 2, IX0, IX1, F, F + H, lin, WIN_S, 0)
wall(it, "z", IX0 + lin / 2, IZ0 + lin, IZ1 - lin, F, F + H, lin, DOOR, 0)
wall(it, "z", IX1 - lin / 2, IZ0 + lin, IZ1 - lin, F, F + H, lin, [], 0)
INNER_DOOR = [(26.35, 27.65, F, F + 2.2)]
for x in (16.0, 25.0):
    wall(it, "z", x, IZ0 + lin, IZ1 - lin, F, F + H, 0.15, INNER_DOOR, 0)
    C.bm_box(it, (x, F + 2.26, 27.0), (0.22, 0.12, 1.5), mat_index=8)
    for z in (26.3, 27.7):
        C.bm_box(it, (x, F + 1.1, z), (0.22, 2.2, 0.1), mat_index=8)
# window sills / frames inside
for (a, b, ya, yb), z in [(w, IZ0 + 0.08) for w in WIN_N] + [(w, IZ1 - 0.08) for w in WIN_S]:
    C.bm_box(it, ((a + b) / 2, ya - 0.03, z), (b - a + 0.2, 0.06, 0.16), mat_index=8)
    C.bm_box(it, ((a + b) / 2, yb + 0.03, z), (b - a + 0.2, 0.06, 0.1), mat_index=8)
# skirting + ceiling duct
for z in (IZ0 + 0.06, IZ1 - 0.06):
    C.bm_box(it, (cx, F + 0.05, z), (IX1 - IX0 - 0.1, 0.1, 0.04), mat_index=11)
C.bm_cylinder(it, (IX0 + 0.3, F + H - 0.35, 29.9), 0.18, IX1 - IX0 - 0.6, 12, axis="X", mat_index=8)
for x in (14.1, 18.8, 22.2, 27.5, 31.0):
    C.bm_box(it, (x, F + H - 0.03, 25.5 if x in (18.8, 27.5) else 28.4 if x != 14.1 else 27.0), (1.3, 0.05, 0.5), mat_index=8)
# airlock: lockers, bench, parkas, boots, extinguisher
for i in range(4):
    C.bm_box(it, (12.75 + i * 0.75, F + 1.0, IZ0 + 0.33), (0.72, 2.0, 0.6), mat_index=6)
C.bm_box(it, (14.0, F + 0.24, IZ1 - 0.3), (2.8, 0.06, 0.45), mat_index=9)
for x in (12.8, 15.2):
    C.bm_box(it, (x, F + 0.11, IZ1 - 0.3), (0.08, 0.22, 0.4), mat_index=8)
C.bm_box(it, (14.0, F + 1.75, IZ1 - 0.06), (2.6, 0.05, 0.05), mat_index=8)
for i, x in enumerate((13.0, 13.9, 14.9)):
    hexa(it, [(x - 0.32, F + 0.75, IZ1 - 0.45), (x + 0.32, F + 0.75, IZ1 - 0.45), (x + 0.32, F + 0.75, IZ1 - 0.1), (x - 0.32, F + 0.75, IZ1 - 0.1)],
         [(x - 0.24, F + 1.65, IZ1 - 0.32), (x + 0.24, F + 1.65, IZ1 - 0.32), (x + 0.24, F + 1.65, IZ1 - 0.1), (x - 0.24, F + 1.65, IZ1 - 0.1)], 10)
    C.bm_cylinder(it, (x, F + 1.6, IZ1 - 0.25), 0.16, 0.24, 8, mat_index=10)
for x in (12.9, 13.3, 14.4, 14.75):
    C.bm_box(it, (x, F + 0.12, IZ1 - 0.75), (0.16, 0.24, 0.32), mat_index=11)
C.bm_cylinder(it, (12.45, F, 25.8), 0.09, 0.55, 10, mat_index=7)
C.bm_box(it, (12.4, F + 1.5, 25.0), (0.1, 0.6, 0.45), mat_index=7)
# laboratory: north bench + cabinets, terminal, microscope, jars, shelving
C.bm_box(it, (20.5, F + 0.45, IZ0 + 0.47), (8.0, 0.9, 0.85), mat_index=6)
C.bm_box(it, (20.5, F + 0.92, IZ0 + 0.47), (8.2, 0.05, 0.92), mat_index=4)
C.bm_box(it, (19.2, F + 1.25, IZ0 + 0.32), (0.75, 0.55, 0.06), mat_index=5)
C.bm_box(it, (19.2, F + 0.97, IZ0 + 0.38), (0.2, 0.08, 0.2), mat_index=5)
C.bm_box(it, (19.2, F + 0.96, IZ0 + 0.7), (0.5, 0.03, 0.18), mat_index=5)
C.bm_cylinder(it, (17.6, F + 0.95, IZ0 + 0.5), 0.12, 0.08, 10, mat_index=5)
C.bm_cylinder(it, (17.6, F + 1.03, IZ0 + 0.5), 0.035, 0.4, 8, mat_index=8)
C.bm_box(it, (17.6, F + 1.4, IZ0 + 0.55), (0.1, 0.12, 0.25), mat_index=5)
for k in range(6):
    C.bm_cylinder(it, (21.5 + k * 0.28, F + 0.95, IZ0 + 0.45 + (k % 2) * 0.18), 0.07, 0.2 + (k % 3) * 0.05, 8, mat_index=8)
C.bm_box(it, (23.8, F + 1.2, IZ0 + 0.45), (0.9, 0.55, 0.6), mat_index=8)
C.bm_box(it, (17.7, F + 1.0, IZ1 - 0.3), (2.4, 2.0, 0.5), mat_index=6)
for k in range(3):
    C.bm_box(it, (17.7, F + 0.45 + k * 0.6, IZ1 - 0.32), (2.3, 0.04, 0.52), mat_index=8)
    for j in range(3):
        C.bm_box(it, (16.9 + j * 0.75, F + 0.62 + k * 0.6, IZ1 - 0.35), (0.42, 0.3, 0.32), mat_index=9)
# artifact containment pedestal + cage
AX, AZ = 22.6, 29.1
C.bm_cylinder(it, (AX, F, AZ), 0.72, 0.85, 20, mat_index=5)
C.bm_cylinder(it, (AX, F + 0.85, AZ), 0.62, 0.08, 20, mat_index=8)
C.bm_cylinder(it, (AX, F + 2.32, AZ), 0.62, 0.08, 20, mat_index=8)
for k in range(4):
    a = k * math.tau / 4 + 0.4
    C.bm_cylinder(it, (AX + 0.6 * math.cos(a), F + 0.9, AZ + 0.6 * math.sin(a)), 0.035, 1.45, 6, mat_index=8)
C.bm_cylinder(it, (AX, F + H - 0.4, AZ), 0.22, 0.4, 12, mat_index=5)
# control room: east console desk + monitors, radio desk, frequency console, breaker panel, chairs
C.bm_box(it, (IX1 - 0.45, F + 0.42, 27.0), (0.8, 0.84, 6.6), mat_index=5)
hexa(it, [(IX1 - 0.85, F + 0.84, 23.9), (IX1 - 0.05, F + 0.84, 23.9), (IX1 - 0.05, F + 0.84, 30.1), (IX1 - 0.85, F + 0.84, 30.1)],
     [(IX1 - 0.85, F + 0.9, 23.9), (IX1 - 0.05, F + 1.08, 23.9), (IX1 - 0.05, F + 1.08, 30.1), (IX1 - 0.85, F + 0.9, 30.1)], 5)
for z in (24.8, 27.0, 29.2):
    C.bm_box(it, (IX1 - 0.18, F + 1.55, z), (0.1, 0.72, 1.25), mat_index=5)
C.bm_box(it, (31.1, F + 0.4, IZ1 - 0.4), (3.0, 0.8, 0.75), mat_index=4)
C.bm_box(it, (31.1, F + 0.82, IZ1 - 0.4), (3.1, 0.04, 0.8), mat_index=8)
C.bm_box(it, (31.0, F + 1.12, IZ1 - 0.45), (1.2, 0.55, 0.45), mat_index=5)
C.bm_cylinder(it, (30.2, F + 0.84, IZ1 - 0.45), 0.08, 0.12, 8, mat_index=8)
C.bm_beam(it, (32.3, F + 1.39, IZ1 - 0.5), (32.3, F + 2.1, IZ1 - 0.5), 0.02, mat_index=8)
C.bm_box(it, (29.0, F + 0.5, IZ0 + 0.4), (2.8, 1.0, 0.7), mat_index=5)
hexa(it, [(27.6, F + 1.0, IZ0 + 0.05), (30.4, F + 1.0, IZ0 + 0.05), (30.4, F + 1.0, IZ0 + 0.75), (27.6, F + 1.0, IZ0 + 0.75)],
     [(27.6, F + 1.75, IZ0 + 0.05), (30.4, F + 1.75, IZ0 + 0.05), (30.4, F + 1.05, IZ0 + 0.75), (27.6, F + 1.05, IZ0 + 0.75)], 5)
C.bm_box(it, (26.0, F + 1.5, IZ0 + 0.1), (0.8, 1.1, 0.16), mat_index=6)
for (x, z) in ((32.1, 26.0), (30.9, 29.4)):
    C.bm_cylinder(it, (x, F, z), 0.25, 0.06, 10, mat_index=11)
    C.bm_cylinder(it, (x, F + 0.05, z), 0.04, 0.42, 6, mat_index=8)
    C.bm_box(it, (x, F + 0.5, z), (0.5, 0.08, 0.5), mat_index=11)
    C.bm_box(it, (x + (0.24 if x > 31.5 else 0), F + 0.8, z + (0 if x > 31.5 else 0.22)), (0.08 if x > 31.5 else 0.5, 0.55, 0.5 if x > 31.5 else 0.08), mat_index=11)
C.bm_box(it, (27.2, F + 0.3, 30.3), (0.6, 0.6, 0.6), 0.3, mat_index=9)
bmesh.ops.recalc_face_normals(it, faces=it.faces)
ob_int = C.mesh_object("SRC_station_interior", it, M_INT, col_src)

# ------------------------------------------------------------------ emissive + glass + dynamic parts


def emissive_mesh(name, builder, **props):
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    builder(bm, uv)
    ob = C.mesh_object(name, bm, M_SCREEN, col_game)
    for k, v in props.items():
        ob[k] = v
    return ob


def screen(bm, uv, cell, center, w, h, facing):
    """Screen quad in game space facing +x/-x/+z/-z showing an atlas cell (or swatch name)."""
    x, y, z = center
    if facing in ("+x", "-x"):
        s = 1 if facing == "+x" else -1
        pts = [(x, y - h / 2, z + s * w / 2), (x, y - h / 2, z - s * w / 2), (x, y + h / 2, z - s * w / 2), (x, y + h / 2, z + s * w / 2)]
    else:
        s = 1 if facing == "+z" else -1
        pts = [(x - s * w / 2, y - h / 2, z), (x + s * w / 2, y - h / 2, z), (x + s * w / 2, y + h / 2, z), (x - s * w / 2, y + h / 2, z)]
    f = C.bm_quad(bm, pts)
    if isinstance(cell, str):
        u, v = S.SWATCH_UV[cell]
        coords = [(u, v)] * 4
    else:
        u0, v0, u1, v1 = S.cell_uv_rect(cell)
        coords = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
    for loop, c in zip(f.loops, coords):
        loop[uv].uv = c
    return f


def swatch_box(bm, uv, center, size, sw, yaw=0.0):
    verts = C.bm_box(bm, center, size, yaw)
    u, v = S.SWATCH_UV[sw]
    for f in {f for vv in verts for f in vv.link_faces}:
        for loop in f.loops:
            loop[uv].uv = (u, v)


def build_powered(bm, uv):
    screen(bm, uv, 1, (19.2, F + 1.25, IZ0 + 0.355), 0.66, 0.46, "+z")
    for z, cell in ((24.8, 2), (27.0, 0), (29.2, 2)):
        screen(bm, uv, cell, (IX1 - 0.235, F + 1.55, z), 1.12, 0.62, "-x")
    screen(bm, uv, 0, (31.0, F + 1.12, IZ1 - 0.68), 1.05, 0.46, "-z")
    p = [(27.75, F + 1.08, IZ0 + 0.7), (30.25, F + 1.08, IZ0 + 0.7), (30.25, F + 1.68, IZ0 + 0.12), (27.75, F + 1.68, IZ0 + 0.12)]
    f = C.bm_quad(bm, [(a, b + 0.012, c + 0.012) for a, b, c in p])
    u0, v0, u1, v1 = S.cell_uv_rect(7)
    for loop, c in zip(f.loops, [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]):
        loop[uv].uv = c
    for x in (14.1, 18.8, 22.2, 27.5, 31.0):
        z = 25.5 if x in (18.8, 27.5) else 28.4 if x != 14.1 else 27.0
        swatch_box(bm, uv, (x, F + H - 0.065, z), (1.15, 0.03, 0.38), "white" if x > 25 else "warm")
    screen(bm, uv, 4, (SHX - 0.76, sg + 1.35, SHZ), 0.82, 0.7, "-x")


def build_static(bm, uv):
    screen(bm, uv, 5, (X0 - 0.03, F + 1.7, 24.7), 1.6, 1.6, "-x")
    swatch_box(bm, uv, (X0 - 0.3, F + 2.52, 27.0), (0.36, 0.05, 0.5), "warm")
    screen(bm, uv, 3, (GX - 1.56, g0 + 1.25, GZ), 0.95, 0.82, "-x")
    swatch_box(bm, uv, (IX0 + 0.1, F + 2.45, 26.0), (0.08, 0.14, 0.3), "red")


def build_beacon(bm, uv):
    swatch_box(bm, uv, (MX, mg + MH + 2.25, MZ), (0.22, 0.3, 0.22), "red")


def build_drill(bm, uv):
    verts = C.bm_cylinder(bm, (DX, dg + 0.02, DZ), 0.78, 0.05, 20)
    u, v = S.SWATCH_UV["blue"]
    for f in {f for vv in verts for f in vv.link_faces}:
        for loop in f.loops:
            loop[uv].uv = (u, v)


ob_pow = emissive_mesh("EMI_powered", build_powered, a3d_power=1, a3d_cull=60.0)
ob_static = emissive_mesh("EMI_static", build_static, a3d_cull=140.0)
ob_beacon = emissive_mesh("EMI_beacon", build_beacon, a3d_blink=0.8, a3d_cull=400.0)
ob_drill = emissive_mesh("EMI_drill", build_drill, a3d_pulse=0.55, a3d_scan=1, a3d_group="drill", a3d_cull=160.0)


def build_artifact(bm, uv):
    u, v = S.SWATCH_UV["blue"]
    top, bot = bm.verts.new((0, 0, 0.62)), bm.verts.new((0, 0, -0.55))
    ring = [bm.verts.new((0.17 * math.cos(a), 0.17 * math.sin(a), 0.05 * math.sin(3 * a))) for a in [k * math.tau / 6 for k in range(6)]]
    for i in range(6):
        for f in (bm.faces.new((ring[i], ring[(i + 1) % 6], top)), bm.faces.new((ring[(i + 1) % 6], ring[i], bot))):
            for loop in f.loops:
                loop[uv].uv = (u, v)


bm = bmesh.new()
uvl = bm.loops.layers.uv.new("UVMap")
build_artifact(bm, uvl)
ob_art = C.mesh_object("ARTIFACT_core", bm, M_SCREEN, col_game)
ob_art.location = C.G(AX, F + 1.62, AZ)
ob_art["a3d_spin"] = 0.7
ob_art["a3d_bob"] = 0.07
ob_art["a3d_pulse"] = 1.4
ob_art["a3d_scan"] = 1
ob_art["a3d_group"] = "artifact"
ob_art["a3d_cull"] = 60.0

gl = bmesh.new()
for (a, b, ya, yb) in WIN_N:
    C.bm_box(gl, ((a + b) / 2, (ya + yb) / 2, Z0 + 0.1), (b - a, yb - ya, 0.03))
for (a, b, ya, yb) in WIN_S:
    C.bm_box(gl, ((a + b) / 2, (ya + yb) / 2, Z1 - 0.1), (b - a, yb - ya, 0.03))
C.bm_cylinder(gl, (AX, F + 0.93, AZ), 0.55, 1.39, 20)
ob_glass = C.mesh_object("GLASS_station", gl, M_GLASS, col_game)
ob_glass["a3d_cull"] = 120.0

M_DOOR = flat("GM_Door", (0.46, 0.11, 0.05), 0.45, 0.3)
bm = bmesh.new()
C.bm_box(bm, (0, 1.12, 0), (0.09, 2.24, 1.38))
C.bm_box(bm, (-0.06, 1.55, 0), (0.02, 0.35, 0.8))
ob_door = C.mesh_object("DOOR_airlock", bm, M_DOOR, col_game)
ob_door.location = C.G(X0 - 0.08, F, 27.0)
ob_door["a3d_slide"] = [0.0, 0.0, 1.42]   # game-space offset when open
ob_door["a3d_trigger"] = 2.6

M_DISH = flat("GM_Dish", (0.80, 0.82, 0.82), 0.35, 0.2)
bm = bmesh.new()
C.bm_cylinder(bm, (0, -0.08, 0), 0.06, 0.16, 8)
C.bm_beam(bm, (0, 0, 0), (1.1, 0.1, 0), 0.06)
verts = C.bm_cylinder(bm, (1.1, 0.1, 0), 0.75, 0.35, 18, axis="X", radius_top=0.1, cap=True)
C.bm_beam(bm, (1.25, 0.1, 0), (1.85, 0.1, 0), 0.03)
ob_dish = C.mesh_object("DISH_uplink", bm, M_DISH, col_game)
ob_dish.location = C.G(MX, mg + 9.0, MZ)
ob_dish["a3d_spin"] = 0.22
ob_dish["a3d_cull"] = 300.0

# ------------------------------------------------------------------ gameplay metadata
W = 0.15
C.collider("wall_n", (cx, F, Z0 + 0.12), (11.0, 3.0, W), col=col_meta)
C.collider("wall_s", (cx, F, Z1 - 0.12), (11.0, 3.0, W), col=col_meta)
C.collider("wall_e", (X1 - 0.12, F, cz), (W, 3.0, 4.0), col=col_meta)
C.collider("wall_w1", (X0 + 0.1, F, (Z0 + DOOR_Z[0]) / 2), (W, 3.0, (DOOR_Z[0] - Z0) / 2), col=col_meta)
C.collider("wall_w2", (X0 + 0.1, F, (DOOR_Z[1] + Z1) / 2), (W, 3.0, (Z1 - DOOR_Z[1]) / 2), col=col_meta)
C.collider("door", (X0 + 0.05, F, 27.0), (0.12, 2.0, 0.7), col=col_meta, a3d_door="DOOR_airlock")
for x in (16.0, 25.0):
    C.collider("part%d_a" % x, (x, F, (Z0 + 26.35) / 2), (0.1, 3.0, (26.35 - Z0) / 2), col=col_meta)
    C.collider("part%d_b" % x, (x, F, (27.65 + Z1) / 2), (0.1, 3.0, (Z1 - 27.65) / 2), col=col_meta)
for name, c, h in (
    ("lockers", (14.25, F, IZ0 + 0.33), (1.55, 1, 0.32)),
    ("bench", (14.0, F, IZ1 - 0.35), (1.45, 1, 0.35)),
    ("labbench", (20.5, F, IZ0 + 0.47), (4.1, 1, 0.48)),
    ("shelves", (17.7, F, IZ1 - 0.3), (1.25, 1, 0.3)),
    ("artifact", (AX, F, AZ), (0.75, 1, 0.75)),
    ("console_e", (IX1 - 0.45, F, 27.0), (0.45, 1, 3.4)),
    ("radiodesk", (31.1, F, IZ1 - 0.4), (1.55, 1, 0.42)),
    ("freqdesk", (29.0, F, IZ0 + 0.4), (1.45, 1, 0.42)),
    ("crate_cr", (27.2, F, 30.3), (0.35, 1, 0.35)),
    ("landing_n", (10.9, F, 25.62), (1.15, 1, 0.06)),
    ("landing_s", (10.9, F, 28.38), (1.15, 1, 0.06)),
    ("landing_wn", (9.82, F, 25.85), (0.06, 1, 0.22)),
    ("landing_ws", (9.82, F, 28.15), (0.06, 1, 0.22)),
    ("ramp_n", ((RAMP_X[0] + RAMP_X[1]) / 2, 1.5, 26.03), ((RAMP_X[1] - RAMP_X[0]) / 2, 1, 0.06)),
    ("ramp_s", ((RAMP_X[0] + RAMP_X[1]) / 2, 1.5, 27.97), ((RAMP_X[1] - RAMP_X[0]) / 2, 1, 0.06)),
    ("generator", (GX, g0, GZ), (1.6, 1, 1.25)),
    ("drums", (13.1, 1.2, 36.6), (0.95, 1, 0.75)),
    ("crates", (19.7, 1.2, 36.5), (0.75, 1, 0.8)),
    ("mast", (MX, mg, MZ), (1.05, 1, 1.05)),
    ("mast_shelter", (SHX, sg, SHZ), (0.72, 1, 0.88)),
    ("drill", (DX, dg, DZ), (1.6, 1, 1.6)),
    ("corerack", (RX, 1.2, RZ), (0.82, 1, 0.3)),
):
    C.collider(name, c, h, col=col_meta)
for a in (0.0, 2.094, 4.189):
    ax, az = MX + 7.0 * math.cos(a), MZ + 7.0 * math.sin(a)
    C.collider("guy%d" % int(a * 10), (ax, 1.5, az), (0.3, 1, 0.3), col=col_meta)

C.floor("station", (cx, F - 0.5, cz), ((X1 - X0) / 2, 0.5, (Z1 - Z0) / 2), col=col_meta)
C.floor("landing", (10.9, F - 0.5, 27.0), (1.15, 0.5, 1.45), col=col_meta)
C.floor("ramp", ((RAMP_X[0] + RAMP_X[1]) / 2, (F + RAMP_BOTTOM) / 2, 27.0), (0.92, (F - RAMP_BOTTOM) / 2, (RAMP_X[1] - RAMP_X[0]) / 2), yaw=math.pi / 2, col=col_meta, ramp=True)
C.volume("indoor", (cx, F + H / 2, cz), ((IX1 - IX0) / 2, H / 2 + 0.5, (IZ1 - IZ0) / 2), "indoor", col=col_meta)

C.anchor("radio", (31.0, F, 29.25), col_meta, a3d_id="radio", a3d_radius=2.3, a3d_label="TELSİZ")
C.anchor("freq", (29.0, F, 24.85), col_meta, a3d_id="freq", a3d_radius=2.2, a3d_label="FREKANS ÇÖZÜCÜ")
C.anchor("labterminal", (19.2, F, 24.95), col_meta, a3d_id="labterminal", a3d_radius=2.0, a3d_label="LAB TERMİNALİ")
C.anchor("artifact", (AX - 0.2, F, AZ - 1.15), col_meta, a3d_id="artifact", a3d_radius=1.9, a3d_label="HELIKON KRİSTALİ")
C.anchor("generator", (GX - 2.25, ground(GX - 2.25, GZ), GZ), col_meta, a3d_id="generator", a3d_radius=2.4, a3d_label="JENERATÖR")
C.anchor("uplink", (SHX - 1.45, ground(SHX - 1.45, SHZ), SHZ), col_meta, a3d_id="uplink", a3d_radius=2.4, a3d_label="BİRLİK UPLINK")
C.anchor("drill", (DX - 2.4, ground(DX - 2.4, DZ), DZ), col_meta, a3d_id="drill", a3d_radius=2.6, a3d_label="HELIKON SONDAJI")

for name, pos, color, inten, rng_m, power, flick in (
    ("airlock", (14.1, F + H - 0.45, 27.0), (0.85, 0.92, 1.0), 1.1, 6.0, 1, 0.0),
    ("lab", (20.5, F + H - 0.45, 27.0), (1.0, 0.86, 0.68), 1.25, 8.5, 1, 0.0),
    ("control", (29.4, F + H - 0.45, 27.0), (0.80, 0.90, 1.0), 1.15, 8.5, 1, 0.0),
    ("artifact", (AX, F + 1.6, AZ), (0.30, 0.85, 1.0), 1.6, 5.0, 0, 0.35),
    ("emergency", (IX0 + 0.4, F + 2.4, 26.0), (1.0, 0.18, 0.1), 0.55, 7.0, -1, 0.0),
    ("door", (X0 - 0.6, F + 2.3, 27.0), (1.0, 0.8, 0.55), 0.9, 7.0, 0, 0.0),
    ("drill", (DX, dg + 0.6, DZ), (0.25, 0.8, 1.0), 1.4, 7.0, 0, 0.25),
    ("generator", (GX - 1.9, g0 + 2.4, GZ), (1.0, 0.6, 0.25), 0.8, 6.0, 1, 0.0),
):
    e = C.light(name, pos, color, inten, rng_m, col_meta, flick)
    e["a3d_power"] = power  # 1 = needs generator, -1 = only while unpowered, 0 = always
for i, (x, z) in enumerate(((17.5, 17.6), (25.0, 18.2), (33.0, 18.6), (25.0, 18.2))):
    C.empty("PATH_selin_%d" % i, (x, ground(x, z), z), (0.2, 0.2, 0.2), col=col_meta, kind="SPHERE", a3d_kind="path", a3d_order=i,
            a3d_wait=4.0 if i in (0, 2) else 0.0)

# ------------------------------------------------------------------ ground patch (AO / sun shadow decal)
RES, TX0, TX1, TZ0, TZ1 = 246, -325.0, 325.0, -390.0, 135.0
DXs, DZs = (TX1 - TX0) / RES, (TZ1 - TZ0) / RES
i0, i1 = int((-1 - TX0) / DXs), int((50 - TX0) / DXs) + 1
j0, j1 = int((12 - TZ0) / DZs), int((46 - TZ0) / DZs) + 1
gp = bmesh.new()
uvg = gp.loops.layers.uv.new("UVMap")
vmap = {}
for j in range(j0, j1 + 1):
    for i in range(i0, i1 + 1):
        x, z = TX0 + i * DXs, TZ0 + j * DZs
        vmap[(i, j)] = gp.verts.new(C.G(x, T.terrain_y(x, z) + 0.03, z))
gx0, gx1, gz0, gz1 = TX0 + i0 * DXs, TX0 + i1 * DXs, TZ0 + j0 * DZs, TZ0 + j1 * DZs
for j in range(j0, j1):
    for i in range(i0, i1):
        for tri in ((vmap[(i, j)], vmap[(i, j + 1)], vmap[(i + 1, j)]), (vmap[(i + 1, j)], vmap[(i, j + 1)], vmap[(i + 1, j + 1)])):
            f = gp.faces.new(tri)
            for loop in f.loops:
                x, z = loop.vert.co.x, -loop.vert.co.y
                loop[uvg].uv = ((x - gx0) / (gx1 - gx0), 1 - (z - gz0) / (gz1 - gz0))
ground_mat = flat("M_GroundBake", (0.8, 0.8, 0.8), 0.9)
ob_ground = C.mesh_object("SHADOW_station", gp, ground_mat, col_game)

# ------------------------------------------------------------------ bake
sun = bpy.data.lights.new("GameSun", "SUN")
sun.angle = math.radians(4.0)
sun_ob = bpy.data.objects.new("GameSun", sun)
col_help.objects.link(sun_ob)
to_sun = C.G(-0.58, 0.47, -0.68).normalized()
sun_ob.rotation_euler = (-to_sun).to_track_quat("-Z", "Y").to_euler()

game_ext = C.join_copies([ob_ext], "station_exterior", col_game)
ob_ext.hide_render = True
C.unwrap(game_ext)
C.bake_atlas(game_ext, "station_exterior", 1024, ao_distance=2.2, ao_samples=48)
game_int = C.join_copies([ob_int], "station_interior", col_game)
ob_int.hide_render = True
C.unwrap(game_int, margin=0.003)
C.bake_atlas(game_int, "station_interior", 1024, ao_distance=1.1, ao_samples=64, interior=True)
game_int["a3d_cull"] = 55.0

# ground decal: AO + sun shadow from the finished building
img_sh = bpy.data.images.new("station_shadow", 512, 512)
img_sh.colorspace_settings.name = "Non-Color"
nt = ground_mat.node_tree
tn = nt.nodes.new("ShaderNodeTexImage")
tn.image = img_sh
nt.nodes.active = tn
C._select_only([ob_ground], ob_ground)
bk = scene.render.bake
bk.use_clear = True
scene.world.light_settings.distance = 6.0
scene.cycles.samples = 96
bpy.ops.object.bake(type="AO")
ao = C._pixels(img_sh)[..., 0].copy()
img_sd = bpy.data.images.new("station_sun", 512, 512)
img_sd.colorspace_settings.name = "Non-Color"
tn.image = img_sd
scene.cycles.samples = 32
bpy.ops.object.bake(type="SHADOW")
sh = C._pixels(img_sd)[..., 0]
sh = sh / max(1e-4, float(sh.max()))
dark = C.np.clip(C.np.maximum((1 - ao) * 1.15, (1 - sh) * 0.62), 0, 1)
val = 1 - dark
out = C.np.stack([val, val, val, C.np.ones_like(val)], -1).astype(C.np.float32)
img_sh.pixels.foreach_set(out.ravel())
p = os.path.join(C.TEX_DIR, "station_shadow.png")
C._save(img_sh, p)
img_sh.filepath = p
img_sh.source = "FILE"
img_sh.reload()
nt.nodes.remove(tn)
bpy.data.images.remove(img_sd)
b = nt.nodes["Principled BSDF"]
t2 = nt.nodes.new("ShaderNodeTexImage")
t2.image = img_sh
nt.links.new(t2.outputs["Color"], b.inputs["Base Color"])
ob_ground["a3d_decal"] = 1
ob_ground["a3d_cull"] = 200.0

lod1 = C.make_lod(game_ext, 0.35, "station_exterior_LOD1")
game_ext["a3d_lod_far"] = 70.0
lod1["a3d_lod_near"] = 70.0

# ------------------------------------------------------------------ export
for o in (ob_ext, ob_int):
    o.hide_render = True
export = [game_ext, lod1, game_int, ob_pow, ob_static, ob_beacon, ob_drill, ob_art, ob_glass, ob_door, ob_dish, ob_ground] + list(col_meta.objects)
root = bpy.data.objects.new("STATION_root", None)
col_game.objects.link(root)
root["a3d_model"] = "station"
root["a3d_floor"] = F
for o in export:
    o.parent = root
glb = os.path.join(C.GAME_MODELS, "station.glb")
size = C.export_glb([root] + export, glb)
stats = {o.name: C.tri_count(o) for o in export if o.type == "MESH"}
print("STATS", stats, "total_tris", sum(stats.values()), "glb_bytes", size)
C.save_blend("station")
