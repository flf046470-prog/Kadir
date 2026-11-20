"""HELIKON city — Chapter 4 ("Üç Cevap"): the subglacial lake basin behind the three-ring gate.

Produces blender/source/helikon_city.blend, blender/textures/city_*.png and
ios/Antarktika/Game/models/helikon_city.glb.

Realism: modelled on real subglacial lakes (Lake Vostok lies under ~4 km of ice): liquid water
kept above freezing by pressure and geothermal heat, an ice ceiling, dark rock walls. The fiction
is the city built into the basin's north wall.

Instanced interior (layer 'city', state.inCity), like the chapter 3 hall.
  * entry tunnel + terrace + ramp down to the shore             INT_city_exit, INT_city_spawn
  * dark lake with geothermal vents glowing under the water
  * three symbol stones teaching the crystal language          INT_sym1..3
  * the bridge stone; a crystal bridge rises from the water     INT_bridgestone (floor/collider a3d_cond)
  * the island with the crystal spire that speaks              INT_spire
  * terraced city in the north wall (window slits light up)
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
HX, HZ = -200.0, -260.0
ground = min(T.terrain_y(HX + dx, HZ + dz) for dx in range(-34, 35, 2) for dz in range(4, -76, -2))
WY = math.floor(ground) - 38.0      # lake surface level
DC, RX, RZ, RY = -40.0, 34.0, 28.0, 24.0   # dome centre (local z) and radii
print("lake level", WY, "ground min", round(ground, 2), "dome top", WY + RY)
assert WY + RY + 3.0 < ground, "basin would break the surface"


def P(lx, ly, lz):
    return (HX + lx, WY + ly, HZ + lz)


TER = 4.0     # terrace height above the water
SHORE = 0.4
ISLE = (0.0, -50.0)

M_CITY = [
    C.mat_rock("M_CityRock"),                                                                   # 0
    C.mat_ice("M_CityIce", deep=(0.02, 0.10, 0.18), light=(0.28, 0.55, 0.70), interior=True),     # 1
    C.mat_plain("M_CityStone", (0.33, 0.31, 0.28), rough=0.75, interior=True, noise=0.3),        # 2 carved stone
    C.mat_plain("M_LakeBed", (0.02, 0.025, 0.03), rough=0.9, interior=True),                     # 3
    C.mat_plain("M_CityBronze", (0.20, 0.16, 0.10), rough=0.45, metal=0.7, interior=True, noise=0.2),  # 4
]
M_WATER = C.mat_glass("GM_LakeWater", tint=(0.02, 0.07, 0.10), alpha=0.70)

bm = bmesh.new()

# ------------------------------------------------------------------ dome (rock below, ice above), inward facing
SEG_U, SEG_V = 40, 14
rows = []
for j in range(SEG_V + 1):
    phi = j / SEG_V * (math.pi / 2)                  # 0 = equator, pi/2 = top
    row = []
    for i in range(SEG_U):
        th = i / SEG_U * math.tau
        n = noise.noise(Vector((math.cos(th) * 2.1, math.sin(th) * 2.1, phi * 3.0)))
        s = 1.0 + 0.06 * n * (1.0 - j / SEG_V)
        x = RX * math.cos(phi) * math.cos(th) * s
        z = DC + RZ * math.cos(phi) * math.sin(th) * s
        y = -1.2 + RY * math.sin(phi) * (1.0 + 0.04 * n)
        row.append((x, y, z))
    rows.append(row)
verts = [[bm.verts.new(C.G(*P(*p))) for p in row] for row in rows]
centre_b = Vector(C.G(*P(0.0, 6.0, DC)))
for j in range(SEG_V):
    for i in range(SEG_U):
        a, b, c, d = verts[j][i], verts[j][(i + 1) % SEG_U], verts[j + 1][(i + 1) % SEG_U], verts[j + 1][i]
        mid = (Vector(a.co) + Vector(c.co)) / 2
        # keep a hole where the entry tunnel pierces the south wall
        lx, lz, ly = mid.x - HX, -mid.y - HZ, mid.z - WY
        if abs(lx) < 3.2 and ly < 10.0 and lz > DC + 20:
            continue
        f = bm.faces.new((a, b, c, d))
        f.smooth = True
        f.material_index = 0 if ly < 7.0 else 1
        f.normal_update()
        if f.normal.dot(centre_b - f.calc_center_median()) < 0:
            f.normal_flip()
# lake bed
C.bm_box(bm, P(0, -1.5, DC), (2 * RX + 2, 0.6, 2 * RZ + 2), mat_index=3)

# ------------------------------------------------------------------ tunnel, terrace, ramp, shores, island
C.bm_box(bm, P(0, TER - 0.3, -6.5), (4.6, 0.6, 15.0), mat_index=2)                    # tunnel floor
for side in (-1, 1):
    C.bm_box(bm, P(side * 2.6, TER + 2.3, -6.5), (0.6, 4.6, 15.0), mat_index=0)       # tunnel walls
C.bm_box(bm, P(0, TER + 4.75, -6.5), (5.8, 0.4, 15.0), mat_index=0)                   # tunnel roof
C.bm_box(bm, P(0, TER + 2.3, 1.1), (5.8, 4.6, 0.5), mat_index=0)                      # portal wall
for lz in (-3.0, -7.0, -11.0):
    C.bm_box(bm, P(0, TER + 4.4, lz), (4.8, 0.3, 0.35), mat_index=4)                  # bronze ribs
# terrace (cantilevered over the shore) with a carved parapet
C.bm_box(bm, P(0, TER - 0.35, -17.0), (18.0, 0.7, 6.0), bevel=0.05, mat_index=2)
C.bm_box(bm, P(0, TER / 2 - 0.4, -17.0), (18.0, TER - 0.6, 5.2), mat_index=0)        # terrace base
for side in (-1, 1):
    C.bm_box(bm, P(side * 5.6, TER + 0.45, -19.85), (6.8, 0.9, 0.3), mat_index=2)      # parapet (ramp gap in the middle)
    C.bm_box(bm, P(side * 8.85, TER + 0.45, -17.0), (0.3, 0.9, 6.0), mat_index=2)
# ramp: 12 m long, terrace (z -20) down to the shore (z -32)
rl, rz0, rz1 = 12.0, -20.0, -32.0
ramp_top = [P(-2.0, TER, rz0), P(2.0, TER, rz0), P(2.0, SHORE, rz1), P(-2.0, SHORE, rz1)]
C.bm_quad(bm, ramp_top, mat_index=2)                                                   # faces up (checked by hand)
for side in (-1, 1):   # ramp side walls, both faces (seen from the ramp and from the quay)
    pts = [P(side * 2.0, -0.5, rz0), P(side * 2.0, TER + 0.6, rz0), P(side * 2.0, SHORE + 0.6, rz1), P(side * 2.0, -0.5, rz1)]
    C.bm_quad(bm, pts, mat_index=2)
    C.bm_quad(bm, pts[::-1], mat_index=2)
# shores
C.bm_box(bm, P(0, SHORE - 0.5, -34.0), (52.0, 1.0, 4.0), mat_index=2)                 # south quay
for side in (-1, 1):
    C.bm_box(bm, P(side * 22.0, SHORE - 0.5, -46.0), (8.0, 1.0, 20.0), mat_index=0)    # west / east shelves
    for k in range(5):                                                                  # carved bollards on the quay edge
        C.bm_cylinder(bm, P(side * (4.0 + k * 3.4), SHORE, -35.7), 0.22, 0.7, 8, mat_index=2)
# island
C.bm_cylinder(bm, P(ISLE[0], -1.2, ISLE[1]), 5.8, 1.7, 36, mat_index=0)
C.bm_cylinder(bm, P(ISLE[0], 0.42, ISLE[1]), 5.2, 0.08, 36, mat_index=2)
C.bm_cylinder(bm, P(ISLE[0], 0.5, ISLE[1]), 1.9, 0.6, 16, mat_index=4)                 # spire plinth
# pillars along the shelves
for side in (-1, 1):
    for lz in (-40.0, -47.0, -54.0):
        C.bm_cylinder(bm, P(side * 25.0, SHORE, lz), 0.6, 9.0, 12, mat_index=2, radius_top=0.45)
        C.bm_box(bm, P(side * 25.0, SHORE + 9.2, lz), (1.6, 0.5, 1.6), mat_index=2)

# ------------------------------------------------------------------ the terraced city in the north wall
rr = C.rng(404)
CITY_WIN = []
for tier, (lz, ly0, half) in enumerate(((-63.0, -0.2, 17.0), (-64.5, 4.2, 14.5), (-65.6, 8.6, 10.5))):
    C.bm_box(bm, P(0, ly0 + 2.2, lz), (2 * half, 4.4, 3.0), mat_index=2)               # terrace block
    x = -half + 1.2
    while x < half - 1.2:
        w = rr.uniform(1.6, 3.2)
        h = rr.uniform(2.4, 3.8)
        C.bm_box(bm, P(x + w / 2, ly0 + 4.4 + h / 2, lz + 0.6), (w, h, 1.8), mat_index=2)
        CITY_WIN.append((x + w / 2, ly0 + 4.4 + h * 0.55, lz + 1.52, w * 0.18, h * 0.32))
        x += w + rr.uniform(0.4, 1.2)
    for k in range(int(half // 3)):                                                       # doorways on the terrace face
        dx = -half + 2.0 + k * 6.0
        CITY_WIN.append((dx, ly0 + 1.6, lz + 1.52, 0.55, 1.1))

# icicles from the ice ceiling
for _ in range(90):
    th = rr.uniform(0, math.tau)
    rad = math.sqrt(rr.uniform(0.05, 0.75))
    x, z = RX * rad * math.cos(th), DC + RZ * rad * math.sin(th)
    ytop = -1.2 + RY * math.sqrt(max(0.0, 1 - (x / RX) ** 2 - ((z - DC) / RZ) ** 2)) - 0.3
    ln = rr.uniform(0.6, 3.0)
    C.bm_cylinder(bm, P(x, ytop - ln, z), rr.uniform(0.005, 0.02), ln, 6, radius_top=rr.uniform(0.1, 0.32), mat_index=1)

ob_city = C.mesh_object("SRC_city", bm, M_CITY, col_src)

# ------------------------------------------------------------------ emissive atlas: symbol stones, swatches, portal


def draw_symbol(d, k, cx, cy, s, col):
    """The six crystal-language symbols (UI uses the same shapes: ◆ ◇ △ ≈ □ ○)."""
    if k == 0:
        d.polygon([(cx, cy - s), (cx + s * 0.75, cy), (cx, cy + s), (cx - s * 0.75, cy)], fill=col)
    elif k == 1:
        d.polygon([(cx, cy - s), (cx + s * 0.75, cy), (cx, cy + s), (cx - s * 0.75, cy)], outline=col, width=5)
    elif k == 2:
        d.polygon([(cx, cy - s), (cx + s, cy + s * 0.8), (cx - s, cy + s * 0.8)], outline=col, width=5)
        d.ellipse([cx - 5, cy + 2, cx + 5, cy + 12], fill=col)
    elif k == 3:
        for o in (-0.5, 0.0, 0.5):
            pts = [(cx - s + t * (2 * s / 12), cy + o * s + math.sin(t / 12 * math.tau) * s * 0.15) for t in range(13)]
            d.line(pts, fill=col, width=5)
    elif k == 4:
        d.rectangle([cx - s * 0.7, cy - s, cx + s * 0.7, cy + s], outline=col, width=5)
        d.line([cx, cy - s * 0.4, cx, cy + s], fill=col, width=4)
    else:
        d.ellipse([cx - s, cy - s, cx + s, cy + s], outline=col, width=5)


STONES = [(0, 3), (1, 2), (4, 5)]      # sym1: BİZ+SU, sym2: SİZ+ZAMAN, sym3: KAPI+SESSİZLİK


def build_atlas(path):
    img = Image.new("RGB", (1024, 512), (0, 0, 0))
    d = ImageDraw.Draw(img)
    rnd = C.rng(91)
    for i, pair in enumerate(STONES + [(0, 3, 1, 2)]):        # 3 symbol stones + the bridge stone (4 sockets)
        x0, y0, w, h = i * 200 + 10, 10, 180, 300
        d.rectangle([x0, y0, x0 + w, y0 + h], fill=(5, 16, 24))
        d.rectangle([x0 + 6, y0 + 6, x0 + w - 6, y0 + h - 6], outline=(50, 150, 175), width=2)
        if len(pair) == 2:
            draw_symbol(d, pair[0], x0 + w / 2, y0 + 70, 40, (150, 240, 255))
            draw_symbol(d, pair[1], x0 + w / 2, y0 + 170, 40, (150, 240, 255))
            for r in range(3):
                gy = y0 + 236 + r * 18
                for c in range(5):
                    gx = x0 + 26 + c * 30
                    d.line([gx, gy, gx + rnd.uniform(6, 18), gy + rnd.uniform(-5, 5)], fill=(70, 190, 215), width=2)
        else:
            for k, sym in enumerate(pair):
                draw_symbol(d, sym, x0 + w / 2 + (-40 if k % 2 == 0 else 40), y0 + 80 + (k // 2) * 110, 30, (150, 240, 255))
    # portal ring
    cx, cy = 912, 110
    for r_, wdt in ((96, 4), (78, 2), (56, 3), (30, 2)):
        d.ellipse([cx - r_, cy - r_, cx + r_, cy + r_], outline=(90, 235, 255), width=wdt)
    glow = img.filter(ImageFilter.GaussianBlur(4))
    img = Image.blend(img, glow, 0.35)
    # geothermal vent glow: soft radial falloff (seen through the water)
    vent = Image.new("RGB", (190, 190), (0, 0, 0))
    for y in range(190):
        for x in range(190):
            r = math.hypot(x - 95, y - 95) / 95.0
            k = max(0.0, 1.0 - r) ** 2.2
            vent.putpixel((x, y), (int(255 * k), int(120 * k * k + 30 * k), int(40 * k ** 3)))
    img.paste(vent, (820, 222))
    d = ImageDraw.Draw(img)
    for i, c in enumerate([(70, 220, 255), (255, 120, 40), (255, 196, 110), (235, 250, 255), (190, 130, 255), (255, 170, 90)]):
        d.rectangle([i * 128, 432, i * 128 + 127, 511], fill=c)
    img.save(path)


atlas_path = os.path.join(C.TEX_DIR, "city_emissive.png")
build_atlas(atlas_path)
M_EMI = C.mat_emissive("GM_CityEmissive", (1, 1, 1), 2.4, bpy.data.images.load(atlas_path))
SW = {k: ((i * 128 + 64) / 1024, 1 - 472 / 512) for i, k in enumerate(["cyan", "orange", "gold", "white", "violet", "amber"])}


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


def box_emi(b, centre, size, colour):
    vs = C.bm_box(b, centre, size)
    solid(b, {f for v in vs for f in v.link_faces}, colour)


emissive = []
# symbol stones (slab is baked stone; the glowing face is emissive). facing: +x, -x, +z
STONE_POS = [((-20.6, -48.0), "x+"), ((20.6, -48.0), "x-"), ((-3.2, -53.0), "z+")]
BRIDGE_STONE = ((-3.2, -33.6), "z+")
slabs = bmesh.new()


def stone(b_slab, pos, facing, idx, group):
    (x, z) = pos
    if facing.startswith("x"):
        C.bm_box(b_slab, P(x, SHORE + 1.4, z), (0.5, 2.8, 1.4), mat_index=0)
        fx = x + (0.26 if facing == "x+" else -0.26)
        z0, z1 = (z + 0.6, z - 0.6) if facing == "x+" else (z - 0.6, z + 0.6)
        pts = [P(fx, SHORE + 0.35, z0), P(fx, SHORE + 0.35, z1), P(fx, SHORE + 2.6, z1), P(fx, SHORE + 2.6, z0)]
    else:
        base = 0.5 if idx == 2 else SHORE
        C.bm_box(b_slab, P(x, base + 1.4, z), (1.4, 2.8, 0.5), mat_index=0)
        fz = z + 0.26
        pts = [P(x - 0.6, base + 0.35, fz), P(x + 0.6, base + 0.35, fz), P(x + 0.6, base + 2.6, fz), P(x - 0.6, base + 2.6, fz)]
    rect = (idx * 200 + 10, 10, idx * 200 + 190, 310)
    emissive.append(emi("STONE_%s" % group, lambda b: quad_uv(b, pts, rect), a3d_group=group, a3d_scan=1, a3d_cull=70.0))


for i, (pos, facing) in enumerate(STONE_POS):
    stone(slabs, pos, facing, i, "sym%d" % (i + 1))
stone(slabs, BRIDGE_STONE[0], BRIDGE_STONE[1], 3, "bridgestone")
for f in slabs.faces:
    f.material_index = 0
# slabs join the baked city mesh
slab_ob = C.mesh_object("SRC_slabs", slabs, M_CITY, col_src)

# crystal bridge (hidden until the bridge stone wakes it)


def b_bridge(b):
    for k in range(7):
        z = -36.4 - k * 1.2
        box_emi(b, P(0.0, 0.32, z), (2.8, 0.22, 1.05), "cyan")


emissive.append(emi("BRIDGE", b_bridge, a3d_group="bridge", a3d_cull=80.0))


# the spire: a cluster of tall crystals on the island
def b_spire(b):
    r = C.rng(5)
    for n in range(7):
        h = 9.0 if n == 0 else r.uniform(2.5, 6.0)
        rad = 0.55 if n == 0 else r.uniform(0.18, 0.38)
        tilt = Vector((r.uniform(-0.25, 0.25), r.uniform(-0.25, 0.25), 1)).normalized() if n else Vector((0, 0, 1))
        base = Vector(C.G(*P(ISLE[0] + (r.uniform(-0.9, 0.9) if n else 0), 1.0, ISLE[1] + (r.uniform(-0.9, 0.9) if n else 0))))
        side = tilt.orthogonal().normalized()
        side2 = tilt.cross(side)
        ring = [b.verts.new(base + (side * math.cos(a) + side2 * math.sin(a)) * rad) for a in [k * math.tau / 6 for k in range(6)]]
        top = [b.verts.new(v.co + tilt * h * 0.82) for v in ring]
        tip = b.verts.new(base + tilt * h)
        faces = []
        for k in range(6):
            faces.append(b.faces.new((ring[k], ring[(k + 1) % 6], top[(k + 1) % 6], top[k])))
            faces.append(b.faces.new((top[k], top[(k + 1) % 6], tip)))
        solid(b, faces, "cyan" if n % 2 == 0 else "violet")


emissive.append(emi("SPIRE", b_spire, a3d_group="spire", a3d_pulse=0.3, a3d_cull=120.0))


def b_windows(b):
    for (x, y, z, w, h) in CITY_WIN:
        f = C.bm_quad(b, [P(x - w / 2, y - h / 2, z), P(x + w / 2, y - h / 2, z), P(x + w / 2, y + h / 2, z), P(x - w / 2, y + h / 2, z)])
        solid(b, [f], "amber")


emissive.append(emi("CITY_LIGHTS", b_windows, a3d_group="citylights", a3d_cull=140.0))


def b_vents(b):
    for (x, z, s) in ((-10.0, -55.0, 1.6), (9.0, -41.0, 1.2), (12.0, -58.0, 1.4), (-12.0, -42.0, 0.9)):
        quad_uv(b, [P(x - s * 1.8, -0.25, z + s * 1.8), P(x + s * 1.8, -0.25, z + s * 1.8), P(x + s * 1.8, -0.25, z - s * 1.8), P(x - s * 1.8, -0.25, z - s * 1.8)], (822, 224, 1008, 410))


emissive.append(emi("VENTS", b_vents, a3d_pulse=0.5, a3d_cull=120.0))


def b_portal(b):
    quad_uv(b, [P(2.1, TER + 0.2, 0.84), P(-2.1, TER + 0.2, 0.84), P(-2.1, TER + 4.3, 0.84), P(2.1, TER + 4.3, 0.84)], (814, 12, 1010, 208))


emissive.append(emi("PORTAL", b_portal, a3d_group="portal", a3d_pulse=0.25, a3d_cull=60.0))

# water surface (blended, not baked) over the lake and around the island
bw = bmesh.new()
C.bm_quad(bw, [P(-RX, 0.0, DC + RZ), P(RX, 0.0, DC + RZ), P(RX, 0.0, DC - RZ), P(-RX, 0.0, DC - RZ)])
ob_water = C.mesh_object("LAKE_water", bw, M_WATER, col_game)
ob_water["a3d_cull"] = 160.0

# ------------------------------------------------------------------ gameplay metadata
cm = col_meta
C.volume("city", P(0, 8.0, -33.0), (RX + 2, 14.0, 36.0), "city", col=cm)
# floors (top = surface)
C.floor("lakebed", P(0, -0.7 - 0.25, DC), (RX, 0.25, RZ + 2), col=cm)
C.floor("tunnel", P(0, TER - 0.25, -6.5), (2.3, 0.25, 7.6), col=cm)
C.floor("terrace", P(0, TER - 0.25, -17.0), (9.0, 0.25, 3.0), col=cm)
ramp = C.floor("ramp", P(0, (TER + SHORE) / 2, (rz0 + rz1) / 2), (2.0, (TER - SHORE) / 2, rl / 2), yaw=math.pi, col=cm, ramp=True)
C.floor("quay", P(0, SHORE - 0.25, -34.0), (26.0, 0.25, 2.0), col=cm)
for side, nm in ((-1, "west"), (1, "east")):
    C.floor("shelf_" + nm, P(side * 22.0, SHORE - 0.25, -46.0), (4.0, 0.25, 10.0), col=cm)
C.floor("island", P(ISLE[0], 0.5 - 0.25, ISLE[1]), (4.0, 0.25, 4.0), col=cm)
br = C.floor("bridge", P(0, 0.45 - 0.25, -40.4), (1.4, 0.25, 4.6), col=cm)
br["a3d_cond"] = "bridge"
# colliders
for side in (-1, 1):
    C.collider("tunnel_%d" % side, P(side * 2.55, 0, -6.5), (0.3, 4, 7.6), col=cm)
    C.collider("terrace_side_%d" % side, P(side * 9.1, 0, -17.0), (0.3, 4, 3.2), col=cm)
    C.collider("parapet_%d" % side, P(side * 5.6, 0, -20.0), (3.4, 4, 0.25), col=cm)
    C.collider("ramp_wall_%d" % side, P(side * 2.2, 0, -26.0), (0.2, 4, 6.0), col=cm)
    C.collider("quay_back_%d" % side, P(side * 14.1, 0, -31.8), (11.9, 4, 0.2), col=cm)
    C.collider("quay_edge_%d" % side, P(side * 9.75, 0, -36.2), (8.25, 4, 0.2), col=cm)   # lake edge either side of the bridge
    C.collider("shelf_inner_%d" % side, P(side * 17.8, 0, -46.2), (0.2, 4, 10.0), col=cm)
    C.collider("shelf_outer_%d" % side, P(side * 26.2, 0, -45.0), (0.2, 4, 13.5), col=cm)
    C.collider("shelf_end_%d" % side, P(side * 22.0, 0, -56.3), (4.4, 4, 0.2), col=cm)
    C.collider("bridge_rail_%d" % side, P(side * 1.6, 0, -40.4), (0.15, 4, 4.4), col=cm)
    C.collider("isle_side_%d" % side, P(ISLE[0] + side * 4.2, 0, ISLE[1]), (0.2, 4, 4.2), col=cm)
    C.collider("isle_front_%d" % side, P(ISLE[0] + side * 2.9, 0, ISLE[1] + 4.2), (1.3, 4, 0.2), col=cm)
    for lz in (-40.0, -47.0, -54.0):
        C.collider("pillar_%d_%d" % (side, int(-lz)), P(side * 25.0, 0, lz), (0.65, 4, 0.65), col=cm)
C.collider("portal_wall", P(0, 0, 1.0), (2.6, 4, 0.3), col=cm)
C.collider("isle_back", P(ISLE[0], 0, ISLE[1] - 4.2), (4.2, 4, 0.2), col=cm)
C.collider("spire", P(ISLE[0], 0, ISLE[1]), (1.8, 4, 1.8), col=cm)
gap = C.collider("bridge_gap", P(0, 0, -36.2), (1.5, 4, 0.2), col=cm)
gap["a3d_cond"] = "nobridge"
for i, ((x, z), facing) in enumerate(STONE_POS + [BRIDGE_STONE]):
    C.collider("stone%d" % i, P(x, 0, z), (0.35, 4, 0.75) if facing.startswith("x") else (0.75, 4, 0.35), col=cm)
# anchors
C.anchor("city_exit", P(0, TER, -0.6), cm, a3d_id="city_exit", a3d_radius=2.2, a3d_label="DÖNÜŞ KAPISI")
C.anchor("city_spawn", P(0, TER, -4.0), cm, a3d_id="city_spawn", a3d_radius=0.1, a3d_label="")
for i, ((x, z), facing) in enumerate(STONE_POS):
    ax = x + (1.4 if facing == "x+" else -1.4 if facing == "x-" else 0.0)
    az = z + (1.5 if facing == "z+" else 0.0)
    C.anchor("sym%d" % (i + 1), P(ax, SHORE, az), cm, a3d_id="sym%d" % (i + 1), a3d_radius=2.2, a3d_label="SEMBOL TAŞI")
C.anchor("bridgestone", P(BRIDGE_STONE[0][0], SHORE, BRIDGE_STONE[0][1] + 1.3), cm, a3d_id="bridgestone", a3d_radius=2.0, a3d_label="KÖPRÜ TAŞI")
C.anchor("spire", P(ISLE[0] + 0.0, 0.5, ISLE[1] + 3.0), cm, a3d_id="spire", a3d_radius=2.4, a3d_label="KRİSTAL KULE")
# lights
for name, pos, colour, inten, rng_m, flick, group in (
    ("portal", P(0, TER + 2.4, -1.2), (0.35, 0.85, 1.0), 1.0, 8.0, 0.0, "portal"),
    ("terrace", P(0, TER + 3.0, -16.0), (0.45, 0.8, 1.0), 1.2, 16.0, 0.0, None),
    ("vent_a", P(-10.0, 0.6, -55.0), (1.0, 0.45, 0.15), 1.6, 14.0, 0.2, None),
    ("vent_b", P(9.0, 0.6, -41.0), (1.0, 0.45, 0.15), 1.3, 12.0, 0.2, None),
    ("vent_c", P(12.0, 0.6, -58.0), (1.0, 0.45, 0.15), 1.3, 12.0, 0.2, None),
    ("quay", P(0, 2.5, -33.0), (0.45, 0.8, 1.0), 1.0, 14.0, 0.0, None),
    ("spire", P(ISLE[0], 5.0, ISLE[1]), (0.5, 0.85, 1.0), 1.8, 20.0, 0.0, "spire"),
    ("bridge", P(0, 1.2, -40.0), (0.4, 0.9, 1.0), 1.2, 9.0, 0.0, "bridge"),
    ("city", P(0, 8.0, -60.0), (1.0, 0.7, 0.4), 1.4, 26.0, 0.0, "citylights"),
):
    e = C.light(name, pos, colour, inten, rng_m, cm, flick)
    if group:
        e["a3d_group"] = group

# ------------------------------------------------------------------ bake + export
game = C.join_copies([ob_city, slab_ob], "city_interior", col_game)
ob_city.hide_render = True
slab_ob.hide_render = True
C.unwrap(game, margin=0.002)
C.bake_atlas(game, "city_interior", 2048, ao_distance=8.0, ao_samples=48, interior=True, extra_props={"a3d_zone": "city"})
game["a3d_cull"] = 200.0

export = [game, ob_water] + emissive + list(col_meta.objects)
root = bpy.data.objects.new("CITY_root", None)
col_game.objects.link(root)
root["a3d_model"] = "helikon_city"
for o in export:
    o.parent = root
glb = os.path.join(C.GAME_MODELS, "helikon_city.glb")
size = C.export_glb([root] + export, glb)
stats = {o.name: C.tri_count(o) for o in export if o.type == "MESH"}
print("STATS", stats, "total_tris", sum(stats.values()), "glb_bytes", size, "WY", WY, "HX", HX, "HZ", HZ)
C.save_blend("helikon_city")
