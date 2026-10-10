"""
Measure a source mesh's joints, so a sculpted body can be rigged onto a body plan's skeleton.

    python3 tools/blender/landmarks.py <source.glb> <height> <plan>

prints a `SOURCE_MESHES` entry for `characters.py`: every joint the plan's skeleton needs, read off
the mesh after `characters._import_source` has normalised it exactly as the build will.

It is an offline tool, not a build step. Its numbers are proposals: they are pasted into
`characters.py` as art data, checked on a gridded render with the joints overlaid, and corrected
there by hand where a heuristic guessed wrong (a paw held against a chest, a tail touching a leg).
The build never runs this, so a rebuild cannot move a joint behind anybody's back.

How it measures: the mesh is filled with 2 cm voxels (a point is inside when the nearest surface
faces away from it), and the body is read as solid cross-sections rather than as the surface's
rings. Legs are the separate blobs of a slab near the ground, followed upward slab by slab until
they merge into the body; the bend along that path is the knee. Arms are the blobs beside the torso
in a slab at chest height, followed down to the hand and up to the shoulder. A tail is whatever
lies behind the rump, ordered by its distance through the voxels from where it leaves the body.
"""

import math
import os
import sys
from collections import deque

sys.path.insert(0, os.path.dirname(__file__))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402

import characters  # noqa: E402

CELL = 0.02


def voxelise(ob):
    """
    Every cell centre inside the mesh, as integer (i, j, k) keys.

    Inside by ray parity along whole rows of cells, voted across the three axes. A Meshy surface
    has patches with flipped normals (the chest fur on the wolf), so "the nearest face points away"
    put solid cells in the air under its jaw; parity does not read normals at all, and the vote
    survives the odd ray that slips through a hole.
    """
    tree = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())
    lo = [min(v.co[a] for v in ob.data.vertices) for a in range(3)]
    hi = [max(v.co[a] for v in ob.data.vertices) for a in range(3)]
    span = [range(int(math.floor(lo[a] / CELL)) - 1, int(math.ceil(hi[a] / CELL)) + 2) for a in range(3)]
    votes = {}
    for axis in range(3):
        u, w = [a for a in range(3) if a != axis]
        direction = Vector([1.0 if a == axis else 0.0 for a in range(3)])
        for iu in span[u]:
            for iw in span[w]:
                origin = Vector((0.0, 0.0, 0.0))
                origin[u], origin[w], origin[axis] = iu * CELL, iw * CELL, lo[axis] - 0.1
                hits = []
                while True:
                    hit = tree.ray_cast(origin, direction, hi[axis] - origin[axis] + 0.2)
                    if hit[0] is None:
                        break
                    hits.append(hit[0][axis])
                    origin = hit[0] + direction * 1e-4
                if len(hits) < 2:
                    continue
                for i in span[axis]:
                    x = i * CELL
                    if sum(1 for h in hits if h < x) % 2:
                        key = [0, 0, 0]
                        key[axis], key[u], key[w] = i, iu, iw
                        key = tuple(key)
                        votes[key] = votes.get(key, 0) + 1
    return {k for k, n in votes.items() if n >= 2}


def at(key):
    return Vector((key[0] * CELL, key[1] * CELL, key[2] * CELL))


def centroid(cells):
    total = Vector((0, 0, 0))
    for c in cells:
        total += at(c)
    return total / max(1, len(cells))


def blobs(cells, axes=(0, 1)):
    """Connected groups of cells, connectivity in the two given axes (cells share the third)."""
    cells = set(cells)
    seen, out = set(), []
    a, b = axes
    for start in cells:
        if start in seen:
            continue
        group, queue = [], deque([start])
        seen.add(start)
        while queue:
            c = queue.popleft()
            group.append(c)
            for da in (-1, 0, 1):
                for db in (-1, 0, 1):
                    n = list(c)
                    n[a] += da
                    n[b] += db
                    n = tuple(n)
                    if n in cells and n not in seen:
                        seen.add(n)
                        queue.append(n)
        out.append(group)
    return sorted(out, key=len, reverse=True)


def blobs3(cells):
    """Connected groups of cells in three dimensions, largest first."""
    cells = set(cells)
    seen, out = set(), []
    for start in cells:
        if start in seen:
            continue
        group, queue = [], deque([start])
        seen.add(start)
        while queue:
            c = queue.popleft()
            group.append(c)
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for dz in (-1, 0, 1):
                        n = (c[0] + dx, c[1] + dy, c[2] + dz)
                        if n in cells and n not in seen:
                            seen.add(n)
                            queue.append(n)
        out.append(group)
    return sorted(out, key=len, reverse=True)


def slab(vox, k):
    return [c for c in vox if c[2] == k]


def follow_up(vox, start):
    """
    Follow a blob up through the slabs, returning (centroids, last k) until it merges into
    something else — the body, or another leg — or vanishes. A merge shows as the blob more than
    doubling from one slab to the next, or its centre jumping sideways towards whatever it joined.
    """
    path = [centroid(start)]
    current = set((c[0], c[1]) for c in start)
    size = len(start)
    k = start[0][2]
    while True:
        k += 1
        layer = blobs(slab(vox, k))
        nxt = [g for g in layer if any((c[0], c[1]) in current or (c[0] + 1, c[1]) in current
                                      or (c[0] - 1, c[1]) in current or (c[0], c[1] + 1) in current
                                      or (c[0], c[1] - 1) in current for c in g)]
        if not nxt:
            return path, k - 1
        g = max(nxt, key=len)
        c = centroid(g)
        jump = Vector((c.x - path[-1].x, c.y - path[-1].y)).length
        if len(g) > size * 2.2 or jump > 0.06:
            return path, k - 1
        path.append(c)
        current = set((cc[0], cc[1]) for cc in g)
        size = len(g)


def bend(path):
    """The point on a path farthest from the straight line between its ends: a knee, an elbow."""
    a, b = path[0], path[-1]
    axis = (b - a).normalized()
    best, far = None, -1.0
    for p in path:
        d = ((p - a) - axis * (p - a).dot(axis)).length
        if d > far:
            best, far = p, d
    return best, far


def r3(v):
    return tuple(round(c, 3) for c in v)


def follow_down(vox, start):
    """The cells of a blob followed down to the ground: a leg's foot."""
    cells = list(start)
    current = set((c[0], c[1]) for c in start)
    k = start[0][2]
    while k > 0:
        k -= 1
        layer = blobs(slab(vox, k))
        nxt = [g for g in layer if any((c[0] + dx, c[1] + dy) in current for c in g for dx in (-1, 0, 1) for dy in (-1, 0, 1))]
        if not nxt:
            break
        g = max(nxt, key=len)
        cells += g
        current = set((c[0], c[1]) for c in g)
    return cells


def legs_from_ground(vox, count, k_probe):
    """
    The largest blobs either side of the midline in the slab at `k_probe` — `count / 2` a side —
    followed up to the body and down to the toe. A tail that reaches the ground (the fox's brush)
    hangs on the midline, and the biggest blobs overall would have taken it for a leg.
    """
    layer = blobs(slab(vox, k_probe))
    per_side = count // 2
    layer = ([g for g in layer if centroid(g).x > 0.05][:per_side]
             + [g for g in layer if centroid(g).x < -0.05][:per_side])
    out = []
    for g in layer:
        path, top_k = follow_up(vox, g)
        foot = follow_down(vox, g)
        ground = [c for c in foot if c[2] <= min(f[2] for f in foot) + 2]
        front = max(ground, key=lambda c: c[1])
        toe = Vector((centroid(ground).x, front[1] * CELL, front[2] * CELL))
        out.append({"path": path, "top_k": top_k, "toe": toe, "ground": centroid(ground)})
    return out


def trunk_line(vox, y0, y1, z_min):
    """Centroids of the torso's y-slices between y0 and y1, above z_min."""
    line = []
    j0, j1 = int(round(min(y0, y1) / CELL)), int(round(max(y0, y1) / CELL))
    for j in range(j0, j1 + 1):
        cells = [c for c in vox if c[1] == j and c[2] * CELL > z_min]
        if cells:
            line.append(centroid(cells))
    return line


def chain(cells, origin, joints):
    """Order a limb's cells by their distance through the voxels from `origin`; `joints` centroids."""
    cells = set(cells)
    start = min(cells, key=lambda c: (at(c) - origin).length)
    dist = {start: 0}
    queue = deque([start])
    while queue:
        c = queue.popleft()
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    n = (c[0] + dx, c[1] + dy, c[2] + dz)
                    if n in cells and n not in dist:
                        dist[n] = dist[c] + 1
                        queue.append(n)
    far = max(dist.values())
    out = []
    for n in range(joints + 1):
        band = [c for c, d in dist.items() if abs(d - far * n / joints) <= max(1, far / (joints * 3))]
        out.append(centroid(band))
    return out


def quadruped(ob, vox, height):
    # Low enough that a hanging tail does not reach it, high enough to be above the paws' spread.
    legs = legs_from_ground(vox, 4, int(0.12 / CELL))
    left = sorted((leg for leg in legs if leg["path"][0].x > 0), key=lambda leg: leg["path"][0].y)
    right = sorted((leg for leg in legs if leg["path"][0].x < 0), key=lambda leg: leg["path"][0].y)
    back, front = [left[0], right[0]], [left[1], right[1]]
    entry = {"plan": "quadruped"}
    for name, pair in (("foreleg", front), ("hindleg", back)):
        sides = {}
        for side, leg in zip(("L", "R"), pair):
            path = leg["path"]
            top = path[-1] + Vector((0, 0, 0.12))
            low = min(path, key=lambda p: abs(p.z - 0.10))
            if name == "hindleg":
                # Hip, stifle, hock, toe: a hind leg bends twice, forward at the stifle and back at
                # the hock. The hock is the deeper bend of the whole path; the stifle is the bend of
                # the part above it.
                hock, depth = bend([p for p in path if p.z >= low.z])
                if depth < 0.03:
                    hock = low
                upper = [p for p in path if p.z >= hock.z] + [top]
                knee, depth = bend(upper)
                if depth < 0.03:
                    knee = (hock + top) / 2
                sides[side] = (r3(top), r3(knee), r3(hock), r3(leg["toe"]))
            else:
                # A foreleg is nearly straight from elbow to wrist; only a real bend counts.
                knee, depth = bend([p for p in path if p.z >= low.z] + [top])
                if depth < 0.05:
                    knee = (low + top) / 2
                sides[side] = (r3(top), r3(knee), r3(low), r3(leg["toe"]))
        entry[name] = sides
    back_y = sum(leg["path"][-1].y for leg in back) / 2
    front_y = sum(leg["path"][-1].y for leg in front) / 2
    belly = max(leg["path"][-1].z for leg in legs)
    line = trunk_line(vox, back_y - 0.15, front_y, belly)
    rump, withers = line[0], line[-1]
    mid = line[len(line) // 2]
    entry["spine"] = (r3(rump), r3(mid), r3(withers))
    # The head: everything in front of the withers and above them.
    ahead = [c for c in vox if c[1] * CELL > front_y + 0.05 and c[2] * CELL > withers.z - 0.1]
    neck = chain(ahead, withers, 4)
    # The nose from the surface, not the voxels: it is the one landmark a cell's width matters for.
    nose = max((v.co for v in ob.data.vertices if v.co.z > withers.z and abs(v.co.x) < 0.05), key=lambda co: co.y)
    entry["neck"] = r3(neck[2])
    entry["head"] = (r3(neck[2]), r3(nose))
    entry["nose"] = r3(nose)
    # The skull's top between the ears (ears stand off the midline), and the top of the back.
    skull = [v.co for v in ob.data.vertices if abs(v.co.x) < 0.04 and neck[2].y < v.co.y < nose.y]
    entry["crown"] = r3(max(skull, key=lambda co: co.z))
    ridge = [v.co for v in ob.data.vertices if abs(v.co.x) < 0.05 and abs(v.co.y - mid.y) < 0.06]
    entry["back"] = r3(max(ridge, key=lambda co: co.z))
    crown = Vector(entry["crown"])
    eye = eyes_on(ob, crown, nose, sideways=True)
    if eye:
        entry["eyes"] = eye
        face = surface(ob, (0, eye[1], 3.0), (0, 0, -1))
        entry["face"] = r3(face) if face else r3(crown)
    behind = [c for c in vox if c[1] * CELL < back_y - 0.22]
    tails = blobs(behind, axes=(1, 2))
    if tails:
        tail = max(tails, key=len)
        entry["tail"] = tuple(r3(p) for p in chain(tail, rump, 4))
    # Where the feet are, which is where the capsule is.
    entry["center_y"] = round(sum(leg["ground"].y for leg in legs) / 4, 3)
    return entry


def surface(ob, origin, direction):
    """The first surface point along a ray, or None."""
    tree = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())
    hit = tree.ray_cast(Vector(origin), Vector(direction).normalized(), 5.0)
    return hit[0]


def eyes_on(ob, crown, nose, sideways, neck_z=None):
    """
    Where the eyes go: a guess from the skull's proportions, put on the surface by a ray.

    A sculpt this decimated has no readable eye: on the wolf the socket is a shading change, not a
    shape. So the eye is placed by proportion between the crown and the nose — a long muzzle puts
    it well back, a flat face high on the front — and then onto the skin from outside, sideways for
    a muzzle that points forward (a quadruped) and from the front for a face that does.
    """
    if sideways:
        y = crown.y + (nose.y - crown.y) * 0.5
        z = crown.z + (nose.z - crown.z) * 0.45
        hit = surface(ob, (0.6, y, z), (-1, 0, 0))
    else:
        z = nose.z + (crown.z - nose.z) * 0.42
        # Half way out across the front of the face at that height: a mane or a ruff behind it
        # is wider than the face and does not count.
        front = [v.co for v in ob.data.vertices if abs(v.co.z - z) < 0.025 and v.co.y > nose.y - 0.12]
        x = 0.5 * max(abs(co.x) for co in front) if front else 0.04
        hit = surface(ob, (x, nose.y + 0.5, z), (0, -1, 0))
    return r3(hit) if hit else None


def biped(ob, vox, height, plan, digitigrade=False):
    """Two legs from the ground, arms beside the torso, a neck where the body is narrowest."""
    layer = blobs(slab(vox, int(0.10 / CELL)))
    # A tail on the ground sits on the midline; legs are the biggest blob on either side of it.
    left = max((g for g in layer if centroid(g).x > 0.03), key=len)
    right = max((g for g in layer if centroid(g).x < -0.03), key=len)
    legs = []
    for g in (left, right):
        path, top_k = follow_up(vox, g)
        foot = follow_down(vox, g)
        ground = [c for c in foot if c[2] <= min(f[2] for f in foot) + 2]
        front = max(ground, key=lambda c: c[1])
        legs.append({"path": path, "top_k": top_k, "ground": centroid(ground),
                     "toe": Vector((centroid(ground).x, front[1] * CELL, front[2] * CELL))})
    crotch = min(leg["top_k"] for leg in legs) * CELL
    entry = {"plan": plan}
    sides = {}
    for side, leg in zip(("L", "R"), legs):
        path = leg["path"]
        hip = Vector((path[-1].x, path[-1].y, crotch + 0.06))
        ankle = min(path, key=lambda p: abs(p.z - 0.08))
        if digitigrade:
            # Hip, knee, hock, hoof: the leg bends back at the hock and forward at the knee, and
            # the long bone from the hock down is the foot.
            hock, depth = bend([p for p in path if p.z >= ankle.z] + [hip])
            if depth >= 0.03:
                ankle = hock
            knee, depth = bend([p for p in path if p.z >= ankle.z] + [hip])
            if depth < 0.03:
                knee = (hip + ankle) / 2
        else:
            # A plantigrade leg is straight but for the calf, which a centroid path reads as a bend.
            knee = (hip + ankle) / 2
        sides[side] = (r3(hip), r3(knee), r3(ankle), r3(leg["toe"]))
    entry["leg"] = sides

    # The torso's own width, at the waist, where no arm can be.
    waist = [c for c in vox if abs(c[2] * CELL - (crotch + 0.12)) < CELL and abs(c[0] * CELL) < 0.4]
    core = max(blobs(waist), key=len)
    half = max(abs(c[0]) for c in core) * CELL
    torso_top = max(c[2] for c in vox if abs(c[0] * CELL) < 0.05) * CELL
    arms = {}
    for side, sign in (("L", 1), ("R", -1)):
        out = [c for c in vox if sign * c[0] * CELL > half + 0.05 and c[2] * CELL > crotch + 0.12]
        groups = blobs3(out) if out else []
        if not groups:
            continue
        arm = set(groups[0])
        root_x = min(abs(c[0]) for c in arm)
        root = [c for c in arm if abs(c[0]) <= root_x + 1]
        shoulder = centroid(root)
        shoulder = Vector((sign * (half - 0.02), shoulder.y, shoulder.z + 0.04))
        hand = chain(arm, centroid(root), 1)[-1]
        arms[side] = (r3(shoulder), r3(hand))
    if len(arms) == 2:
        entry["arm"] = arms
    shoulder_z = min(a[0][2] for a in arms.values()) if arms else crotch + (torso_top - crotch) * 0.6

    # The neck: the narrowest slab of the midline body between the shoulders and the skull.
    best, neck_z = None, shoulder_z
    for k in range(int(shoulder_z / CELL), int((torso_top - 0.15) / CELL)):
        mids = [g for g in blobs(slab(vox, k)) if any(abs(c[0]) <= 1 for c in g)]
        if mids:
            area = len(max(mids, key=len))
            if best is None or area < best:
                best, neck_z = area, k * CELL
    trunk = [c for c in vox if abs(c[0] * CELL) <= half and crotch < c[2] * CELL < neck_z]
    rump = centroid([c for c in trunk if c[2] * CELL < crotch + 0.12])
    withers = centroid([c for c in trunk if c[2] * CELL > neck_z - 0.1])
    mid = centroid([c for c in trunk if abs(c[2] * CELL - (crotch + neck_z) / 2) < 0.05])
    rump.z = crotch + 0.06
    withers.z = neck_z - 0.04
    entry["spine"] = (r3(Vector((0, rump.y, rump.z))), r3(Vector((0, mid.y, mid.z))), r3(Vector((0, withers.y, withers.z))))
    skull_cells = [c for c in vox if c[2] * CELL > neck_z]
    head_mass = centroid(skull_cells)
    skull = [v.co for v in ob.data.vertices if abs(v.co.x) < 0.04 and v.co.z > neck_z]
    crown = max(skull, key=lambda co: co.z)
    nose = max((co for co in skull if co.z < crown.z - 0.05), key=lambda co: co.y)
    entry["head"] = (r3(Vector((0, withers.y, neck_z))), r3(Vector((0, head_mass.y, crown.z))))
    entry["crown"] = r3(crown)
    entry["nose"] = r3(nose)
    # A muzzle that reaches well forward of the skull (deer, dragon) carries its eyes on the sides
    # of the head, like a quadruped's; a flat face carries them on the front.
    muzzle = nose.y - head_mass.y > 0.16
    eye = eyes_on(ob, crown, nose, sideways=muzzle)
    if eye:
        entry["eyes"] = eye
        face = surface(ob, (0, nose.y + 0.5, eye[2]), (0, -1, 0))
        entry["face"] = r3(face) if face else r3(nose)
    chest_z = crotch + (neck_z - crotch) * 0.6
    back = [v.co for v in ob.data.vertices if abs(v.co.x) < 0.05 and abs(v.co.z - chest_z) < 0.04]
    behind = min(back, key=lambda co: co.y)
    entry["back"] = r3(Vector((0, behind.y, behind.z)))
    behind_y = min(c[1] for c in core) * CELL - 0.03
    tail_cells = [c for c in vox if c[1] * CELL < behind_y and abs(c[0] * CELL) < half and c[2] * CELL < chest_z]
    if tail_cells:
        tail = max(blobs(tail_cells, axes=(1, 2)), key=len)
        if len(tail) > 30:
            entry["tail"] = tuple(r3(p) for p in chain(tail, rump, 3))
    entry["center_y"] = round(sum(leg["ground"].y for leg in legs) / 2, 3)
    return entry


def shifted(value, dy):
    """Every point in a landmark value moved by dy along y."""
    if isinstance(value, dict):
        return {k: shifted(v, dy) for k, v in value.items()}
    if isinstance(value, tuple) and value and isinstance(value[0], tuple):
        return tuple(shifted(v, dy) for v in value)
    if isinstance(value, tuple) and len(value) == 3:
        return (value[0], round(value[1] - dy, 3), value[2])
    return value


def main():
    path, height, plan = sys.argv[1], float(sys.argv[2]), sys.argv[3]
    digitigrade = "--digitigrade" in sys.argv
    bpy.ops.wm.read_factory_settings(use_empty=True)
    ob = characters._import_source({"path": path, "height": height, "triangles": 3900})
    vox = voxelise(ob)
    print(f"# {len(vox)} voxels")
    entry = quadruped(ob, vox, height) if plan == "quadruped" else biped(ob, vox, height, plan, digitigrade)
    dy = entry.get("center_y", 0.0)
    for key, value in entry.items():
        if key not in ("plan", "center_y"):
            value = shifted(value, dy)
        print(f"        {key!r}: {value!r},")


if __name__ == "__main__":
    main()
