"""Cinematic (photoreal-style) trailer shots rendered with Cycles from the game's own
Blender assets: physical sky at dusk, volumetric blizzard haze, displaced snow
terrain, falling snow with motion blur, depth of field, AgX view transform.

Usage:
    python render_trailer.py <out_dir> [shot ...] [--frames N] [--preview]
Shots:
    station  slow push toward HELIKON-14 in the storm (beacon, warm windows)
    cave     dolly into the ice cave chamber toward the glowing glyph
    selin    Dr. Selin walks toward camera through the snow
    match    the exact in-game camera at the foot of the ramp (cut to engine)
Each shot renders to <out_dir>/<shot>/####.png at 1280x720.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Euler, Vector  # noqa: E402

import a3d_common as C  # noqa: E402
import terrain as T  # noqa: E402

_argv = sys.argv[1:]
if "--frames" in _argv:
    _i = _argv.index("--frames")
    _argv = _argv[:_i] + _argv[_i + 2:]
args = [a for a in _argv if not a.startswith("--")]
OUT = args[0] if args else "/tmp/trailer"
SHOTS = args[1:] or ["station", "cave", "selin", "match"]
PREVIEW = "--preview" in sys.argv
FRAMES = int(sys.argv[sys.argv.index("--frames") + 1]) if "--frames" in sys.argv else None
FPS = 24


def G(x, y, z):
    return Vector((x, -z, y))


def append_collection(blend, prefix_skip=("SRC_", "COL_", "FLOOR_", "VOL_", "INT_", "LIGHT_", "PATH_")):
    """Append the game-export objects of a built .blend (meshes only + armature)."""
    path = os.path.join(C.SOURCE_DIR, blend + ".blend")
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = [n for n in src.objects if not n.startswith(prefix_skip)]
        dst.actions = list(src.actions)
    obs = []
    for o in dst.objects:
        if o is None:
            continue
        if o.type in ("MESH", "ARMATURE"):
            bpy.context.scene.collection.objects.link(o)
            obs.append(o)
    return obs


def setup_scene(sun_elev=6.0, sun_rot=215.0, haze=0.012):
    scene = C.reset_scene()
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 12 if PREVIEW else 28
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 4
    scene.cycles.volume_bounces = 0
    scene.cycles.volume_step_rate = 4.0
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    scene.render.fps = FPS
    scene.render.use_motion_blur = True
    scene.render.motion_blur_shutter = 0.5
    try:
        scene.view_settings.view_transform = "AgX"
        scene.view_settings.look = "AgX - Medium High Contrast"
        scene.view_settings.exposure = 0.9
    except TypeError:
        scene.view_settings.view_transform = "Filmic"
    scene.render.image_settings.file_format = "PNG"
    # physical sky (dusk), blizzard haze as a world volume
    w = scene.world
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    sky = nt.nodes.new("ShaderNodeTexSky")
    for kind in ("MULTIPLE_SCATTERING", "NISHITA"):
        try:
            sky.sky_type = kind
            break
        except TypeError:
            continue
    sky.sun_elevation = math.radians(sun_elev)
    sky.sun_rotation = math.radians(sun_rot)
    sky.altitude = 2800
    sky.air_density = 1.6
    sky.sun_disc = True
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = 1.35
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(sky.outputs[0], bg.inputs[0])
    nt.links.new(bg.outputs[0], out.inputs["Surface"])
    # blizzard haze in a bounded box (a world volume would swallow the sky and the sun)
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    me = bpy.data.meshes.new("Haze")
    bm.to_mesh(me)
    haze_ob = bpy.data.objects.new("Haze", me)
    haze_ob.scale = (320, 320, 90)
    haze_ob.location = (0, 0, 40)
    scene.collection.objects.link(haze_ob)
    hm = bpy.data.materials.new("HazeMat")
    hm.use_nodes = True
    hn = hm.node_tree
    hn.nodes.remove(hn.nodes["Principled BSDF"])
    vol = hn.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Density"].default_value = haze
    vol.inputs["Color"].default_value = (0.82, 0.88, 0.93, 1)
    vol.inputs["Anisotropy"].default_value = 0.4
    hn.links.new(vol.outputs[0], hn.nodes["Material Output"].inputs["Volume"])
    me.materials.append(hm)
    haze_ob.visible_shadow = False
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 4.5
    sun.data.angle = math.radians(1.5)
    sun.data.color = (1.0, 0.82, 0.66)
    sun.rotation_euler = Euler((math.radians(90 - sun_elev), 0, math.radians(sun_rot)), "XYZ")
    scene.collection.objects.link(sun)
    return scene


def snow_terrain(cx, cz, half, res=180):
    """Displaced snow surface following the game terrain, with fine sastrugi."""
    import bmesh
    bm = bmesh.new()
    rnd = random.Random(7)
    verts = {}
    for j in range(res + 1):
        for i in range(res + 1):
            x = cx - half + 2 * half * i / res
            z = cz - half + 2 * half * j / res
            y = T.terrain_y(x, z) + 0.06 * math.sin(x * 2.1 + z * 0.7) * math.sin(z * 1.3) + 0.02 * (rnd.random() - 0.5)
            verts[(i, j)] = bm.verts.new(G(x, y, z))
    for j in range(res):
        for i in range(res):
            f = bm.faces.new((verts[(i, j)], verts[(i + 1, j)], verts[(i + 1, j + 1)], verts[(i, j + 1)]))
            f.smooth = True
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("SnowTerrain")
    bm.to_mesh(me)
    ob = bpy.data.objects.new("SnowTerrain", me)
    bpy.context.scene.collection.objects.link(ob)
    m = bpy.data.materials.new("Snow_Cine")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.86, 0.9, 0.95, 1)
    b.inputs["Roughness"].default_value = 0.55
    try:
        b.inputs["Subsurface Weight"].default_value = 0.35
        b.inputs["Subsurface Radius"].default_value = (0.3, 0.5, 0.8)
        b.inputs["Coat Weight"].default_value = 0.08
    except KeyError:
        pass
    nt = m.node_tree
    tc = nt.nodes.new("ShaderNodeTexCoord")
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = 60.0
    n.inputs["Detail"].default_value = 8.0
    nt.links.new(tc.outputs["Object"], n.inputs["Vector"])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.25
    nt.links.new(n.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    me.materials.append(m)
    return ob


def mountains():
    """Far ridges: displaced planes with snow/rock split by slope."""
    import bmesh
    for side, (cx, cz) in enumerate(((-30, -330), (190, -180), (-210, -160))):
        bm = bmesh.new()
        res, w = 70, 260
        verts = {}
        rnd = random.Random(30 + side)
        ph = [rnd.uniform(0, 6) for _ in range(4)]
        for j in range(res + 1):
            for i in range(res + 1):
                u, v = i / res - 0.5, j / res - 0.5
                ridge = max(0.0, 1 - abs(v) * 2.2)
                h = (90 + 60 * math.sin(u * 7 + ph[0]) + 35 * math.sin(u * 19 + ph[1]) + 18 * math.sin(u * 41 + ph[2])) * ridge ** 1.4
                h += 6 * math.sin(u * 90 + v * 30 + ph[3]) * ridge
                verts[(i, j)] = bm.verts.new(G(cx + u * w * 2, h - 10, cz + v * 120))
        for j in range(res):
            for i in range(res):
                bm.faces.new((verts[(i, j)], verts[(i + 1, j)], verts[(i + 1, j + 1)], verts[(i, j + 1)])).smooth = True
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        me = bpy.data.meshes.new("Ridge%d" % side)
        bm.to_mesh(me)
        ob = bpy.data.objects.new("Ridge%d" % side, me)
        bpy.context.scene.collection.objects.link(ob)
        m = bpy.data.materials.new("Ridge%d" % side)
        m.use_nodes = True
        nt = m.node_tree
        b = nt.nodes["Principled BSDF"]
        geo = nt.nodes.new("ShaderNodeNewGeometry")
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(geo.outputs["Normal"], sep.inputs[0])
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[0].color = 0.55, (0.12, 0.13, 0.15, 1)
        ramp.color_ramp.elements[1].position, ramp.color_ramp.elements[1].color = 0.72, (0.88, 0.92, 0.96, 1)
        nt.links.new(sep.outputs["Z"], ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
        b.inputs["Roughness"].default_value = 0.7
        me.materials.append(m)


def falling_snow(center, radius, count, frames, wind=(1.6, 0.0, 0.6)):
    """Instanced flakes animated with keyframes (motion blur streaks them)."""
    import bmesh
    rnd = random.Random(11)
    flake = bpy.data.meshes.new("flake")
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.012)
    bm.to_mesh(flake)
    m = bpy.data.materials.new("FlakeMat")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (1, 1, 1, 1)
    b.inputs["Roughness"].default_value = 0.4
    try:
        b.inputs["Emission Color"].default_value = (0.9, 0.95, 1, 1)
        b.inputs["Emission Strength"].default_value = 0.4
    except KeyError:
        pass
    flake.materials.append(m)
    col = bpy.data.collections.new("Snowfall")
    bpy.context.scene.collection.children.link(col)
    for i in range(count):
        ob = bpy.data.objects.new("f%d" % i, flake)
        col.objects.link(ob)
        start = Vector((center[0] + rnd.uniform(-radius, radius), center[1] + rnd.uniform(0, 7), center[2] + rnd.uniform(-radius, radius)))
        speed = rnd.uniform(0.6, 1.4)
        for f in (1, frames):
            t = (f - 1) / FPS
            p = start + Vector((wind[0] * t * speed, -1.1 * t * speed, wind[2] * t * speed))
            ob.location = G(p.x, p.y, p.z)
            ob.keyframe_insert("location", frame=f)
        if ob.animation_data and ob.animation_data.action:
            for fc in getattr(ob.animation_data.action, "fcurves", []):
                for kp in fc.keyframe_points:
                    kp.interpolation = "LINEAR"


def camera(name, keys, lens=35, fstop=2.8, focus=None):
    cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    bpy.context.scene.collection.objects.link(cam)
    cam.data.lens = lens
    cam.data.clip_start = 0.05
    cam.data.dof.use_dof = focus is not None
    if focus is not None:
        cam.data.dof.aperture_fstop = fstop
    for frame, pos, tgt, fdist in keys:
        cam.location = G(*pos)
        cam.rotation_euler = (G(*tgt) - G(*pos)).to_track_quat("-Z", "Y").to_euler()
        cam.keyframe_insert("location", frame=frame)
        cam.keyframe_insert("rotation_euler", frame=frame)
        if focus is not None:
            cam.data.dof.focus_distance = fdist
            cam.data.keyframe_insert("dof.focus_distance", frame=frame)
    bpy.context.scene.camera = cam
    return cam


def point(name, pos, color, energy, radius=0.2):
    li = bpy.data.objects.new(name, bpy.data.lights.new(name, "POINT"))
    li.data.color = color
    li.data.energy = energy
    li.data.shadow_soft_size = radius
    li.location = G(*pos)
    bpy.context.scene.collection.objects.link(li)
    return li


def render(shot, frames):
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = 1, frames
    sc.render.filepath = os.path.join(OUT, shot, "")
    os.makedirs(sc.render.filepath, exist_ok=True)
    if PREVIEW:
        sc.frame_set(max(1, frames // 2))
        sc.render.filepath = os.path.join(OUT, shot + "_preview.png")
        bpy.ops.render.render(write_still=True)
    else:
        bpy.ops.render.render(animation=True)


def shot_station():
    frames = FRAMES or 6 * FPS
    setup_scene(sun_elev=9.0, sun_rot=230.0, haze=0.0045)
    append_collection("station")
    snow_terrain(20, 28, 70)
    mountains()
    F = 2.76
    point("lab_window", (21.0, F + 1.6, 24.0), (1.0, 0.78, 0.5), 220)
    point("ctrl_window", (29.0, F + 1.6, 30.0), (0.75, 0.85, 1.0), 160)
    point("door_lamp", (11.4, F + 2.4, 27.0), (1.0, 0.75, 0.45), 90)
    point("beacon", (40.0, 2.0 + 16.25, 25.0), (1.0, 0.1, 0.05), 60, 0.1)
    point("drill", (29.5, 1.8, 37.6), (0.3, 0.8, 1.0), 120)
    falling_snow((14, 3, 30), 16, 900 if not PREVIEW else 400, frames)
    camera("cam_station", [(1, (-26, 4.2, 56), (22, 4.0, 27), 50), (frames, (-12, 3.2, 44), (22, 4.2, 27), 38)], lens=42, fstop=4.0, focus=True)
    render("station", frames)


def shot_cave():
    frames = FRAMES or 5 * FPS
    setup_scene(sun_elev=8.0, sun_rot=200.0, haze=0.03)
    for o in append_collection("ice_cave"):
        if o.name.startswith("A1_core"):
            o.hide_render = True
    zc = -52.0
    point("glyph", (-7.6, T.terrain_y(-7.6, zc) + 2.6, zc + 1.0), (0.3, 0.85, 1.0), 400, 0.6)
    point("c1", (-10.9, T.terrain_y(-10.9, -47.4) + 1.0, -47.4), (0.3, 0.8, 1.0), 70)
    point("c2", (-8.0, T.terrain_y(-8.0, -49.4) + 1.0, -49.4), (1.0, 0.75, 0.35), 70)
    point("c3", (-5.1, T.terrain_y(-5.1, -47.4) + 1.0, -47.4), (0.75, 0.5, 1.0), 70)
    torch = bpy.data.objects.new("torch", bpy.data.lights.new("torch", "SPOT"))
    torch.data.energy = 900
    torch.data.spot_size = math.radians(38)
    torch.data.spot_blend = 0.6
    torch.data.color = (1.0, 0.94, 0.85)
    bpy.context.scene.collection.objects.link(torch)
    cam = camera("cam_cave", [(1, (-8.5, T.terrain_y(-8.5, -33) + 1.7, -33), (-7.7, T.terrain_y(-7.7, -50) + 2.0, -51), 12),
                              (frames, (-8.2, T.terrain_y(-8.2, -41) + 1.6, -41.5), (-7.6, T.terrain_y(-7.6, -50) + 2.2, -51.5), 8)], lens=24, fstop=2.2, focus=True)
    torch.parent = cam
    torch.location = (0.25, -0.25, 0)
    render("cave", frames)


def shot_selin():
    frames = FRAMES or 4 * FPS
    setup_scene(sun_elev=10.0, sun_rot=120.0, haze=0.006)
    obs = append_collection("explorer")
    arm = next(o for o in obs if o.type == "ARMATURE")
    for o in obs:
        if o.name.endswith("LOD1"):
            o.hide_render = True
    walk = bpy.data.actions.get("Walk")
    arm.animation_data_create()
    arm.animation_data.action = walk
    try:
        arm.animation_data.action_slot = walk.slots[0]
    except (AttributeError, IndexError):
        pass
    # walk toward camera along +z at 1.35 m/s, looping the 30-frame cycle
    sx, sz = 6.0, 12.0
    for f in range(1, frames + 1, 6):
        t = (f - 1) / FPS
        arm.location = G(sx, T.terrain_y(sx, sz + 1.35 * t), sz + 1.35 * t)
        arm.rotation_euler = (0, 0, 0)
        arm.keyframe_insert("location", frame=f)
    if arm.animation_data:
        nla = arm.animation_data.nla_tracks.new()
        strip = nla.strips.new("walk", 1, walk)
        strip.repeat = frames / 30.0 + 1
        arm.animation_data.action = None
    append_collection("station")
    snow_terrain(8, 18, 40)
    mountains()
    falling_snow((6, 2, 16), 9, 700 if not PREVIEW else 300, frames, wind=(2.4, 0, 0.4))
    camera("cam_selin", [(1, (6.4, T.terrain_y(6.4, 22) + 1.5, 22.5), (6.0, T.terrain_y(6, 13) + 1.3, 12.5), 9.5),
                         (frames, (6.5, T.terrain_y(6.5, 22.5) + 1.45, 23.0), (6.0, T.terrain_y(6, 16) + 1.25, 16.5), 6.2)], lens=70, fstop=2.0, focus=True)
    render("selin", frames)


def shot_match():
    """Same viewpoint as the engine capture at the foot of the ramp (player -2,33; yaw 1.35; eye 1.71 m)."""
    frames = FRAMES or 2 * FPS
    setup_scene(sun_elev=14.0, sun_rot=225.0, haze=0.003)
    append_collection("station")
    snow_terrain(16, 30, 60)
    mountains()
    falling_snow((4, 3, 31), 10, 500 if not PREVIEW else 200, frames)
    px, pz, yaw, pitch = -2.0, 33.0, 1.35, 0.02
    eye = (px, T.terrain_y(px, pz) + 1.71, pz)
    f = (math.sin(yaw) * math.cos(pitch), math.sin(pitch), -math.cos(yaw) * math.cos(pitch))
    tgt = (eye[0] + f[0] * 10, eye[1] + f[1] * 10, eye[2] + f[2] * 10)
    cam = camera("cam_match", [(1, eye, tgt, 20), (frames, eye, tgt, 20)], lens=35, fstop=8.0, focus=True)
    # engine vertical FOV 76 deg
    cam.data.sensor_fit = "VERTICAL"
    cam.data.angle = math.radians(76)
    render("match", frames)


for s in SHOTS:
    {"station": shot_station, "cave": shot_cave, "selin": shot_selin, "match": shot_match}[s]()
    print("SHOT DONE", s)
