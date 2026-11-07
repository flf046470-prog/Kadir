"""Dr. Selin — rigged polar researcher (NPC 'explorer').

Produces blender/source/explorer.blend, blender/textures/explorer_*.png and
ios/Antarktika/Game/models/explorer.glb (skinned mesh + LOD1, 17 bones,
animations Idle / Walk / Run / Interact at 30 fps, in place).

Built facing Blender -Y (= glTF +Z). Feet at the origin, height ~1.84 m.
Walk cycle: 30 frames, 2 steps, designed for 1.35 m/s. Run: 20 frames for 3.6 m/s.
Foot contacts (for footstep sounds): Walk frames 0 and 15, Run frames 0 and 10.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402  (must precede bmesh when used as a module)
import bmesh  # noqa: E402
from mathutils import Matrix, Quaternion, Vector  # noqa: E402

import a3d_common as C  # noqa: E402

scene = C.reset_scene()
scene.render.fps = 30
col_src = C.collection("SRC_procedural")
col_game = C.collection("GAME_export")

# ------------------------------------------------------------------ skeleton
BONES = [
    ("hips", None, (0, 0, 0.98), (0, 0, 1.10)),
    ("spine", "hips", (0, 0, 1.10), (0, 0, 1.30)),
    ("chest", "spine", (0, 0, 1.30), (0, 0, 1.50)),
    ("neck", "chest", (0, 0, 1.50), (0, 0, 1.60)),
    ("head", "neck", (0, 0, 1.60), (0, 0, 1.86)),
]
for s, sx in (("L", 1), ("R", -1)):
    BONES += [
        ("upper_arm.%s" % s, "chest", (0.235 * sx, 0, 1.46), (0.285 * sx, 0.0, 1.19)),
        ("forearm.%s" % s, "upper_arm.%s" % s, (0.285 * sx, 0.0, 1.19), (0.30 * sx, -0.03, 0.97)),
        ("hand.%s" % s, "forearm.%s" % s, (0.30 * sx, -0.03, 0.97), (0.305 * sx, -0.04, 0.86)),
        ("thigh.%s" % s, "hips", (0.10 * sx, 0, 0.95), (0.10 * sx, 0.0, 0.52)),
        ("shin.%s" % s, "thigh.%s" % s, (0.10 * sx, 0.0, 0.52), (0.10 * sx, 0.02, 0.10)),
        ("foot.%s" % s, "shin.%s" % s, (0.10 * sx, 0.02, 0.10), (0.10 * sx, -0.13, 0.03)),
    ]
BONE_INDEX = {b[0]: i for i, b in enumerate(BONES)}

arm_data = bpy.data.armatures.new("Selin_Rig")
arm = bpy.data.objects.new("Selin_Rig", arm_data)
col_game.objects.link(arm)
bpy.context.view_layer.objects.active = arm
arm.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
for name, parent, head, tail in BONES:
    eb = arm_data.edit_bones.new(name)
    eb.head, eb.tail = head, tail
    eb.roll = 0.0
    if parent:
        eb.parent = arm_data.edit_bones[parent]
        eb.use_connect = False
bpy.ops.object.mode_set(mode="OBJECT")

# ------------------------------------------------------------------ materials
MATS = [
    C.mat_fabric("M_Parka", (0.72, 0.11, 0.035), weave=220.0),            # 0
    C.mat_fabric("M_Pants", (0.05, 0.07, 0.11), weave=260.0),             # 1
    C.mat_plain("M_Boot", (0.05, 0.05, 0.055), rough=0.7),                # 2
    C.mat_plain("M_Glove", (0.03, 0.03, 0.035), rough=0.75),              # 3
    C.mat_painted_metal("M_Helmet", (0.86, 0.87, 0.86), rough=0.35, metal=0.0, seams=False, grime=0.15),  # 4
    C.mat_plain("M_Lens", (0.25, 0.12, 0.03), rough=0.08, metal=0.6, noise=0.02),  # 5
    C.mat_plain("M_Fur", (0.62, 0.57, 0.50), rough=0.95, noise=0.35),     # 6
    C.mat_fabric("M_Balaclava", (0.10, 0.10, 0.11), weave=300.0),        # 7
    C.mat_fabric("M_Pack", (0.20, 0.24, 0.20), weave=160.0),             # 8
    C.mat_plain("M_Strap", (0.02, 0.02, 0.02), rough=0.6),                # 9
    C.mat_plain("M_Reflect", (0.80, 0.82, 0.80), rough=0.3),              # 10
    C.mat_painted_metal("M_Radio", (0.12, 0.13, 0.13), rough=0.4, metal=0.3, seams=False),  # 11
]

bm = bmesh.new()
dl = bm.verts.layers.deform.verify()


def weigh(v, weights):
    tot = sum(w for _, w in weights) or 1.0
    for bone, w in weights:
        if w > 1e-4:
            v[dl][BONE_INDEX[bone]] = w / tot


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def frame(d):
    d = d.normalized()
    up = Vector((1, 0, 0)) if abs(d.x) < 0.9 else Vector((0, 1, 0))
    u = (up - d * up.dot(d)).normalized()
    return u, d.cross(u)


def profile_tube(p0, p1, rings, segs, mat, weight_fn, caps=True):
    """rings: list of (t, rx, ry, offset_y). weight_fn(t) -> [(bone, w)]."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    u, v = frame(d)
    loops = []
    for t, rx, ry, oy in rings:
        c = p0 + d * t + Vector((0, oy, 0))
        loop = []
        for k in range(segs):
            a = k / segs * math.tau
            vert = bm.verts.new(c + u * (math.cos(a) * rx) + v * (math.sin(a) * ry))
            weigh(vert, weight_fn(t))
            loop.append(vert)
        loops.append(loop)
    faces = []
    for i in range(len(loops) - 1):
        for k in range(segs):
            faces.append(bm.faces.new((loops[i][k], loops[i][(k + 1) % segs], loops[i + 1][(k + 1) % segs], loops[i + 1][k])))
    if caps:
        for loop, t in ((loops[0], rings[0][0]), (loops[-1], rings[-1][0])):
            c = bm.verts.new(sum((vv.co for vv in loop), Vector()) / len(loop))
            weigh(c, weight_fn(t))
            for k in range(segs):
                faces.append(bm.faces.new((loop[k], loop[(k + 1) % segs], c)))
    for f in faces:
        f.material_index = mat
        f.smooth = True
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    return faces


def tube(p0, p1, r0, r1, segs, mat, weight_fn, squash=1.0, rings=4, puff=0.0):
    rs = []
    for i in range(rings):
        t = i / (rings - 1)
        r = r0 + (r1 - r0) * t + puff * math.sin(t * math.pi)
        rs.append((t, r, r * squash, 0.0))
    return profile_tube(p0, p1, rs, segs, mat, weight_fn)


def sphere(center, radius, mat, weights, scale=(1, 1, 1), segs=12, rings=8, top_only=False):
    geom = bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=radius)
    verts = geom["verts"]
    if top_only:
        bmesh.ops.delete(bm, geom=[vv for vv in verts if vv.co.z < -radius * 0.05], context="VERTS")
        verts = [vv for vv in verts if vv.is_valid]
    for vv in verts:
        vv.co = Vector(center) + Vector((vv.co.x * scale[0], vv.co.y * scale[1], vv.co.z * scale[2]))
        weigh(vv, weights)
    faces = {f for vv in verts for f in vv.link_faces}
    for f in faces:
        f.material_index = mat
        f.smooth = True
    return faces


def box(center, size, mat, weights):
    geom = bmesh.ops.create_cube(bm, size=1.0)
    for vv in geom["verts"]:
        vv.co = Vector(center) + Vector((vv.co.x * size[0], vv.co.y * size[1], vv.co.z * size[2]))
        weigh(vv, weights)
    for f in {f for vv in geom["verts"] for f in vv.link_faces}:
        f.material_index = mat
    return geom["verts"]


def torus(center, major, minor, axis, mat, weights, segs=16, sides=6):
    ax = Vector(axis).normalized()
    u, v = frame(ax)
    rings = []
    for i in range(segs):
        a = i / segs * math.tau
        cdir = u * math.cos(a) + v * math.sin(a)
        ring = []
        for k in range(sides):
            b = k / sides * math.tau
            p = Vector(center) + cdir * (major + minor * math.cos(b)) + ax * (minor * math.sin(b))
            vert = bm.verts.new(p)
            weigh(vert, weights)
            ring.append(vert)
        rings.append(ring)
    for i in range(segs):
        for k in range(sides):
            f = bm.faces.new((rings[i][k], rings[(i + 1) % segs][k], rings[(i + 1) % segs][(k + 1) % sides], rings[i][(k + 1) % sides]))
            f.material_index = mat
            f.smooth = True


# ------------------------------------------------------------------ body
for s, sx in (("L", 1), ("R", -1)):
    X = 0.10 * sx
    # boot: foot capsule + shaft + sole + reflective strap
    profile_tube((X, 0.075, 0.075), (X, -0.175, 0.07),
                 [(0.0, 0.055, 0.06, 0), (0.15, 0.068, 0.07, 0), (0.6, 0.068, 0.062, 0), (0.92, 0.058, 0.05, 0), (1.0, 0.03, 0.03, 0)],
                 12, 2, lambda t, s=s: [("foot.%s" % s, smoothstep(0.1, 0.45, t)), ("shin.%s" % s, 1 - smoothstep(0.1, 0.45, t))])
    tube((X, 0.02, 0.06), (X, 0.01, 0.32), 0.074, 0.08, 12, 2, lambda t, s=s: [("shin.%s" % s, 1.0)], rings=3)
    box((X, -0.05, 0.012), (0.075, 0.13, 0.012), 2, [("foot.%s" % s, 0.7), ("shin.%s" % s, 0.3)])
    torus((X, 0.012, 0.29), 0.082, 0.012, (0, 0, 1), 10, [("shin.%s" % s, 1.0)], segs=12, sides=4)
    # trousers
    tube((X, 0.01, 0.30), (X, 0.0, 0.54), 0.08, 0.088, 12, 1, lambda t, s=s: [("shin.%s" % s, 1 - 0.5 * smoothstep(0.7, 1.0, t)), ("thigh.%s" % s, 0.5 * smoothstep(0.7, 1.0, t))])
    sphere((X, -0.012, 0.53), 0.088, 1, [("shin.%s" % s, 0.5), ("thigh.%s" % s, 0.5)], segs=10, rings=6)
    tube((X, 0.0, 0.53), (X * 1.04, 0.0, 0.96), 0.09, 0.118, 12, 1,
         lambda t, s=s: [("thigh.%s" % s, 1 - 0.45 * smoothstep(0.75, 1.0, t)), ("hips", 0.45 * smoothstep(0.75, 1.0, t))], puff=0.008)
    # arm: shoulder, sleeve, elbow, puffy cuff, mitten + thumb, reflective band
    sphere((0.228 * sx, 0.0, 1.46), 0.09, 0, [("chest", 0.5), ("upper_arm.%s" % s, 0.5)], segs=10, rings=6)
    tube((0.235 * sx, 0.0, 1.47), (0.285 * sx, 0.0, 1.19), 0.078, 0.066, 10, 0,
         lambda t, s=s: [("upper_arm.%s" % s, smoothstep(0.0, 0.3, t) * 0.7 + 0.3), ("chest", 0.7 * (1 - smoothstep(0.0, 0.3, t)))], puff=0.01)
    sphere((0.285 * sx, 0.0, 1.19), 0.066, 0, [("upper_arm.%s" % s, 0.5), ("forearm.%s" % s, 0.5)], segs=10, rings=6)
    tube((0.285 * sx, 0.0, 1.19), (0.30 * sx, -0.03, 0.98), 0.066, 0.074, 10, 0, lambda t, s=s: [("forearm.%s" % s, 1.0)], puff=0.006)
    torus((0.293 * sx, -0.016, 1.08), 0.07, 0.008, (0.07 * sx, -0.14, -1.0), 10, [("forearm.%s" % s, 1.0)], segs=10, sides=4)
    profile_tube((0.30 * sx, -0.03, 0.985), (0.305 * sx, -0.045, 0.83),
                 [(0.0, 0.05, 0.042, 0), (0.25, 0.056, 0.036, 0), (0.75, 0.054, 0.033, 0), (1.0, 0.02, 0.018, 0)],
                 10, 3, lambda t, s=s: [("hand.%s" % s, smoothstep(0.0, 0.25, t)), ("forearm.%s" % s, 1 - smoothstep(0.0, 0.25, t))])
    tube((0.28 * sx, -0.07, 0.95), (0.27 * sx, -0.085, 0.885), 0.02, 0.016, 6, 3, lambda t, s=s: [("hand.%s" % s, 1.0)], rings=3)

# parka torso (quilted puffer profile) with hem
rings = [(0.0, 0.205, 0.155, 0.0), (0.12, 0.222, 0.165, 0.0), (0.28, 0.218, 0.16, 0.0), (0.45, 0.226, 0.168, 0.0),
         (0.62, 0.236, 0.172, 0.005), (0.78, 0.24, 0.17, 0.01), (0.9, 0.215, 0.15, 0.01), (1.0, 0.12, 0.10, 0.0)]


def torso_w(t):
    z = 0.82 + t * 0.74
    return [("hips", 1 - smoothstep(0.98, 1.12, z)), ("spine", smoothstep(0.98, 1.12, z) * (1 - smoothstep(1.24, 1.36, z))), ("chest", smoothstep(1.24, 1.36, z))]


profile_tube((0, 0, 0.82), (0, 0, 1.56), rings, 16, 0, torso_w)
box((0, -0.172, 1.18), (0.01, 0.01, 0.32), 9, [("spine", 0.6), ("chest", 0.4)])          # zip
# collar, neck, head, balaclava, helmet, goggles, fur hood ruff
torus((0, 0.0, 1.565), 0.125, 0.055, (0, 0, 1), 6, [("neck", 0.6), ("chest", 0.4)], segs=16, sides=8)
tube((0, 0.0, 1.55), (0, 0.0, 1.66), 0.07, 0.072, 10, 7, lambda t: [("neck", 1 - t * 0.6), ("head", t * 0.6)], rings=3)
sphere((0, -0.01, 1.73), 0.112, 7, [("head", 1.0)], scale=(1.0, 1.08, 1.08), segs=14, rings=10)
sphere((0, 0.008, 1.755), 0.132, 4, [("head", 1.0)], scale=(1.0, 1.1, 0.95), segs=16, rings=10, top_only=True)
torus((0, 0.008, 1.758), 0.131, 0.012, (0, 0, 1), 9, [("head", 1.0)], segs=16, sides=4)
torus((0, -0.004, 1.735), 0.118, 0.016, (0, 0.05, 1), 9, [("head", 1.0)], segs=16, sides=4)
profile_tube((-0.085, -0.105, 1.735), (0.085, -0.105, 1.735), [(0.0, 0.03, 0.025, 0), (0.5, 0.036, 0.03, -0.012), (1.0, 0.03, 0.025, 0)], 8, 5, lambda t: [("head", 1.0)])
torus((0, -0.075, 1.70), 0.145, 0.045, (0, 1, 0.08), 6, [("head", 1.0)], segs=18, sides=7)
# backpack with bedroll, straps, antenna; chest radio
box((0, 0.255, 1.22), (0.165, 0.095, 0.22), 8, [("chest", 0.65), ("spine", 0.35)])
box((0, 0.26, 1.08), (0.15, 0.09, 0.06), 8, [("spine", 0.8), ("chest", 0.2)])
tube((-0.19, 0.25, 1.49), (0.19, 0.25, 1.49), 0.075, 0.075, 12, 6, lambda t: [("chest", 1.0)], rings=3)
for sx in (1, -1):
    box((0.11 * sx, -0.02, 1.47), (0.03, 0.17, 0.012), 9, [("chest", 1.0)])
    box((0.11 * sx, -0.172, 1.33), (0.026, 0.01, 0.13), 9, [("chest", 1.0)])
tube((0.12, 0.30, 1.42), (0.13, 0.31, 1.78), 0.008, 0.004, 5, 9, lambda t: [("chest", 1.0)], rings=2)
box((-0.09, -0.183, 1.36), (0.035, 0.018, 0.06), 11, [("chest", 1.0)])
box((-0.09, -0.19, 1.43), (0.006, 0.006, 0.025), 9, [("chest", 1.0)])

src = C.mesh_object("SRC_selin_body", bm, MATS, col_src)
for name, *_ in BONES:
    src.vertex_groups.new(name=name)
print("source tris", C.tri_count(src))

# ------------------------------------------------------------------ bake to one PBR set
body = C.join_copies([src], "Selin", col_game)
src.hide_render = True
C.unwrap(body, margin=0.006, angle=55.0)
C.bake_atlas(body, "explorer", 1024, ao_distance=0.18, ao_samples=48)
lod1 = C.make_lod(body, 0.38, "Selin_LOD1")
body["a3d_lod_far"] = 28.0
lod1["a3d_lod_near"] = 28.0
for ob in (body, lod1):
    # skinned meshes stay root nodes (glTF: parent transforms never affect a skinned mesh)
    mod = ob.modifiers.new("Armature", "ARMATURE")
    mod.object = arm

# ------------------------------------------------------------------ animation
FPS = 30


def q(axis, deg):
    return Quaternion(Vector(axis).normalized(), math.radians(deg))


def pose_key(action_name, frames, keys, loop=True, hip_bob=None):
    """keys: {frame: {bone: armature-space Quaternion}} -> bone-local keyframes."""
    act = bpy.data.actions.new(action_name)
    act.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = act
    pose = arm.pose
    for pb in pose.bones:
        pb.rotation_mode = "QUATERNION"
    for f in sorted(keys):
        for pb in pose.bones:
            rest = pb.bone.matrix_local.to_quaternion()
            qw = keys[f].get(pb.name, Quaternion())
            pb.rotation_quaternion = rest.inverted() @ qw @ rest
            pb.keyframe_insert("rotation_quaternion", frame=f + 1)
        hb = pose.bones["hips"]
        hb.location = (0, hip_bob(f) if hip_bob else 0.0, 0)
        hb.keyframe_insert("location", frame=f + 1)
    if loop:
        first = min(keys)
        for pb in pose.bones:
            rest = pb.bone.matrix_local.to_quaternion()
            qw = keys[first].get(pb.name, Quaternion())
            pb.rotation_quaternion = rest.inverted() @ qw @ rest
            pb.keyframe_insert("rotation_quaternion", frame=frames + 1)
        hb = pose.bones["hips"]
        hb.location = (0, hip_bob(first) if hip_bob else 0.0, 0)
        hb.keyframe_insert("location", frame=frames + 1)
    arm.animation_data.action = None
    return act


X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)
# forward is -Y, so a rotation about +X with a negative angle swings a limb forward.


def gait(n_frames, stride, knee, arm_swing, lean, twist, bob, elbow):
    keys = {}
    for f in range(0, n_frames, 2):
        ph = f / n_frames * math.tau
        s = math.sin(ph)
        k = {}
        k["hips"] = q(Z, twist * s) @ q(X, -lean * 0.3)
        k["spine"] = q(X, -lean * 0.5) @ q(Z, -twist * 0.6 * s)
        k["chest"] = q(X, -lean * 0.4) @ q(Z, -twist * 0.8 * s)
        k["neck"] = q(X, lean * 0.6)
        k["head"] = q(X, lean * 0.3) @ q(Z, twist * 0.3 * s)
        for side, sgn in (("L", 1), ("R", -1)):
            p = s * sgn
            lift = max(0.0, -math.sin(ph + (0 if sgn > 0 else math.pi) + 0.6))
            k["thigh.%s" % side] = q(X, -stride * p)
            k["shin.%s" % side] = q(X, knee * (0.25 + 0.75 * lift))
            k["foot.%s" % side] = q(X, -8 * p - 6 * lift)
            k["upper_arm.%s" % side] = q(X, arm_swing * p) @ q(Y, -4 * sgn)
            k["forearm.%s" % side] = q(X, -elbow - 10 * max(0.0, -p))
            k["hand.%s" % side] = q(X, -5)
        keys[f] = k
    return keys, (lambda f: -abs(math.cos(f / n_frames * math.tau)) * bob + bob * 0.5)


walk_keys, walk_bob = gait(30, 24, 38, 18, 4, 5, 0.035, 18)
run_keys, run_bob = gait(20, 38, 70, 32, 14, 9, 0.06, 55)
idle = {}
for f in range(0, 90, 6):
    ph = f / 90 * math.tau
    br = math.sin(ph * 2)
    look = math.sin(ph) * 28 * smoothstep(0.2, 0.5, abs(math.sin(ph)))
    k = {"spine": q(X, 1.2 * br), "chest": q(X, 1.6 * br), "neck": q(Z, look * 0.35), "head": q(Z, look * 0.65) @ q(X, 3 * math.sin(ph * 3))}
    for side, sgn in (("L", 1), ("R", -1)):
        k["upper_arm.%s" % side] = q(Y, -3 * sgn) @ q(X, 2 * br)
        k["forearm.%s" % side] = q(X, -14 - 2 * br)
    idle[f] = k
interact = {}
for f in range(0, 60, 3):
    t = f / 60
    up = smoothstep(0.0, 0.25, t) * (1 - smoothstep(0.75, 1.0, t))
    talk = math.sin(t * math.tau * 3) * up
    k = {"head": q(X, 6 * up + 4 * talk), "neck": q(X, 3 * up), "chest": q(Z, 8 * up)}
    k["upper_arm.R"] = q(X, -70 * up) @ q(Y, -12 * up) @ q(Z, -10 * up)
    k["forearm.R"] = q(X, -75 * up - 8 * talk)
    k["hand.R"] = q(Z, 15 * talk)
    k["upper_arm.L"] = q(Y, -3)
    k["forearm.L"] = q(X, -16)
    interact[f] = k

acts = [pose_key("Idle", 90, idle), pose_key("Walk", 30, walk_keys, hip_bob=walk_bob),
        pose_key("Run", 20, run_keys, hip_bob=run_bob), pose_key("Interact", 60, interact)]
arm.animation_data.action = acts[0]
for pb in arm.pose.bones:
    pb.rotation_quaternion = Quaternion()
    pb.location = (0, 0, 0)

arm["a3d_model"] = "explorer"
arm["a3d_contacts"] = {"Walk": [0.0, 0.5], "Run": [0.0, 0.5]}
arm["a3d_speed"] = {"Walk": 1.35, "Run": 3.6}
glb = os.path.join(C.GAME_MODELS, "explorer.glb")
size = C.export_glb([arm, body, lod1], glb, animations=True)
print("STATS", {"Selin": C.tri_count(body), "Selin_LOD1": C.tri_count(lod1)}, "glb_bytes", size, "actions", [a.name for a in acts])
C.save_blend("explorer")
