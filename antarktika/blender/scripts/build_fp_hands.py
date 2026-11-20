"""First-person hands: gloved right hand with the flashlight, left hand with the
HELIKON field scanner, parka sleeves. Authored in view space (metres):
x = right, y = up, z = toward the viewer (forward is -z), camera at the origin.

Produces blender/source/fp_hands.blend and Game/models/fp_hands.glb with:
    HANDS_body      baked PBR mesh (one draw call)
    TORCH_lens      emissive lens       (a3d_group = torch)
    SCANNER_screen  emissive screen     (a3d_group = scanner)
The engine renders this after the world with a cleared depth buffer and
animates sway, walk bob and the scanner raise procedurally.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402  (must precede bmesh when used as a module)
import bmesh  # noqa: E402
from mathutils import Vector  # noqa: E402
from PIL import Image, ImageDraw, ImageFilter  # noqa: E402

import a3d_common as C  # noqa: E402

scene = C.reset_scene()
col_src = C.collection("SRC_procedural")
col_game = C.collection("GAME_export")

M = [
    C.mat_fabric("M_Glove", (0.045, 0.047, 0.05), rough=0.8, weave=420.0),      # 0
    C.mat_plain("M_Cuff", (0.85, 0.32, 0.05), rough=0.7),                      # 1
    C.mat_fabric("M_Sleeve", (0.62, 0.09, 0.03), rough=0.82, weave=320.0),     # 2
    C.mat_painted_metal("M_TorchBody", (0.11, 0.115, 0.12), rough=0.38, metal=0.7, seams=False, grime=0.3),  # 3
    C.mat_painted_metal("M_TorchRing", (0.78, 0.55, 0.08), rough=0.4, metal=0.5, seams=False),  # 4
    C.mat_plain("M_ScannerShell", (0.86, 0.36, 0.06), rough=0.55, noise=0.15),  # 5
    C.mat_plain("M_ScannerBumper", (0.06, 0.065, 0.07), rough=0.75),            # 6
    C.mat_painted_metal("M_Antenna", (0.55, 0.58, 0.6), rough=0.3, metal=0.9, seams=False),  # 7
    C.mat_plain("M_Reflect", (0.8, 0.82, 0.8), rough=0.3),                      # 8
]

bm = bmesh.new()


def V(x, y, z):
    """View-space point -> Blender (glTF export maps Blender (x,y,z) -> (x,z,-y))."""
    return Vector((x, -z, y))


def tube(p0, p1, r0, r1, segs, mi, rings=4, squash=1.0, caps=True):
    a, b = V(*p0), V(*p1)
    d = b - a
    up = Vector((0, 0, 1)) if abs(d.normalized().z) < 0.9 else Vector((1, 0, 0))
    u = d.cross(up).normalized()
    w = d.cross(u).normalized()
    loops = []
    for i in range(rings):
        t = i / (rings - 1)
        r = r0 + (r1 - r0) * t
        c = a + d * t
        loops.append([bm.verts.new(c + u * math.cos(k / segs * math.tau) * r + w * math.sin(k / segs * math.tau) * r * squash) for k in range(segs)])
    faces = []
    for i in range(rings - 1):
        for k in range(segs):
            faces.append(bm.faces.new((loops[i][k], loops[i][(k + 1) % segs], loops[i + 1][(k + 1) % segs], loops[i + 1][k])))
    if caps:
        for lp in (loops[0], loops[-1]):
            cv = bm.verts.new(sum((v.co for v in lp), Vector()) / len(lp))
            for k in range(segs):
                faces.append(bm.faces.new((lp[k], lp[(k + 1) % segs], cv)))
    for f in faces:
        f.material_index = mi
        f.smooth = True
    bmesh.ops.recalc_face_normals(bm, faces=faces)


def blob(center, size, mi, segs=12, rings=8):
    g = bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0)
    c = V(*center)
    for v in g["verts"]:
        v.co = c + Vector((v.co.x * size[0], v.co.y * size[2], v.co.z * size[1]))
    for f in {f for v in g["verts"] for f in v.link_faces}:
        f.material_index = mi
        f.smooth = True


def box(center, size, mi):
    g = bmesh.ops.create_cube(bm, size=1.0)
    c = V(*center)
    for v in g["verts"]:
        v.co = c + Vector((v.co.x * size[0], v.co.y * size[2], v.co.z * size[1]))
    for f in {f for v in g["verts"] for f in v.link_faces}:
        f.material_index = mi


# ---------------------------------------------------------------- right: flashlight in a fist
TX, TY = 0.200, -0.150
tube((TX, TY, -0.02), (TX, TY, -0.25), 0.021, 0.021, 14, 3, rings=2)              # torch body
tube((TX, TY, -0.25), (TX, TY, -0.305), 0.024, 0.032, 16, 3, rings=3)             # head flare
tube((TX, TY, -0.247), (TX, TY, -0.257), 0.026, 0.026, 16, 4, rings=2)           # yellow ring
tube((TX, TY + 0.0215, -0.06), (TX, TY + 0.0215, -0.085), 0.006, 0.006, 8, 6, rings=2)  # switch
blob((TX + 0.012, TY - 0.012, -0.135), (0.042, 0.048, 0.062), 0)                  # palm wrapped round the body
for i, z in enumerate((-0.098, -0.122, -0.146, -0.170)):                           # four curled fingers (left side)
    for k in range(5):
        a0 = math.radians(110 + k * 34)
        a1 = math.radians(110 + (k + 1) * 34)
        r = 0.033
        p0 = (TX + r * math.cos(a0), TY + r * math.sin(a0), z)
        p1 = (TX + r * math.cos(a1), TY + r * math.sin(a1), z)
        tube(p0, p1, 0.0115, 0.011, 8, 0, rings=2)
tube((TX + 0.03, TY + 0.012, -0.12), (TX + 0.004, TY + 0.03, -0.172), 0.012, 0.010, 8, 0, rings=3)   # thumb on top
tube((TX + 0.03, TY - 0.03, -0.09), (TX + 0.05, TY - 0.06, 0.02), 0.04, 0.046, 12, 0, rings=3)       # wrist
tube((TX + 0.05, TY - 0.06, 0.015), (TX + 0.055, TY - 0.065, 0.045), 0.052, 0.054, 14, 1, rings=2)   # orange cuff
tube((TX + 0.055, TY - 0.066, 0.04), (TX + 0.11, TY - 0.17, 0.3), 0.062, 0.085, 14, 2, rings=4)     # parka sleeve
tube((TX + 0.065, TY - 0.085, 0.10), (TX + 0.07, TY - 0.09, 0.115), 0.068, 0.068, 14, 8, rings=2)   # reflective band

bmesh.ops.translate(bm, verts=list(bm.verts), vec=Vector((0.0, 0.055, 0.03)))   # right assembly: 5.5 cm forward, 3 cm up (Blender y=-z, z=y)
RIGHT_SHIFT = (0.0, 0.03, -0.055)

# ---------------------------------------------------------------- left: field scanner, screen tilted toward the eye
SX, SY, SZ = -0.185, -0.140, -0.30
tilt = math.radians(-38)


def S(lx, ly, lz):
    """Scanner local (x right, y along screen up, z out of screen) -> view space."""
    y = ly * math.cos(tilt) - lz * math.sin(tilt)
    z = ly * math.sin(tilt) + lz * math.cos(tilt)
    return (SX + lx, SY + y, SZ + z)


def sbox(c, s, mi):
    g = bmesh.ops.create_cube(bm, size=1.0)
    for v in g["verts"]:
        lx, ly, lz = v.co.x * s[0], v.co.y * s[1], v.co.z * s[2]
        v.co = V(*S(c[0] + lx, c[1] + ly, c[2] + lz))
    for f in {f for v in g["verts"] for f in v.link_faces}:
        f.material_index = mi


sbox((0, 0, 0), (0.105, 0.15, 0.026), 5)                       # shell
for cy in (-0.078, 0.078):
    sbox((0, cy, 0.002), (0.115, 0.016, 0.034), 6)            # bumpers
for cx in (-0.055, 0.055):
    sbox((cx, 0, 0.002), (0.012, 0.16, 0.032), 6)
sbox((0, -0.058, 0.014), (0.07, 0.02, 0.006), 6)              # keypad strip
a0 = S(-0.04, 0.075, 0.0)
tube(a0, (a0[0] - 0.006, a0[1] + 0.10, a0[2] - 0.02), 0.005, 0.003, 6, 7, rings=2)
blob((a0[0] - 0.007, a0[1] + 0.102, a0[2] - 0.021), (0.008, 0.008, 0.008), 1, segs=8, rings=5)
# left hand: palm under the scanner's lower-left, fingers over the bumper, thumb along the side
hp = S(-0.045, -0.06, -0.03)
blob(hp, (0.045, 0.04, 0.06), 0)
for i in range(4):
    f0 = S(-0.06 + i * 0.026, -0.085, -0.012)
    f1 = S(-0.06 + i * 0.026, -0.072, 0.022)
    tube(f0, f1, 0.0115, 0.0105, 8, 0, rings=2)
t0 = S(-0.062, -0.03, -0.01)
tube(t0, S(-0.055, 0.02, 0.018), 0.012, 0.010, 8, 0, rings=3)
w0 = (hp[0] - 0.015, hp[1] - 0.03, hp[2] + 0.04)
tube(hp, w0, 0.04, 0.045, 12, 0, rings=3)
tube(w0, (w0[0] - 0.004, w0[1] - 0.006, w0[2] + 0.03), 0.052, 0.054, 14, 1, rings=2)
tube((w0[0] - 0.004, w0[1] - 0.006, w0[2] + 0.025), (w0[0] - 0.07, w0[1] - 0.15, w0[2] + 0.32), 0.062, 0.085, 14, 2, rings=4)
tube((w0[0] - 0.016, w0[1] - 0.03, w0[2] + 0.085), (w0[0] - 0.02, w0[1] - 0.035, w0[2] + 0.1), 0.068, 0.068, 14, 8, rings=2)

src = C.mesh_object("SRC_fp_hands", bm, M, col_src)
body = C.join_copies([src], "HANDS_body", col_game)
src.hide_render = True
C.unwrap(body, margin=0.006, angle=55.0)
C.bake_atlas(body, "fp_hands", 512, ao_distance=0.05, ao_samples=48)


def split_side(src_ob, name, keep_right):
    ob = src_ob.copy()
    ob.data = src_ob.data.copy()
    col_game.objects.link(ob)
    ob.name = ob.data.name = name
    b = bmesh.new()
    b.from_mesh(ob.data)
    kill = [f for f in b.faces if (f.calc_center_median().x >= 0) != keep_right]
    bmesh.ops.delete(b, geom=kill, context="FACES")
    b.to_mesh(ob.data)
    b.free()
    return ob


right = split_side(body, "HANDS_right", True)
left = split_side(body, "HANDS_left", False)
right["a3d_side"] = "right"
left["a3d_side"] = "left"
bpy.data.objects.remove(body)

# ---------------------------------------------------------------- emissive lens + scanner screen (own small atlas)
scr_path = os.path.join(C.TEX_DIR, "fp_hands_emissive.png")
img = Image.new("RGB", (256, 128), (0, 0, 0))
d = ImageDraw.Draw(img)
d.ellipse([10, 10, 118, 118], fill=(255, 246, 225))                     # lens (left half)
d.rectangle([128, 0, 255, 127], fill=(4, 26, 30))                       # scanner screen (right half)
for r in (16, 32, 48):
    d.ellipse([192 - r, 64 - r, 192 + r, 64 + r], outline=(70, 230, 220), width=2)
d.line([192, 64, 236, 30], fill=(160, 255, 240), width=3)
d.line([136, 64, 248, 64], fill=(40, 130, 130), width=1)
d.line([192, 8, 192, 120], fill=(40, 130, 130), width=1)
for x, y in ((214, 46), (171, 85), (205, 92)):
    d.ellipse([x - 4, y - 4, x + 4, y + 4], fill=(255, 196, 120))
img = Image.blend(img, img.filter(ImageFilter.GaussianBlur(2)), 0.35)
img.save(scr_path)
M_EMI = C.mat_emissive("GM_HandsEmissive", (1, 1, 1), 2.2, bpy.data.images.load(scr_path))


def quad_object(name, pts, uvs, **props):
    b = bmesh.new()
    uv = b.loops.layers.uv.new("UVMap")
    f = b.faces.new([b.verts.new(V(*p)) for p in pts])
    for loop, c in zip(f.loops, uvs):
        loop[uv].uv = c
    ob = C.mesh_object(name, b, M_EMI, col_game)
    for k, v in props.items():
        ob[k] = v
    return ob


lens_pts = []
for k in range(4):
    a = k * math.tau / 4 + math.pi / 4
    lens_pts.append((TX + 0.027 * math.cos(a) + RIGHT_SHIFT[0], TY + 0.027 * math.sin(a) + RIGHT_SHIFT[1], -0.3065 + RIGHT_SHIFT[2]))
lens = quad_object("TORCH_lens", lens_pts, [(0.0, 0.0), (0.5, 0.0), (0.5, 1.0), (0.0, 1.0)], a3d_group="torch", a3d_side="right")
screen = quad_object("SCANNER_screen", [S(-0.042, -0.044, 0.0135), S(0.042, -0.044, 0.0135), S(0.042, 0.064, 0.0135), S(-0.042, 0.064, 0.0135)],
                     [(0.52, 0.02), (0.98, 0.02), (0.98, 0.98), (0.52, 0.98)], a3d_group="scanner", a3d_side="left")

root = bpy.data.objects.new("HANDS_root", None)
col_game.objects.link(root)
root["a3d_model"] = "fp_hands"
root["a3d_viewspace"] = 1
for o in (right, left, lens, screen):
    o.parent = root
glb = os.path.join(C.GAME_MODELS, "fp_hands.glb")
size = C.export_glb([root, right, left, lens, screen], glb)
print("STATS", {"HANDS_right": C.tri_count(right), "HANDS_left": C.tri_count(left)}, "glb_bytes", size)
C.save_blend("fp_hands")
