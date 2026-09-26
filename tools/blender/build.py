#!/usr/bin/env python3
"""
Generate the game's art with Blender and write it where the client loads it from.

    npm run assets:spec     # refresh tools/blender/animals.json from the game data
    npm run assets:build    # this script

Blender runs as a Python module (`pip install bpy`), so there is no Blender application to
install and no GUI — the whole thing is a script that can run in CI. Output goes to
`packages/client/public/models`, which is what `ModelRef.url` resolves against.

Each model is checked as it is built: height against the capsule the simulation gives every
player, feet at the origin, and a triangle budget. A model that fails a check stops the build
rather than shipping — an asset that is quietly the wrong size is worse than a missing one,
because the game falls back to procedural geometry for a missing file and looks fine.
"""

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

# No bytecode cache for the generator, read or written. A `.pyc` is trusted when the source's
# size and whole-second mtime match, and a mutation test changes a number for one of the same
# width and restores it inside a second: measured, the build then ran the *mutant's* bytecode
# against the restored source, passed a check it should have failed, and later failed three
# animals on geometry that was no longer in the file. Compiling these modules costs nothing
# next to a Blender build.
sys.dont_write_bytecode = True
for stale in (os.path.join(HERE, "__pycache__"),):
    if os.path.isdir(stale):
        import shutil

        shutil.rmtree(stale)

import characters  # noqa: E402  (path set above)

REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
DEFAULT_OUT = os.path.join(REPO, "packages", "client", "public", "models")
SPEC = os.path.join(HERE, "animals.json")

# A character is the most-instanced thing on screen — up to sixteen at once in a full room, each
# with a skeleton being posed every frame. Quest and mid-range phones are the budget.
TRIANGLE_BUDGET = 4000


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--only", default=None, help="build one animal by id")
    args = ap.parse_args()

    if not os.path.exists(SPEC):
        print(f"missing {SPEC} — run `npm run assets:spec` first", file=sys.stderr)
        return 1
    with open(SPEC) as fh:
        spec = json.load(fh)

    os.makedirs(args.out, exist_ok=True)
    rows, failures = [], []

    for animal in spec["animals"]:
        if args.only and animal["id"] != args.only:
            continue
        path = os.path.join(args.out, os.path.basename(animal["modelUrl"]))
        try:
            row = characters.build_animal(animal, path, spec["capsule"])
        except Exception as err:  # noqa: BLE001 — one bad animal must not hide the rest
            failures.append(f"{animal['id']}: {err}")
            print(f"FAIL {animal['id']:10s} {err}")
            continue
        if row["triangles"] > TRIANGLE_BUDGET:
            failures.append(f"{row['id']}: {row['triangles']} triangles over the {TRIANGLE_BUDGET} budget")
        rows.append(row)
        print(
            f"ok   {row['id']:10s} {row['plan']:10s} {row['triangles']:5d} tris  "
            f"{row['bytes'] / 1024:6.1f} KB  {row['height']:.2f}m"
        )

    if rows:
        total = sum(r["bytes"] for r in rows)
        print(f"\n{len(rows)} models, {total / 1024:.0f} KB total → {args.out}")
    if failures:
        print(f"\n{len(failures)} failure(s):")
        for f in failures:
            print(f"  - {f}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
