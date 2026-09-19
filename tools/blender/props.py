#!/usr/bin/env python3
"""
Turn raw Meshy geometry into shippable props.

Meshy is used in preview mode, which returns a mesh and nothing else — no materials, no textures,
no UVs. That is the useful half. Its strength is organic shape, which is exactly what a procedural
script is bad at; its texturing would cost 1-2 MB per prop and fight the flat-shaded look
everything else in this game uses. So the shape comes from there and everything else is done here,
which lands a finished prop at 30-50 KB instead of megabytes.

Four passes, each fixing something real that the raw files have:

  1. **Clean.** Meshy leaves small disconnected fragments floating near the subject. In a viewer
     they are specks; in a game they are geometry hanging in mid-air next to a rock.
  2. **Place.** Raw output is centred on its own bounding box, so half of every prop would be
     underground. Props are moved to sit on z=0 and scaled to a sensible world size.
  3. **Colour.** Two tones split by height, because a single flat colour reads as untextured
     while moss on top of a rock or leaves above a trunk reads as intentional. There are no UVs
     to work with, so this is per-face material assignment — which is also why it stays cheap.
  4. **Budget.** Decimate anything still over its triangle target.

Usage: npm run assets:props
"""

import argparse
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import lib  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
CACHE = os.path.join(REPO, "assets", "meshy")
OUT = os.path.join(REPO, "packages", "client", "public", "models", "props")
MANIFEST = os.path.join(REPO, "tools", "meshy", "props.json")

# --------------------------------------------------------------------------------------------
# Palettes
# --------------------------------------------------------------------------------------------

# (lower colour, upper colour, split height as a fraction of the prop)
#
# The split is what makes these read as objects rather than as untextured meshes. Values are
# chosen against the jungle world's own greens and browns so a Meshy rock sits beside a generated
# kangaroo without either looking imported.
PALETTES = {
    "rock":     (0x6E6A63, 0x4E6B3A, 0.62),
    "wood":     (0x6B4A2F, 0x8A6440, 0.75),
    "foliage":  (0x2F7A3A, 0x4FB055, 0.35),
    "tree":     (0x6B4A2F, 0x3E8E45, 0.42),
    "flower":   (0x3E8E45, 0xE86A9B, 0.55),
    "mushroom": (0xE8DCC0, 0xC2412F, 0.55),
    "cave":     (0x7A7468, 0x9A948A, 0.6),
    "crystal":  (0x2E7C96, 0x6FE3F5, 0.4),
    "canyon":   (0xB5603A, 0xD98E52, 0.5),
    "banner":   (0x6B4A2F, 0xE0B33C, 0.35),
}

# Largest dimension in metres, per prop.
#
# Size belongs to the object, not to its colour, and it is measured across the *largest* axis
# rather than the height. Scaling a prop so its height hits a target is fine for a tree and
# catastrophic for a slab: the scale is uniform, so making a 0.3 m-thick ledge five metres tall
# also made it fourteen metres wide. That shipped in the first pass and was obvious the moment
# anything was rendered next to anything else — a ledge nine times the height of the player who
# is supposed to jump onto it.
#
# The player is 1.5 m. Every number here is chosen against that.
SIZES = {
    "rock": 2.0,
    "boulder-tall": 3.0,
    "log": 4.0,
    "stump": 1.4,
    "bush": 1.6,
    "fern": 1.3,
    "flower": 0.6,
    "mushroom": 0.7,
    "tree": 7.0,
    "vine": 3.0,
    "stalagmite": 1.8,
    "crystal": 1.4,
    "canyon-spire": 6.0,
    "ledge": 3.5,
    "platform": 3.0,
    "banner": 2.8,
}

# Props whose top surface is meant to be stood on. Their upper colour is not applied by height,
# because a landable top painted like moss hides the one thing a player needs to read: that it is
# flat and they can land on it.
FLAT_TOPPED = {"boulder-tall", "canyon-spire", "ledge", "platform"}


def _clean_loose(obj, keep_fraction=0.08):
    """
    Drop disconnected fragments far smaller than the main body.

    Threshold is relative, not absolute: a speck beside a six-metre tree and a speck beside a
    half-metre flower are different sizes and the same mistake.
    """
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")

    pieces = [o for o in bpy.context.selected_objects if o.type == "MESH"]
    if len(pieces) <= 1:
        return pieces[0] if pieces else obj

    def extent(o):
        bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
        return max(max(p[i] for p in bb) - min(p[i] for p in bb) for i in range(3))

    biggest = max(extent(p) for p in pieces)
    keep = [p for p in pieces if extent(p) >= biggest * keep_fraction]
    drop = [p for p in pieces if p not in keep]
    for p in drop:
        bpy.data.objects.remove(p, do_unlink=True)

    if len(keep) == 1:
        return keep[0]
    bpy.ops.object.select_all(action="DESELECT")
    for p in keep:
        p.select_set(True)
    bpy.context.view_layer.objects.active = keep[0]
    bpy.ops.object.join()
    return bpy.context.active_object


def _place(obj, target_size):
    """
    Scale so the largest dimension is `target_size`, and stand the result on z=0.

    Largest dimension, not height. See `SIZES`: uniform scaling driven by height turns a thin
    slab into a building.
    """
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    verts = [obj.matrix_world @ v.co for v in obj.data.vertices]
    lo = Vector((min(v[i] for v in verts) for i in range(3)))
    hi = Vector((max(v[i] for v in verts) for i in range(3)))
    extent = max(hi[i] - lo[i] for i in range(3))
    if extent < 1e-5:
        raise ValueError("degenerate mesh — nothing to scale")

    scale = target_size / extent
    obj.scale = (scale, scale, scale)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    verts = [obj.matrix_world @ v.co for v in obj.data.vertices]
    lo = Vector((min(v[i] for v in verts) for i in range(3)))
    hi = Vector((max(v[i] for v in verts) for i in range(3)))
    # Centred horizontally so a prop rotates about itself, and resting on the ground vertically.
    obj.location -= Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)


def _colour(obj, palette_name, flat_topped):
    """
    Bake the two tones into vertex colours, under a single white material.

    Two materials would be the obvious way to do this and the wrong one: a prop is drawn with
    `InstancedMesh`, which takes exactly one geometry and one material, so every extra material
    is another instanced draw call for the same bush. Across sixteen prop kinds with four variants
    each that is the difference between 64 draw calls and 128. Vertex colours cost three bytes a
    vertex and collapse it back to one.

    glTF multiplies COLOR_0 by the material's base colour factor, so the material stays white and
    the vertex colours carry everything.
    """
    low_hex, high_hex, split = PALETTES[palette_name]
    white = lib.material(f"{palette_name}_flat", 0xFFFFFF)
    obj.data.materials.clear()
    obj.data.materials.append(white)

    zs = [v.co.z for v in obj.data.vertices]
    lo, hi = min(zs), max(zs)
    span = hi - lo or 1.0
    cut = lo + span * split

    low_rgba = lib.hex_to_linear(low_hex)
    high_rgba = lib.hex_to_linear(high_hex)

    # Meshy's own mesh arrives carrying a colour attribute. Leaving it in place puts it in
    # COLOR_0 and pushes ours to COLOR_1 — and three.js reads COLOR_0 and nothing else, so every
    # prop would have shipped wearing Meshy's empty layer instead of the palette. Clear first.
    while len(obj.data.color_attributes):
        obj.data.color_attributes.remove(obj.data.color_attributes[0])
    attr = obj.data.color_attributes.new(name="Color", type="BYTE_COLOR", domain="CORNER")
    for poly in obj.data.polygons:
        # Left smooth on purpose: the file ships without normals and three.js computes flat ones,
        # which is the same look for a third of the bytes. Splitting vertices here would undo that
        # saving before the exporter ever sees the mesh.
        poly.use_smooth = True
        poly.material_index = 0
        centre = sum((obj.data.vertices[i].co.z for i in poly.vertices), 0.0) / len(poly.vertices)
        upper = centre > cut
        if upper and flat_topped:
            # Keep a landable surface in the base colour; only the sides above the cut change.
            upper = poly.normal.z < 0.55
        rgba = high_rgba if upper else low_rgba
        for loop_index in poly.loop_indices:
            attr.data[loop_index].color = rgba


def _budget(obj, target):
    tris = lib.triangle_count(obj)
    if tris <= target:
        return tris
    mod = obj.modifiers.new("decimate", "DECIMATE")
    mod.ratio = target / tris
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return lib.triangle_count(obj)


def build_prop(src, name, palette_name, target_tris):
    lib.reset()
    lib.reset_materials()
    bpy.ops.import_scene.gltf(filepath=src)

    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise ValueError("no mesh in the file")
    if len(meshes) > 1:
        bpy.ops.object.select_all(action="DESELECT")
        for m in meshes:
            m.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active or meshes[0]

    obj = _clean_loose(obj)
    _place(obj, SIZES[name.rsplit("-", 1)[0]])
    tris = _budget(obj, target_tris)
    _colour(obj, palette_name, name.rsplit("-", 1)[0] in FLAT_TOPPED)

    out = os.path.join(OUT, f"{name}.glb")
    size = lib.export_glb(out, animated=False, normals=False, uvs=False)
    return {"name": name, "triangles": tris, "bytes": size}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--only", default=None)
    args = ap.parse_args()

    if not os.path.isdir(CACHE):
        print(f"no cached geometry in {CACHE} — run `npm run assets:meshy` first", file=sys.stderr)
        return 1
    with open(MANIFEST) as fh:
        manifest = json.load(fh)
    palette_of = {p["id"]: p["palette"] for p in manifest["props"]}
    budget_of = {p["id"]: p["polycount"] for p in manifest["props"]}

    os.makedirs(args.out, exist_ok=True)
    rows, failures = [], []
    for file in sorted(os.listdir(CACHE)):
        if not file.endswith(".glb"):
            continue
        name = file[:-4]
        base = name.rsplit("-", 1)[0]
        if args.only and base != args.only:
            continue
        if base not in palette_of:
            failures.append(f"{name}: no manifest entry for {base!r}")
            continue
        try:
            row = build_prop(os.path.join(CACHE, file), name, palette_of[base], budget_of[base])
        except Exception as err:  # noqa: BLE001 — one bad prop must not stop the rest
            failures.append(f"{name}: {err}")
            print(f"FAIL {name}: {err}")
            continue
        rows.append(row)
        print(f"ok   {row['name']:20s} {row['triangles']:5d} tris  {row['bytes'] / 1024:6.1f} KB")

    if rows:
        total = sum(r["bytes"] for r in rows)
        print(f"\n{len(rows)} props, {total / 1024:.0f} KB total → {args.out}")
    if failures:
        print(f"\n{len(failures)} failure(s):")
        for f in failures:
            print(f"  - {f}")
    return 1 if failures and not rows else 0


if __name__ == "__main__":
    raise SystemExit(main())
