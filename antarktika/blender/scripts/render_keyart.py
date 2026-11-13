"""Photoreal key art (Cycles) for the store pages: App Store promo, Steam capsules / library art,
Meta Horizon covers, the trailer's establishing shots and the Meta 360 preview.

    python render_keyart.py <out_dir> [shot ...] [--preview] [--samples N] [--scale S]

Shots (all built from the game's own .blend assets, no stock imagery):
    station    16:9  blue hour at HELIKON-14, aurora australis over the plateau, an expedition member
                     in the foreground looking at the lit station (3840x2160)
    portrait   2:3   the same night, closer: the explorer with a head torch, station behind (2160x3240)
    city       16:9  the subglacial lake basin: ice dome, terraced city, crystal spire (3840x2160)
    camp       16:9  coalition drill camp in the ice cavern, thermal drones' floodlights (3840x2160)
    pano360    2:1   equirectangular panorama in the lake basin at 1.67 m eye height (7680x3840)
Text and logos are added later (tools/make_store_kit.py); the renders carry artwork only.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Euler, Vector  # noqa: E402

import a3d_common as C  # noqa: E402
import render_trailer as RT  # noqa: E402  (setup_scene, snow_terrain, mountains, falling_snow, camera, point)
import terrain as T  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
flags = {a for a in argv if a.startswith("--")}
vals = [a for a in argv if not a.startswith("--")]
OUT = vals[0] if vals else "/tmp/keyart"
SHOTS = [v for v in vals[1:] if not v.replace(".", "").isdigit()] or ["station", "portrait", "city", "camp"]
PREVIEW = "--preview" in flags
SAMPLES = int(argv[argv.index("--samples") + 1]) if "--samples" in argv else (12 if PREVIEW else 96)
SCALE = float(argv[argv.index("--scale") + 1]) if "--scale" in argv else (0.25 if PREVIEW else 1.0)
G = RT.G


def finish_scene(w, h):
    sc = bpy.context.scene
    sc.cycles.samples = SAMPLES
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.02
    sc.cycles.max_bounces = 6
    sc.cycles.diffuse_bounces = 3
    sc.cycles.glossy_bounces = 3
    sc.cycles.transmission_bounces = 6
    sc.cycles.volume_bounces = 1
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = "OPENIMAGEDENOISE"
    except TypeError:
        pass
    sc.render.resolution_x, sc.render.resolution_y = int(w * SCALE), int(h * SCALE)
    sc.render.resolution_percentage = 100
    sc.render.use_motion_blur = False
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_depth = "16"
    sc.frame_set(1)
    if sc.camera:
        sc.camera.data.clip_end = 6000


def render_still(name):
    sc = bpy.context.scene
    os.makedirs(OUT, exist_ok=True)
    sc.render.filepath = os.path.join(OUT, name + (".preview" if PREVIEW else "") + ".png")
    bpy.ops.render.render(write_still=True)
    print("KEYART", sc.render.filepath, sc.render.resolution_x, sc.render.resolution_y)


# ------------------------------------------------------------------ night sky: stars + aurora australis
def night_world(strength=0.05):
    """Nishita sky with the sun below the horizon (blue hour) plus a procedural star field."""
    w = bpy.context.scene.world
    nt = w.node_tree
    bg = next(n for n in nt.nodes if n.type == "BACKGROUND")
    sky = next(n for n in nt.nodes if n.type == "TEX_SKY")
    bg.inputs["Strength"].default_value = strength
    coord = nt.nodes.new("ShaderNodeTexCoord")
    vor = nt.nodes.new("ShaderNodeTexVoronoi")
    vor.inputs["Scale"].default_value = 900.0
    nt.links.new(coord.outputs["Generated"], vor.inputs["Vector"])
    # distance to the cell point → tiny bright points
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[0].color = 0.0, (1, 1, 1, 1)
    ramp.color_ramp.elements[1].position, ramp.color_ramp.elements[1].color = 0.035, (0, 0, 0, 1)
    nt.links.new(vor.outputs["Distance"], ramp.inputs["Fac"])
    # thin out: only cells whose random colour is bright become stars
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(vor.outputs["Color"], sep.inputs[0])
    gate = nt.nodes.new("ShaderNodeMath")
    gate.operation = "GREATER_THAN"
    gate.inputs[1].default_value = 0.82
    nt.links.new(sep.outputs[0], gate.inputs[0])
    mul = nt.nodes.new("ShaderNodeMixRGB")
    mul.blend_type = "MULTIPLY"
    mul.inputs["Fac"].default_value = 1.0
    nt.links.new(ramp.outputs["Color"], mul.inputs[1])
    nt.links.new(gate.outputs[0], mul.inputs[2])
    # stars only above the horizon
    sepz = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(coord.outputs["Generated"], sepz.inputs[0])
    hz = nt.nodes.new("ShaderNodeMath")
    hz.operation = "GREATER_THAN"
    hz.inputs[1].default_value = 0.53
    nt.links.new(sepz.outputs["Z"], hz.inputs[0])
    mul2 = nt.nodes.new("ShaderNodeMixRGB")
    mul2.blend_type = "MULTIPLY"
    mul2.inputs["Fac"].default_value = 1.0
    nt.links.new(mul.outputs[0], mul2.inputs[1])
    nt.links.new(hz.outputs[0], mul2.inputs[2])
    star_bg = nt.nodes.new("ShaderNodeBackground")
    star_bg.inputs["Strength"].default_value = 1.6
    nt.links.new(mul2.outputs[0], star_bg.inputs["Color"])
    add = nt.nodes.new("ShaderNodeAddShader")
    out = next(n for n in nt.nodes if n.type == "OUTPUT_WORLD")
    nt.links.new(bg.outputs[0], add.inputs[0])
    nt.links.new(star_bg.outputs[0], add.inputs[1])
    nt.links.new(add.outputs[0], out.inputs["Surface"])
    return sky


def aurora(center, radius, height, arc_deg=(-70, 70), base=260.0, top=620.0, seed=3, strength=3.0):
    """Curtains of the aurora australis: an arc of vertical ribbons far away, green low, violet high,
    with fine vertical rays (wave texture) and slow folds (noise)."""
    import bmesh
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    rnd = random.Random(seed)
    segs = 160
    a0, a1 = math.radians(arc_deg[0]), math.radians(arc_deg[1])
    cols = []
    for i in range(segs + 1):
        t = i / segs
        a = a0 + (a1 - a0) * t
        r = radius * (1 + 0.08 * math.sin(t * 9 + seed) + 0.04 * math.sin(t * 23))
        x, z = center[0] + r * math.sin(a), center[1] - r * math.cos(a)
        lo = base + 40 * math.sin(t * 7 + 1.3)
        cols.append((bm.verts.new(G(x, lo, z)), bm.verts.new(G(x, top + 80 * math.sin(t * 5), z)), t))
    for i in range(segs):
        (a0v, a1v, ta), (b0v, b1v, tb) = cols[i], cols[i + 1]
        f = bm.faces.new((a0v, b0v, b1v, a1v))
        for loop, c in zip(f.loops, [(ta, 0), (tb, 0), (tb, 1), (ta, 1)]):
            loop[uv].uv = c
    me = bpy.data.meshes.new("Aurora")
    bm.to_mesh(me)
    ob = bpy.data.objects.new("Aurora", me)
    bpy.context.scene.collection.objects.link(ob)
    ob.visible_shadow = False
    m = bpy.data.materials.new("AuroraMat")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["UV"], sep.inputs[0])
    # colour by height: green 557.7 nm oxygen line low, red/violet higher
    cr = nt.nodes.new("ShaderNodeValToRGB")
    e = cr.color_ramp.elements
    e[0].position, e[0].color = 0.0, (0.15, 1.0, 0.45, 1)
    e[1].position, e[1].color = 1.0, (0.55, 0.15, 0.85, 1)
    mid = e.new(0.45)
    mid.color = (0.25, 0.95, 0.55, 1)
    nt.links.new(sep.outputs["Y"], cr.inputs["Fac"])
    # vertical rays along U
    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.inputs["Scale"].default_value = 38.0
    wave.inputs["Distortion"].default_value = 11.0
    wave.inputs["Detail"].default_value = 4.0
    nt.links.new(tc.outputs["UV"], wave.inputs["Vector"])
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 3.5
    noise.inputs["Detail"].default_value = 3.0
    nt.links.new(tc.outputs["UV"], noise.inputs["Vector"])
    # fade: bright sharp lower edge, soft top, soft ends
    fade_y = nt.nodes.new("ShaderNodeValToRGB")
    fy = fade_y.color_ramp.elements
    fy[0].position, fy[0].color = 0.0, (0, 0, 0, 1)
    fy[1].position, fy[1].color = 1.0, (0, 0, 0, 1)
    k1 = fade_y.color_ramp.elements.new(0.04)
    k1.color = (1, 1, 1, 1)
    k2 = fade_y.color_ramp.elements.new(0.35)
    k2.color = (0.45, 0.45, 0.45, 1)
    nt.links.new(sep.outputs["Y"], fade_y.inputs["Fac"])
    fade_x = nt.nodes.new("ShaderNodeValToRGB")
    fx = fade_x.color_ramp.elements
    fx[0].position, fx[0].color = 0.0, (0, 0, 0, 1)
    fx[1].position, fx[1].color = 1.0, (0, 0, 0, 1)
    fade_x.color_ramp.elements.new(0.25).color = (1, 1, 1, 1)
    fade_x.color_ramp.elements.new(0.75).color = (1, 1, 1, 1)
    nt.links.new(sep.outputs["X"], fade_x.inputs["Fac"])
    m1 = nt.nodes.new("ShaderNodeMath")
    m1.operation = "MULTIPLY"
    nt.links.new(wave.outputs["Fac"], m1.inputs[0])
    nt.links.new(noise.outputs["Fac"], m1.inputs[1])
    m2 = nt.nodes.new("ShaderNodeMath")
    m2.operation = "MULTIPLY"
    nt.links.new(m1.outputs[0], m2.inputs[0])
    nt.links.new(fade_y.outputs["Color"], m2.inputs[1])
    m3 = nt.nodes.new("ShaderNodeMath")
    m3.operation = "MULTIPLY"
    nt.links.new(m2.outputs[0], m3.inputs[0])
    nt.links.new(fade_x.outputs["Color"], m3.inputs[1])
    m4 = nt.nodes.new("ShaderNodeMath")
    m4.operation = "MULTIPLY"
    m4.inputs[1].default_value = strength
    nt.links.new(m3.outputs[0], m4.inputs[0])
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(cr.outputs["Color"], em.inputs["Color"])
    nt.links.new(m4.outputs[0], em.inputs["Strength"])
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    add = nt.nodes.new("ShaderNodeAddShader")
    nt.links.new(em.outputs[0], add.inputs[0])
    nt.links.new(tr.outputs[0], add.inputs[1])
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(add.outputs[0], out.inputs["Surface"])
    try:
        m.surface_render_method = "BLENDED"
    except Exception:
        pass
    me.materials.append(m)
    return ob


# ------------------------------------------------------------------ the explorer, posed from the game rig
def explorer(pos, yaw_deg, action="Idle", frame=1, torch=False):
    obs = RT.append_collection("explorer")
    arm = next(o for o in obs if o.type == "ARMATURE")
    for o in obs:
        if o.name.endswith("LOD1") or o.name.startswith("SRC_"):
            o.hide_render = True
        elif o.type == "MESH":
            o.parent = arm
            o.matrix_parent_inverse = arm.matrix_world.inverted()
            for md in o.modifiers:
                if md.type == "ARMATURE":
                    md.object = arm
            sub = o.modifiers.new("Subsurf", "SUBSURF")
            sub.levels, sub.render_levels = 0, 2
            for poly in o.data.polygons:
                poly.use_smooth = True
    act = bpy.data.actions.get(action)
    if act:
        arm.animation_data_create().action = act
        bpy.context.scene.frame_set(frame)
    arm.location = G(pos[0], T.terrain_y(pos[0], pos[2]) if pos[1] is None else pos[1], pos[2])
    arm.rotation_euler = (0, 0, math.radians(yaw_deg))
    if torch:
        li = bpy.data.objects.new("headtorch", bpy.data.lights.new("headtorch", "SPOT"))
        li.data.energy = 120
        li.data.spot_size = math.radians(42)
        li.data.spot_blend = 0.7
        li.data.color = (1.0, 0.95, 0.88)
        li.data.shadow_soft_size = 0.02
        bpy.context.scene.collection.objects.link(li)
        li.parent = arm
        li.location = (0, 0.18, 1.72)
        li.rotation_euler = (math.radians(80), 0, math.radians(180))
    return arm


def station_lights():
    F = 2.76
    RT.point("lab_window", (21.0, F + 1.6, 24.0), (1.0, 0.72, 0.42), 320)
    RT.point("ctrl_window", (29.0, F + 1.6, 30.0), (0.75, 0.85, 1.0), 200)
    RT.point("door_lamp", (11.4, F + 2.4, 27.0), (1.0, 0.7, 0.4), 150)
    RT.point("beacon", (40.0, 2.0 + 16.25, 25.0), (1.0, 0.1, 0.05), 90, 0.1)
    RT.point("drill", (29.5, 1.8, 37.6), (0.3, 0.8, 1.0), 160)
    RT.point("gen", (13.0, 2.4, 35.5), (1.0, 0.8, 0.5), 80)


def shot_station():
    RT.setup_scene(sun_elev=-5.0, sun_rot=210.0, haze=0.0022)
    bpy.data.objects["Sun"].data.energy = 0.0
    night_world(0.9)
    RT.append_collection("station")
    RT.snow_terrain(14, 34, 90, res=220)
    RT.mountains()
    station_lights()
    aurora((20, -20), 820, 0, arc_deg=(-65, 60), base=330, top=900, seed=3, strength=1.5)
    aurora((60, -60), 930, 0, arc_deg=(-40, 75), base=480, top=1150, seed=8, strength=0.9)
    # moonlight-ish fill from the twilight side so the snow reads
    fill = bpy.data.objects.new("twilight", bpy.data.lights.new("twilight", "SUN"))
    fill.data.energy = 0.06
    fill.data.color = (0.55, 0.68, 1.0)
    fill.rotation_euler = Euler((math.radians(75), 0, math.radians(30)), "XYZ")
    bpy.context.scene.collection.objects.link(fill)
    explorer((-9.5, None, 47.0), 124, torch=True)
    RT.falling_snow((-6, 3, 44), 12, 500, 2)
    RT.camera("cam_ka_station", [(1, (-16.5, T.terrain_y(-16.5, 54.0) + 1.55, 54.0), (16, 7.5, 24), 9.2)], lens=26, fstop=4.0, focus=True)
    finish_scene(3840, 2160)
    render_still("keyart_station")


def shot_portrait():
    RT.setup_scene(sun_elev=-4.0, sun_rot=210.0, haze=0.0026)
    bpy.data.objects["Sun"].data.energy = 0.0
    night_world(0.9)
    RT.append_collection("station")
    RT.snow_terrain(10, 40, 70, res=200)
    RT.mountains()
    station_lights()
    aurora((20, -20), 800, 0, arc_deg=(-55, 55), base=300, top=1050, seed=5, strength=1.6)
    fill = bpy.data.objects.new("twilight", bpy.data.lights.new("twilight", "SUN"))
    fill.data.energy = 0.07
    fill.data.color = (0.55, 0.68, 1.0)
    fill.rotation_euler = Euler((math.radians(72), 0, math.radians(40)), "XYZ")
    bpy.context.scene.collection.objects.link(fill)
    # explorer turned three-quarters toward camera, torch lighting the snow ahead
    explorer((-3.2, None, 44.5), 128, torch=True)
    rim = RT.point("rim", (-1.5, T.terrain_y(-1.5, 42.5) + 2.6, 42.5), (0.5, 0.95, 0.7), 40, 0.6)
    RT.falling_snow((-3, 3, 46), 6, 450, 2)
    RT.camera("cam_ka_portrait", [(1, (-5.8, T.terrain_y(-5.8, 49.5) + 1.25, 49.5), (8, 8.5, 26), 5.6)], lens=32, fstop=2.8, focus=True)
    finish_scene(2160, 3240)
    render_still("keyart_portrait")


# ------------------------------------------------------------------ interiors: game LIGHT_ empties → Cycles lights
def interior(blend, light_gain=1.0, haze=0.012, haze_color=(0.55, 0.75, 0.85)):
    sc = C.reset_scene()
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    try:
        sc.view_settings.view_transform = "AgX"
        sc.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        sc.view_settings.view_transform = "Filmic"
    w = sc.world
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.004, 0.008, 0.012, 1)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    path = os.path.join(C.SOURCE_DIR, blend + ".blend")
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = [n for n in src.objects if not n.startswith(("SRC_", "COL_", "FLOOR_", "VOL_", "PATH_"))]
    refs = {}
    for o in dst.objects:
        if o is None:
            continue
        if o.type == "MESH":
            sc.collection.objects.link(o)
        elif o.name.startswith("LIGHT_"):
            col = o.get("a3d_color", [1, 1, 1])
            li = bpy.data.objects.new(o.name, bpy.data.lights.new(o.name, "POINT"))
            li.data.color = tuple(col)
            li.data.energy = float(o.get("a3d_intensity", 1.0)) * float(o.get("a3d_range", 8.0)) ** 2 * 1.6 * light_gain
            li.data.shadow_soft_size = 0.35
            li.location = o.location.copy()
            sc.collection.objects.link(li)
        elif o.name.startswith("INT_"):
            refs[o.name[4:]] = o.location.copy()
    # lift the emissive strengths a touch for film (the game tone-maps differently)
    for m in bpy.data.materials:
        if m.use_nodes:
            for n in m.node_tree.nodes:
                if n.type == "EMISSION":
                    n.inputs["Strength"].default_value *= 1.6
                elif n.type == "BSDF_PRINCIPLED" and "Emission Strength" in n.inputs and n.inputs["Emission Strength"].default_value > 0:
                    n.inputs["Emission Strength"].default_value *= 1.6
    # volumetric haze filling the space (light shafts from the vents / floodlights)
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    me = bpy.data.meshes.new("Haze")
    bm.to_mesh(me)
    hz = bpy.data.objects.new("Haze", me)
    sc.collection.objects.link(hz)
    lo = Vector((min(v.x for v in refs.values()), min(v.y for v in refs.values()), min(v.z for v in refs.values())))
    hi = Vector((max(v.x for v in refs.values()), max(v.y for v in refs.values()), max(v.z for v in refs.values())))
    hz.location = (lo + hi) / 2 + Vector((0, 0, 8))
    hz.scale = (hi - lo) + Vector((90, 90, 40))
    hm = bpy.data.materials.new("HazeMat")
    hm.use_nodes = True
    hn = hm.node_tree
    hn.nodes.remove(hn.nodes["Principled BSDF"])
    vol = hn.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Density"].default_value = haze
    vol.inputs["Color"].default_value = (*haze_color, 1)
    vol.inputs["Anisotropy"].default_value = 0.35
    hn.links.new(vol.outputs[0], hn.nodes["Material Output"].inputs["Volume"])
    me.materials.append(hm)
    hz.visible_shadow = False
    return refs


def cam_at(name, pos_b, tgt_b, lens, fstop=None, focus=None, equirect=False):
    cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    bpy.context.scene.collection.objects.link(cam)
    cam.data.lens = lens
    cam.data.clip_start = 0.05
    cam.location = pos_b
    cam.rotation_euler = (tgt_b - pos_b).to_track_quat("-Z", "Y").to_euler()
    if equirect:
        cam.data.type = "PANO"
        try:
            cam.data.panorama_type = "EQUIRECTANGULAR"
        except AttributeError:
            cam.data.cycles.panorama_type = "EQUIRECTANGULAR"
        cam.rotation_euler = Euler((math.radians(90), 0, 0), "XYZ")
    elif focus:
        cam.data.dof.use_dof = True
        cam.data.dof.aperture_fstop = fstop or 2.8
        cam.data.dof.focus_distance = focus
    bpy.context.scene.camera = cam
    return cam


def shot_city():
    r = interior("helikon_city", light_gain=1.0, haze=0.0012, haze_color=(0.55, 0.8, 0.9))
    sp, sx = r["city_spawn"], r["spire"]
    # Blender space: x = game x, y = -game z, z = up
    # north (toward the spire) is +y in Blender space
    eye = Vector((sp.x + 4.0, sp.y + 15.75, sp.z + 1.9))
    tgt = Vector((sx.x - 0.5, sx.y + 3.0, sx.z + 5.5))
    cam_at("cam_ka_city", eye, tgt, 24, fstop=5.6, focus=(tgt - eye).length * 0.32)
    finish_scene(3840, 2160)
    render_still("keyart_city")


def shot_camp():
    r = interior("drill_camp", light_gain=1.1, haze=0.0025, haze_color=(0.75, 0.85, 0.95))
    ex, pump, relay = r["camp_spawn"], r["pump"], r["relay"]
    # drone floodlights: real spot lights under the drone bodies
    for o in bpy.data.objects:
        if o.name.startswith("DRONE_") and o.type == "MESH":
            top = max(v.co.z for v in o.data.vertices)
            import bmesh as _bm
            b = _bm.new()
            b.from_mesh(o.data)
            _bm.ops.delete(b, geom=[v for v in b.verts if v.co.z < top - 2.0], context="VERTS")   # the game's fake floor spot
            b.to_mesh(o.data)
            b.free()
            c = sum((v.co for v in o.data.vertices), Vector()) / len(o.data.vertices)
            li = bpy.data.objects.new(o.name + "_flood", bpy.data.lights.new(o.name + "_flood", "SPOT"))
            li.data.energy = 2400
            li.data.spot_size = math.radians(48)
            li.data.spot_blend = 0.5
            li.data.color = (0.92, 0.96, 1.0)
            li.location = Vector((c.x, c.y, top - 0.25))
            li.rotation_euler = (0, 0, 0)
            bpy.context.scene.collection.objects.link(li)
    eye = Vector((ex.x - 3.5, ex.y + 7.5, ex.z + 1.45))
    tgt = Vector((pump.x - 4.0, pump.y + 3.0, pump.z + 2.6))
    explorer((ex.x - 1.4, ex.z, -(ex.y + 10.0)), 180)
    cam_at("cam_ka_camp", eye, tgt, 22, fstop=4.0, focus=7.5)
    finish_scene(3840, 2160)
    render_still("keyart_camp")


def shot_pano360():
    r = interior("helikon_city", light_gain=1.0, haze=0.001)
    sp = r["city_spawn"]
    q = r["bridgestone"]
    cam_at("cam_pano", Vector((q.x + 2.0, q.y - 1.0, q.z + 1.67)), Vector((q.x, q.y + 10, q.z + 1.67)), 18, equirect=True)
    finish_scene(7680, 3840)
    render_still("pano360_city")


SHOT_FN = {"station": shot_station, "portrait": shot_portrait, "city": shot_city, "camp": shot_camp, "pano360": shot_pano360}
if __name__ == "__main__":
    for s in SHOTS:
        SHOT_FN[s]()
        print("SHOT DONE", s)
