#!/usr/bin/env python3
"""
Build the golden boomerang — the easter egg hidden on top of the highest climbs of every map
(`LevelBuilder.hideSecrets`, `render/Secrets.ts`).

    npm run assets:boomerang

Output goes to `packages/client/public/models/props/boomerang.glb`. Generated from an outline in
code, like `portal.py`, so it is ours to ship and carries no third-party licence.

The shape is a real two-armed boomerang rather than a bent bar: a centreline that runs out along
one arm, turns through a rounded elbow and out along the other, offset either side by a width that
swells at the elbow and rounds off at the tips; then extruded to a blade 3 cm thick and bevelled
so its rim catches the light. A bevelled rim is most of why it reads as gold rather than as a flat
yellow sticker: a flat face lit by one sun is one colour.

It is made metallic, unlike every other model `lib.material` makes. A stylised animal that shines
like a car reads as plastic (see `lib.material`), but this is the one object in the game that is
meant to look like treasure.
"""

import argparse
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
import bmesh  # noqa: E402  (after bpy, which puts it on the path)

import lib  # noqa: E402  (path set above)
from lib import export_glb, triangle_count  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
DEFAULT_OUT = os.path.join(REPO, "packages", "client", "public", "models", "props")

# Tip to tip, in metres. Bigger than a real one (~0.45 m) on purpose: it floats 0.9 m over a perch
# that is 3-16 m up, and has to read as a boomerang from the ground under it.
SPAN = 0.9
# Angle between the two arms. Real boomerangs are 90-120 degrees.
ELBOW_DEG = 105
ARM_WIDTH = 0.11
ELBOW_WIDTH = 0.16
THICKNESS = 0.035
BEVEL = 0.012
# Points along each arm's centreline. Nine instances at most are ever drawn, but they spin, and a
# coarse outline shows its corners as it turns.
ARM_STEPS = 14
# Triangles. Three are drawn on a map at once.
BUDGET = 1200

GOLD = 0xF2B632
STRIPE = 0xC0392B


def centreline():
    """Points from one tip, round the elbow, to the other, in the XY plane, elbow at the origin."""
    half = math.radians(ELBOW_DEG) / 2
    arm = SPAN / 2 / math.sin(half)
    # Each arm leaves the elbow along its own direction and bends a little towards the other at the
    # tip, which is what makes a boomerang a curve rather than a chevron.
    points = []
    for side in (-1, 1):
        run = []
        for i in range(ARM_STEPS + 1):
            t = i / ARM_STEPS
            angle = side * (half - 0.18 * t * t)
            r = arm * t
            run.append((math.sin(angle) * r, -math.cos(angle) * r + 0.0, t))
        if side < 0:
            points.extend(reversed(run))
        else:
            points.extend(run[1:])
    return points


def width_at(t: float) -> float:
    """Half-width along an arm: widest at the elbow, a rounded tip at the end."""
    base = ELBOW_WIDTH + (ARM_WIDTH - ELBOW_WIDTH) * min(1.0, t * 1.6)
    if t > 0.85:
        base *= math.sqrt(max(0.0, 1 - ((t - 0.85) / 0.15) ** 2)) * 0.8 + 0.2
    return base / 2


def outline():
    """The blade's outline: the centreline offset either side by `width_at`, as one loop."""
    line = centreline()
    left, right = [], []
    for i, (x, y, t) in enumerate(line):
        ax, ay, _ = line[max(0, i - 1)]
        bx, by, _ = line[min(len(line) - 1, i + 1)]
        dx, dy = bx - ax, by - ay
        length = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / length, dx / length
        w = width_at(t)
        left.append((x + nx * w, y + ny * w))
        right.append((x - nx * w, y - ny * w))
    return left + list(reversed(right))


def gold_material(name, colour, roughness, metallic):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = lib.hex_to_linear(colour)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return mat


def build_boomerang():
    lib.reset()
    lib.reset_materials()
    gold = gold_material("boomerang_gold", GOLD, 0.28, 1.0)
    stripe = gold_material("boomerang_stripe", STRIPE, 0.5, 0.0)

    mesh = bpy.data.meshes.new("boomerang")
    ob = bpy.data.objects.new("boomerang", mesh)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(gold)
    ob.data.materials.append(stripe)

    bm = bmesh.new()
    verts = [bm.verts.new((x, y, -THICKNESS / 2)) for x, y in outline()]
    face = bm.faces.new(verts)
    if face.normal.z > 0:
        face.normal_flip()
    extruded = bmesh.ops.extrude_face_region(bm, geom=[face])
    top = [v for v in extruded["geom"] if isinstance(v, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(0, 0, THICKNESS), verts=top)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    # Triangulate the two caps first, so the bevel works on a clean rim.
    caps = [f for f in bm.faces if abs(f.normal.z) > 0.9]
    bmesh.ops.triangulate(bm, faces=caps)
    rim = [e for e in bm.edges if len(e.link_faces) == 2 and abs(e.link_faces[0].normal.z - e.link_faces[1].normal.z) > 0.9]
    bmesh.ops.bevel(bm, geom=rim, offset=BEVEL, segments=2, affect="EDGES", profile=0.5)

    # A painted band across each arm, the one mark that says "boomerang" rather than "banana":
    # faces on the top and bottom caps between 55 % and 70 % of the way out along either arm.
    half = math.radians(ELBOW_DEG) / 2
    arm = SPAN / 2 / math.sin(half)
    for f in bm.faces:
        if abs(f.normal.z) < 0.5:
            continue
        c = f.calc_center_median()
        r = math.hypot(c.x, c.y) / arm
        if 0.55 < r < 0.7:
            f.material_index = 1
    # The tips bend inwards, so the span the arms were laid out for is not the span that results:
    # scale the outline to it exactly rather than solving the bend for it.
    xs = [v.co.x for v in bm.verts]
    fit = SPAN / (max(xs) - min(xs))
    for v in bm.verts:
        v.co.x *= fit
        v.co.y *= fit
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = False
    # glTF is Y-up: the blade lies flat in the exported XZ plane with its elbow at the origin, so
    # the renderer stands it up and spins it about whatever axis it likes.
    return ob


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=DEFAULT_OUT)
    args = ap.parse_args()

    ob = build_boomerang()
    tris = triangle_count(ob)
    if tris > BUDGET:
        print(f"FAIL boomerang: {tris} triangles over the {BUDGET} budget", file=sys.stderr)
        return 1
    xs = [v.co.x for v in ob.data.vertices]
    span = max(xs) - min(xs)
    if abs(span - SPAN) > 0.01:
        print(f"FAIL boomerang: {span:.2f} m tip to tip, asked for {SPAN}", file=sys.stderr)
        return 1
    striped = sum(1 for p in ob.data.polygons if p.material_index == 1)
    if striped == 0:
        print("FAIL boomerang: no stripe faces", file=sys.stderr)
        return 1

    os.makedirs(args.out, exist_ok=True)
    path = os.path.join(args.out, "boomerang.glb")
    size = export_glb(path, animated=False, uvs=False)
    print(f"ok   boomerang {tris:4d} tris   {size / 1024:5.1f} KB   {span:.2f} m span   {striped} stripe faces -> {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
