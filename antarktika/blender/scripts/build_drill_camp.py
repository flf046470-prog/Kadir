"""Coalition drill camp — Chapter 6 ("Kış Ablukası"): an ice cavern above the Helikon lake.

Produces blender/source/drill_camp.blend, blender/textures/camp_*.png and
ios/Antarktika/Game/models/drill_camp.glb.

Story: June, polar night. The emergency coalition has airdropped a drilling team. Their borehole
broke into an ice cavern ~35 m under the plateau, a few hundred metres from the lake basin. To reach
the water fast they use a kerosene-based drilling fluid (the fluid that filled the real Vostok
borehole was kerosene + HCFC-141b; the clean alternative, hot-water drilling as at Lake Whillans,
is slower). If it reaches the lake, the Helikon city dies. The player is unarmed:
  * thermal drones patrol the cavern; the warmer the body, the farther they see it
  * snow-block windbreaks are cover
  * stop the fluid pump, silence the satellite relay, decide what to do with a hypothermic soldier

Instanced interior (layer 'camp', state.inCamp), like the other chapters.
  * Helikon tunnel in the south wall                         INT_camp_exit, INT_camp_spawn
  * ice dome, packed-snow floor, borehole + drill tower, fluid tanks, pump skid   INT_pump
  * three accommodation containers (lit windows), relay cabinet + mast            INT_relay
  * a coalition soldier slumped against a crate (posed crew model)               INT_soldier
  * snow-block windbreaks (VOL_ zone 'cover'), two drones (a3d_drone 1 / 2)
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Matrix, Quaternion, Vector, noise  # noqa: E402
from PIL import Image, ImageDraw, ImageFilter  # noqa: E402

import a3d_common as C  # noqa: E402
import terrain as T  # noqa: E402

scene = C.reset_scene()
col_src = C.collection("SRC_procedural")
col_game = C.collection("GAME_export")
col_meta = C.collection("META_gameplay")

# ------------------------------------------------------------------ placement (inside engine bounds x ±295, z −352..105)
HX, HZ = -60.0, -288.0
ground = min(T.terrain_y(HX + dx, HZ + dz) for dx in range(-26, 27, 2) for dz in range(4, -56, -2))
FY = math.floor(ground) - 35.0
DC, RX, RZ, RY = -28.0, 22.0, 24.0, 10.0
print("camp floor", FY, "ground min", round(ground, 2))
assert FY + RY + 4.0 < ground, "cavern would break the surface"


def P(lx, ly, lz):
    return (HX + lx, FY + ly, HZ + lz)


BORE = (5.0, -28.0)
PUMP = (9.0, -23.0)
RELAY = (-17.0, -40.0)
SOLDIER = (15.0, -14.5)
CONTAINERS = [((-12.0, -15.0), 0.0), ((-14.0, -31.0), math.pi / 2), ((13.0, -41.0), 0.0)]
WINDBREAKS = [((-4.5, -12.0), 0.0), ((3.5, -20.5), 0.0), ((-4.0, -27.0), math.pi / 2), ((-9.0, -37.5), 0.0), ((4.5, -38.0), 0.0)]
DRONES = [[(2.0, -17.0), (15.0, -17.0), (15.0, -30.0), (2.0, -30.0)],
          [(-19.0, -24.0), (-6.0, -24.0), (-6.0, -46.0), (-19.0, -46.0)]]
DRONE_Y = 4.6

M_CAMP = [
    C.mat_ice("M_CampIce", deep=(0.04, 0.16, 0.26), light=(0.45, 0.70, 0.82), interior=True),   # 0 cavern ice
    C.mat_snow("M_CampSnow", interior=True),                                                     # 1 packed snow
    C.mat_painted_metal("M_CampContainer", (0.70, 0.72, 0.68), rough=0.55, metal=0.3, interior=True, spacing=0.4),  # 2 winter grey
    C.mat_painted_metal("M_CampOlive", (0.30, 0.33, 0.22), rough=0.6, metal=0.35, interior=True, spacing=0.6),       # 3 olive kit
    C.mat_plain("M_CampSteel", (0.45, 0.46, 0.47), rough=0.35, metal=0.85, interior=True, noise=0.15),              # 4 steel
    C.mat_plain("M_CampRubber", (0.04, 0.04, 0.045), rough=0.8, interior=True),                                    # 5 hose / rubber
    C.mat_painted_metal("M_CampTank", (0.62, 0.20, 0.12), rough=0.5, metal=0.4, interior=True, spacing=0.8),        # 6 fluid tanks (hazard red)
]

bm = bmesh.new()

# ------------------------------------------------------------------ ice dome (inward), floor, entry tunnel
SEG_U, SEG_V = 40, 12
rows = []
for j in range(SEG_V + 1):
    phi = j / SEG_V * (math.pi / 2)
    row = []
    for i in range(SEG_U):
        th = i / SEG_U * math.tau
        n = noise.noise(Vector((math.cos(th) * 1.7, math.sin(th) * 1.7, phi * 2.6)))
        s = 1.0 + 0.07 * n * (1.0 - j / SEG_V)
        row.append((RX * math.cos(phi) * math.cos(th) * s, -0.6 + RY * math.sin(phi) * (1.0 + 0.05 * n), DC + RZ * math.cos(phi) * math.sin(th) * s))
    rows.append(row)
verts = [[bm.verts.new(C.G(*P(*p))) for p in row] for row in rows]
centre_b = Vector(C.G(*P(0.0, 3.0, DC)))
for j in range(SEG_V):
    for i in range(SEG_U):
        a, b, c, d = verts[j][i], verts[j][(i + 1) % SEG_U], verts[j + 1][(i + 1) % SEG_U], verts[j + 1][i]
        mid = (Vector(a.co) + Vector(c.co)) / 2
        lx, lz, ly = mid.x - HX, -mid.y - HZ, mid.z - FY
        if abs(lx) < 2.6 and ly < 4.2 and lz > DC + RZ - 3:      # tunnel mouth in the south wall
            continue
        f = bm.faces.new((a, b, c, d))
        f.smooth = True
        f.material_index = 0
        f.normal_update()
        if f.normal.dot(centre_b - f.calc_center_median()) < 0:
            f.normal_flip()
C.bm_box(bm, P(0, -0.3, DC), (2 * RX + 2, 0.6, 2 * RZ + 2), mat_index=1)               # packed snow floor
C.bm_box(bm, P(0, -0.3, -1.5), (4.2, 0.6, 9.0), mat_index=0)                             # tunnel floor (Helikon ice)
for side in (-1, 1):
    C.bm_box(bm, P(side * 2.3, 2.0, -1.5), (0.6, 4.4, 9.0), mat_index=0)
C.bm_box(bm, P(0, 4.3, -1.5), (5.2, 0.4, 9.0), mat_index=0)
C.bm_box(bm, P(0, 2.0, 3.1), (5.2, 4.4, 0.4), mat_index=0)

# ------------------------------------------------------------------ containers (accommodation / generator modules)
CONT = (6.06, 2.59, 2.44)   # ISO 20 ft


def cont_box(pos, yaw, mat=2):
    (x, z) = pos
    C.bm_box(bm, P(x, CONT[1] / 2, z), (CONT[0], CONT[1], CONT[2]), yaw=yaw, bevel=0.03, mat_index=mat)
    for k in (-1, 1):   # corrugation ribs on the long sides
        for r in range(9):
            t = -CONT[0] / 2 + 0.4 + r * 0.66
            ox, oz = math.cos(yaw) * t - math.sin(yaw) * k * (CONT[2] / 2 + 0.02), math.sin(yaw) * t + math.cos(yaw) * k * (CONT[2] / 2 + 0.02)
            C.bm_box(bm, P(x + ox, CONT[1] / 2, z + oz), (0.08, CONT[1] - 0.2, 0.04), yaw=yaw, mat_index=mat)


for pos, yaw in CONTAINERS:
    cont_box(pos, yaw)
    C.bm_box(bm, P(pos[0], 0.12, pos[1]), (CONT[0] + 0.6, 0.24, CONT[2] + 0.6), yaw=yaw, mat_index=3)   # skid frame

# ------------------------------------------------------------------ drill tower over the borehole, hose drum, fluid tanks, pump
bx, bz = BORE
for dx in (-0.9, 0.9):
    for dz in (-0.9, 0.9):
        C.bm_beam(bm, P(bx + dx, 0.0, bz + dz), P(bx + dx * 0.3, 7.4, bz + dz * 0.3), 0.12, mat_index=3)
for h in (1.5, 3.2, 4.9):
    s = 1.0 - h / 7.4 * 0.7
    for (ax, az), (cx, cz) in (((-1, -1), (1, -1)), ((1, -1), (1, 1)), ((1, 1), (-1, 1)), ((-1, 1), (-1, -1))):
        C.bm_beam(bm, P(bx + ax * 0.9 * s, h, bz + az * 0.9 * s), P(bx + cx * 0.9 * s, h, bz + cz * 0.9 * s), 0.07, mat_index=3)
C.bm_box(bm, P(bx, 7.5, bz), (1.0, 0.4, 1.0), mat_index=4)                              # crown block
C.bm_cylinder(bm, P(bx, 0.0, bz), 0.95, 0.35, 24, mat_index=4)                           # wellhead collar
C.bm_cylinder(bm, P(bx, 0.35, bz), 0.16, 7.2, 12, mat_index=5)                           # drill hose / pipe
C.bm_cylinder(bm, P(bx - 2.6, 0.9, bz + 0.0), 0.9, 1.5, 24, axis="Z", mat_index=5)        # hose drum
for k in (-1, 1):
    C.bm_box(bm, P(bx - 2.6, 0.55, bz + k * 0.85), (0.2, 1.1, 0.1), mat_index=3)
for k, tz in enumerate((-30.5, -34.0)):                                                   # drilling-fluid tanks (horizontal)
    C.bm_cylinder(bm, P(10.0, 1.1, tz - 0.0), 0.95, 4.2, 24, axis="X", mat_index=6)
    for e in (-1.5, 1.5):
        C.bm_box(bm, P(10.0 + e + 2.1, 0.5, tz), (0.25, 1.0, 1.4), mat_index=3)
C.bm_beam(bm, P(12.2, 1.1, -30.5), P(PUMP[0] + 0.8, 0.6, PUMP[1] - 0.6), 0.12, mat_index=5)    # feed hose tank -> pump
C.bm_beam(bm, P(PUMP[0] - 0.8, 0.6, PUMP[1] - 0.4), P(bx + 0.6, 0.35, bz + 0.5), 0.12, mat_index=5)  # pump -> wellhead
px_, pz_ = PUMP
C.bm_box(bm, P(px_, 0.15, pz_), (2.6, 0.3, 1.5), mat_index=3)                            # skid
C.bm_box(bm, P(px_ - 0.4, 0.8, pz_), (1.4, 1.0, 1.1), bevel=0.04, mat_index=3)            # diesel engine
C.bm_cylinder(bm, P(px_ + 0.75, 0.75, pz_), 0.38, 0.9, 16, axis="X", mat_index=4)          # triplex pump body
C.bm_cylinder(bm, P(px_ - 0.6, 1.3, pz_ - 0.3), 0.06, 0.9, 8, mat_index=4)                 # exhaust
C.bm_cylinder(bm, P(px_ + 1.0, 0.6, pz_ + 0.9), 0.3, 0.05, 16, axis="Z", mat_index=6)      # red valve wheel (front)

# ------------------------------------------------------------------ relay: satellite terminal cabinet + mast up through a ceiling bore
rx_, rz_ = RELAY
C.bm_box(bm, P(rx_, 0.8, rz_), (0.9, 1.6, 0.7), bevel=0.03, mat_index=3)
C.bm_cylinder(bm, P(rx_ - 0.7, 0.0, rz_ - 0.2), 0.07, 8.8, 8, mat_index=4)
C.bm_cylinder(bm, P(rx_ - 0.7, 6.2, rz_ - 0.2), 0.45, 0.08, 16, mat_index=4)                # small dish
C.bm_beam(bm, P(rx_, 1.6, rz_), P(rx_ - 0.7, 3.0, rz_ - 0.2), 0.04, mat_index=5)

# ------------------------------------------------------------------ soldier's spot: supply crate, fallen sled
sx_, sz_ = SOLDIER
C.bm_box(bm, P(sx_ + 0.9, 0.55, sz_ + 0.2), (1.2, 1.1, 1.0), bevel=0.02, mat_index=3)
C.bm_box(bm, P(sx_ - 1.6, 0.18, sz_ + 1.2), (2.4, 0.12, 0.8), yaw=0.4, mat_index=6)        # pulk sled

# ------------------------------------------------------------------ snow-block windbreaks (cover)
for (x, z), yaw in WINDBREAKS:
    for k in range(5):
        for r in range(3):
            t = -1.6 + k * 0.8 + (0.4 if r % 2 else 0.0)
            if t > 1.6:
                continue
            ox, oz = math.cos(yaw) * t, math.sin(yaw) * t
            C.bm_box(bm, P(x + ox, 0.25 + r * 0.5, z + oz), (0.76, 0.48, 0.5), yaw=yaw, mat_index=1)

# icicles from the dome
rr = C.rng(606)
for _ in range(80):
    th = rr.uniform(0, math.tau)
    rad = math.sqrt(rr.uniform(0.05, 0.8))
    x, z = RX * rad * math.cos(th), DC + RZ * rad * math.sin(th)
    ytop = -0.6 + RY * math.sqrt(max(0.0, 1 - (x / RX) ** 2 - ((z - DC) / RZ) ** 2)) - 0.2
    ln = rr.uniform(0.4, 2.0)
    C.bm_cylinder(bm, P(x, ytop - ln, z), rr.uniform(0.004, 0.012), ln, 6, radius_top=rr.uniform(0.06, 0.2), mat_index=0)

ob_camp = C.mesh_object("SRC_camp", bm, M_CAMP, col_src)

# ------------------------------------------------------------------ emissive atlas: windows, swatches, borehole glow, drone eye
FONT = "/usr/share/fonts/opentype/inter/InterDisplay-Bold.otf"


def build_atlas(path):
    from PIL import ImageFont
    img = Image.new("RGB", (1024, 512), (0, 0, 0))
    d = ImageDraw.Draw(img)
    # container window (warm, with a blind)
    d.rectangle([10, 10, 190, 130], fill=(255, 196, 120))
    for k in range(5):
        d.rectangle([10, 14 + k * 24, 190, 22 + k * 24], fill=(200, 140, 80))
    # relay screen
    d.rectangle([210, 10, 390, 130], fill=(10, 30, 20))
    f = ImageFont.truetype(FONT, 18)
    d.text((300, 40), "IRIDIUM", font=f, fill=(120, 255, 160), anchor="mm")
    d.text((300, 80), "UPLINK ▮▮▮▮", font=f, fill=(120, 255, 160), anchor="mm")
    # pump panel
    d.rectangle([410, 10, 590, 130], fill=(30, 26, 10))
    d.text((500, 40), "FLUID", font=f, fill=(255, 200, 80), anchor="mm")
    d.text((500, 80), "38 bar", font=f, fill=(255, 200, 80), anchor="mm")
    # radial glows: borehole (cold blue) at (610,10), drone floodlight (white) at (810,10)
    for ox, col in ((610, (120, 200, 255)), (810, (235, 245, 255))):
        g = Image.new("RGB", (190, 190), (0, 0, 0))
        for y in range(190):
            for x in range(190):
                r = math.hypot(x - 95, y - 95) / 95.0
                k = max(0.0, 1.0 - r) ** 1.6
                g.putpixel((x, y), tuple(int(c * k) for c in col))
        img.paste(g, (ox, 10))
    glow = img.filter(ImageFilter.GaussianBlur(3))
    img = Image.blend(img, glow, 0.25)
    d = ImageDraw.Draw(img)
    for i, c in enumerate([(255, 40, 30), (255, 196, 120), (120, 255, 160), (235, 245, 255), (90, 220, 255), (255, 150, 40)]):
        d.rectangle([i * 128, 432, i * 128 + 127, 511], fill=c)
    img.save(path)


atlas_path = os.path.join(C.TEX_DIR, "camp_emissive.png")
build_atlas(atlas_path)
M_EMI = C.mat_emissive("GM_CampEmissive", (1, 1, 1), 2.2, bpy.data.images.load(atlas_path))
SW = {k: ((i * 128 + 64) / 1024, 1 - 472 / 512) for i, k in enumerate(["red", "warm", "green", "white", "cyan", "amber"])}


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


def b_windows(b):
    for (x, z), yaw in CONTAINERS:
        # two windows on the long side facing the cavern centre
        nx, nz = -math.sin(yaw), math.cos(yaw)
        if (0 - x) * nx + (DC - z) * nz < 0:
            nx, nz = -nx, -nz
        tx, tz = math.cos(yaw), math.sin(yaw)
        for t in (-1.4, 1.4):
            cx, cz = x + tx * t + nx * (CONT[2] / 2 + 0.05), z + tz * t + nz * (CONT[2] / 2 + 0.05)
            hw = 0.55
            a = P(cx - tx * hw, 1.1, cz - tz * hw)
            bq = P(cx + tx * hw, 1.1, cz + tz * hw)
            c = P(cx + tx * hw, 1.9, cz + tz * hw)
            dd = P(cx - tx * hw, 1.9, cz - tz * hw)
            pts = [a, bq, c, dd]
            # face outward: order so the normal points along (nx, nz)
            if (tx * nz - tz * nx) > 0:
                pts = [bq, a, dd, c]
            quad_uv(b, pts, (10, 10, 190, 130))


emissive.append(emi("CONT_WINDOWS", b_windows, a3d_cull=90.0))


def b_bore(b):
    quad_uv(b, [P(BORE[0] - 0.8, 0.36, BORE[1] + 0.8), P(BORE[0] + 0.8, 0.36, BORE[1] + 0.8), P(BORE[0] + 0.8, 0.36, BORE[1] - 0.8), P(BORE[0] - 0.8, 0.36, BORE[1] - 0.8)], (612, 12, 798, 198))


emissive.append(emi("BORE_GLOW", b_bore, a3d_group="bore", a3d_pulse=0.4, a3d_cull=80.0))


def b_pump_panel(b):
    x, z = PUMP[0] + 1.32, PUMP[1]
    quad_uv(b, [P(x, 0.45, z + 0.5), P(x, 0.45, z - 0.5), P(x, 1.05, z - 0.5), P(x, 1.05, z + 0.5)], (410, 10, 590, 130))
    box_emi(b, P(PUMP[0] - 0.4, 1.38, PUMP[1] + 0.5), (0.1, 0.1, 0.1), "amber")   # running lamp


emissive.append(emi("PUMP_PANEL", b_pump_panel, a3d_group="pump", a3d_cull=60.0))


def b_relay_screen(b):
    x, z = RELAY[0] + 0.46, RELAY[1]
    quad_uv(b, [P(x, 0.9, z + 0.3), P(x, 0.9, z - 0.3), P(x, 1.4, z - 0.3), P(x, 1.4, z + 0.3)], (210, 10, 390, 130))
    box_emi(b, P(RELAY[0] - 0.7, 8.85, RELAY[1] - 0.2), (0.12, 0.12, 0.12), "red")   # mast beacon


emissive.append(emi("RELAY_SCREEN", b_relay_screen, a3d_group="relay", a3d_cull=60.0))


def drone_mesh(b, x, z):
    """Quadcopter (~1.1 m span) with a downward floodlight disc; built at its patrol start."""
    y = DRONE_Y
    vs = C.bm_box(b, P(x, y, z), (0.42, 0.16, 0.42))
    solid(b, {f for v in vs for f in v.link_faces}, "white")
    for ax, az in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
        vs = C.bm_beam(b, P(x, y, z), P(x + ax * 0.42, y + 0.02, z + az * 0.42), 0.05)
        solid(b, {f for v in vs for f in v.link_faces}, "white")
        vs = C.bm_cylinder(b, P(x + ax * 0.42, y + 0.06, z + az * 0.42), 0.2, 0.02, 12)
        solid(b, {f for v in vs for f in v.link_faces}, "white")
    box_emi(b, P(x, y - 0.12, z), (0.12, 0.08, 0.12), "red")          # thermal camera eye
    box_emi(b, P(x + 0.2, y + 0.09, z), (0.05, 0.05, 0.05), "green")  # nav light
    # floodlight spot on the snow (6 m wide)
    quad_uv(b, [P(x - 3.0, 0.03, z + 3.0), P(x + 3.0, 0.03, z + 3.0), P(x + 3.0, 0.03, z - 3.0), P(x - 3.0, 0.03, z - 3.0)], (812, 12, 998, 198))


for i, path in enumerate(DRONES):
    emissive.append(emi("DRONE_%d" % (i + 1), lambda b, p=path[0]: drone_mesh(b, p[0], p[1]), a3d_drone=i + 1, a3d_group="drone%d" % (i + 1), a3d_cull=90.0))

# ------------------------------------------------------------------ gameplay metadata
cm = col_meta
C.volume("camp", P(0, 4.0, DC + 1.0), (RX + 1, 8.0, RZ + 5.0), "camp", col=cm)
for i, ((x, z), yaw) in enumerate(WINDBREAKS):   # crouch behind the wall: a 3.4 x 1.4 m strip on both sides
    C.volume("cover%d" % i, P(x, 1.0, z), (1.7, 1.0, 1.0), "cover", col=cm, yaw=yaw)
C.floor("cavern", P(0, -0.25, DC), (RX, 0.25, RZ), col=cm)
C.floor("tunnel", P(0, -0.25, -1.0), (1.9, 0.25, 4.0), col=cm)
# colliders (the dome rim is an ellipse clamp in a3d.js: centre (0, DC), radii RX-1.2, RZ-1.2)
for side in (-1, 1):
    C.collider("tunnel_%d" % side, P(side * 2.1, 0, -1.0), (0.25, 4, 4.4), col=cm)
    C.collider("mouth_%d" % side, P(side * 5.0, 0, -4.6), (2.6, 4, 0.3), col=cm)
C.collider("tunnel_back", P(0, 0, 3.0), (2.2, 4, 0.25), col=cm)
for i, ((x, z), yaw) in enumerate(CONTAINERS):
    C.collider("cont%d" % i, P(x, 0, z), (CONT[0] / 2 + 0.3, 4, CONT[2] / 2 + 0.3), yaw=yaw, col=cm)
C.collider("tower", P(BORE[0], 0, BORE[1]), (1.2, 4, 1.2), col=cm)
C.collider("drum", P(BORE[0] - 2.6, 0, BORE[1]), (0.5, 4, 1.0), col=cm)
for tz in (-30.5, -34.0):
    C.collider("tank%d" % int(-tz), P(10.0 + 2.1, 0, tz), (2.3, 4, 1.0), col=cm)
C.collider("pump", P(PUMP[0], 0, PUMP[1]), (1.35, 4, 0.8), col=cm)
C.collider("relay", P(RELAY[0] - 0.2, 0, RELAY[1]), (0.75, 4, 0.5), col=cm)
C.collider("crate", P(SOLDIER[0] + 0.9, 0, SOLDIER[1] + 0.2), (0.65, 4, 0.55), col=cm)
for i, ((x, z), yaw) in enumerate(WINDBREAKS):
    C.collider("wind%d" % i, P(x, 0, z), (1.7, 4, 0.3), yaw=yaw, col=cm)
# anchors
C.anchor("camp_exit", P(0, 0, 1.8), cm, a3d_id="camp_exit", a3d_radius=1.8, a3d_label="HELIKON TÜNELİ")
C.anchor("camp_spawn", P(0, 0, -1.0), cm, a3d_id="camp_spawn", a3d_radius=0.1, a3d_label="")
C.anchor("pump", P(PUMP[0] + 2.3, 0, PUMP[1]), cm, a3d_id="pump", a3d_radius=1.8, a3d_label="SONDAJ SIVISI POMPASI")
C.anchor("relay", P(RELAY[0] + 1.6, 0, RELAY[1]), cm, a3d_id="relay", a3d_radius=1.8, a3d_label="UYDU RÖLESİ")
C.anchor("soldier", P(SOLDIER[0] - 1.3, 0, SOLDIER[1] - 0.4), cm, a3d_id="soldier", a3d_radius=1.8, a3d_label="KOALİSYON ASKERİ")
# lights (cold blue cavern, warm windows, work lights)
for name, pos, colour, inten, rng_m, flick, group in (
    ("tunnel", P(0, 3.0, -1.0), (0.4, 0.8, 1.0), 0.8, 8.0, 0.0, None),
    ("bore", P(BORE[0], 2.0, BORE[1]), (0.5, 0.75, 1.0), 1.2, 12.0, 0.0, "bore"),
    ("worklight", P(BORE[0] + 2.0, 6.5, BORE[1] + 3.0), (1.0, 0.95, 0.85), 1.6, 20.0, 0.0, "pump"),
    ("cont0", P(-12.0, 1.6, -13.0), (1.0, 0.72, 0.42), 0.9, 9.0, 0.0, None),
    ("cont1", P(-12.0, 1.6, -31.0), (1.0, 0.72, 0.42), 0.9, 9.0, 0.0, None),
    ("cont2", P(13.0, 1.6, -39.0), (1.0, 0.72, 0.42), 0.9, 9.0, 0.0, None),
    ("relay", P(RELAY[0] + 0.6, 1.8, RELAY[1]), (0.5, 1.0, 0.65), 0.6, 6.0, 0.0, "relay"),
    ("soldier", P(SOLDIER[0] - 1.0, 1.4, SOLDIER[1] - 1.0), (0.6, 0.8, 1.0), 0.5, 6.0, 0.0, None),
):
    e = C.light(name, pos, colour, inten, rng_m, cm, flick)
    if group:
        e["a3d_group"] = group

# ------------------------------------------------------------------ bake
game = C.join_copies([ob_camp], "camp_interior", col_game)
ob_camp.hide_render = True
C.unwrap(game, margin=0.002)
C.bake_atlas(game, "camp_interior", 2048, ao_distance=5.0, ao_samples=48, interior=True, extra_props={"a3d_zone": "camp"})
game["a3d_cull"] = 160.0


# ------------------------------------------------------------------ the soldier (posed copy of the crew model, slumped)
def build_soldier():
    path = os.path.join(C.SOURCE_DIR, "explorer.blend")
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = [n for n in src.objects if n in ("Selin", "Selin_Rig")]
    body = next(o for o in dst.objects if o.name.startswith("Selin") and o.type == "MESH")
    rig = next(o for o in dst.objects if o.type == "ARMATURE")
    for o in (body, rig):
        col_src.objects.link(o)
    rig.animation_data_clear()

    def q(axis, deg):
        return Quaternion(Vector(axis).normalized(), math.radians(deg))
    X = (1, 0, 0)
    pose = {   # sitting against the crate: thighs forward, knees up, head dropped, arms hugging the body
        "spine": q(X, -8), "chest": q(X, 14), "neck": q(X, 18), "head": q(X, 30),
        "thigh.L": q(X, -80) @ q((0, 1, 0), 8), "thigh.R": q(X, -80) @ q((0, 1, 0), -8),
        "shin.L": q(X, -10), "shin.R": q(X, -10), "foot.L": q(X, -70), "foot.R": q(X, -70),
        "upper_arm.L": q(X, -30) @ q((0, 1, 0), 12), "upper_arm.R": q(X, -30) @ q((0, 1, 0), -12),
        "forearm.L": q((0, 0, 1), -55) @ q(X, -80), "forearm.R": q((0, 0, 1), 55) @ q(X, -80),
    }
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"
        rest = pb.bone.matrix_local.to_quaternion()
        pb.rotation_quaternion = rest.inverted() @ pose.get(pb.name, Quaternion()) @ rest
        pb.location = (0, 0, 0)
    bpy.context.view_layer.update()
    for m in body.modifiers:
        if m.type == "ARMATURE":
            m.object = rig
    sol = C.join_copies([body], "SOLDIER", col_game)
    body.hide_render = True
    me = sol.data
    zmin = min(v.co.z for v in me.vertices)
    rot = Matrix.Rotation(math.radians(90), 4, "Z")      # face -x (toward the cavern)
    for v in me.vertices:
        v.co = rot @ Vector((v.co.x, v.co.y, v.co.z - zmin + 0.01))
    me.update()
    sol.location = C.G(*P(SOLDIER[0], 0.0, SOLDIER[1]))
    sol["a3d_cull"] = 60.0
    for k in list(sol.keys()):
        if k.startswith("a3d_lod"):
            del sol[k]
    return sol


ob_soldier = build_soldier()
print("soldier tris", C.tri_count(ob_soldier))

export = [game, ob_soldier] + emissive + list(col_meta.objects)
root = bpy.data.objects.new("CAMP_root", None)
col_game.objects.link(root)
root["a3d_model"] = "drill_camp"
for o in export:
    o.parent = root
glb = os.path.join(C.GAME_MODELS, "drill_camp.glb")
size = C.export_glb([root] + export, glb)
stats = {o.name: C.tri_count(o) for o in export if o.type == "MESH"}
print("STATS", stats, "total_tris", sum(stats.values()), "glb_bytes", size, "FY", FY, "HX", HX, "HZ", HZ)
C.save_blend("drill_camp")
