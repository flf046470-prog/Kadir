"""Procedural props for the DERINLIK web build, made in Blender (no third-party assets, so no licence questions).

Run headless:  blender -b --factory-startup -P DerinlikWeb/tools/make_props.py
Writes DerinlikWeb/models/<name>.glb and models/manifest.json; build.py then inlines them into dist/index.html.

Conventions: metres, origin on the floor at the prop's centre, front faces Blender -Y (= glTF/three.js +Z).
"""
import json
import math
import pathlib

import bpy

OUT = pathlib.Path(__file__).resolve().parent.parent / "models"
OUT.mkdir(exist_ok=True)


def reset():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for block in (bpy.data.meshes, bpy.data.materials):
        for item in list(block):
            block.remove(item)


def mat(name, rgb, rough=0.7, metal=0.0, emit=None):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*rgb, 1)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    if emit:
        p.inputs["Emission Color"].default_value = (*emit[0], 1)
        p.inputs["Emission Strength"].default_value = emit[1]
    return m


def finish(obj, material, bevel=0.0, segments=1):
    obj.data.materials.append(material)
    if bevel:
        mod = obj.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = segments
        mod.limit_method = "ANGLE"
    return obj


def cube(size, loc, material, bevel=0.004, rot=(0, 0, 0)):
    """Box given its full size (x, y, z) and centre."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    return finish(o, material, bevel)


def cyl(radius, depth, loc, material, verts=16, rot=(0, 0, 0), bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth, location=loc, rotation=rot)
    return finish(bpy.context.active_object, material, bevel)


def torus(major, minor, loc, material, rot=(0, 0, 0), seg=24):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=seg, minor_segments=8, location=loc, rotation=rot)
    return finish(bpy.context.active_object, material)


def export(name, place):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=str(OUT / f"{name}.glb"), export_format="GLB", use_selection=True, export_apply=True, export_yup=True)
    manifest[name] = {"place": place}


manifest = {}
X90 = (math.pi / 2, 0, 0)
Y90 = (0, math.pi / 2, 0)

# --- wooden chair -------------------------------------------------------------
reset()
wood = mat("wood_dark", (0.16, 0.09, 0.05), 0.75)
for sx in (-1, 1):
    for sy in (-1, 1):
        cube((0.035, 0.035, 0.45), (sx * 0.19, sy * 0.18, 0.225), wood)
cube((0.44, 0.42, 0.035), (0, 0, 0.465), wood, 0.006)
for sx in (-1, 1):
    cube((0.035, 0.035, 0.46), (sx * 0.19, 0.18, 0.71), wood)  # back posts (rear = +Y)
for z in (0.66, 0.84):
    cube((0.38, 0.022, 0.07), (0, 0.18, z), wood)
cube((0.38, 0.02, 0.02), (0, -0.18, 0.12), wood)  # front stretcher
export("chair", "Sakarya basement and control room, SIFIR-17 lab, PALIMPSEST archive")

# --- wooden crate ---------------------------------------------------------------
reset()
plank = mat("wood_crate", (0.33, 0.24, 0.14), 0.85)
frame = mat("wood_crate_dark", (0.21, 0.14, 0.08), 0.85)
W, D, H = 0.72, 0.62, 0.56
for i in range(4):  # side planks with small gaps
    z = 0.07 + i * 0.135
    cube((W, 0.02, 0.12), (0, -D / 2, z), plank)
    cube((W, 0.02, 0.12), (0, D / 2, z), plank)
    cube((0.02, D, 0.12), (-W / 2, 0, z), plank)
    cube((0.02, D, 0.12), (W / 2, 0, z), plank)
for sx in (-1, 1):  # corner posts and diagonal brace on the front
    for sy in (-1, 1):
        cube((0.05, 0.05, H), (sx * (W / 2 - 0.01), sy * (D / 2 - 0.01), H / 2), frame)
cube((0.05, 0.024, math.hypot(W, H) * 0.9), (0, -D / 2 - 0.012, H / 2), frame, rot=(0, math.atan2(W, H), 0))
for i in range(5):
    cube((W, 0.11, 0.02), (0, -D / 2 + 0.06 + i * 0.125, H + 0.01), plank)
export("crate", "Sakarya basement, reactor hall")

# --- flame fixtures: wall sconce, candle cluster, standing candelabrum ---------------
def candle(x, y, z0, h, wax, flame, r=0.018):
    cyl(r, h, (x, y, z0 + h / 2), wax, 10)
    bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=r * 0.5, radius2=0.0, depth=0.035, location=(x, y, z0 + h + 0.02))
    finish(bpy.context.active_object, flame)


reset()
iron = mat("iron", (0.05, 0.045, 0.04), 0.55, 0.8)
wax = mat("wax", (0.78, 0.72, 0.58), 0.6)
flame = mat("flame", (1.0, 0.55, 0.2), 1.0, 0.0, ((1.0, 0.5, 0.15), 6.0))
cube((0.08, 0.012, 0.22), (0, 0.17, 0), iron, 0.003)          # wall plate (wall is behind, Blender +Y = three.js -Z)
cube((0.02, 0.17, 0.02), (0, 0.085, -0.03), iron, 0.0)          # arm
bpy.ops.mesh.primitive_cone_add(vertices=16, radius1=0.03, radius2=0.06, depth=0.05, location=(0, 0, 0))
finish(bpy.context.active_object, iron)
candle(0, 0, 0.025, 0.07, wax, flame)
export("sconce", "wall lights in Nevşehir")

reset()
iron = mat("iron", (0.05, 0.045, 0.04), 0.55, 0.8)
wax = mat("wax", (0.78, 0.72, 0.58), 0.6)
flame = mat("flame", (1.0, 0.55, 0.2), 1.0, 0.0, ((1.0, 0.5, 0.15), 6.0))
cyl(0.08, 0.012, (0, 0, 0.006), iron, 20)
for (x, y, h) in ((0.0, 0.0, 0.12), (0.045, 0.025, 0.08), (-0.04, 0.03, 0.1), (0.015, -0.045, 0.06)):
    candle(x, y, 0.012, h, wax, flame, 0.014)
export("candles", "niche tops in the Paris ossuary")

reset()
iron = mat("iron", (0.05, 0.045, 0.04), 0.55, 0.8)
wax = mat("wax", (0.78, 0.72, 0.58), 0.6)
flame = mat("flame", (1.0, 0.55, 0.2), 1.0, 0.0, ((1.0, 0.5, 0.15), 6.0))
cyl(0.16, 0.03, (0, 0, 0.015), iron, 20)
for a in range(3):
    ang = a * 2 * math.pi / 3
    cube((0.2, 0.025, 0.02), (math.cos(ang) * 0.08, math.sin(ang) * 0.08, 0.04), iron, 0.0, rot=(0, 0, ang))
cyl(0.018, 0.86, (0, 0, 0.46), iron, 10)
bpy.ops.mesh.primitive_cone_add(vertices=20, radius1=0.04, radius2=0.15, depth=0.07, location=(0, 0, 0.92))
finish(bpy.context.active_object, iron)
for (x, y, h) in ((0.0, 0.0, 0.14), (0.07, 0.03, 0.09), (-0.06, 0.05, 0.11), (0.02, -0.07, 0.08)):
    candle(x, y, 0.955, h, wax, flame)
export("candelabrum", "Paris final chamber")

# --- valve wheel on a pipe stub (wall-mounted, faces +Z in three.js) ------------
reset()
paint = mat("valve_red", (0.32, 0.05, 0.03), 0.6, 0.3)
pipe = mat("pipe", (0.18, 0.2, 0.18), 0.5, 0.7)
cyl(0.035, 0.16, (0, -0.08, 0), pipe, 14, X90)
torus(0.15, 0.016, (0, -0.17, 0), paint, X90)
for a in range(3):
    ang = a * math.pi / 3
    cube((0.3, 0.018, 0.022), (0, -0.17, 0), paint, 0.0, rot=(0, ang, 0))
cyl(0.03, 0.04, (0, -0.17, 0), paint, 12, X90)
export("valve", "SIFIR-17 corridor walls")

# --- reel-to-reel tape recorder --------------------------------------------------
reset()
case = mat("recorder_case", (0.22, 0.2, 0.17), 0.55, 0.2)
plate = mat("recorder_plate", (0.55, 0.55, 0.52), 0.35, 0.8)
reel = mat("reel", (0.06, 0.06, 0.07), 0.4, 0.3)
tape = mat("tape", (0.12, 0.07, 0.04), 0.45)
cube((0.5, 0.36, 0.13), (0, 0, 0.065), case, 0.01, )
cube((0.47, 0.33, 0.006), (0, 0, 0.133), plate, 0.0)
for x in (-0.13, 0.13):
    cyl(0.1, 0.012, (x, 0.03, 0.15), reel, 28)
    cyl(0.06, 0.016, (x, 0.03, 0.151), tape, 24)
    cyl(0.012, 0.03, (x, 0.03, 0.16), plate, 8)
for i, x in enumerate((-0.15, -0.07, 0.01, 0.09)):
    cube((0.05, 0.03, 0.018), (x, -0.13, 0.145), reel if i % 2 else plate, 0.002)
cube((0.1, 0.035, 0.01), (0.17, -0.13, 0.142), mat("vu", (0.75, 0.62, 0.32), 0.4, 0.0, ((0.8, 0.55, 0.2), 0.6)), 0.0)
export("recorder", "PALIMPSEST archive desk")

# --- metal filing cabinet ----------------------------------------------------------
reset()
steel = mat("cabinet", (0.25, 0.29, 0.26), 0.5, 0.55)
handle = mat("handle", (0.6, 0.6, 0.58), 0.3, 0.9)
cube((0.46, 0.6, 1.3), (0, 0, 0.65), steel, 0.008)
for i in range(4):
    z = 0.18 + i * 0.31
    cube((0.42, 0.012, 0.28), (0, -0.303, z), steel, 0.004)
    cube((0.12, 0.02, 0.02), (0, -0.318, z + 0.06), handle, 0.003)
    cube((0.07, 0.006, 0.035), (0, -0.312, z + 0.1), mat("label", (0.8, 0.77, 0.68), 0.8), 0.0)
export("cabinet", "SIFIR-17 laboratory")

# --- Soviet valve radio --------------------------------------------------------------
reset()
bake = mat("bakelite", (0.18, 0.11, 0.06), 0.45, 0.0)
cloth = mat("speaker_cloth", (0.38, 0.32, 0.22), 0.95)
dial = mat("radio_dial", (0.85, 0.75, 0.5), 0.4, 0.0, ((0.9, 0.7, 0.35), 0.8))
cube((0.46, 0.22, 0.28), (0, 0, 0.14), bake, 0.015, )
cube((0.2, 0.01, 0.18), (-0.1, -0.111, 0.15), cloth, 0.0)
cube((0.17, 0.01, 0.06), (0.12, -0.111, 0.2), dial, 0.0)
for x in (0.07, 0.17):
    cyl(0.022, 0.03, (x, -0.12, 0.08), bake, 14, X90)
export("radio", "Sakarya control room console, SIFIR-17 lab table")

# --- ossuary: a human skull and a femur, instanced by the hundred in the Paris catacombs ------------------------------
# Built from rough volumes fused by a voxel remesh, then carved (orbits, nasal aperture) and decimated. Most skulls in the
# Paris ossuary have lost their mandible, so this one has none. Origin at the centre (they are set into bone walls,
# not stood on the floor). Cavities are darkened in a vertex colour (COLOR_0) so eye sockets read under any light.
import bmesh
from mathutils import Vector


def active(o):
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


def apply_mod(o, kind, **kw):
    active(o)
    m = o.modifiers.new(kind.lower(), kind)
    for k, v in kw.items():
        setattr(m, k, v)
    bpy.ops.object.modifier_apply(modifier=m.name)


def ellipsoid(r, loc, seg=32, rings=16):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=1, location=loc)
    o = bpy.context.active_object
    o.scale = r
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return o


def join(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return o


def carve(o, cutter):
    apply_mod(o, "BOOLEAN", operation="DIFFERENCE", object=cutter, solver="EXACT")
    bpy.data.objects.remove(cutter)


def reduce(o, faces):
    apply_mod(o, "DECIMATE", ratio=min(1.0, faces / max(1, len(o.data.polygons))))
    active(o)
    bpy.ops.object.shade_smooth()


def cavity_colors(o, tint=lambda co: None, gain=9.0):
    """Greyscale occlusion in COLOR_0: 1 on open surfaces, darker in hollows (neighbours above the tangent plane)."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.verts.ensure_lookup_table()
    cav = []
    for v in bm.verts:
        acc = Vector()
        for e in v.link_edges:
            acc += (e.other_vert(v).co - v.co).normalized()
        cav.append(acc.dot(v.normal) / max(1, len(v.link_edges)))
    for _ in range(3):  # soften
        cav = [(cav[v.index] * 2 + sum(cav[e.other_vert(v).index] for e in v.link_edges)) / (2 + len(v.link_edges)) for v in bm.verts]
    cos = [v.co.copy() for v in bm.verts]
    bm.free()
    attr = o.data.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    for i, c in enumerate(cav):
        k = 1.0 - min(0.85, max(0.0, c * gain))
        t = tint(cos[i])
        rgb = (k, k, k) if t is None else tuple(k * x for x in t)
        attr.data[i].color = (*rgb, 1.0)


reset()
bone_mat = mat("bone", (0.66, 0.57, 0.42), 0.8)
# measurements of an adult cranium: length ~19 cm, breadth ~14 cm, orbits ~4 x 3.4 cm, nasal aperture ~2.4 x 3.4 cm
cr = ellipsoid((0.07, 0.093, 0.072), (0, 0.014, 0.014), 48, 24)
for v in cr.data.vertices:  # egg-shaped from above (narrow brow, wide parietals), flat cranial base
    x, y, z = v.co
    t = max(0.0, min(1.0, -(y - 0.014) / 0.093))
    x *= 1.0 - 0.16 * t
    if z < -0.018:
        z = -0.018 + (z + 0.018) * 0.4
    v.co = Vector((x, y, z))
parts = [cr,
         ellipsoid((0.05, 0.034, 0.042), (0, -0.058, -0.022)),                                                 # face: orbits and maxilla sit in it
         ellipsoid((0.02, 0.022, 0.017), (0.045, -0.062, -0.026)), ellipsoid((0.02, 0.022, 0.017), (-0.045, -0.062, -0.026)),  # cheekbones
         ellipsoid((0.007, 0.03, 0.006), (0.06, -0.03, -0.026)), ellipsoid((0.007, 0.03, 0.006), (-0.06, -0.03, -0.026)),    # zygomatic arches
         ellipsoid((0.029, 0.03, 0.014), (0, -0.066, -0.062)),                                                 # tooth-bearing ridge
         ellipsoid((0.052, 0.066, 0.024), (0, 0.012, -0.024)),                                                 # cranial base under the vault
         ellipsoid((0.01, 0.012, 0.013), (0.05, 0.03, -0.032)), ellipsoid((0.01, 0.012, 0.013), (-0.05, 0.03, -0.032))]       # mastoids
skull = join(parts)
apply_mod(skull, "REMESH", mode="VOXEL", voxel_size=0.0032)
apply_mod(skull, "SMOOTH", factor=0.6, iterations=4)
reduce(skull, 2600)
for sx in (-1, 1):  # orbits: deep, slightly tilted down-and-out
    carve(skull, ellipsoid((0.02, 0.05, 0.0175), (sx * 0.032, -0.104, -0.006)))
carve(skull, ellipsoid((0.0115, 0.04, 0.018), (0, -0.11, -0.044)))  # nasal aperture
carve(skull, ellipsoid((0.017, 0.045, 0.012), (0, 0.0, -0.07)))     # palate and foramen, seen from below
apply_mod(skull, "TRIANGULATE")
teeth = []
for i in range(14):  # upper teeth on a U-shaped arch
    a = -1.25 + i * 2.5 / 13
    teeth.append(cube((0.0066, 0.0064, 0.011), (math.sin(a) * 0.025, -0.064 - math.cos(a) * 0.024, -0.077), bone_mat, 0.0, rot=(0, 0, -a)))
skull = join([skull] + teeth)
active(skull)
bpy.ops.object.shade_smooth()
skull.data.materials.clear()
skull.data.materials.append(bone_mat)
cavity_colors(skull, tint=lambda co: (0.86, 0.8, 0.66) if co.z < -0.07 and co.y < -0.035 else None)
export("skull", "Paris ossuary: bone walls (instanced); origin at the skull's centre")

reset()
fem_mat = mat("bone", (0.66, 0.57, 0.42), 0.8)
parts = [cyl(0.0125, 0.36, (0, 0, 0), fem_mat, 16, Y90),                          # shaft along X
         cyl(0.009, 0.055, (0.19, 0, 0.021), fem_mat, 12, (0, math.radians(41), 0)),  # neck, ~125° to the shaft
         ellipsoid((0.022, 0.022, 0.022), (0.207, 0, 0.04)),                       # head
         ellipsoid((0.018, 0.016, 0.022), (0.178, 0, -0.008)),                     # greater trochanter
         ellipsoid((0.022, 0.017, 0.024), (-0.19, 0.016, -0.002)), ellipsoid((0.022, 0.017, 0.024), (-0.19, -0.016, -0.002))]  # condyles
femur = join(parts)
apply_mod(femur, "REMESH", mode="VOXEL", voxel_size=0.002)
apply_mod(femur, "SMOOTH", factor=0.5, iterations=3)
reduce(femur, 500)
femur.data.materials.clear()
femur.data.materials.append(fem_mat)
cavity_colors(femur)
export("femur", "Paris ossuary: loose long bones on the bone walls (instanced); origin at the centre")

(OUT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print("PROPS:", ", ".join(manifest))
