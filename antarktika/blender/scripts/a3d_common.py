"""Shared toolkit for the ANTARKTIKA: WHITEOUT Blender build scripts.

Everything here is original procedural content: no external textures, HDRIs,
models or add-ons are used. Run the build scripts with Blender 5.2+ (or the
`bpy` 5.2 Python module):

    blender -b -P build_station.py
    python build_station.py          # with the bpy module installed

Coordinate convention
---------------------
The game uses a right-handed Y-up world: x = east, y = up, z = south.
glTF uses the same axes. Blender is Z-up, and the glTF exporter maps
Blender (x, y, z) -> glTF (x, z, -y).  G(x, y, z) converts a game position
into the Blender location that ends up at that game position after export.

Gameplay metadata exported as glTF node `extras` (custom properties):
    COL_*    empty (cube display)  solid collider, half extents = scale
    FLOOR_*  empty (cube display)  walkable surface, top = location.z + scale.z
             a3d_ramp = 1          surface rises from local -Y to +Y (Blender)
    VOL_*    empty (cube display)  zone volume: a3d_zone = indoor|cave
    INT_*    empty                 interaction anchor: a3d_id, a3d_radius, a3d_label
    LIGHT_*  empty                 engine point light: a3d_color, a3d_intensity, a3d_range
    PATH_*   empty                 NPC waypoint (a3d_order)
Mesh nodes may carry a3d_lod (0/1), a3d_cull (draw distance, m),
a3d_scan (1 = reacts to the field scanner) and a3d_group (puzzle element id).
"""
import math
import os
import random

import bpy  # noqa: I001  (bpy must be imported before bmesh in module mode)
import bmesh
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
SOURCE_DIR = os.path.join(ROOT, "source")
TEX_DIR = os.path.join(ROOT, "textures")
GAME_MODELS = os.path.normpath(os.path.join(ROOT, "..", "ios", "Antarktika", "Game", "models"))
for _d in (SOURCE_DIR, TEX_DIR, GAME_MODELS):
    os.makedirs(_d, exist_ok=True)


# --------------------------------------------------------------------------- scene

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 16
    scene.render.bake.margin = 6
    if scene.world is None:
        scene.world = bpy.data.worlds.new("World")
    return scene


def G(x, y, z):
    """Game position -> Blender location."""
    return Vector((x, -z, y))


def collection(name, parent=None):
    col = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if col.name not in (parent or bpy.context.scene.collection).children:
        (parent or bpy.context.scene.collection).children.link(col)
    return col


def link(ob, col):
    for c in list(ob.users_collection):
        c.objects.unlink(ob)
    col.objects.link(ob)
    return ob


def rng(seed):
    return random.Random(seed)


# --------------------------------------------------------------------------- materials

def _node(nt, kind, loc=(0, 0), **props):
    n = nt.nodes.new(kind)
    n.location = loc
    for k, v in props.items():
        if k in n.inputs:
            n.inputs[k].default_value = v
        else:
            setattr(n, k, v)
    return n


def new_material(name, metal=0.0, interior=False):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m["a3d_metal"] = float(metal)
    m["a3d_interior"] = 1 if interior else 0
    return m


def _coords(nt):
    tc = _node(nt, "ShaderNodeTexCoord", (-1200, 0))
    return tc.outputs["Object"]


def _ramp(nt, src, stops, loc):
    r = _node(nt, "ShaderNodeValToRGB", loc)
    cr = r.color_ramp
    cr.elements[0].position, cr.elements[0].color = stops[0][0], (*stops[0][1], 1)
    cr.elements[1].position, cr.elements[1].color = stops[-1][0], (*stops[-1][1], 1)
    for pos, col in stops[1:-1]:
        e = cr.elements.new(pos)
        e.color = (*col, 1)
    nt.links.new(src, r.inputs["Fac"])
    return r.outputs["Color"]


def _noise(nt, vec, scale, detail=6.0, rough=0.55, loc=(-900, 0), w=None):
    n = _node(nt, "ShaderNodeTexNoise", loc, noise_dimensions="3D")
    n.inputs["Scale"].default_value = scale
    n.inputs["Detail"].default_value = detail
    n.inputs["Roughness"].default_value = rough
    nt.links.new(vec, n.inputs["Vector"])
    return n


def _math(nt, op, a, b=None, loc=(0, 0), clamp=False):
    n = _node(nt, "ShaderNodeMath", loc, operation=op)
    n.use_clamp = clamp
    for i, v in enumerate((a, b)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        else:
            nt.links.new(v, n.inputs[i])
    return n.outputs[0]


def _mix_rgb(nt, fac, a, b, loc=(0, 0), blend="MIX"):
    n = _node(nt, "ShaderNodeMix", loc, data_type="RGBA", blend_type=blend)
    for sock, v in ((n.inputs[0], fac), (n.inputs[6], a), (n.inputs[7], b)):
        if isinstance(v, (int, float)):
            sock.default_value = v
        elif isinstance(v, tuple):
            sock.default_value = (*v, 1) if len(v) == 3 else v
        else:
            nt.links.new(v, sock)
    return n.outputs[2]


def _bsdf(m):
    return m.node_tree.nodes["Principled BSDF"]


def _bump(nt, height, strength, loc=(-200, -400), distance=0.02):
    b = _node(nt, "ShaderNodeBump", loc)
    b.inputs["Strength"].default_value = strength
    b.inputs["Distance"].default_value = distance
    nt.links.new(height, b.inputs["Height"])
    return b.outputs["Normal"]


def _panel_seams(nt, vec, spacing=1.2, row=1.0, width=0.012, loc=(-900, -600)):
    """0 on panel seams, 1 elsewhere, for walls in any orientation."""
    sep = _node(nt, "ShaderNodeSeparateXYZ", loc)
    nt.links.new(vec, sep.inputs[0])
    outs = []
    for i, (axis, sp) in enumerate((("X", spacing), ("Y", spacing), ("Z", row))):
        frac = _math(nt, "FRACT", _math(nt, "DIVIDE", sep.outputs[axis], sp, (loc[0] + 200, loc[1] - 150 * i)), None, (loc[0] + 380, loc[1] - 150 * i))
        d = _math(nt, "MINIMUM", frac, _math(nt, "SUBTRACT", 1.0, frac, (loc[0] + 540, loc[1] - 150 * i)), (loc[0] + 700, loc[1] - 150 * i))
        outs.append(_math(nt, "GREATER_THAN", d, width / sp, (loc[0] + 860, loc[1] - 150 * i)))
    m1 = _math(nt, "MULTIPLY", outs[0], outs[1], (loc[0] + 1040, loc[1]))
    return _math(nt, "MULTIPLY", m1, outs[2], (loc[0] + 1200, loc[1]))


def mat_painted_metal(name, color, rough=0.5, metal=0.35, seams=True, grime=0.35, interior=False, spacing=1.2):
    m = new_material(name, metal, interior)
    nt = m.node_tree
    vec = _coords(nt)
    n1 = _noise(nt, vec, 1.6, 7, 0.6, (-900, 200))
    n2 = _noise(nt, vec, 18.0, 4, 0.5, (-900, -100))
    dark = tuple(c * 0.55 for c in color)
    base = _ramp(nt, n1.outputs["Fac"], [(0.3, dark), (0.62, color), (0.85, tuple(min(1, c * 1.12) for c in color))], (-600, 200))
    grime_mask = _math(nt, "MULTIPLY", _math(nt, "POWER", n2.outputs["Fac"], 3.0, (-650, -150)), grime * 2.2, (-500, -150), True)
    col = _mix_rgb(nt, grime_mask, base, (0.18, 0.17, 0.16), (-300, 100))
    height = n2.outputs["Fac"]
    if seams:
        s = _panel_seams(nt, vec, spacing=spacing)
        col = _mix_rgb(nt, _math(nt, "SUBTRACT", 1.0, s, (-250, -300)), col, tuple(c * 0.35 for c in color), (-120, 50))
        height = _math(nt, "ADD", _math(nt, "MULTIPLY", s, 1.0, (-150, -450)), _math(nt, "MULTIPLY", n2.outputs["Fac"], 0.08, (-150, -550)), (-60, -500))
    b = _bsdf(m)
    nt.links.new(col, b.inputs["Base Color"])
    r = _math(nt, "ADD", rough - 0.1, _math(nt, "MULTIPLY", n2.outputs["Fac"], 0.25, (-300, -200)), (-150, -200), True)
    nt.links.new(r, b.inputs["Roughness"])
    b.inputs["Metallic"].default_value = metal
    nt.links.new(_bump(nt, height, 0.55), b.inputs["Normal"])
    return m


def mat_snow(name="M_Snow", interior=False):
    m = new_material(name, 0.0, interior)
    nt = m.node_tree
    vec = _coords(nt)
    n1 = _noise(nt, vec, 3.5, 8, 0.62, (-900, 200))
    n2 = _noise(nt, vec, 40.0, 3, 0.5, (-900, -200))
    col = _ramp(nt, n1.outputs["Fac"], [(0.25, (0.70, 0.78, 0.84)), (0.55, (0.90, 0.93, 0.95)), (0.8, (0.97, 0.98, 0.99))], (-500, 200))
    b = _bsdf(m)
    nt.links.new(col, b.inputs["Base Color"])
    nt.links.new(_math(nt, "ADD", 0.72, _math(nt, "MULTIPLY", n2.outputs["Fac"], 0.25, (-500, -100)), (-300, -100), True), b.inputs["Roughness"])
    h = _math(nt, "ADD", n1.outputs["Fac"], _math(nt, "MULTIPLY", n2.outputs["Fac"], 0.35, (-500, -350)), (-300, -350))
    nt.links.new(_bump(nt, h, 0.35, distance=0.05), b.inputs["Normal"])
    return m


def mat_ice(name="M_Ice", deep=(0.05, 0.28, 0.42), light=(0.62, 0.86, 0.95), interior=False, cracks=True):
    m = new_material(name, 0.0, interior)
    m["a3d_ice"] = 1
    nt = m.node_tree
    vec = _coords(nt)
    n1 = _noise(nt, vec, 0.9, 8, 0.66, (-900, 250))
    n2 = _noise(nt, vec, 6.0, 5, 0.6, (-900, -50))
    col = _ramp(nt, n1.outputs["Fac"], [(0.28, deep), (0.55, tuple((a + b) / 2 for a, b in zip(deep, light))), (0.78, light)], (-550, 250))
    h = n2.outputs["Fac"]
    if cracks:
        vor = _node(nt, "ShaderNodeTexVoronoi", (-900, -350), feature="DISTANCE_TO_EDGE")
        vor.inputs["Scale"].default_value = 2.4
        nt.links.new(vec, vor.inputs["Vector"])
        crack = _math(nt, "LESS_THAN", vor.outputs["Distance"], 0.018, (-650, -350))
        col = _mix_rgb(nt, _math(nt, "MULTIPLY", crack, 0.75, (-450, -300)), col, (0.93, 0.98, 1.0), (-300, 150))
        h = _math(nt, "SUBTRACT", h, _math(nt, "MULTIPLY", crack, 0.6, (-450, -450)), (-300, -450))
    b = _bsdf(m)
    nt.links.new(col, b.inputs["Base Color"])
    nt.links.new(_math(nt, "ADD", 0.08, _math(nt, "MULTIPLY", n2.outputs["Fac"], 0.3, (-500, -150)), (-300, -150), True), b.inputs["Roughness"])
    nt.links.new(_bump(nt, h, 0.4, distance=0.04), b.inputs["Normal"])
    return m


def mat_rock(name="M_Rock"):
    m = new_material(name, 0.0)
    nt = m.node_tree
    vec = _coords(nt)
    n1 = _noise(nt, vec, 2.2, 9, 0.7, (-900, 200))
    vor = _node(nt, "ShaderNodeTexVoronoi", (-900, -200))
    vor.inputs["Scale"].default_value = 3.0
    nt.links.new(vec, vor.inputs["Vector"])
    col = _ramp(nt, n1.outputs["Fac"], [(0.3, (0.08, 0.09, 0.10)), (0.6, (0.20, 0.21, 0.22)), (0.8, (0.33, 0.33, 0.34))], (-500, 200))
    b = _bsdf(m)
    nt.links.new(col, b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.92
    h = _math(nt, "ADD", n1.outputs["Fac"], _math(nt, "MULTIPLY", vor.outputs["Distance"], 0.6, (-600, -300)), (-400, -300))
    nt.links.new(_bump(nt, h, 0.8, distance=0.08), b.inputs["Normal"])
    return m


def mat_grating(name, interior=True):
    m = new_material(name, 0.6, interior)
    nt = m.node_tree
    vec = _coords(nt)
    br = _node(nt, "ShaderNodeTexBrick", (-700, 0))
    br.inputs["Scale"].default_value = 9.0
    br.inputs["Mortar Size"].default_value = 0.03
    br.inputs["Color1"].default_value = (0.22, 0.24, 0.25, 1)
    br.inputs["Color2"].default_value = (0.17, 0.19, 0.20, 1)
    br.inputs["Mortar"].default_value = (0.04, 0.045, 0.05, 1)
    nt.links.new(vec, br.inputs["Vector"])
    n = _noise(nt, vec, 9.0, 4, 0.5, (-900, -300))
    b = _bsdf(m)
    nt.links.new(_mix_rgb(nt, _math(nt, "MULTIPLY", n.outputs["Fac"], 0.4, (-500, -250)), br.outputs["Color"], (0.12, 0.10, 0.09), (-300, 0)), b.inputs["Base Color"])
    b.inputs["Metallic"].default_value = 0.6
    nt.links.new(_math(nt, "ADD", 0.38, _math(nt, "MULTIPLY", n.outputs["Fac"], 0.3, (-500, -400)), (-300, -350)), b.inputs["Roughness"])
    nt.links.new(_bump(nt, br.outputs["Fac"], 0.6), b.inputs["Normal"])
    return m


def mat_plain(name, color, rough=0.6, metal=0.0, interior=False, noise=0.12):
    m = new_material(name, metal, interior)
    nt = m.node_tree
    vec = _coords(nt)
    n = _noise(nt, vec, 7.0, 5, 0.55, (-900, 0))
    col = _mix_rgb(nt, _math(nt, "MULTIPLY", n.outputs["Fac"], noise * 2, (-600, -100)), color, tuple(c * 0.6 for c in color), (-300, 0))
    b = _bsdf(m)
    nt.links.new(col, b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    nt.links.new(_bump(nt, n.outputs["Fac"], 0.15), b.inputs["Normal"])
    return m


def mat_wood(name="M_Crate", interior=False):
    m = new_material(name, 0.0, interior)
    nt = m.node_tree
    vec = _coords(nt)
    wave = _node(nt, "ShaderNodeTexWave", (-800, 100), wave_type="BANDS", bands_direction="Z")
    wave.inputs["Scale"].default_value = 3.4
    wave.inputs["Distortion"].default_value = 2.0
    nt.links.new(vec, wave.inputs["Vector"])
    n = _noise(nt, vec, 25.0, 6, 0.6, (-900, -250))
    col = _ramp(nt, wave.outputs["Fac"], [(0.2, (0.20, 0.12, 0.06)), (0.6, (0.36, 0.23, 0.12)), (0.9, (0.45, 0.31, 0.18))], (-500, 100))
    b = _bsdf(m)
    nt.links.new(_mix_rgb(nt, _math(nt, "MULTIPLY", n.outputs["Fac"], 0.3, (-500, -200)), col, (0.12, 0.08, 0.05), (-300, 0)), b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.8
    nt.links.new(_bump(nt, _math(nt, "ADD", wave.outputs["Fac"], n.outputs["Fac"], (-400, -400)), 0.35), b.inputs["Normal"])
    return m


def mat_fabric(name, color, rough=0.82, weave=180.0):
    m = new_material(name, 0.0)
    nt = m.node_tree
    vec = _coords(nt)
    n1 = _noise(nt, vec, 4.0, 6, 0.55, (-900, 200))
    wave = _node(nt, "ShaderNodeTexWave", (-900, -200), wave_type="BANDS", bands_direction="DIAGONAL")
    wave.inputs["Scale"].default_value = weave
    nt.links.new(vec, wave.inputs["Vector"])
    col = _ramp(nt, n1.outputs["Fac"], [(0.3, tuple(c * 0.7 for c in color)), (0.7, color)], (-500, 200))
    b = _bsdf(m)
    nt.links.new(col, b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = rough
    nt.links.new(_bump(nt, _math(nt, "ADD", wave.outputs["Fac"], n1.outputs["Fac"], (-500, -300)), 0.25, distance=0.004), b.inputs["Normal"])
    return m


def mat_emissive(name, color, strength=4.0, image=None):
    """Self-lit material (screens, lamps, HELIKON glow). Not baked."""
    m = new_material(name, 0.0)
    m["a3d_emissive"] = 1
    nt = m.node_tree
    b = _bsdf(m)
    b.inputs["Base Color"].default_value = (*[c * 0.2 for c in color], 1)
    b.inputs["Roughness"].default_value = 0.3
    b.inputs["Emission Strength"].default_value = strength
    if image is not None:
        tex = _node(nt, "ShaderNodeTexImage", (-500, 0))
        tex.image = image
        nt.links.new(tex.outputs["Color"], b.inputs["Emission Color"])
        nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])
    else:
        b.inputs["Emission Color"].default_value = (*color, 1)
    return m


def mat_glass(name="M_Glass", tint=(0.55, 0.72, 0.80), alpha=0.28):
    m = new_material(name, 0.0)
    m["a3d_glass"] = 1
    b = _bsdf(m)
    b.inputs["Base Color"].default_value = (*tint, 1)
    b.inputs["Roughness"].default_value = 0.06
    b.inputs["Alpha"].default_value = alpha
    try:
        m.surface_render_method = "BLENDED"
    except AttributeError:
        m.blend_method = "BLEND"
    return m


# --------------------------------------------------------------------------- geometry

def mesh_object(name, bm, mat=None, col=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    (col or bpy.context.scene.collection).objects.link(ob)
    if mat is not None:
        if isinstance(mat, (list, tuple)):
            for m in mat:
                me.materials.append(m)
        else:
            me.materials.append(mat)
    return ob


def bm_box(bm, center, size, yaw=0.0, bevel=0.0, mat_index=0):
    """Box in game units: center = true centre (x, y, z), size = (w, h, d), yaw about +y."""
    cx, cy, cz = center
    w, h, d = size
    geom = bmesh.ops.create_cube(bm, size=1.0)
    verts = geom["verts"]
    m = Matrix.Translation(G(cx, cy, cz)) @ Matrix.Rotation(-yaw, 4, "Z") @ Matrix.Diagonal((w, d, h, 1))
    bmesh.ops.transform(bm, matrix=m, verts=verts)
    faces = list({f for v in verts for f in v.link_faces})
    for f in faces:
        f.material_index = mat_index
    if bevel > 0:
        edges = list({e for v in verts for e in v.link_edges})
        bmesh.ops.bevel(bm, geom=edges, offset=bevel, segments=1, affect="EDGES", profile=0.5)
    return verts


def bm_cylinder(bm, base, radius, height, segments=12, axis="Y", mat_index=0, radius_top=None, cap=True):
    """Cylinder from game position `base` along +axis (Y=up, X or Z horizontal)."""
    rt = radius if radius_top is None else radius_top
    geom = bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=segments, radius1=radius, radius2=rt, depth=height)
    verts = geom["verts"]
    rot = {"Y": Matrix.Identity(4), "X": Matrix.Rotation(math.pi / 2, 4, "Y"), "Z": Matrix.Rotation(math.pi / 2, 4, "X")}[axis]
    off = {"Y": G(0, height / 2, 0), "X": G(height / 2, 0, 0), "Z": G(0, 0, height / 2)}[axis]
    bmesh.ops.transform(bm, matrix=Matrix.Translation(G(*base) + off) @ rot, verts=verts)
    ax = (rot @ Vector((0, 0, 1, 0))).to_3d().normalized()
    faces = {f for v in verts for f in v.link_faces}
    caps = set()
    for f in faces:
        f.material_index = mat_index
        f.normal_update()
        if abs(f.normal.dot(ax)) > 0.85 and len(f.verts) > 4:
            caps.add(f)
        else:
            f.smooth = True
    for e in {e for f in faces for e in f.edges}:
        lf = set(e.link_faces)
        if lf & caps and lf - caps:
            e.smooth = False
    return verts


def bm_beam(bm, a, b, thickness, mat_index=0):
    """Square beam between two game points."""
    pa, pb = G(*a), G(*b)
    d = pb - pa
    length = d.length
    geom = bmesh.ops.create_cube(bm, size=1.0)
    verts = geom["verts"]
    rot = d.to_track_quat("Z", "Y").to_matrix().to_4x4()
    m = Matrix.Translation((pa + pb) / 2) @ rot @ Matrix.Diagonal((thickness, thickness, length, 1))
    bmesh.ops.transform(bm, matrix=m, verts=verts)
    for f in {f for v in verts for f in v.link_faces}:
        f.material_index = mat_index
    return verts


def bm_quad(bm, pts, mat_index=0):
    vs = [bm.verts.new(G(*p)) for p in pts]
    f = bm.faces.new(vs)
    f.material_index = mat_index
    return f


def shade_smooth(ob, angle=40.0):
    for p in ob.data.polygons:
        p.use_smooth = True
    try:
        mod = ob.modifiers.new("autosmooth", "NODES")
        bpy.ops.object.select_all(action="DESELECT")
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.shade_auto_smooth(angle=math.radians(angle))
        ob.modifiers.remove(mod)
    except Exception:
        pass


def apply_modifiers(ob):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


# --------------------------------------------------------------------------- gameplay empties

def empty(name, loc_game, size=(0.5, 0.5, 0.5), yaw=0.0, col=None, kind="CUBE", **props):
    """size is game (half-width x, half-height y, half-depth z)."""
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = kind
    e.location = G(*loc_game)
    e.rotation_euler = (0, 0, -yaw)
    e.scale = (size[0], size[2], size[1])
    for k, v in props.items():
        e[k] = v
    (col or bpy.context.scene.collection).objects.link(e)
    return e


def collider(name, center, half, yaw=0.0, col=None, **props):
    return empty("COL_" + name, center, half, yaw, col, a3d_kind="collider", **props)


def floor(name, center, half, yaw=0.0, col=None, ramp=False):
    return empty("FLOOR_" + name, center, half, yaw, col, a3d_kind="floor", a3d_ramp=1 if ramp else 0)


def volume(name, center, half, zone, col=None, yaw=0.0):
    return empty("VOL_" + name, center, half, yaw, col, a3d_kind="volume", a3d_zone=zone)


def anchor(name, pos, col=None, **props):
    return empty("INT_" + name, pos, (0.3, 0.3, 0.3), 0.0, col, "PLAIN_AXES", a3d_kind="interact", **props)


def light(name, pos, color, intensity, rng_m, col=None, flicker=0.0):
    return empty("LIGHT_" + name, pos, (0.2, 0.2, 0.2), 0.0, col, "SPHERE", a3d_kind="light",
                 a3d_color=list(color), a3d_intensity=float(intensity), a3d_range=float(rng_m), a3d_flicker=float(flicker))


# --------------------------------------------------------------------------- baking

def _select_only(obs, active):
    bpy.ops.object.select_all(action="DESELECT")
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active


def join_copies(objects, name, col):
    """Duplicate objects (keeping the editable sources) and join the copies."""
    copies = []
    for o in objects:
        c = o.copy()
        c.data = o.data.copy()
        col.objects.link(c)
        copies.append(c)
    _select_only(copies, copies[0])
    for c in copies:
        for m in list(c.modifiers):
            bpy.context.view_layer.objects.active = c
            bpy.ops.object.modifier_apply(modifier=m.name)
    _select_only(copies, copies[0])
    if len(copies) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    triangulate(ob)
    return ob


def triangulate(ob):
    """Triangulate in place so the exporter can compute MikkTSpace tangents."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3], quad_method="BEAUTY", ngon_method="BEAUTY")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.validate(clean_customdata=False)
    ob.data.update()


def unwrap(ob, margin=0.004, angle=62.0):
    _select_only([ob], ob)
    me = ob.data
    while len(me.uv_layers):
        me.uv_layers.remove(me.uv_layers[0])
    me.uv_layers.new(name="UVMap")
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    bpy.ops.object.mode_set(mode="OBJECT")


def _image(name, size, alpha=False, non_color=False):
    img = bpy.data.images.get(name)
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, size, size, alpha=alpha, float_buffer=False)
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    return img


def _set_bake_target(ob, img):
    nodes = []
    for slot in ob.material_slots:
        m = slot.material
        nt = m.node_tree
        n = nt.nodes.get("__bake__") or nt.nodes.new("ShaderNodeTexImage")
        n.name = "__bake__"
        n.image = img
        nt.nodes.active = n
        nodes.append((nt, n))
    return nodes


def _clear_bake_nodes(ob):
    for slot in ob.material_slots:
        nt = slot.material.node_tree
        n = nt.nodes.get("__bake__")
        if n:
            nt.nodes.remove(n)


def _swap_to_emission(ob, value_getter):
    """Temporarily route a scalar into Emission to bake it (used for metallic)."""
    saved = []
    for slot in ob.material_slots:
        m = slot.material
        nt = m.node_tree
        out = nt.nodes.get("Material Output")
        old = out.inputs["Surface"].links[0].from_socket if out.inputs["Surface"].links else None
        em = nt.nodes.new("ShaderNodeEmission")
        v = value_getter(m)
        em.inputs["Color"].default_value = (v, v, v, 1)
        nt.links.new(em.outputs[0], out.inputs["Surface"])
        saved.append((nt, out, old, em))
    return saved


def _restore_emission(saved):
    for nt, out, old, em in saved:
        if old is not None:
            nt.links.new(old, out.inputs["Surface"])
        nt.nodes.remove(em)


def _pixels(img):
    a = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(img.size[1], img.size[0], 4)


def _save(img, path, fmt="PNG", quality=90):
    img.filepath_raw = path
    img.file_format = fmt
    if fmt == "JPEG":
        bpy.context.scene.render.image_settings.quality = quality
    img.save()


def gltf_output_group():
    """Node group recognised by the glTF exporter for the occlusion texture."""
    g = bpy.data.node_groups.get("glTF Material Output")
    if g:
        return g
    g = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
    g.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    g.interface.new_socket("Thickness", in_out="INPUT", socket_type="NodeSocketFloat")
    g.nodes.new("NodeGroupInput")
    return g


def bake_atlas(ob, name, size=1024, ao_distance=1.5, ao_samples=48, interior=False, extra_props=None):
    """Bake every procedural material on `ob` into one PBR texture set.

    Writes <name>_basecolor.png, <name>_orm.png (R=AO, G=roughness, B=metal)
    and <name>_normal.png into blender/textures and replaces the materials
    with a single image-based material (one draw call in the engine)."""
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    _select_only([ob], ob)
    bake = scene.render.bake
    bake.margin = 8
    bake.use_clear = True

    # Base colour (albedo only, no lighting)
    img_col = _image(name + "_basecolor", size)
    _set_bake_target(ob, img_col)
    bake.use_pass_direct = False
    bake.use_pass_indirect = False
    bake.use_pass_color = True
    scene.cycles.samples = 1
    bpy.ops.object.bake(type="DIFFUSE")

    img_rough = _image(name + "_rough", size, non_color=True)
    _set_bake_target(ob, img_rough)
    bpy.ops.object.bake(type="ROUGHNESS")

    img_nrm = _image(name + "_normal", size, non_color=True)
    _set_bake_target(ob, img_nrm)
    scene.cycles.samples = 4
    bake.normal_space = "TANGENT"
    bpy.ops.object.bake(type="NORMAL")

    img_metal = _image(name + "_metal", size, non_color=True)
    _set_bake_target(ob, img_metal)
    saved = _swap_to_emission(ob, lambda m: float(m.get("a3d_metal", 0.0)))
    scene.cycles.samples = 1
    bpy.ops.object.bake(type="EMIT")
    _restore_emission(saved)

    img_ao = _image(name + "_ao", size, non_color=True)
    _set_bake_target(ob, img_ao)
    scene.world.light_settings.distance = ao_distance
    scene.cycles.samples = ao_samples
    bpy.ops.object.bake(type="AO")
    _clear_bake_nodes(ob)

    # Pack ORM
    ao = _pixels(img_ao)[..., 0]
    ro = _pixels(img_rough)[..., 0]
    me = _pixels(img_metal)[..., 0]
    ao = np.clip(0.18 + 0.82 * ao, 0, 1)  # keep some bounce light in crevices
    orm = np.stack([ao, ro, me, np.ones_like(ao)], axis=-1).astype(np.float32)
    img_orm = _image(name + "_orm", size, non_color=True)
    img_orm.pixels.foreach_set(orm.ravel())

    paths = {}
    for key, img in (("basecolor", img_col), ("orm", img_orm), ("normal", img_nrm)):
        p = os.path.join(TEX_DIR, "%s_%s.png" % (name, key))
        _save(img, p)
        img.filepath = p
        img.source = "FILE"
        img.reload()
        paths[key] = p
    for img in (img_rough, img_metal, img_ao):
        bpy.data.images.remove(img)
    img_col.colorspace_settings.name = "sRGB"
    for img in (img_orm, img_nrm):
        img.colorspace_settings.name = "Non-Color"

    # Final game material
    mat = bpy.data.materials.new("GM_" + name)
    mat.use_nodes = True
    mat["a3d_interior"] = 1 if interior else 0
    for k, v in (extra_props or {}).items():
        mat[k] = v
    nt = mat.node_tree
    b = nt.nodes["Principled BSDF"]
    t_col = _node(nt, "ShaderNodeTexImage", (-700, 300))
    t_col.image = img_col
    t_orm = _node(nt, "ShaderNodeTexImage", (-900, 0))
    t_orm.image = img_orm
    t_nrm = _node(nt, "ShaderNodeTexImage", (-700, -400))
    t_nrm.image = img_nrm
    sep = _node(nt, "ShaderNodeSeparateColor", (-500, 0))
    nm = _node(nt, "ShaderNodeNormalMap", (-350, -400))
    nt.links.new(t_col.outputs["Color"], b.inputs["Base Color"])
    nt.links.new(t_orm.outputs["Color"], sep.inputs[0])
    nt.links.new(sep.outputs[1], b.inputs["Roughness"])
    nt.links.new(sep.outputs[2], b.inputs["Metallic"])
    nt.links.new(t_nrm.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
    grp = nt.nodes.new("ShaderNodeGroup")
    grp.node_tree = gltf_output_group()
    grp.location = (0, -500)
    nt.links.new(sep.outputs[0], grp.inputs["Occlusion"])

    ob.data.materials.clear()
    ob.data.materials.append(mat)
    for p in ob.data.polygons:
        p.material_index = 0
    return mat, paths


def make_lod(ob, ratio, name):
    c = ob.copy()
    c.data = ob.data.copy()
    for col in ob.users_collection:
        col.objects.link(c)
    c.name = name
    c.data.name = name
    mod = c.modifiers.new("decimate", "DECIMATE")
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    apply_modifiers(c)
    triangulate(c)
    c["a3d_lod"] = 1
    ob["a3d_lod"] = 0
    return c


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


# --------------------------------------------------------------------------- export

def export_glb(objects, path, animations=False):
    for o in objects:
        if o.type == "MESH" and not o.modifiers and not o.data.shape_keys:
            triangulate(o)
    _select_only(objects, objects[0])
    kwargs = dict(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_extras=True,
        export_apply=True,
        export_tangents=True,
        export_yup=True,
        export_image_format="JPEG",
        export_jpeg_quality=86,
        export_animations=animations,
        export_cameras=False,
        export_lights=False,
    )
    if animations:
        kwargs.update(export_animation_mode="ACTIONS", export_force_sampling=True, export_frame_step=1,
                      export_optimize_animation_size=True, export_skins=True, export_all_influences=False,
                      export_def_bones=True, export_rest_position_armature=True)
    bpy.ops.export_scene.gltf(**kwargs)
    return os.path.getsize(path)


def save_blend(name):
    path = os.path.join(SOURCE_DIR, name + ".blend")
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)
    return path
