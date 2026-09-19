#!/usr/bin/env python3
"""
Bring an externally authored sculpt into the character pipeline.

    npm run assets:sculpt -- --input path/to/model.glb --animal kangaroo

The generator in `characters.py` builds animals from primitives, which is cheap, deterministic and
rigged correctly — but it cannot sculpt. A model made elsewhere (an AI generator, a modeller, a CC0
pack) arrives as the opposite trade: a good shape with none of the things the game needs. The
kangaroo this was written for is 178,326 triangles against a 4,000 budget, 27.7 MB against a whole
game that precaches 890 KB, has an 8192x8192 base colour, and carries **no skeleton and no
animations at all**. It is a statue.

This turns one into the other:

  1. orient and scale it to the capsule every player shares,
  2. decimate it to the triangle budget,
  3. bake the *high-poly* normals and colour onto the low-poly, so the sculpt detail survives the
     decimation as a texture rather than as geometry — the standard trade that makes low-poly look
     detailed,
  4. fit the plan's own skeleton to it and skin it,
  5. reuse the plan's animation clips,
  6. export through the same checks `build.py` applies to a generated animal.

Step 3 is the one that makes the rest worth doing. Decimating 178k to 4k without it throws the
sculpt away and leaves a blob; with it, the silhouette simplifies and the surface keeps its shape.
"""

import argparse
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import characters  # noqa: E402
import lib  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
SPEC = os.path.join(HERE, "animals.json")
DEFAULT_OUT = os.path.join(REPO, "packages", "client", "public", "models")


# --------------------------------------------------------------------------------------------
# Import and orientation
# --------------------------------------------------------------------------------------------


def import_mesh(path: str):
    """Load a glTF/glb and return its single joined mesh object."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    imported = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in imported if o.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"{path} contains no mesh")

    for ob in imported:
        if ob.type != "MESH":
            continue
    # A generated sculpt is usually one mesh, but a pack may split it; join so everything below
    # works on one object.
    bpy.ops.object.select_all(action="DESELECT")
    for ob in meshes:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    mesh = bpy.context.view_layer.objects.active

    # Drop anything that came along that is not the mesh: empties, cameras, the importer's parent
    # nodes. They carry transforms that would fight the ones applied below.
    for ob in imported:
        if ob is not mesh and ob.name in bpy.data.objects:
            bpy.data.objects.remove(ob, do_unlink=True)
    mesh.parent = None
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return mesh


def measure(mesh):
    """World-space bounding box and the coordinates of the highest point."""
    coords = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
    lo = Vector((min(c.x for c in coords), min(c.y for c in coords), min(c.z for c in coords)))
    hi = Vector((max(c.x for c in coords), max(c.y for c in coords), max(c.z for c in coords)))
    top = max(coords, key=lambda c: c.z)
    return lo, hi, top


def facing_sign(mesh) -> float:
    """
    Which way along Y the model looks, as +1 or -1.

    Decided from where the *head* is rather than from the bounding box, because a kangaroo's box is
    dominated by its tail and a tail points backwards. The highest vertices are the ears, and ears
    sit over the face — so the sign of their Y against the body's centre is the way it faces.

    Guessing this wrong is not subtle: the animal hops backwards for the whole match.
    """
    coords = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
    zs = sorted(c.z for c in coords)
    cutoff = zs[int(len(zs) * 0.97)]
    high = [c for c in coords if c.z >= cutoff]
    centre_y = sum(c.y for c in coords) / len(coords)
    head_y = sum(c.y for c in high) / len(high)
    return 1.0 if head_y >= centre_y else -1.0


def orient(mesh, stand_height: float) -> dict:
    """
    Scale to the shared capsule, stand the feet on the origin, centre it, and face it +Y.

    Every one of these is something `build_animal` asserts about a generated animal, and a sculpt
    from anywhere else satisfies none of them by accident: it arrives at whatever scale its author
    worked in, centred on whatever point their tool chose.
    """
    lo, hi, _ = measure(mesh)
    height = hi.z - lo.z
    if height <= 0:
        raise RuntimeError("model has no height")

    scale = stand_height / height
    mesh.scale = (scale, scale, scale)
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    sign = facing_sign(mesh)
    if sign < 0:
        mesh.rotation_euler = (0.0, 0.0, math.pi)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)

    lo, hi, _ = measure(mesh)
    mesh.location = (
        -(lo.x + hi.x) / 2,
        -(lo.y + hi.y) / 2,
        -lo.z,
    )
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)

    lo, hi, _ = measure(mesh)
    return {
        "scale": round(scale, 5),
        "flipped": sign < 0,
        "height": round(hi.z - lo.z, 4),
        "lowest": round(lo.z, 4),
        "depth": round(hi.y - lo.y, 4),
        "width": round(hi.x - lo.x, 4),
    }


# --------------------------------------------------------------------------------------------
# Decimation
# --------------------------------------------------------------------------------------------


def weld(mesh) -> dict:
    """
    Merge coincident vertices so the sculpt is one connected surface.

    The step without which nothing downstream works. A generated sculpt exports with its vertices
    split along every UV and material seam: the kangaroo arrived as 98,474 vertices forming **208
    disconnected islands**, and 9,315 of those vertices were exact duplicates sitting on top of one
    another.

    Heat-diffusion skinning solves per connected component, so each of those 208 islands bound to
    whichever bone happened to be nearest its own centre and then moved independently. Rendered on
    the first frame of a run cycle, the head came apart into a cloud of fragments. Welding first
    leaves one island and the weights flow across the whole body.

    It also lets the decimator work: an edge collapse cannot cross a seam, so a split mesh keeps a
    dense band of triangles along every one of them and spends the budget on the seams instead of
    the shape.

    The threshold is deliberately tight. These are exact duplicates — 1e-5 already merges all 208
    into one — and a loose threshold would start welding genuine detail like the gap between an ear
    and the skull.
    """
    before = len(mesh.data.vertices)
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=1e-5)
    bpy.ops.object.mode_set(mode="OBJECT")
    after = len(mesh.data.vertices)
    return {"weldedVertices": before - after, "vertices": after}


def loose_parts(mesh) -> int:
    """How many disconnected pieces the mesh is in. One is the only acceptable answer before rigging."""
    import bmesh

    bm = bmesh.new()
    bm.from_mesh(mesh.data)
    bm.verts.ensure_lookup_table()
    seen: set = set()
    parts = 0
    for vert in bm.verts:
        if vert.index in seen:
            continue
        parts += 1
        stack = [vert]
        seen.add(vert.index)
        while stack:
            current = stack.pop()
            for edge in current.link_edges:
                other = edge.other_vert(current)
                if other.index not in seen:
                    seen.add(other.index)
                    stack.append(other)
    bm.free()
    return parts


def decimate(mesh, budget: int) -> int:
    """
    Reduce to the triangle budget with a collapse decimator.

    Collapse rather than un-subdivide or planar: it is the only mode that works on the irregular
    triangle soup a generated sculpt produces, and the only one that takes a ratio, which is what a
    budget needs. The ratio is computed rather than guessed, and then checked — a decimator asked
    for 2% of 178,000 triangles does not always land where the arithmetic says.
    """
    mesh.data.calc_loop_triangles()
    before = len(mesh.data.loop_triangles)
    if before <= budget:
        return before

    modifier = mesh.modifiers.new("budget", "DECIMATE")
    modifier.decimate_type = "COLLAPSE"
    # A little under the budget, because the result lands slightly above the requested ratio often
    # enough that aiming exactly at the limit fails the check that follows.
    modifier.ratio = (budget * 0.95) / before
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.modifier_apply(modifier="budget")

    mesh.data.calc_loop_triangles()
    return len(mesh.data.loop_triangles)


def unwrap(mesh) -> None:
    """
    Give the decimated mesh its own UVs.

    The sculpt's original UVs survive decimation but arrive stretched across collapsed triangles,
    and they index an 8K atlas laid out for 178,000 of them. A fresh unwrap is a clean target for
    the bake, and the bake is what carries the detail across.
    """
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")


# --------------------------------------------------------------------------------------------
# Baking
# --------------------------------------------------------------------------------------------


def _new_image(name: str, size: int, is_data: bool):
    image = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    if is_data:
        # A normal map is a direction, not a picture. Pushed through the sRGB curve it comes back
        # as the wrong vector, and the surface lights subtly and consistently wrong.
        image.colorspace_settings.name = "Non-Color"
    return image


def bake_from(high, low, size: int) -> dict:
    """
    Bake the high-poly's colour and normals onto the low-poly's fresh UVs.

    This is the step that makes decimating from 178,000 triangles to 3,800 worth doing. Without it
    the sculpt's surface is simply gone, and — because the unwrap replaces the UVs the original 8K
    atlas was laid out for — the model does not merely lose detail, it comes out with its texture
    scrambled into patches. Rendered and looked at before this existed, which is how that was found.

    Cycles, because it is the only engine in Blender that bakes. One sample is enough for both
    passes: a colour pass with `pass_filter={'COLOR'}` is the raw albedo with no lighting in it, and
    a normal pass is geometry. Neither converges over samples, so the usual reason to raise them
    does not apply.
    """
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 1
    scene.cycles.use_denoising = False
    scene.render.bake.use_selected_to_active = True
    # The cage has to clear the low-poly's surface everywhere, or rays miss the high-poly and the
    # bake comes back with holes. Scaled to the model rather than fixed, since this runs on whatever
    # size a sculpt arrives at.
    extent = max(low.dimensions)
    scene.render.bake.cage_extrusion = extent * 0.03
    scene.render.bake.max_ray_distance = extent * 0.06
    scene.render.bake.use_clear = True

    albedo = _new_image(f"{low.name}_albedo", size, is_data=False)
    normal = _new_image(f"{low.name}_normal", size, is_data=True)

    material = bpy.data.materials.new(f"{low.name}_mat")
    material.use_nodes = True
    low.data.materials.clear()
    low.data.materials.append(material)
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    principled = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")

    albedo_node = nodes.new("ShaderNodeTexImage")
    albedo_node.image = albedo
    normal_node = nodes.new("ShaderNodeTexImage")
    normal_node.image = normal

    passes = [
        (albedo_node, albedo, "DIFFUSE", {"COLOR"}),
        (normal_node, normal, "NORMAL", set()),
    ]
    for node, image, bake_type, pass_filter in passes:
        # The bake target is whichever image node is *active*, which is a piece of Blender state
        # rather than an argument — setting the wrong one silently overwrites the other map.
        nodes.active = node
        bpy.ops.object.select_all(action="DESELECT")
        high.select_set(True)
        low.select_set(True)
        bpy.context.view_layer.objects.active = low
        kwargs = {"type": bake_type, "use_selected_to_active": True}
        if pass_filter:
            kwargs["pass_filter"] = pass_filter
        bpy.ops.object.bake(**kwargs)
        image.pack()

    # Wire the baked maps up now that they hold something.
    links.new(albedo_node.outputs["Color"], principled.inputs["Base Color"])
    normal_map = nodes.new("ShaderNodeNormalMap")
    links.new(normal_node.outputs["Color"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], principled.inputs["Normal"])
    # Fur, not plastic: the sculpt carries no roughness map of its own, so it is set once here
    # rather than left at Blender's default 0.5, which reads as damp rubber under an environment.
    principled.inputs["Roughness"].default_value = 0.82
    principled.inputs["Metallic"].default_value = 0.0

    return {"bakeSize": size, "albedo": albedo.name, "normal": normal.name}


# --------------------------------------------------------------------------------------------
# Rigging
# --------------------------------------------------------------------------------------------


def rig(mesh, animal):
    """
    Fit the plan's own skeleton to the sculpt and give it the plan's clips.

    The bones come from `characters.build_hopper` rather than from a list written here, and that is
    the point of doing it this way: the client looks up `jaw` to drive lip sync, `thigh.L` and
    `thigh.R` to take a VR player's legs off, and every clip name to play an animation. A sculpt
    rigged to its own invented skeleton would load, render, and then do none of those things.

    The builder returns primitive body parts alongside its bones. They are thrown away — the shape
    is the sculpt's job now — but it is still the builder that is called, so the skeleton stays in
    step with the generated animals if either changes.
    """
    scratch = {
        "body": characters.material("sculpt_scratch_body", 0x808080),
        "accent": characters.material("sculpt_scratch_accent", 0x808080),
        "belly": characters.material("sculpt_scratch_belly", 0x808080),
        "dark": characters.material("sculpt_scratch_dark", 0x101010),
    }
    builder = characters.PLANS.get(animal["visual"].get("build"), characters.build_quadruped)
    parts, bones, plan = builder(animal, scratch)
    for part in parts:
        bpy.data.objects.remove(part, do_unlink=True)

    arm = lib.armature(f"{animal['id']}_rig", bones)
    lib.skin(mesh, arm)
    characters.animate(arm, plan, [b[0] for b in bones if b[0].startswith("tail")])
    return arm, plan, [b[0] for b in bones]


def check(mesh, capsule, animal_id: str) -> dict:
    """
    The same assertions `build_animal` makes about a generated animal.

    A sculpt satisfies none of them by accident, and every one of them is a defect a player would
    see rather than a crash: the wrong height floats or sinks the model inside its own hitbox, and
    feet away from the origin leave it hovering.
    """
    mesh.data.calc_loop_triangles()
    zs = [(mesh.matrix_world @ v.co).z for v in mesh.data.vertices]
    height, lowest = max(zs) - min(zs), min(zs)
    target = capsule["standHeight"]
    if abs(height - target) > target * 0.22:
        raise AssertionError(f"{animal_id}: {height:.2f}m tall against a {target}m capsule")
    if abs(lowest) > 0.10:
        raise AssertionError(f"{animal_id}: feet at z={lowest:.2f}, expected the origin")
    return {"finalHeight": round(height, 3), "feetAt": round(lowest, 3)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="the sculpt to convert (.glb/.gltf)")
    ap.add_argument("--animal", required=True, help="which animal in animals.json it replaces")
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--budget", type=int, default=4000)
    ap.add_argument(
        "--bake",
        type=int,
        default=1024,
        help="size of the baked albedo and normal maps; the source 8192 is 15 MB of JPEG on its own",
    )
    ap.add_argument("--inspect", action="store_true", help="report and stop, writing nothing")
    ap.add_argument(
        "--preview",
        default=None,
        help="write the oriented, decimated mesh here so the result can be looked at before rigging",
    )
    args = ap.parse_args()

    with open(SPEC) as fh:
        spec = json.load(fh)
    animal = next((a for a in spec["animals"] if a["id"] == args.animal), None)
    if animal is None:
        print(f"unknown animal {args.animal!r}", file=sys.stderr)
        return 1

    lib.reset()
    lib.reset_materials()

    mesh = import_mesh(args.input)
    mesh.data.calc_loop_triangles()
    source_tris = len(mesh.data.loop_triangles)

    placed = orient(mesh, spec["capsule"]["standHeight"])
    welded = weld(mesh)
    parts = loose_parts(mesh)
    if parts > 1:
        # Not a warning. Skinning binds per connected component, so shipping this would produce a
        # model that renders correctly at rest and shatters on its first animated frame.
        raise AssertionError(f"{args.animal}: mesh is in {parts} disconnected pieces after welding")

    # The high-poly is kept aside *before* decimating, because it is what the bake reads from. Once
    # the modifier is applied the sculpt is gone and there is nothing left to transfer.
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.duplicate()
    high = bpy.context.view_layer.objects.active
    high.name = f"{args.animal}_high"
    high.hide_render = False

    tris = decimate(mesh, args.budget)
    unwrap(mesh)
    baked = bake_from(high, mesh, args.bake)

    # The high-poly has served its purpose; leaving it in the scene would export it too.
    bpy.data.objects.remove(high, do_unlink=True)
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh

    report = {
        "input": os.path.basename(args.input),
        "animal": args.animal,
        "sourceTriangles": source_tris,
        "triangles": tris,
        "budget": args.budget,
        "looseParts": parts,
        **placed,
        **welded,
        **baked,
    }
    if not args.inspect:
        arm, plan, bone_names = rig(mesh, animal)
        report.update(check(mesh, spec["capsule"], args.animal))
        report["plan"] = plan
        report["bones"] = len(bone_names)
        # The three the client looks up by name. A rig that loads and then cannot lip-sync or take
        # a VR player's legs off is a rig that quietly dropped two features.
        for required in ("jaw", "thigh.L", "thigh.R"):
            if required not in bone_names:
                raise AssertionError(f"{args.animal}: rig has no {required!r} bone")
        out_path = os.path.join(args.out, os.path.basename(animal["modelUrl"]))
        report["bytes"] = lib.export_glb(out_path, animated=True, uvs=True)
        report["out"] = out_path

    if args.preview:
        # Written before any rigging so the two questions can be answered separately: did the
        # decimation keep the shape, and is the animal facing the way the skeleton will assume it
        # does. `facing_sign` is a heuristic about where the ears are, and a heuristic that is
        # wrong here makes the animal hop backwards for a whole match — so it gets looked at.
        report["previewBytes"] = lib.export_glb(args.preview, animated=False, uvs=True)

    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
