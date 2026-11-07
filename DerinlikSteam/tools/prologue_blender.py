"""Renders the trailer's live-action prologue: the Sakarya basement exported from the game (tools/export_scene.mjs),
lit and shot as a real place in Cycles, along the camera path of tools/prologue_path.py.

    blender -b --factory-startup -P DerinlikSteam/tools/prologue_blender.py -- \
        --glb chapter0.glb --lights chapter0_lights.json --path path.json --out frames_dir \
        [--frames 0-245] [--res 640x360] [--samples 64] [--still 120] [--torch 450] [--bulb 35] [--dust]

Writes frames_dir/00001.png ... (frame numbers match path.json, 1-based). --still N renders one frame to
frames_dir/still_N.png for tuning.

What makes it read as real rather than as the game: path-traced bounce light, soft contact shadows, bevelled edges
(every hard box corner of the game catches a thin highlight), puddle outlines, an LED torch with a hot centre and a
wide spill that carries the shot over a dim bulb, and camera motion blur at a camcorder's night shutter. 640x360 is
a camcorder's own detail; prologue_post.py blows it up to HD as the camcorder would.
--debug script.py runs that script (with bpy, opt and the built scene) instead of rendering.
The camcorder look itself (noise, smear, overlay) is added afterwards by tools/prologue_post.py.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
opt = {"frames": None, "res": "640x360", "samples": "64", "still": None, "dust": False, "bulb": "35", "torch": "450"}
i = 0
while i < len(argv):
    k = argv[i].lstrip("-")
    if k in ("dust", "no-dust"):          # a dusty air volume: shows the torch beam, but costs time and adds noise
        opt["dust"] = k == "dust"
        i += 1
        continue
    opt[k] = argv[i + 1]
    i += 2

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(opt["glb"]))
scene = bpy.context.scene
for o in list(scene.objects):          # the game's lamps come in as glTF lights; they are placed again below in watts
    if o.type == "LIGHT":
        bpy.data.objects.remove(o, do_unlink=True)

C = Matrix.Rotation(math.radians(90), 4, "X")     # game (Y up) -> Blender (Z up): (x, y, z) -> (x, -z, y)


def to_b(p):
    return (C @ Vector((p[0], p[1], p[2], 1.0))).to_3d()


def srgb(hexcol):
    c = [((hexcol >> s) & 255) / 255 for s in (16, 8, 0)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


# ---- materials: bevelled edges, a little more relief ----
for m in bpy.data.materials:
    if not m.use_nodes:
        continue
    nt = m.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if not bsdf:
        continue
    bevel = nt.nodes.new("ShaderNodeBevel")
    bevel.inputs["Radius"].default_value = 0.008
    bevel.samples = 6
    link = next((l for l in nt.links if l.to_socket == bsdf.inputs["Normal"]), None)
    if link:
        src = link.from_socket
        nt.links.remove(link)
        if src.node.type == "NORMAL_MAP":
            src.node.inputs["Strength"].default_value = max(src.node.inputs["Strength"].default_value, 1.2)
        nt.links.new(src, bevel.inputs["Normal"])
    nt.links.new(bevel.outputs["Normal"], bsdf.inputs["Normal"])

# ---- puddles: the game cuts their outline with an alpha map, which glTF cannot carry; draw the outline again here ----
for m in bpy.data.materials:
    if not m.use_nodes or m.blend_method != "BLEND":
        continue
    nt = m.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if not bsdf or any(n.type == "TEX_IMAGE" for n in nt.nodes) or max(bsdf.inputs["Base Color"].default_value[:3]) > 0.1:
        continue
    co = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(co.outputs["Generated"], sep.inputs[0])
    d = nt.nodes.new("ShaderNodeVectorMath")
    d.operation = "DISTANCE"
    nt.links.new(co.outputs["Generated"], d.inputs[0])
    d.inputs[1].default_value = (0.5, 0.5, 0.5)
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 3.0
    noise.inputs["Detail"].default_value = 6.0
    nt.links.new(co.outputs["Object"], noise.inputs["Vector"])
    mix = nt.nodes.new("ShaderNodeMath")
    mix.operation = "MULTIPLY_ADD"
    nt.links.new(noise.outputs["Fac"], mix.inputs[0])
    mix.inputs[1].default_value = 0.35
    nt.links.new(d.outputs["Value"], mix.inputs[2])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[1].position = 0.52, 0.62
    ramp.color_ramp.elements[0].color, ramp.color_ramp.elements[1].color = (0.9, 0.9, 0.9, 1), (0, 0, 0, 1)
    nt.links.new(mix.outputs[0], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Alpha"])
    bsdf.inputs["Roughness"].default_value = 0.04
    bsdf.inputs["Base Color"].default_value = (0.012, 0.011, 0.01, 1)

data = json.load(open(opt["lights"]))
# ---- the bulb(s) ----
for L in data["lights"]:
    if L["intensity"] <= 0 or not L["visible"]:
        continue
    ld = bpy.data.lights.new("bulb", "POINT")
    ld.energy = float(opt["bulb"]) * L["intensity"] / 9.9     # the basement bulb is 9.9 in the game; the torch, not the bulb, carries the shot
    ld.shadow_soft_size = 0.03
    ld.color = srgb(L["color"])
    ob = bpy.data.objects.new("bulb", ld)
    ob.location = to_b(L["pos"])
    scene.collection.objects.link(ob)
    # the game's bulb is a glass mesh around the lamp: let its light out (it still glows and shows in reflections)
    for o in scene.objects:
        if o.type == "MESH" and (o.matrix_world.translation - ob.location).length < 0.35 and max(o.dimensions) < 0.4:
            o.visible_shadow = False

# ---- camera, with the torch in the hand beside it ----
cd = bpy.data.cameras.new("camcorder")
cd.sensor_fit = "VERTICAL"
cd.angle_y = math.radians(data["fov"])
cd.clip_start = 0.05
cam = bpy.data.objects.new("camcorder", cd)
scene.collection.objects.link(cam)
scene.camera = cam
T = data["torch"]
aim = Vector(T["target"]).normalized()
for name, size, blend, share in (("torch_spill", 2 * T["angle"], T["penumbra"], 0.55), ("torch_hot", 0.42, 0.7, 0.45)):
    sd = bpy.data.lights.new(name, "SPOT")
    sd.energy = float(opt["torch"]) * share
    sd.spot_size = size
    sd.spot_blend = blend
    sd.shadow_soft_size = 0.008
    sd.color = srgb(T["color"])
    so = bpy.data.objects.new(name, sd)
    so.parent = cam
    so.location = Vector(T["offset"])                      # camera space is the same in both (looks down -Z, Y up)
    so.rotation_mode = "QUATERNION"
    so.rotation_quaternion = aim.to_track_quat("-Z", "Y")
    scene.collection.objects.link(so)

path = json.load(open(opt["path"]))
prev = None
for f, (x, y, z, yaw, pitch, roll) in enumerate(path["frames"]):
    mt = Matrix.Translation((x, y, z)) @ Matrix.Rotation(yaw, 4, "Y") @ Matrix.Rotation(pitch, 4, "X") @ Matrix.Rotation(roll, 4, "Z")
    mb = C @ mt
    cam.location = mb.to_translation()
    e = mb.to_euler("XYZ", prev) if prev else mb.to_euler("XYZ")
    cam.rotation_euler = e
    prev = e
    cam.keyframe_insert("location", frame=f + 1)
    cam.keyframe_insert("rotation_euler", frame=f + 1)
for fc in cam.animation_data.action.fcurves:
    for kp in fc.keyframe_points:
        kp.interpolation = "LINEAR"

# ---- air: a little dust for the beam to show in ----
world = bpy.data.worlds.new("night")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0
scene.world = world
if opt["dust"]:
    bpy.ops.mesh.primitive_cube_add(size=1)
    box = bpy.context.active_object
    box.name = "dust"
    box.scale = (6.2, 8.4, 3.0)
    box.location = to_b((0, 1.5, 4.1))
    vm = bpy.data.materials.new("dust")
    vm.use_nodes = True
    nt = vm.node_tree
    for n in list(nt.nodes):
        if n.type != "OUTPUT_MATERIAL":
            nt.nodes.remove(n)
    vol = nt.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Density"].default_value = 0.012
    vol.inputs["Anisotropy"].default_value = 0.55
    vol.inputs["Color"].default_value = (0.9, 0.86, 0.8, 1)
    nt.links.new(vol.outputs["Volume"], nt.nodes["Material Output"].inputs["Volume"])
    box.data.materials.append(vm)
    box.visible_shadow = False

# ---- render ----
r = scene.render
scene.render.engine = "CYCLES"
cy = scene.cycles
cy.device = "CPU"
cy.samples = int(opt["samples"])
cy.adaptive_threshold = 0.03
try:                                  # this Blender build may ship without OpenImageDenoise; prologue_post.py denoises then
    cy.denoiser = "OPENIMAGEDENOISE"
    cy.use_denoising = True
except TypeError:
    cy.use_denoising = False
cy.max_bounces, cy.diffuse_bounces, cy.glossy_bounces, cy.transmission_bounces, cy.volume_bounces = 5, 3, 2, 2, 0
cy.caustics_reflective = cy.caustics_refractive = False
cy.sample_clamp_indirect = 1.5           # no fireflies from the bulb seen through the dust
cy.volume_step_rate = 4.0
r.use_persistent_data = True
w, h = (int(v) for v in opt["res"].split("x"))
r.resolution_x, r.resolution_y, r.resolution_percentage = w, h, 100
r.fps = path["fps"]
r.use_motion_blur = True
r.motion_blur_shutter = 0.5           # 1/60 s at 30 fps: what a camcorder uses in the dark
r.image_settings.file_format = "PNG"
r.image_settings.color_depth = "8"
try:
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
except TypeError:
    scene.view_settings.view_transform = "Filmic"
scene.view_settings.exposure = float(opt.get("exposure", 0.3))

out = os.path.abspath(opt["out"])
os.makedirs(out, exist_ok=True)
if opt.get("debug"):
    exec(open(opt["debug"]).read())
    sys.exit(0)
if opt["still"] is not None:
    scene.frame_set(int(opt["still"]))
    r.filepath = os.path.join(out, f"still_{opt['still']}.png")
    bpy.ops.render.render(write_still=True)
else:
    a, b = (int(v) for v in (opt["frames"] or f"0-{len(path['frames']) - 1}").split("-"))
    scene.frame_start, scene.frame_end = a + 1, b + 1
    r.filepath = out + "/"
    r.use_file_extension = True
    r.use_overwrite = False            # a rerun resumes where a stopped one left off
    bpy.ops.render.render(animation=True)
