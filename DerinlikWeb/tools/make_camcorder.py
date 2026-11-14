"""The DV camcorder Ekin carries, as a first-person view model (no third-party assets).

Run headless:  blender -b --factory-startup -P DerinlikWeb/tools/make_camcorder.py
Writes DerinlikWeb/models/camcorder.glb and adds it to models/manifest.json (the other props are left as they are).

Conventions: metres, origin at the grip (where the right hand holds it), lens pointing Blender +Y (= three.js -Z, away
from the player when it is parented to the camera). Generic late-1990s handheld: no maker's shapes or logos.
"""
import json
import math
import pathlib

import bpy

OUT = pathlib.Path(__file__).resolve().parent.parent / "models"

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()


def mat(name, rgb, rough=0.6, metal=0.0, emit=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*rgb, 1)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    if emit:
        p.inputs["Emission Color"].default_value = (*emit[0], 1)
        p.inputs["Emission Strength"].default_value = emit[1]
    return m


def finish(o, material, bevel=0.0):
    o.data.materials.append(material)
    if bevel:
        b = o.modifiers.new("bevel", "BEVEL")
        b.width, b.segments, b.limit_method = bevel, 2, "ANGLE"
    return o


def box(size, loc, material, bevel=0.003, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    return finish(o, material, bevel)


def tube(r, depth, loc, material, verts=28, bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=(math.pi / 2, 0, 0))
    return finish(bpy.context.active_object, material, bevel)


body = mat("cam_body", (0.055, 0.055, 0.06), 0.55)
trim = mat("cam_trim", (0.17, 0.17, 0.18), 0.4, 0.6)
rubber = mat("cam_rubber", (0.02, 0.02, 0.02), 0.9)
glass = mat("cam_glass", (0.01, 0.015, 0.03), 0.05, 0.3)
strap = mat("cam_strap", (0.03, 0.03, 0.035), 0.95)
rec = mat("cam_rec", (0.4, 0.02, 0.02), 0.4, 0, ((1, 0.05, 0.03), 4.0))

# body: a rounded block, 6 cm wide, 13 cm long, 7.5 cm tall; the grip side (+X) faces the right hand
box((0.060, 0.130, 0.075), (0, 0, 0.0375), body, 0.008)
box((0.062, 0.040, 0.018), (0, 0.040, 0.084), body, 0.005)  # top hump over the lens mechanism
box((0.004, 0.090, 0.050), (-0.032, -0.010, 0.040), trim, 0.002)  # flip-out screen, folded shut on the left
box((0.002, 0.080, 0.040), (-0.0345, -0.010, 0.040), glass, 0.001)

# lens: barrel, ring and the dark glass, sticking out of the front
tube(0.026, 0.046, (0, 0.086, 0.040), body, bevel=0.002)
tube(0.028, 0.010, (0, 0.110, 0.040), trim)
tube(0.021, 0.004, (0, 0.116, 0.040), glass)
box((0.060, 0.018, 0.040), (0, 0.124, 0.054), rubber, 0.003)  # lens hood lip, top half only

# viewfinder: a tube at the back top, eyecup in rubber
tube(0.012, 0.050, (-0.012, -0.070, 0.082), body)
tube(0.016, 0.014, (-0.012, -0.100, 0.082), rubber)

# hand strap along the grip side, cassette door seam, buttons, the red tally lamp on the front
box((0.010, 0.100, 0.012), (0.036, 0.000, 0.066), strap, 0.004)
box((0.010, 0.012, 0.050), (0.036, 0.046, 0.040), strap, 0.004)
box((0.010, 0.012, 0.050), (0.036, -0.046, 0.040), strap, 0.004)
box((0.001, 0.090, 0.001), (0.0302, -0.005, 0.012), rubber, 0)
for i, y in enumerate((-0.035, -0.020)):
    tube(0.005, 0.004, (0.010 + i * 0.012, y, 0.076), trim, verts=12)
box((0.010, 0.004, 0.012), (0.018, 0.068, 0.086), rubber, 0.001)  # record button
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.0035, location=(0.022, 0.066, 0.070), segments=12, ring_count=8)
finish(bpy.context.active_object, rec)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=str(OUT / "camcorder.glb"), export_format="GLB", use_selection=True, export_apply=True, export_yup=True)

manifest_path = OUT / "manifest.json"
manifest = json.loads(manifest_path.read_text())
manifest["camcorder"] = {"place": "first-person view model: Ekin's camcorder, held low in the right hand while it is lowered"}
manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
