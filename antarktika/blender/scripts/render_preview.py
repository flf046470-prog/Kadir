"""Quick Cycles preview renders of a built .blend (visual QA only, not shipped)."""
import math
import os
import sys

import bpy
from mathutils import Vector

blend, out_prefix = sys.argv[sys.argv.index("--") + 1], sys.argv[sys.argv.index("--") + 2]
views = [v.split(":") for v in sys.argv[sys.argv.index("--") + 3:]]
bpy.ops.wm.open_mainfile(filepath=blend)
sc = bpy.context.scene
for o in sc.objects:
    if o.name.startswith(("SRC_", "LOD")) or o.name.endswith("_LOD1") or o.name.startswith("SHADOW_"):
        o.hide_render = True
w = sc.world or bpy.data.worlds.new("W")
sc.world = w
w.use_nodes = True
bg = w.node_tree.nodes.get("Background")
bg.inputs[0].default_value = (0.62, 0.70, 0.76, 1)
bg.inputs[1].default_value = 0.9
if "GameSun" in bpy.data.objects:
    bpy.data.objects["GameSun"].data.energy = 3.5
sc.render.engine = "CYCLES"
sc.cycles.samples = 24
sc.cycles.use_denoising = False
sc.render.resolution_x, sc.render.resolution_y = 800, 450
for i, (px, py, pz, tx, ty, tz) in enumerate([tuple(map(float, v)) for v in views]):
    cam_d = bpy.data.cameras.new("cam%d" % i)
    cam_d.lens = 18
    cam = bpy.data.objects.new("cam%d" % i, cam_d)
    sc.collection.objects.link(cam)
    pos = Vector((px, -pz, py))
    tgt = Vector((tx, -tz, ty))
    cam.location = pos
    cam.rotation_euler = (tgt - pos).to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam
    sc.render.filepath = "%s_%d.png" % (out_prefix, i)
    bpy.ops.render.render(write_still=True)
    print("wrote", sc.render.filepath)
