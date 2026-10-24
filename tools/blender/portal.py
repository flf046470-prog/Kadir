#!/usr/bin/env python3
"""
Build the mode portal — the arch that stands in the lobby, one per game mode.

Generated from primitives rather than from a Meshy cache like `props.py`, for three reasons: the
Meshy key is being revoked, an arch is a ring and a slab and needs no sculpting, and a model we
generate ourselves carries no third-party licence into a build that ships on two stores.

    python3 tools/blender/portal.py

Output goes to `packages/client/public/models/props/portal.glb`, which is what the level renderer
resolves a portal instance against. The mesh is deliberately untextured and untinted: the renderer
colours each arch per mode, so one 30 KB model serves all eight doors.

The ring is built from wedge boxes laid around a circle rather than from a torus, because a torus
at a useful resolution costs several thousand triangles and this thing is drawn eight times in the
one place a player stands still and looks around.
"""

import argparse
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import lib  # noqa: E402  (path set above)
from lib import box, cone, export_glb, join, material, triangle_count  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
DEFAULT_OUT = os.path.join(REPO, "packages", "client", "public", "models", "props")

# A player stands 1.75 m. The opening has to read as something you walk through rather than duck
# under, so the inner radius is chest-to-head and the whole arch clears two metres.
INNER_RADIUS = 1.55
RING_THICKNESS = 0.32
RING_DEPTH = 0.42
SEGMENTS = 18
# Triangles. Eight of these stand in the lobby together, and the lobby is where a Quest is already
# drawing every other player in the room.
BUDGET = 900


def build_portal():
    lib.reset()
    lib.reset_materials()

    stone = material("portal_stone", 0x6B7280, roughness=0.82)
    # The surface inside the arch. Left a plain bright colour: the renderer swaps it per mode and
    # animates it, so baking a look in here would only be something to override.
    veil = material("portal_veil", 0xFFFFFF, roughness=0.25)

    parts = []

    # The ring, as wedges around a circle. Each is a box rotated to sit tangent to the curve.
    centre_radius = INNER_RADIUS + RING_THICKNESS / 2
    # Chord length between segment centres, so neighbours meet without overlapping into z-fighting.
    wedge = (2 * math.pi * centre_radius) / SEGMENTS * 0.62
    for i in range(SEGMENTS):
        angle = (i / SEGMENTS) * math.tau
        x = math.sin(angle) * centre_radius
        z = math.cos(angle) * centre_radius
        parts.append(
            box(
                f"ring_{i}",
                (x, 0.0, z + centre_radius),
                (wedge, RING_DEPTH, RING_THICKNESS),
                stone,
                rotation=(0.0, -angle, 0.0),
            )
        )

    # The veil: a thin disc filling the opening, set slightly back so the ring reads in front of it.
    parts.append(
        cone(
            "veil",
            (0.0, -0.06, centre_radius),
            INNER_RADIUS,
            INNER_RADIUS,
            0.06,
            veil,
            vertices=SEGMENTS,
            rotation=(math.pi / 2, 0.0, 0.0),
        )
    )

    # Two feet, so it stands on the ground instead of floating with its lowest wedge buried.
    for side in (-1, 1):
        parts.append(
            box(
                f"foot_{'l' if side < 0 else 'r'}",
                (side * (centre_radius - 0.25), 0.0, 0.34),
                (0.7, 0.5, 0.68),
                stone,
            )
        )

    mesh = join(parts, "portal")
    return mesh


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=DEFAULT_OUT)
    args = ap.parse_args()

    mesh = build_portal()
    tris = triangle_count(mesh)
    if tris > BUDGET:
        print(f"FAIL portal: {tris} triangles over the {BUDGET} budget", file=sys.stderr)
        return 1

    # Height is the number that matters at runtime: the renderer plants a portal on the ground and
    # the simulation's trigger is a flat radius, so an arch shorter than a player would be a door
    # you step over rather than through.
    mesh.data.calc_loop_triangles()
    ys = [(mesh.matrix_world @ v.co).z for v in mesh.data.vertices]
    height = max(ys) - min(ys)
    if height < 2.0:
        print(f"FAIL portal: {height:.2f} m tall, which is not a doorway", file=sys.stderr)
        return 1

    os.makedirs(args.out, exist_ok=True)
    path = os.path.join(args.out, "portal.glb")
    size = export_glb(path, animated=False)
    print(f"ok   portal   {tris:4d} tris   {size / 1024:5.1f} KB   {height:.2f}m -> {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
