#!/usr/bin/env python3
"""
Build the serac towers: the ice pillars of `glacier-world`'s serac field.

    npm run assets:serac

Output goes to `packages/client/public/models/props/serac-{1,2,3}.glb`. Each tower on the map is a
yawed box collider marked `drawAs: 'serac'`, and the renderer draws it as one of these stretched to
fill that box (`fillUnitCube`), so the ice a player sees is the ice they collide with.

Why a script rather than a sculpt: the towers come in sixteen proportions (1.6–3.4 m half-widths,
5–16 m tall), and a model that is stretched to each of them has to look right at every one of
those aspect ratios. A sculpt has detail at one scale; a column of rings with vertical fractures
carved into it reads as ice at any stretch, because everything about it runs up the tower.

The rules that keep it honest to the collider:

  * **Carved inwards, never out.** Every vertex lies inside the unit footprint, and on each side at
    least one fracture ridge is left uncarved, so the bounding box is the whole box and
    `fillUnitCube` maps it exactly onto the collider. A model that bulged out of its box would be
    ice you can see and walk into.
  * **The top is the box's top.** Players stand on these; the cap is flat at the top, inset only by
    a chamfer round its broken lip.
  * **Faceted.** Exported without normals and drawn flat-shaded, because glacial ice breaks along
    planes; smooth normals made the first version look like wax.
"""

import argparse
import math
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
import bmesh  # noqa: E402  (after bpy, which puts it on the path)

import lib  # noqa: E402  (path set above)
from lib import export_glb, triangle_count  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
DEFAULT_OUT = os.path.join(REPO, "packages", "client", "public", "models", "props")

VARIANTS = 3
# Points round each ring. Sixteen is enough for four fractures a side and a rounded corner.
COLUMNS = 24
# Heights of the rings, as a share of the tower. Denser at the foot and the lip, where the shape
# changes; the shaft between is long, straight flutes.
ROWS = [0.0, 0.05, 0.16, 0.27, 0.4, 0.52, 0.64, 0.76, 0.86, 0.94]
# Deepest a fracture is carved, as a share of the half-width.
MAX_CARVE = 0.2
# How much further in the lip is cut than the shaft below it.
LIP_CHAMFER = 0.07
# How square the footprint is: a superellipse exponent. 2 is a circle; this is a rounded box.
SQUARENESS = 5.0
BUDGET = 900


def ring_point(t: float) -> tuple:
    """A point on the rounded-square footprint, touching ±1 on each axis."""
    a = t * math.tau
    c, s = math.cos(a), math.sin(a)
    e = 2.0 / SQUARENESS
    return (math.copysign(abs(c) ** e, c), math.copysign(abs(s) ** e, s))


def build_serac(seed: int):
    rand = random.Random(seed)
    lib.reset()
    lib.reset_materials()
    mat = lib.material("serac_ice", 0xCFE8F5, roughness=0.2)

    # One depth per column for the whole shaft: fractures run the height of the tower. Every sixth
    # column, starting at an axis, stays uncarved, so each side keeps a ridge at full width; between
    # them deep and shallow alternate, which is what turns a flute into a facet that catches light.
    depth = []
    for k in range(COLUMNS):
        if k % 6 == 0:
            depth.append(0.0)
        elif k % 2 == 1:
            depth.append(rand.uniform(0.55, 1.0) * MAX_CARVE)
        else:
            depth.append(rand.uniform(0.0, 0.35) * MAX_CARVE)
    # Layering: each ring is set in by a step of its own, so the shaft reads as stacked slabs of
    # old snow rather than one extrusion. Never at the foot, and the ridges stay at full width.
    layer = [0.0] + [rand.uniform(0.0, 0.06) for _ in ROWS[1:]] + [0.0]

    mesh = bpy.data.meshes.new(f"serac-{seed}")
    ob = bpy.data.objects.new(f"serac-{seed}", mesh)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat)
    bm = bmesh.new()

    # A band where the tower once calved: a ring carved deeper all round, at a different height on
    # each variant. It breaks the long vertical lines the way real seracs show their layering.
    band = rand.choice([2, 3, 4, 5])
    rings = []
    for r, h in enumerate(ROWS + [1.0]):
        ring = []
        for k in range(COLUMNS):
            x, y = ring_point(k / COLUMNS)
            carve = depth[k]
            if 0 < r < len(ROWS) and depth[k] > 0:
                # A wander up the flute and the ring's own layer step, never out past the footprint.
                carve = max(0.0, carve + layer[r] + rand.uniform(-0.03, 0.03))
            if r == band:
                carve += 0.05
            if h == 1.0:
                carve += LIP_CHAMFER
            carve = min(carve, 0.3)
            ring.append(bm.verts.new((x * (1 - carve), y * (1 - carve), h)))
        rings.append(ring)

    for r in range(len(rings) - 1):
        lower, upper = rings[r], rings[r + 1]
        for k in range(COLUMNS):
            n = (k + 1) % COLUMNS
            bm.faces.new((lower[k], lower[n], upper[n], upper[k]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = False
    return ob


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=DEFAULT_OUT)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    for i in range(1, VARIANTS + 1):
        ob = build_serac(1000 + i)
        tris = triangle_count(ob)
        if tris > BUDGET:
            print(f"FAIL serac-{i}: {tris} triangles over the {BUDGET} budget", file=sys.stderr)
            return 1
        xs = [v.co.x for v in ob.data.vertices]
        ys = [v.co.y for v in ob.data.vertices]
        zs = [v.co.z for v in ob.data.vertices]
        # The bounding box must be the whole unit box: that is what `fillUnitCube` maps onto the
        # collider. A side with no full-width ridge would shrink the box and stretch the model out.
        for name, lo, hi in (("x", min(xs), max(xs)), ("y", min(ys), max(ys))):
            if abs(lo + 1) > 1e-6 or abs(hi - 1) > 1e-6:
                print(f"FAIL serac-{i}: {name} spans {lo:.3f}..{hi:.3f}, not -1..1", file=sys.stderr)
                return 1
        if abs(min(zs)) > 1e-6 or abs(max(zs) - 1) > 1e-6:
            print(f"FAIL serac-{i}: height spans {min(zs):.3f}..{max(zs):.3f}, not 0..1", file=sys.stderr)
            return 1
        path = os.path.join(args.out, f"serac-{i}.glb")
        size = export_glb(path, animated=False, normals=False, uvs=False)
        print(f"ok   serac-{i}   {tris:4d} tris   {size / 1024:5.1f} KB -> {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
