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

(OUT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print("PROPS:", ", ".join(manifest))
