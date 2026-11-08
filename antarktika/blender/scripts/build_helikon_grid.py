"""HELIKON grid gallery — Chapter 5 ("İlk Temas"): the conduit under the hall's heat well.

Produces blender/source/helikon_grid.blend, blender/textures/grid_*.png and
ios/Antarktika/Game/models/helikon_grid.glb.

Story: the last aircraft of the season has left; the station's diesel will not last the winter.
The heat well in the Helikon hall is the top of a conduit: a carved gallery carrying geothermal
power from the lake basin. At its end the station's own 840 m drill borehole breaks through the
ceiling — the player lowers the station cable through it and couples the two networks.

Realism: paralleling two AC sources needs the same voltage, the same frequency and the same
phase sequence, and the breaker may only close when the synchroscope needle is near 12 o'clock
(phase angle ≈ 0). The three junctions set voltage / frequency / phase sequence; the coupling
panel is a synchroscope with a breaker. A wrong closure trips the protection relay (blackout).

Instanced interior (layer 'grid', state.inGrid), like the hall and the city.
  * shaft landing with a ladder up to the heat well          INT_grid_exit, INT_grid_spawn
  * 40 m gallery with glowing conduits on both walls
  * three junction pedestals (dial faces)                    INT_j1..3
  * coupling chamber: Helikon core, borehole casing + cable, INT_cable, INT_sync
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Vector  # noqa: E402
from PIL import Image, ImageDraw, ImageFilter  # noqa: E402

import a3d_common as C  # noqa: E402
import terrain as T  # noqa: E402

scene = C.reset_scene()
col_src = C.collection("SRC_procedural")
col_game = C.collection("GAME_export")
col_meta = C.collection("META_gameplay")

# ------------------------------------------------------------------ placement
HX, HZ = 80.0, -286.0     # inside the engine bounds (x ±295, z −352..105); 36 m under the plateau
ground = min(T.terrain_y(HX + dx, HZ + dz) for dx in range(-10, 11, 2) for dz in range(4, -62, -2))
FY = math.floor(ground) - 36.0
print("grid floor", FY, "ground min", round(ground, 2))
assert FY + 9.0 < ground, "gallery would break the surface"


def P(lx, ly, lz):
    return (HX + lx, FY + ly, HZ + lz)


W = 3.0                 # gallery half width
GH = 5.0                # gallery height
Z_LAND, Z_GAL, Z_CH, Z_END = 1.0, -4.0, -44.0, -58.0
CW, CH = 7.0, 7.5       # chamber half width, height
CORE = (0.0, -51.0)
BORE = (4.4, -47.6)     # station borehole casing (840 m from the surface)
PANEL = (-4.2, -57.0)   # coupling panel (synchroscope + breaker), faces +z
JUNCTIONS = [((-W + 0.45, -14.0), "x+"), ((W - 0.45, -24.0), "x-"), ((-W + 0.45, -34.0), "x+")]

M_GRID = [
    C.mat_rock("M_GridRock"),                                                                    # 0
    C.mat_ice("M_GridIce", deep=(0.02, 0.10, 0.18), light=(0.28, 0.55, 0.70), interior=True),     # 1
    C.mat_plain("M_GridStone", (0.30, 0.29, 0.27), rough=0.75, interior=True, noise=0.3),        # 2 carved stone
    C.mat_plain("M_GridBronze", (0.20, 0.16, 0.10), rough=0.45, metal=0.7, interior=True, noise=0.2),  # 3
    C.mat_painted_metal("M_GridSteel", (0.42, 0.44, 0.45), rough=0.4, metal=0.8, interior=True, spacing=0.6),  # 4 station kit
    C.mat_painted_metal("M_GridCabinet", (0.86, 0.62, 0.10), rough=0.5, metal=0.3, interior=True, spacing=0.5),  # 5 consortium yellow
]

bm = bmesh.new()

# ------------------------------------------------------------------ shaft landing
C.bm_box(bm, P(0, -0.3, (Z_LAND + Z_GAL) / 2), (2 * W, 0.6, Z_LAND - Z_GAL), mat_index=2)
C.bm_box(bm, P(0, 4.0, Z_LAND + 0.3), (2 * W + 1.2, 8.0, 0.6), mat_index=0)               # back wall
for side in (-1, 1):
    C.bm_box(bm, P(side * (W + 0.3), 4.0, (Z_LAND + Z_GAL) / 2), (0.6, 8.0, Z_LAND - Z_GAL + 0.6), mat_index=0)
# open shaft above (a ring of rock rising out of view) + warm glow from above
for k in range(12):
    a = k / 12 * math.tau
    C.bm_box(bm, P(1.6 * math.cos(a), 9.0, -1.4 + 1.6 * math.sin(a)), (0.9, 6.0, 0.9), yaw=a, mat_index=0)
C.bm_box(bm, P(0, GH + 0.25, -3.2), (2 * W, 0.5, 1.6), mat_index=0)                        # lintel into the gallery
# bronze ladder on the back wall
for side in (-1, 1):
    C.bm_box(bm, P(side * 0.45, 3.5, Z_LAND - 0.12), (0.08, 7.0, 0.08), mat_index=3)
for k in range(14):
    C.bm_box(bm, P(0, 0.4 + k * 0.5, Z_LAND - 0.12), (0.9, 0.05, 0.05), mat_index=3)

# ------------------------------------------------------------------ the gallery
L = Z_GAL - Z_CH
C.bm_box(bm, P(0, -0.3, (Z_GAL + Z_CH) / 2), (2 * W, 0.6, L), mat_index=2)                  # floor
for side in (-1, 1):
    C.bm_box(bm, P(side * (W + 0.3), GH / 2, (Z_GAL + Z_CH) / 2), (0.6, GH + 0.4, L), mat_index=0)
    C.bm_box(bm, P(side * (W - 0.15), 0.12, (Z_GAL + Z_CH) / 2), (0.3, 0.24, L), mat_index=2)   # kerb
# vault: two sloped roof planes meeting at the ridge
for side in (-1, 1):
    a, b = P(side * W, GH, Z_GAL), P(0, GH + 1.3, Z_GAL)
    c, d = P(0, GH + 1.3, Z_CH), P(side * W, GH, Z_CH)
    pts = [a, b, c, d] if side < 0 else [b, a, d, c]
    f = C.bm_quad(bm, pts, mat_index=0)
# bronze ribs every 4 m, and conduit brackets
for k in range(11):
    lz = Z_GAL - 0.5 - k * 3.9
    for side in (-1, 1):
        C.bm_box(bm, P(side * (W - 0.12), GH / 2, lz), (0.24, GH, 0.3), mat_index=3)
        C.bm_beam(bm, P(side * W, GH, lz), P(0, GH + 1.3, lz), 0.22, mat_index=3)
        for y in (1.0, 3.6):
            C.bm_box(bm, P(side * (W - 0.35), y, lz), (0.42, 0.12, 0.12), mat_index=3)
# junction pedestals (stone; their dial faces are emissive)
for (x, z), facing in JUNCTIONS:
    C.bm_box(bm, P(x, 0.7, z), (0.7, 1.4, 1.1), bevel=0.04, mat_index=2)
    C.bm_box(bm, P(x, 1.45, z), (0.8, 0.1, 1.2), mat_index=3)

# ------------------------------------------------------------------ coupling chamber
C.bm_box(bm, P(0, -0.3, (Z_CH + Z_END) / 2), (2 * CW, 0.6, Z_CH - Z_END), mat_index=2)
C.bm_box(bm, P(0, CH + 0.3, (Z_CH + Z_END) / 2), (2 * CW + 1.2, 0.6, Z_CH - Z_END + 1.2), mat_index=0)   # roof
C.bm_box(bm, P(0, CH / 2, Z_END - 0.3), (2 * CW + 1.2, CH + 0.6, 0.6), mat_index=0)                      # back wall
for side in (-1, 1):
    C.bm_box(bm, P(side * (CW + 0.3), CH / 2, (Z_CH + Z_END) / 2), (0.6, CH + 0.6, Z_CH - Z_END + 1.2), mat_index=0)
    C.bm_box(bm, P(side * (W + (CW - W) / 2), (GH + CH) / 2 + 0.6, Z_CH + 0.3), (CW - W, CH - GH + 1.2, 0.6), mat_index=0)  # front wall above / beside
    C.bm_box(bm, P(side * (W + (CW - W) / 2), GH / 2, Z_CH + 0.3), (CW - W, GH, 0.6), mat_index=0)
C.bm_box(bm, P(0, GH + 1.6, Z_CH + 0.3), (2 * W, CH - GH - 1.0, 0.6), mat_index=0)        # above the gallery mouth
# core plinth: stepped stone with bronze ring
C.bm_cylinder(bm, P(CORE[0], 0.0, CORE[1]), 2.4, 0.35, 32, mat_index=2)
C.bm_cylinder(bm, P(CORE[0], 0.35, CORE[1]), 1.8, 0.35, 32, mat_index=2)
C.bm_cylinder(bm, P(CORE[0], 0.7, CORE[1]), 1.25, 0.18, 32, mat_index=3)
# four conduit trunks from the gallery walls into the core plinth
for side in (-1, 1):
    C.bm_beam(bm, P(side * (W - 0.3), 1.0, Z_CH - 0.5), P(side * 1.6, 0.5, CORE[1] + 0.8), 0.32, mat_index=3)
# borehole casing: steel pipe from the ceiling, flange, cable spool, junction box
C.bm_cylinder(bm, P(BORE[0], 2.6, BORE[1]), 0.2, CH - 2.6 + 0.4, 16, mat_index=4)
C.bm_cylinder(bm, P(BORE[0], 2.45, BORE[1]), 0.34, 0.15, 16, mat_index=4)
C.bm_cylinder(bm, P(BORE[0], CH - 0.4, BORE[1]), 0.6, 0.4, 16, mat_index=0)               # broken ice/rock collar
C.bm_cylinder(bm, P(BORE[0] - 1.0, 0.0, BORE[1] + 1.0), 0.55, 0.12, 20, axis="Y", mat_index=4)   # spool base
C.bm_cylinder(bm, P(BORE[0] - 1.0, 0.12, BORE[1] + 1.0), 0.32, 0.7, 20, mat_index=5)              # spool drum (yellow)
C.bm_cylinder(bm, P(BORE[0] - 1.0, 0.82, BORE[1] + 1.0), 0.55, 0.08, 20, mat_index=4)
C.bm_box(bm, P(BORE[0] + 0.1, 0.5, BORE[1] + 1.4), (0.6, 1.0, 0.4), bevel=0.02, mat_index=5)      # junction box
# the coupling panel: a consortium-yellow cabinet, synchroscope face is emissive
C.bm_box(bm, P(PANEL[0], 1.1, PANEL[1] - 0.25), (2.2, 2.2, 0.6), bevel=0.03, mat_index=5)
C.bm_box(bm, P(PANEL[0], 2.25, PANEL[1] - 0.25), (2.3, 0.1, 0.7), mat_index=4)
# armoured cable along the floor from the spool to the panel
cable = [(BORE[0] - 1.0, BORE[1] + 1.6), (1.5, -55.4), (PANEL[0] + 1.2, -56.0)]
for (x0, z0), (x1, z1) in zip(cable, cable[1:]):
    C.bm_beam(bm, P(x0, 0.06, z0), P(x1, 0.06, z1), 0.09, mat_index=4)
# icicles from the chamber roof near the borehole (cold leaks down the casing)
rr = C.rng(505)
for _ in range(26):
    x, z = BORE[0] + rr.uniform(-2.4, 2.4), BORE[1] + rr.uniform(-2.4, 2.4)
    ln = rr.uniform(0.3, 1.6)
    C.bm_cylinder(bm, P(x, CH - ln, z), rr.uniform(0.004, 0.012), ln, 6, radius_top=rr.uniform(0.05, 0.16), mat_index=1)

ob_grid = C.mesh_object("SRC_grid", bm, M_GRID, col_src)

# ------------------------------------------------------------------ emissive atlas
DIALS = [("GERİLİM", ["230 V", "400 V", "690 V", "11 kV"]),
         ("FREKANS", ["3,17 Hz", "48 Hz", "50 Hz", "60 Hz"]),
         ("FAZ SIRASI", ["L1-L2-L3", "L1-L3-L2", "L2-L1-L3"])]
FONT = "/usr/share/fonts/opentype/inter/InterDisplay-Bold.otf"


def font(size):
    try:
        from PIL import ImageFont
        return ImageFont.truetype(FONT, size)
    except Exception:
        from PIL import ImageFont
        return ImageFont.load_default()


def build_atlas(path):
    img = Image.new("RGB", (1024, 512), (0, 0, 0))
    d = ImageDraw.Draw(img)
    for i, (name, opts) in enumerate(DIALS):            # junction dial faces: 180 x 300
        x0, y0, w, h = i * 200 + 10, 10, 180, 300
        d.rectangle([x0, y0, x0 + w, y0 + h], fill=(5, 16, 24))
        d.rectangle([x0 + 6, y0 + 6, x0 + w - 6, y0 + h - 6], outline=(60, 170, 190), width=2)
        d.text((x0 + w / 2, y0 + 30), name, font=font(20), fill=(150, 240, 255), anchor="mm")
        cx, cy, R = x0 + w / 2, y0 + 140, 62
        d.ellipse([cx - R, cy - R, cx + R, cy + R], outline=(90, 220, 240), width=3)
        for k, o in enumerate(opts):
            a = math.pi * (1.1 + 0.8 * k / (len(opts) - 1))
            d.line([cx + (R - 10) * math.cos(a), cy + (R - 10) * math.sin(a), cx + R * math.cos(a), cy + R * math.sin(a)], fill=(150, 240, 255), width=3)
        d.ellipse([cx - 8, cy - 8, cx + 8, cy + 8], fill=(255, 200, 120))
        for k, o in enumerate(opts):
            d.text((x0 + w / 2, y0 + 222 + k * 18), o, font=font(14), fill=(110, 200, 220), anchor="mm")
    # synchroscope panel: 380 x 300
    x0, y0, w, h = 620, 10, 380, 300
    d.rectangle([x0, y0, x0 + w, y0 + h], fill=(10, 14, 16))
    d.rectangle([x0 + 6, y0 + 6, x0 + w - 6, y0 + h - 6], outline=(200, 200, 190), width=2)
    d.text((x0 + 100, y0 + 30), "SENKRONOSKOP", font=font(18), fill=(235, 235, 220), anchor="mm")
    cx, cy, R = x0 + 100, y0 + 150, 80
    d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=(18, 22, 24), outline=(220, 220, 210), width=3)
    for k in range(24):
        a = k / 24 * math.tau
        r0 = R - (16 if k % 6 == 0 else 8)
        d.line([cx + r0 * math.sin(a), cy - r0 * math.cos(a), cx + R * math.sin(a), cy - R * math.cos(a)], fill=(220, 220, 210), width=2)
    d.pieslice([cx - R + 4, cy - R + 4, cx + R - 4, cy + R - 4], 255, 285, fill=(40, 160, 60))
    d.text((cx - 50, cy + R + 22), "YAVAŞ", font=font(13), fill=(200, 200, 190), anchor="mm")
    d.text((cx + 50, cy + R + 22), "HIZLI", font=font(13), fill=(200, 200, 190), anchor="mm")
    for k, (lab, col) in enumerate((("İSTASYON", (255, 196, 90)), ("HELIKON", (120, 230, 255)), ("ŞALTER", (255, 90, 70)))):
        yy = y0 + 70 + k * 72
        d.rectangle([x0 + 222, yy, x0 + 360, yy + 52], outline=(200, 200, 190), width=2)
        d.ellipse([x0 + 232, yy + 14, x0 + 256, yy + 38], fill=col)
        d.text((x0 + 310, yy + 26), lab, font=font(14), fill=(230, 230, 220), anchor="mm")
    glow = img.filter(ImageFilter.GaussianBlur(4))
    img = Image.blend(img, glow, 0.3)
    # core glow (radial)
    core = Image.new("RGB", (190, 190), (0, 0, 0))
    for y in range(190):
        for x in range(190):
            r = math.hypot(x - 95, y - 95) / 95.0
            k = max(0.0, 1.0 - r) ** 2.0
            core.putpixel((x, y), (int(110 * k), int(230 * k), int(255 * k)))
    img.paste(core, (10, 322))
    d = ImageDraw.Draw(img)
    for i, c in enumerate([(70, 220, 255), (255, 150, 60), (255, 196, 110), (235, 250, 255), (190, 130, 255), (255, 60, 40)]):
        d.rectangle([224 + i * 128, 432, 224 + i * 128 + 127, 511], fill=c)
    img.save(path)


atlas_path = os.path.join(C.TEX_DIR, "grid_emissive.png")
build_atlas(atlas_path)
M_EMI = C.mat_emissive("GM_GridEmissive", (1, 1, 1), 2.4, bpy.data.images.load(atlas_path))
SW = {k: ((224 + i * 128 + 64) / 1024, 1 - 472 / 512) for i, k in enumerate(["cyan", "amber", "gold", "white", "violet", "red"])}


def emi(name, builder, **props):
    b = bmesh.new()
    b.loops.layers.uv.new("UVMap")
    builder(b)
    ob = C.mesh_object(name, b, M_EMI, col_game)
    for k, v in props.items():
        ob[k] = v
    return ob


def uvl(b):
    return b.loops.layers.uv.active


def quad_uv(b, pts, rect):
    f = C.bm_quad(b, pts)
    u0, v0, u1, v1 = rect[0] / 1024, 1 - rect[3] / 512, rect[2] / 1024, 1 - rect[1] / 512
    for loop, c in zip(f.loops, [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]):
        loop[uvl(b)].uv = c


def solid(b, faces, colour):
    u, v = SW[colour]
    for f in faces:
        for loop in f.loops:
            loop[uvl(b)].uv = (u, v)


def box_emi(b, centre, size, colour, yaw=0.0):
    vs = C.bm_box(b, centre, size, yaw=yaw)
    solid(b, {f for v in vs for f in v.link_faces}, colour)


emissive = []


def b_conduits(b):
    for side in (-1, 1):
        for y, col in ((1.0, "cyan"), (3.6, "amber")):
            box_emi(b, P(side * (W - 0.42), y, (Z_GAL + Z_CH) / 2 - 0.2), (0.16, 0.16, L - 0.6), col)
    for side in (-1, 1):   # trunks into the core
        vs = C.bm_beam(b, P(side * (W - 0.3), 1.0, Z_CH - 0.5), P(side * 1.6, 0.62, CORE[1] + 0.8), 0.12)
        solid(b, {f for v in vs for f in v.link_faces}, "cyan")


emissive.append(emi("CONDUITS", b_conduits, a3d_group="conduit", a3d_pulse=0.35, a3d_cull=90.0))

for i, ((x, z), facing) in enumerate(JUNCTIONS):
    fx = x + (0.36 if facing == "x+" else -0.36)
    z0, z1 = (z + 0.45, z - 0.45) if facing == "x+" else (z - 0.45, z + 0.45)
    pts = [P(fx, 0.3, z0), P(fx, 0.3, z1), P(fx, 1.35, z1), P(fx, 1.35, z0)]
    rect = (i * 200 + 10, 10, i * 200 + 190, 310)
    emissive.append(emi("DIAL_j%d" % (i + 1), lambda b, pts=pts, rect=rect: quad_uv(b, pts, rect), a3d_group="j%d" % (i + 1), a3d_scan=1, a3d_cull=60.0))


def b_panel(b):
    z = PANEL[1] + 0.06
    quad_uv(b, [P(PANEL[0] - 1.0, 0.35, z), P(PANEL[0] + 1.0, 0.35, z), P(PANEL[0] + 1.0, 1.95, z), P(PANEL[0] - 1.0, 1.95, z)], (620, 10, 1000, 310))


emissive.append(emi("SYNC_PANEL", b_panel, a3d_group="sync", a3d_cull=60.0))


def b_core(b):
    r = C.rng(17)
    for n in range(9):
        h = 3.4 if n == 0 else r.uniform(1.0, 2.4)
        rad = 0.32 if n == 0 else r.uniform(0.1, 0.22)
        tilt = Vector((r.uniform(-0.35, 0.35), r.uniform(-0.35, 0.35), 1)).normalized() if n else Vector((0, 0, 1))
        base = Vector(C.G(*P(CORE[0] + (r.uniform(-0.6, 0.6) if n else 0), 0.85, CORE[1] + (r.uniform(-0.6, 0.6) if n else 0))))
        side = tilt.orthogonal().normalized()
        side2 = tilt.cross(side)
        ring = [b.verts.new(base + (side * math.cos(a) + side2 * math.sin(a)) * rad) for a in [k * math.tau / 6 for k in range(6)]]
        top = [b.verts.new(v.co + tilt * h * 0.8) for v in ring]
        tip = b.verts.new(base + tilt * h)
        faces = []
        for k in range(6):
            faces.append(b.faces.new((ring[k], ring[(k + 1) % 6], top[(k + 1) % 6], top[k])))
            faces.append(b.faces.new((top[k], top[(k + 1) % 6], tip)))
        solid(b, faces, "cyan" if n % 3 else "white")
    # soft glow disc on the plinth top
    quad_uv(b, [P(CORE[0] - 1.6, 0.89, CORE[1] + 1.6), P(CORE[0] + 1.6, 0.89, CORE[1] + 1.6), P(CORE[0] + 1.6, 0.89, CORE[1] - 1.6), P(CORE[0] - 1.6, 0.89, CORE[1] - 1.6)], (12, 324, 198, 510))


emissive.append(emi("CORE", b_core, a3d_group="core", a3d_pulse=0.4, a3d_cull=90.0))


def b_cable_lamp(b):   # status lamp on the junction box: red until the cable is coupled
    box_emi(b, P(BORE[0] + 0.1, 1.06, BORE[1] + 1.62), (0.12, 0.12, 0.05), "red")


emissive.append(emi("CABLE_LAMP", b_cable_lamp, a3d_group="cablelamp", a3d_cull=40.0))


def b_shaftglow(b):    # warm light from the heat well far above
    quad_uv(b, [P(-1.4, 11.9, -2.8), P(1.4, 11.9, -2.8), P(1.4, 11.9, 0.0), P(-1.4, 11.9, 0.0)], (12, 324, 198, 510))


emissive.append(emi("SHAFT_GLOW", b_shaftglow, a3d_cull=60.0))

# ------------------------------------------------------------------ gameplay metadata
cm = col_meta
C.volume("grid", P(0, 4.0, -28.0), (CW + 1, 8.0, 31.0), "grid", col=cm)
C.floor("landing_gallery", P(0, -0.25, (Z_LAND + Z_CH) / 2), (W, 0.25, (Z_LAND - Z_CH) / 2), col=cm)
C.floor("chamber", P(0, -0.25, (Z_CH + Z_END) / 2), (CW, 0.25, (Z_CH - Z_END) / 2), col=cm)
for side in (-1, 1):
    C.collider("gal_wall_%d" % side, P(side * (W + 0.2), 0, (Z_LAND + Z_CH) / 2), (0.25, 4, (Z_LAND - Z_CH) / 2), col=cm)
    C.collider("ch_wall_%d" % side, P(side * (CW + 0.2), 0, (Z_CH + Z_END) / 2), (0.25, 4, (Z_CH - Z_END) / 2), col=cm)
    C.collider("ch_front_%d" % side, P(side * (W + CW) / 2, 0, Z_CH + 0.2), ((CW - W) / 2 + 0.2, 4, 0.25), col=cm)
C.collider("land_back", P(0, 0, Z_LAND + 0.2), (W, 4, 0.25), col=cm)
C.collider("ch_back", P(0, 0, Z_END - 0.2), (CW, 4, 0.25), col=cm)
for i, ((x, z), facing) in enumerate(JUNCTIONS):
    C.collider("junction%d" % (i + 1), P(x, 0, z), (0.4, 4, 0.6), col=cm)
C.collider("core", P(CORE[0], 0, CORE[1]), (2.0, 4, 2.0), col=cm)
C.collider("bore", P(BORE[0] - 0.4, 0, BORE[1] + 0.6), (0.9, 4, 1.1), col=cm)
C.collider("panel", P(PANEL[0], 0, PANEL[1] - 0.25), (1.15, 4, 0.35), col=cm)
# anchors
C.anchor("grid_exit", P(0, 0, Z_LAND - 0.7), cm, a3d_id="grid_exit", a3d_radius=1.8, a3d_label="MERDİVEN · ISI KUYUSU")
C.anchor("grid_spawn", P(0, 0, -2.6), cm, a3d_id="grid_spawn", a3d_radius=0.1, a3d_label="")
for i, ((x, z), facing) in enumerate(JUNCTIONS):
    C.anchor("j%d" % (i + 1), P(x + (1.2 if facing == "x+" else -1.2), 0, z), cm, a3d_id="j%d" % (i + 1), a3d_radius=1.9,
             a3d_label="BAĞLANTI DÜĞÜMÜ · " + DIALS[i][0])
C.anchor("cable", P(BORE[0] - 0.6, 0, BORE[1] + 2.6), cm, a3d_id="cable", a3d_radius=2.0, a3d_label="İSTASYON KABLOSU · SONDAJ KUYUSU")
C.anchor("sync", P(PANEL[0], 0, PANEL[1] + 1.4), cm, a3d_id="sync", a3d_radius=1.9, a3d_label="SENKRONOSKOP · ŞALTER")
C.anchor("core", P(CORE[0], 0, CORE[1] + 2.9), cm, a3d_id="core", a3d_radius=1.6, a3d_label="HELIKON ÇEKİRDEĞİ")
# lights
for name, pos, colour, inten, rng_m, flick, group in (
    ("shaft", P(0, 6.0, -1.2), (1.0, 0.6, 0.3), 1.0, 10.0, 0.15, None),
    ("gal_a", P(0, 3.4, -12.0), (0.4, 0.85, 1.0), 1.1, 12.0, 0.0, "conduit"),
    ("gal_b", P(0, 3.4, -24.0), (0.4, 0.85, 1.0), 1.1, 12.0, 0.0, "conduit"),
    ("gal_c", P(0, 3.4, -36.0), (0.4, 0.85, 1.0), 1.1, 12.0, 0.0, "conduit"),
    ("core", P(CORE[0], 3.0, CORE[1]), (0.5, 0.9, 1.0), 1.8, 16.0, 0.0, "core"),
    ("panel", P(PANEL[0], 2.6, PANEL[1] + 1.4), (1.0, 0.9, 0.7), 0.9, 7.0, 0.0, None),
    ("bore", P(BORE[0], 2.2, BORE[1] + 0.8), (0.8, 0.9, 1.0), 0.6, 6.0, 0.0, None),
):
    e = C.light(name, pos, colour, inten, rng_m, cm, flick)
    if group:
        e["a3d_group"] = group

# ------------------------------------------------------------------ bake + export
game = C.join_copies([ob_grid], "grid_interior", col_game)
ob_grid.hide_render = True
C.unwrap(game, margin=0.002)
C.bake_atlas(game, "grid_interior", 2048, ao_distance=4.0, ao_samples=48, interior=True, extra_props={"a3d_zone": "grid"})
game["a3d_cull"] = 160.0

export = [game] + emissive + list(col_meta.objects)
root = bpy.data.objects.new("GRID_root", None)
col_game.objects.link(root)
root["a3d_model"] = "helikon_grid"
for o in export:
    o.parent = root
glb = os.path.join(C.GAME_MODELS, "helikon_grid.glb")
size = C.export_glb([root] + export, glb)
stats = {o.name: C.tri_count(o) for o in export if o.type == "MESH"}
print("STATS", stats, "total_tris", sum(stats.values()), "glb_bytes", size, "FY", FY, "HX", HX, "HZ", HZ)
C.save_blend("helikon_grid")
