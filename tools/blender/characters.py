"""
Generate the playable animals: mesh, skeleton and animation clips, one .glb each.

Three body plans cover the whole roster, chosen by each animal's own `visual.build` field:

    hopper     kangaroo, frog      upright on huge hind legs, tail counterweight
    upright    human, penguin      two legs under a vertical torso
    quadruped  wolf, fox, tiger    four legs under a horizontal spine

Everything else — colours, ear shape, tail shape, snout shape, overall scale — comes from the
same `visual` block the game already uses to draw the procedural avatar, so a model can never
describe a different animal than the one the player picked.

Every animal is the same height and fills the same capsule, because every animal has identical
movement. That is a rule of this project, not an art decision: premium and free animals may
differ in model, texture, animation and sound, and in nothing that touches a match. A wolf that
stood shorter than a kangaroo would be a smaller target, and that is a gameplay advantage bought
with a cosmetic.

Clip names are the contract with the renderer: idle, walk, run, jump, hit, and the seven emotes.
"""

import math
import os

import bpy
import bmesh  # after bpy: the module only exists once Blender has initialised
from mathutils import Matrix, Vector

import lib
from lib import Clip, armature, box, cone, join, material, skin, sphere, wedge


def bpy_update() -> None:
    bpy.context.view_layer.update()

"""
The emotes, in the order the game numbers them.

Ids 1-4 are the four every animal carries (`animals.ts` names them per species, so a kangaroo
taunts where a person points — the pose is the same, the name is flavour). Ids 5-7 belong to the
three unlockable emote cosmetics. All seven are built for every animal so that equipping a cosmetic
never depends on which body you are wearing.
"""
EMOTES = ("wave", "dance", "taunt", "sit", "backflip", "sleep", "victory")

CLIPS = ("idle", "walk", "run", "jump", "hit") + tuple(f"emote_{name}" for name in EMOTES)

# Frame counts. 24 fps, so walk is one second and a stride is half of it.
LENGTHS = {"idle": 48, "walk": 24, "run": 16, "jump": 24, "hit": 16}
# Emotes run about a second and a half; the simulation holds `emoteTimer` for the same span.
LENGTHS.update({f"emote_{name}": 36 for name in EMOTES})
LENGTHS["emote_sleep"] = 72
LENGTHS["emote_backflip"] = 30


# --------------------------------------------------------------------------------------------
# Shared pieces
# --------------------------------------------------------------------------------------------


def _trait(spec, field, handled):
    """
    Read one shape trait, refusing anything this file does not actually build.

    Every trait here used to be `v.get(field, default)` followed by an if/elif chain ending in a
    bare `else`, so a value the chain had no branch for silently became whichever shape the tail
    of the chain happened to build. `AnimalVisual` declares five tails; this file built three of
    them, and `thin` and `fin` both landed on `thick`. Two pairs of animals with genuinely
    different declared traits therefore shipped as the same mesh — measured on the generated art,
    `dragon`/`wolf` and `lion`/`tiger` had identical POSITION+NORMAL hashes.

    A missing branch is now a build failure that names the trait, which is the only way the
    declared vocabulary and the built one can be kept the same size.
    """
    value = spec["visual"].get(field)
    if value not in handled:
        raise ValueError(
            f"{spec['id']}: {field}={value!r} is not a shape this generator builds "
            f"(it builds {sorted(handled)}). Add the branch or change the animal."
        )
    return value


FEATURES = {"none", "mane", "patches", "mask", "dorsal", "antlers", "longneck"}


def _feature(spec):
    """`visual.feature`, optional, refused like any trait when there is no geometry for it."""
    value = spec["visual"].get("feature", "none")
    if value not in FEATURES:
        raise ValueError(
            f"{spec['id']}: feature={value!r} is not one this generator builds "
            f"(it builds {sorted(FEATURES)}). Add the branch or change the animal."
        )
    return value


def _head_sockets(top, forward):
    """
    Where a hat and a pair of glasses go, derived from the numbers that build the head.

    Written next to `_head_parts` and from the same `top`/`forward` on purpose. The client used to
    guess these from its own procedural rig, which is a second implementation of the same body plan
    in another language — measured, a penguin's hat sat forty centimetres below the top of the
    penguin. Then it guessed from the model's bounding box, which is the tip of a kangaroo's
    thirty-centimetre ears rather than its skull. Only this file knows where the skull is.

    The head is `sphere("head", (0, forward, top), (0.34, 0.36, 0.32))`, and `lib.sphere`'s size
    is a full **diameter** — it scales a radius-0.5 sphere. So the crown is `top + 0.16` and the
    front of the face is `forward + 0.18`. A first version read those as radii and was caught by
    measurement rather than review: it put a human's hat socket at 1.70 m on a model whose top
    vertex is at 1.54 — sixteen centimetres of air — which `animal-geometry.test.ts` now refuses.
    """
    return {
        "socket_head": ("head", (0, forward, top + 0.16)),
        "socket_face": ("head", (0, forward + 0.18, top + 0.05)),
    }


def _hand_sockets(bone, where, x):
    """
    `socket_hand_L` / `socket_hand_R`: where a glove goes, at the end of each forelimb.

    Hand cosmetics used to hang on the avatar's own hand groups, which the client hides once a
    model loads ("the model has its own arms") — so on every PC and mobile player, which is every
    player not in a headset, equipped gloves were never drawn at all. The model's forelimb ends
    here, and only this file knows where. Underscored names because three.js strips dots.
    `where(x)` gives the point for the side whose sign `x` carries.
    """
    return {
        "socket_hand_L": (f"{bone}.L", where(x)),
        "socket_hand_R": (f"{bone}.R", where(-x)),
    }


def _head_parts(spec, mats, top, forward):
    """Head, snout, ears and eyes, sitting at `top` and facing +Y."""
    parts = [sphere("head", (0, forward, top), (0.34, 0.36, 0.32), mats["body"])]

    snout = _trait(spec, "snout", {"long", "short", "beak", "flat"})
    if snout == "long":
        parts.append(sphere("snout", (0, forward + 0.20, top - 0.04), (0.17, 0.26, 0.15), mats["body"]))
        parts.append(sphere("nose", (0, forward + 0.32, top - 0.04), (0.07, 0.06, 0.06), mats["accent"]))
    elif snout == "short":
        parts.append(sphere("snout", (0, forward + 0.15, top - 0.04), (0.20, 0.16, 0.16), mats["belly"]))
        parts.append(sphere("nose", (0, forward + 0.22, top - 0.02), (0.08, 0.07, 0.06), mats["accent"]))
    elif snout == "beak":
        parts.append(
            cone("beak", (0, forward + 0.20, top - 0.03), 0.09, 0.01, 0.20, mats["accent"],
                 vertices=6, rotation=(math.radians(-90), 0, 0))
        )
    else:  # flat — a face, not a muzzle
        parts.append(sphere("face", (0, forward + 0.16, top - 0.03), (0.22, 0.10, 0.20), mats["belly"]))

    feature = _feature(spec)
    # A panda's ears are black; everybody else's are the colour of their head.
    ear_mat = mats["accent"] if feature == "patches" else mats["body"]
    ears = _trait(spec, "ears", {"tall", "pointed", "round", "fin", "none"})
    for side, x in (("L", 0.13), ("R", -0.13)):
        if ears == "tall":
            parts.append(lib.pin(
                cone(f"ear.{side}", (x, forward - 0.04, top + 0.26), 0.06, 0.02, 0.30, ear_mat, vertices=6), "head"
            ))
        elif ears == "pointed":
            parts.append(lib.pin(
                cone(f"ear.{side}", (x, forward - 0.02, top + 0.19), 0.07, 0.01, 0.18, ear_mat, vertices=5), "head"
            ))
        elif ears == "round":
            parts.append(lib.pin(sphere(f"ear.{side}", (x, forward - 0.02, top + 0.18), (0.13, 0.05, 0.13), ear_mat), "head"))
        elif ears == "fin":
            # A blade swept back off the side of the skull, not a cone standing up off it. Thin in
            # X so it reads as a fin edge-on and disappears from the front, which is the whole
            # visual joke of an animal with fins where its ears should be.
            parts.append(lib.pin(
                wedge(f"ear.{side}", (x + 0.05 * (1 if side == "L" else -1), forward - 0.08, top + 0.14),
                      (0.03, 0.24, 0.22), mats["accent"],
                      rotation=(math.radians(-10), 0, math.radians(14 if side == "L" else -14))), "head"
            ))

    for side, x in (("L", 0.12), ("R", -0.12)):
        parts.append(lib.pin(sphere(f"eye.{side}", (x, forward + 0.14, top + 0.06), (0.06, 0.05, 0.06), mats["dark"]), "head"))

    # Signature marks that live on the head. All pinned: they are small, they ride the skull
    # rigidly, and heat weighting is not trusted with small islands (see `lib.pin`).
    if feature == "mane":
        # A halo round the face, wider and taller than the skull, and a drape down onto the chest.
        # Behind the face rather than over it, so the eyes and muzzle stay in front of it.
        parts.append(lib.pin(sphere("mane", (0, forward - 0.07, top - 0.03), (0.58, 0.34, 0.56), mats["accent"]), "head"))
        parts.append(lib.pin(sphere("mane.2", (0, forward - 0.10, top - 0.22), (0.50, 0.36, 0.34), mats["accent"]), "head"))
    elif feature == "patches":
        # A panda's eye patches: teardrops round each eye, tilted down and out. Inboard of the
        # eye rather than centred on it: centred, they reached past the edge of the skull and
        # read from the front as a second pair of round ears.
        for side, x in (("L", 0.10), ("R", -0.10)):
            tilt = math.radians(-22 if side == "L" else 22)
            parts.append(lib.pin(sphere(f"patch.{side}", (x, forward + 0.125, top + 0.04), (0.11, 0.07, 0.12),
                                        mats["accent"], rotation=(0, tilt, 0)), "head"))
    elif feature == "mask":
        # The bandit band across the eyes, wrapping round the sides of the skull. The eyes still sit
        # proud of it, and the short muzzle covers its lower edge, so it reads as a mask over a pale
        # snout rather than as a dark face.
        parts.append(lib.pin(sphere("mask", (0, forward + 0.075, top + 0.05), (0.40, 0.18, 0.11), mats["accent"]), "head"))
    elif feature == "antlers":
        # Two swept beams with a forward tine each, in the pale colour of bone. Kept under the
        # capsule's height tolerance, which the tall ears already come close to.
        for side, x in (("L", 1), ("R", -1)):
            parts.append(lib.pin(cone(f"antler.{side}", (0.13 * x, forward - 0.06, top + 0.27), 0.028, 0.012, 0.30,
                                      mats["belly"], vertices=6,
                                      rotation=(math.radians(18), math.radians(32 * x), 0)), "head"))
            parts.append(lib.pin(cone(f"tine.{side}", (0.15 * x, forward + 0.01, top + 0.31), 0.016, 0.006, 0.14,
                                      mats["belly"], vertices=5,
                                      rotation=(math.radians(-40), math.radians(12 * x), 0)), "head"))
    return parts


def _tail_parts(spec, mats, base_z, base_y):
    """Tail running backwards along -Y from the hips."""
    shape = _trait(spec, "tail", {"stub", "bushy", "thick", "thin", "fin"})
    if shape == "stub":
        return [sphere("tail", (0, base_y - 0.16, base_z), (0.13, 0.16, 0.13), mats["body"])]
    if shape == "bushy":
        return [
            sphere("tail.1", (0, base_y - 0.17, base_z + 0.04), (0.17, 0.30, 0.17), mats["body"]),
            sphere("tail.2", (0, base_y - 0.38, base_z + 0.11), (0.21, 0.32, 0.21), mats["belly"]),
        ]
    if shape == "thin":
        # A whip, not a counterweight: half the thick tail's girth, carried level rather than
        # drooping to the ground, and reaching further back for it. The radii are what separate it
        # from `thick` — a lizard's or a big cat's tail is the same chain at a third the volume.
        return [
            sphere("tail.1", (0, base_y - 0.18, base_z + 0.01), (0.10, 0.28, 0.10), mats["body"]),
            sphere("tail.2", (0, base_y - 0.40, base_z + 0.02), (0.08, 0.28, 0.08), mats["body"]),
            sphere("tail.3", (0, base_y - 0.60, base_z + 0.02), (0.06, 0.24, 0.06), mats["accent"]),
        ]
    if shape == "fin":
        # A caudal blade standing on edge: nearly flat in X, tall in Z. Two segments so the
        # animation's travelling wave still has something to sweep — a rigid fin reads as a prop
        # bolted to the hips the moment the animal moves.
        #
        # The stock is round and the fluke is a swept triangle. Both used to be boxes, and the
        # fluke sat three centimetres clear of the stock — a floating slab behind the shark, found
        # by `lib.detached_parts` rather than by eye.
        return [
            _segment("tail.1", (0, base_y + 0.02, base_z), (0, base_y - 0.30, base_z + 0.08), 0.12, 0.13,
                     mats["body"], overlap=1.15),
            wedge("tail.2", (0, base_y - 0.42, base_z + 0.16), (0.035, 0.26, 0.34), mats["accent"]),
        ]
    # thick — a kangaroo's counterweight, thinning as it goes and resting toward the ground
    #
    # The segments overlap generously on purpose. They used to meet with about two centimetres to
    # spare, which held while the tail was static and came apart the moment it was animated: the
    # hop swings the tail through nineteen degrees and the render showed three brown blobs
    # trailing behind a kangaroo they were no longer attached to. Overlap is what lets a chain of
    # spheres bend without opening a seam.
    return [
        sphere("tail.1", (0, base_y - 0.16, base_z - 0.03), (0.21, 0.32, 0.20), mats["body"]),
        sphere("tail.2", (0, base_y - 0.38, base_z - 0.12), (0.17, 0.30, 0.16), mats["body"]),
        sphere("tail.3", (0, base_y - 0.56, base_z - 0.20), (0.13, 0.26, 0.12), mats["accent"]),
    ]


def _jaw_bone(top, forward):
    """
    A jaw bone under the head, pointing down the snout.

    The renderer drives this by name from each speaker's own measured mic level, so a model
    without it is a model that cannot lip sync — which is how the first version of these files
    came out, and the feature quietly stopped working for anyone using an art pack. Automatic
    weights pick up the snout, nose and beak geometry because they sit closest to it.
    """
    return [("jaw", (0, forward + 0.05, top - 0.07), (0, forward + 0.28, top - 0.11), "head")]


def _tail_bones(spec, base_z, base_y, parent):
    # One chain per tail shape, and the count has to match `_tail_parts` or a segment ends up
    # weighted to the wrong bone and trails behind the rest of the tail when it swings.
    shape = _trait(spec, "tail", {"stub", "bushy", "thick", "thin", "fin"})
    if shape == "stub":
        return [("tail.1", (0, base_y, base_z), (0, base_y - 0.22, base_z), parent)]
    if shape == "bushy":
        return [
            ("tail.1", (0, base_y, base_z), (0, base_y - 0.26, base_z + 0.08), parent),
            ("tail.2", (0, base_y - 0.26, base_z + 0.08), (0, base_y - 0.52, base_z + 0.16), "tail.1"),
        ]
    if shape == "fin":
        return [
            ("tail.1", (0, base_y, base_z), (0, base_y - 0.26, base_z + 0.06), parent),
            ("tail.2", (0, base_y - 0.26, base_z + 0.06), (0, base_y - 0.52, base_z + 0.14), "tail.1"),
        ]
    if shape == "thin":
        # Carried level, so the chain runs straight back instead of dropping away like `thick`.
        return [
            ("tail.1", (0, base_y, base_z), (0, base_y - 0.26, base_z + 0.01), parent),
            ("tail.2", (0, base_y - 0.26, base_z + 0.01), (0, base_y - 0.50, base_z + 0.02), "tail.1"),
            ("tail.3", (0, base_y - 0.50, base_z + 0.02), (0, base_y - 0.72, base_z + 0.02), "tail.2"),
        ]
    return [
        ("tail.1", (0, base_y, base_z), (0, base_y - 0.26, base_z - 0.08), parent),
        ("tail.2", (0, base_y - 0.26, base_z - 0.08), (0, base_y - 0.50, base_z - 0.18), "tail.1"),
        ("tail.3", (0, base_y - 0.50, base_z - 0.18), (0, base_y - 0.70, base_z - 0.26), "tail.2"),
    ]


# --------------------------------------------------------------------------------------------
# Body plans
# --------------------------------------------------------------------------------------------


def _limb(name, a, b, width, depth, mat):
    """
    A box running from joint `a` to joint `b` in the sagittal plane (x fixed, y forward, z up).

    Limbs used to be axis-aligned boxes, which is why every hind leg stood dead vertical: there
    is no way to draw a Z-folded leg out of boxes that can only point straight down. This builds
    the box along the segment between two joints, so the rig and the mesh are described by the
    same two points and cannot disagree about where a knee is.
    """
    ay, az = a[1], a[2]
    by, bz = b[1], b[2]
    dy, dz = ay - by, az - bz
    length = math.hypot(dy, dz)
    # Rotating +Z by `angle` about X gives (0, -sin, cos); solve for the direction b -> a.
    angle = math.atan2(-dy, dz)
    centre = (a[0], (ay + by) / 2, (az + bz) / 2)
    return box(name, centre, (width, depth, length + width * 0.5), mat, rotation=(angle, 0, 0))


def _segment(name, a, b, width, depth, mat, overlap=1.3):
    """
    An ellipsoid laid along the segment from `a` to `b` (sagittal plane), for muscle and tail.

    `overlap` lengthens it past both joints so a chain of them bends without opening a seam — the
    tail's own history: segments that met with two centimetres to spare came apart the moment the
    hop swung them, and read as a kangaroo followed by three loose lumps.
    """
    ay, az = a[1], a[2]
    by, bz = b[1], b[2]
    dy, dz = ay - by, az - bz
    length = math.hypot(dy, dz) * overlap
    angle = math.atan2(-dy, dz)
    centre = (a[0], (ay + by) / 2, (az + bz) / 2)
    return sphere(name, centre, (width, depth, length), mat, rotation=(angle, 0, 0))


def _kangaroo_tail(spec, mats, rump):
    """
    The heavy tail a kangaroo rests on, as parts and bones together.

    Only for `thick` tails on hoppers. The generic thick tail drooped about twenty centimetres and
    stopped in mid-air, which is a wolf's tail on a kangaroo; a real one runs down to the ground
    and takes weight when standing — the third leg of the tripod, and half of the silhouette.
    """
    x, y, z = rump
    joints = [(x, y, z), (x, y - 0.26, z - 0.20), (x, y - 0.50, z - 0.42), (x, y - 0.74, z - 0.58)]
    sizes = [(0.24, 0.36, 0.24), (0.19, 0.34, 0.18), (0.14, 0.32, 0.13), (0.10, 0.26, 0.09)]
    parts, bones = [], []
    for i in range(3):
        width = sizes[i][0]
        colour = mats["accent"] if i == 2 else mats["body"]
        parts.append(_segment(f"tail.{i + 1}", joints[i], joints[i + 1], width, width * 0.95, colour, overlap=1.55))
        bones.append((f"tail.{i + 1}", joints[i], joints[i + 1], "hips" if i == 0 else f"tail.{i}"))
    # The tip, where the tail meets the ground.
    parts.append(sphere("tail.tip", joints[3], (0.10, 0.14, 0.09), mats["accent"]))
    return parts, bones


def build_hopper(spec, mats):
    """
    Kangaroo, frog and raptor: a body leaning out over Z-folded hind legs, the tail behind.

    The shape is the one the procedural avatar's `PLANS.hopper` already describes and the
    generated model never had: haunches low and back, the thigh running forward-down to a knee
    under the belly, the shin running back-down to a raised hock, a long foot forward along the
    ground, the torso leaning out over the toes, small forearms held in front of the chest. The
    first version stacked the body vertically on two straight boxes, and in real gameplay frames
    the player's kangaroo read as a robot on stilts from behind — the single most-seen object in
    the game.
    """
    hip_y, hip_z = -0.12, 0.74
    # One long leaning torso over a heavy rump, rather than a stack of balls: in the first render
    # the back read as a caterpillar of four separate lumps.
    parts = [
        sphere("hips", (0, -0.10, 0.74), (0.46, 0.52, 0.46), mats["body"]),
        _segment("torso", (0, -0.06, 0.74), (0, 0.18, 1.12), 0.40, 0.40, mats["body"], overlap=1.35),
        _segment("belly", (0, 0.06, 0.74), (0, 0.22, 1.02), 0.26, 0.22, mats["belly"], overlap=1.2),
        _segment("neck", (0, 0.14, 1.06), (0, 0.24, 1.26), 0.20, 0.22, mats["body"], overlap=1.4),
    ]
    parts += _head_parts(spec, mats, 1.32, 0.26)

    kangaroo_tail = spec["visual"].get("tail") == "thick"
    if kangaroo_tail:
        tail_parts, tail_bone_list = _kangaroo_tail(spec, mats, (0, -0.30, 0.66))
        parts += tail_parts
    else:
        parts += _tail_parts(spec, mats, 0.72, -0.26)

    for side, x in (("L", 0.17), ("R", -0.17)):
        hip = (x, hip_y, hip_z)
        knee = (x, 0.14, 0.46)
        hock = (x, -0.16, 0.12)
        toe = (x, 0.34, 0.045)
        # The haunch: the widest mass of a kangaroo, sitting over the top of the thigh.
        parts.append(sphere(f"haunch.{side}", (x * 0.9, 0.0, 0.62), (0.22, 0.42, 0.38), mats["body"]))
        parts.append(_segment(f"thigh.{side}", hip, knee, 0.20, 0.26, mats["body"], overlap=1.35))
        parts.append(_limb(f"shin.{side}", knee, hock, 0.12, 0.12, mats["body"]))
        parts.append(box(f"foot.{side}", (x, (hock[1] + toe[1]) / 2, 0.045), (0.14, toe[1] - hock[1] + 0.06, 0.09), mats["accent"]))
        shoulder = (x * 0.6, 0.22, 1.06)
        paw = (x * 0.7, 0.38, 0.84)
        parts.append(_limb(f"arm.{side}", shoulder, paw, 0.08, 0.08, mats["body"]))
        parts.append(sphere(f"paw.{side}", paw, (0.09, 0.09, 0.08), mats["accent"]))

    bones = [
        ("root", (0, 0, 0.0), (0, 0, 0.12), None),
        ("hips", (0, hip_y, hip_z), (0, 0.02, 0.90), "root"),
        ("spine", (0, 0.02, 0.90), (0, 0.20, 1.10), "hips"),
        ("head", (0, 0.20, 1.12), (0, 0.30, 1.42), "spine"),
    ]
    bones += _jaw_bone(1.32, 0.26)
    if kangaroo_tail:
        bones += tail_bone_list
    else:
        bones += _tail_bones(spec, 0.72, -0.26, "hips")
    for side, x in (("L", 0.17), ("R", -0.17)):
        bones += [
            (f"thigh.{side}", (x, hip_y, hip_z), (x, 0.14, 0.46), "hips"),
            (f"shin.{side}", (x, 0.14, 0.46), (x, -0.16, 0.12), f"thigh.{side}"),
            (f"foot.{side}", (x, -0.16, 0.10), (x, 0.34, 0.04), f"shin.{side}"),
            (f"arm.{side}", (x * 0.6, 0.22, 1.06), (x * 0.7, 0.38, 0.84), "spine"),
        ]
    # The back of the leaning chest, where a pack rests: the chest sphere is centred on
    # (0, 0.14, 1.01) and 0.38 deep (a diameter), so its back surface is near y = -0.05.
    sockets = _head_sockets(1.32, 0.26)
    sockets["socket_back"] = ("spine", (0, -0.05, 1.02))
    sockets.update(_hand_sockets("arm", lambda x: (x * 0.7, 0.38, 0.84), 0.17))
    return parts, bones, "hopper", sockets


def build_upright(spec, mats):
    """
    Human, lion, deer, raccoon, koala, shark, dragon: a vertical torso on two straight legs.

    Built the same way as the hopper — every limb is laid along the segment between its two
    joints — so thighs taper into shins and arms hang from shoulders with the hand at the hip,
    rather than the square pillars and box arms of the first version.

    Proportions are an animal's standing up, not a mannequin's: a barrel of a torso, thighs as
    wide as the hip joint they hang from, arms thick enough to touch the body, and rounded paws.
    Rendered side by side, the first draft of this plan read as seven identical action figures
    wearing different heads.
    """
    feature = _feature(spec)
    longneck = feature == "longneck"
    # A long neck carries the head up and forward off the shoulders, so it is seen from the side
    # as a neck rather than as a head resting on a collar.
    top, forward = (1.48, 0.20) if longneck else (1.38, 0.02)
    parts = [
        sphere("hips", (0, -0.01, 0.86), (0.40, 0.30, 0.28), mats["body"]),
        _segment("torso", (0, 0, 0.84), (0, 0.01, 1.24), 0.46, 0.32, mats["body"], overlap=1.2),
        _segment("belly", (0, 0.10, 0.90), (0, 0.11, 1.14), 0.30, 0.20, mats["belly"], overlap=1.1),
        # No neck part on a short-necked plan. The first draft had one, sitting entirely inside
        # the shoulders and the skull, so it drew nothing — and a closed island no bone can see
        # gives heat weighting a singular block. Whether that solve fails then depends on
        # summation order: 3 skins in 320, each leaving over a thousand vertices on no bone.
        # `lib.hidden_parts` refuses such a part at build time now.
        sphere("shoulders", (0, 0, 1.20), (0.52, 0.26, 0.18), mats["body"]),
    ]
    if longneck:
        # Pinned to its own bone (below): it spans exactly that bone, so riding it rigidly is the
        # right deformation, and it keeps the neck out of the heat solve — see the bone's comment.
        parts.append(lib.pin(_segment("neck", (0, 0.0, 1.16), (0, forward - 0.03, top - 0.08), 0.17, 0.18,
                                      mats["body"], overlap=1.2), "neck"))
    if feature == "dorsal":
        # A shark's fin, on a back that is vertical because this shark stands up: turned a quarter
        # turn about X so its base runs up the spine and its point sweeps down toward the tail.
        parts.append(lib.pin(wedge("dorsal", (0, -0.25, 1.06), (0.04, 0.34, 0.24), mats["accent"],
                                   rotation=(math.radians(90), 0, 0)), "spine"))
    parts += _head_parts(spec, mats, top, forward)
    parts += _tail_parts(spec, mats, 0.86, -0.02)

    for side, x in (("L", 0.13), ("R", -0.13)):
        hip, knee, ankle = (x, 0, 0.86), (x, 0.03, 0.47), (x, 0, 0.09)
        parts.append(_segment(f"thigh.{side}", hip, knee, 0.21, 0.22, mats["body"], overlap=1.2))
        parts.append(_segment(f"shin.{side}", knee, ankle, 0.15, 0.16, mats["body"], overlap=1.15))
        parts.append(sphere(f"foot.{side}", (x, 0.07, 0.05), (0.15, 0.30, 0.11), mats["accent"]))
        sx = x * 1.9
        shoulder, elbow, hand = (sx, 0, 1.18), (sx * 1.06, 0.02, 0.96), (sx * 1.06, 0.06, 0.77)
        parts.append(_segment(f"upperarm.{side}", shoulder, elbow, 0.13, 0.13, mats["body"], overlap=1.25))
        parts.append(_segment(f"forearm.{side}", elbow, hand, 0.11, 0.11, mats["body"], overlap=1.2))
        parts.append(sphere(f"hand.{side}", hand, (0.12, 0.12, 0.12), mats["accent"]))

    bones = [
        ("root", (0, 0, 0.0), (0, 0, 0.12), None),
        ("hips", (0, 0, 0.86), (0, 0, 1.02), "root"),
        ("spine", (0, 0, 1.02), (0, 0, 1.20), "hips"),
    ]
    if longneck:
        # A neck bone of its own, the way the quadrupeds have one. With a single head bone
        # running 0.41 m from inside the shoulders through the neck into the skull, heat
        # weighting failed on 9 dragon builds in 40 — and on no other animal in 640.
        neck_top = (0, forward - 0.03, top - 0.10)
        bones += [
            ("neck", (0, 0, 1.20), neck_top, "spine"),
            ("head", neck_top, (0, forward, top + 0.08), "neck"),
        ]
    else:
        bones.append(("head", (0, 0, 1.20), (0, forward, top + 0.08), "spine"))
    bones += _jaw_bone(top, forward)
    bones += _tail_bones(spec, 0.86, -0.02, "hips")
    for side, x in (("L", 0.13), ("R", -0.13)):
        sx = x * 1.9
        bones += [
            (f"thigh.{side}", (x, 0, 0.86), (x, 0.03, 0.47), "hips"),
            (f"shin.{side}", (x, 0.03, 0.47), (x, 0, 0.10), f"thigh.{side}"),
            (f"foot.{side}", (x, 0, 0.08), (x, 0.24, 0.04), f"shin.{side}"),
            (f"arm.{side}", (sx, 0, 1.18), (sx * 1.06, 0.06, 0.77), "spine"),
        ]
    # Torso 0.32 deep (a diameter): the back surface is y = -0.16 at chest height.
    sockets = _head_sockets(top, forward)
    sockets["socket_back"] = ("spine", (0, -0.16, 1.10))
    sockets.update(_hand_sockets("arm", lambda x: (x * 1.9 * 1.06, 0.06, 0.77), 0.13))
    return parts, bones, "upright", sockets


def build_waddler(spec, mats):
    """
    Penguin, bear, panda: a tall egg of a body on short legs.

    It used to be `build_upright` with a wider chest, which kept a person's leg length — so the
    penguin walked on two long black stilts and the bear and panda had the penguin's flippers for
    arms. `PLANS.waddler` in the procedural avatar already puts the hip at 0.29 m; this matches it.
    Every animal still fills the same capsule (fairness), so a waddler is tall by being mostly body.

    Forelimbs come from `visual.forelimbs`: flippers are a penguin's, not a property of the plan.
    """
    v = spec["visual"]
    flippers = v.get("forelimbs", "arms") == "flippers"
    # A panda is a white bear in black stockings with a black saddle over the shoulders; without
    # that it rendered as a polar bear. Limbs take the accent colour and a band crosses the back.
    patches = _feature(spec) == "patches"
    limb = mats["accent"] if patches else mats["body"]
    top, forward = 1.30, 0.04
    parts = [
        _segment("body", (0, 0, 0.28), (0, 0.02, 1.16), 0.62, 0.52, mats["body"], overlap=1.12),
        # The pale front is what makes a penguin a penguin (and a panda's chest a panda's). Set
        # just inside the egg it was 98 % hidden on the penguin; it sits forward enough now that
        # the whole front of the body reads as belly.
        _segment("belly", (0, 0.19, 0.36), (0, 0.20, 1.02), 0.46, 0.30, mats["belly"], overlap=1.05),
    ]
    if patches:
        # The saddle: a band a little proud of the egg at shoulder height, pinned to the spine so
        # it moves with the chest. The pale belly still shows through in front.
        parts.append(lib.pin(sphere("saddle", (0, -0.01, 1.00), (0.66, 0.56, 0.20), mats["accent"]), "spine"))
    parts += _head_parts(spec, mats, top, forward)
    # Against the egg where the egg is: at hip height it has narrowed to 0.18 m deep, and a tail
    # placed for its widest point hung twelve centimetres behind every penguin, bear and panda.
    parts += _tail_parts(spec, mats, 0.50, -0.10)

    for side, x in (("L", 0.15), ("R", -0.15)):
        hip, knee, ankle = (x, 0, 0.36), (x, 0.03, 0.20), (x, 0, 0.07)
        parts.append(_segment(f"thigh.{side}", hip, knee, 0.15, 0.16, limb, overlap=1.3))
        parts.append(_segment(f"shin.{side}", knee, ankle, 0.12, 0.13, limb, overlap=1.3))
        parts.append(box(f"foot.{side}", (x, 0.08, 0.035), (0.16, 0.28, 0.07), mats["accent"]))
        sx = 0.30 if side == "L" else -0.30
        if flippers:
            # A wing hanging from the shoulder and held away from the body at the tip, flat, so it
            # reads as a flipper edge-on. The first version tilted the other way — tips pinned to
            # the sides and the tops sticking out, a V — and in the accent colour, which on a
            # penguin is the beak's yellow: two yellow sticks either side of the head.
            parts.append(box(f"arm.{side}", (sx * 1.05, 0.0, 0.86), (0.05, 0.18, 0.46), mats["body"],
                             rotation=(0, math.radians(-14 if side == "L" else 14), 0)))
        else:
            shoulder, paw = (sx, 0.04, 1.02), (sx * 1.1, 0.16, 0.74)
            parts.append(_segment(f"arm.{side}", shoulder, paw, 0.14, 0.14, limb, overlap=1.2))
            parts.append(sphere(f"paw.{side}", paw, (0.13, 0.13, 0.12), mats["accent"]))

    bones = [
        ("root", (0, 0, 0.0), (0, 0, 0.12), None),
        ("hips", (0, 0, 0.36), (0, 0, 0.72), "root"),
        ("spine", (0, 0, 0.72), (0, 0.01, 1.14), "hips"),
        ("head", (0, 0.01, 1.14), (0, 0.04, 1.42), "spine"),
    ]
    bones += _jaw_bone(top, forward)
    bones += _tail_bones(spec, 0.50, -0.10, "hips")
    for side, x in (("L", 0.15), ("R", -0.15)):
        sx = 0.30 if side == "L" else -0.30
        bones += [
            (f"thigh.{side}", (x, 0, 0.36), (x, 0.03, 0.20), "hips"),
            (f"shin.{side}", (x, 0.03, 0.20), (x, 0, 0.08), f"thigh.{side}"),
            (f"foot.{side}", (x, 0, 0.07), (x, 0.22, 0.03), f"shin.{side}"),
            (f"arm.{side}", (sx, 0.04, 1.08), (sx * 1.1, 0.12, 0.66), "spine"),
        ]
    # The egg is 0.52 deep (a diameter): its back surface is y = -0.26 at chest height.
    sockets = _head_sockets(top, forward)
    sockets["socket_back"] = ("spine", (0, -0.25, 0.96))
    if flippers:
        sockets.update(_hand_sockets("arm", lambda x: (x * 2.2, 0.0, 0.66), 0.15))
    else:
        sockets.update(_hand_sockets("arm", lambda x: (x * 2.2, 0.16, 0.74), 0.15))
    return parts, bones, "waddler", sockets


def build_quadruped(spec, mats):
    """
    Wolf, fox, tiger: a horizontal spine carried on four legs.

    One continuous barrel from haunch to chest, and legs that taper from a muscled top to a slim
    wrist. It was three equal spheres in a row on four square pillars, which in a side render read
    as a caterpillar on table legs — the same defect the kangaroo's back had. The joints, and so
    the bones and every clip, are where they were.
    """
    parts = [
        _segment("barrel", (0, -0.36, 0.93), (0, 0.24, 0.97), 0.38, 0.38, mats["body"], overlap=1.22),
        sphere("chest", (0, 0.20, 0.95), (0.42, 0.42, 0.44), mats["body"]),
        sphere("hips", (0, -0.32, 0.94), (0.38, 0.34, 0.36), mats["body"]),
        sphere("underside", (0, -0.04, 0.80), (0.28, 0.56, 0.16), mats["belly"]),
        cone("neck", (0, 0.44, 1.12), 0.17, 0.13, 0.32, mats["body"], vertices=8,
             rotation=(math.radians(58), 0, 0)),
    ]
    parts += _head_parts(spec, mats, 1.30, 0.58)
    parts += _tail_parts(spec, mats, 0.96, -0.34)

    # Front legs sit under the chest, hind legs under the hips; a hind thigh is deeper than a
    # foreleg because that is where the drive comes from.
    for side, x in (("L", 0.19), ("R", -0.19)):
        for tag, y, thigh in (("front", 0.26, (0.15, 0.17)), ("back", -0.30, (0.17, 0.24))):
            parts.append(_segment(f"{tag}upper.{side}", (x, y, 0.88), (x, y, 0.50), thigh[0], thigh[1],
                                  mats["body"], overlap=1.2))
            # Down into the paw: the first version's shin stopped five centimetres above it, and
            # every wolf, fox and tiger stood on four paws floating free of its legs.
            parts.append(_segment(f"{tag}lower.{side}", (x, y, 0.50), (x, y, 0.08), 0.11, 0.12,
                                  mats["body"], overlap=1.15))
            parts.append(sphere(f"{tag}paw.{side}", (x, y + 0.05, 0.05), (0.14, 0.22, 0.11), mats["accent"]))

    bones = [
        ("root", (0, 0, 0.0), (0, 0, 0.12), None),
        ("hips", (0, -0.34, 0.94), (0, -0.06, 0.94), "root"),
        ("spine", (0, -0.06, 0.94), (0, 0.24, 0.98), "hips"),
        ("neck", (0, 0.24, 0.98), (0, 0.48, 1.18), "spine"),
        ("head", (0, 0.48, 1.18), (0, 0.72, 1.30), "neck"),
    ]
    bones += _jaw_bone(1.30, 0.58)
    bones += _tail_bones(spec, 0.96, -0.34, "hips")
    for side, x in (("L", 0.19), ("R", -0.19)):
        for tag, y, parent in (("front", 0.26, "spine"), ("back", -0.30, "hips")):
            bones += [
                (f"{tag}upper.{side}", (x, y, 0.84), (x, y, 0.50), parent),
                (f"{tag}lower.{side}", (x, y, 0.50), (x, y, 0.12), f"{tag}upper.{side}"),
                (f"{tag}paw.{side}", (x, y, 0.10), (x, y + 0.20, 0.05), f"{tag}lower.{side}"),
            ]
    # On four legs the back is the *top* of the barrel — centred at z 0.94 and 0.38 tall — so a
    # pack rides on it at z 1.13 rather than hanging off the rump.
    sockets = _head_sockets(1.30, 0.58)
    sockets["socket_back"] = ("spine", (0, -0.06, 1.13))
    sockets.update(_hand_sockets("frontpaw", lambda x: (x, 0.31, 0.06), 0.19))
    return parts, bones, "quadruped", sockets


"""
Every body plan `AnimalVisual.build` can name, including `quadruped` explicitly.

It used to be looked up as `PLANS.get(plan_name, build_quadruped)` with no `quadruped` key, so an
animal that declared nothing became a quadruped here while `Avatar.ts`'s procedural fallback made
the same animal an `upright`. The wolf, the fox and the tiger were the three that declared
nothing: four legs from their `.glb`, two legs when it failed to load. `build` is required in the
type now and this table has no default, so neither renderer can invent one again.
"""
# --------------------------------------------------------------------------------------------
# Source meshes: a sculpted body on the same skeleton
# --------------------------------------------------------------------------------------------

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

# Joint positions measured on each source mesh after `_import_source` has normalised it (facing
# +Y, feet on z = 0, 1.75 m to the ear tips, centred on x), read off gridded orthographic side
# and front renders. They are art data, like the prompt that made the mesh: the skeleton, the
# bone names and therefore every clip are the hopper plan's own, so a sculpted kangaroo moves
# exactly as the primitive one did and every socket the client looks for still exists.
SOURCE_MESHES = {
    "kangaroo": {
        "path": os.path.join(REPO, "assets", "meshy", "animals", "kangaroo.glb"),
        "plan": "hopper",
        "height": 1.75,
        "triangles": 3900,
        "hip": (0.13, -0.10, 0.78),
        "knee": (0.13, 0.12, 0.52),
        "hock": (0.13, -0.04, 0.10),
        "toe": (0.17, 0.46, 0.02),
        "spine": ((0, -0.10, 0.74), (0, 0.0, 0.92), (0, 0.26, 1.30)),
        "head": ((0, 0.31, 1.32), (0, 0.42, 1.62)),
        "jaw": ((0, 0.47, 1.47), (0, 0.66, 1.43)),
        "shoulder": (0.12, 0.28, 1.15),
        "paw": (0.07, 0.37, 0.87),
        # Down from the rump, then back along the ground: two bones for the part lying on it, or one
        # 0.4 m bone carries the whole ground run and the tail can only swing it as a stick.
        "tail": ((0, -0.17, 0.56), (0, -0.16, 0.30), (0, -0.22, 0.07), (0, -0.44, 0.03), (0, -0.64, 0.02)),
        "eyes": ((0.055, 0.53, 1.53), (-0.055, 0.53, 1.53)),
        "nose": (0, 0.665, 1.455),
        "crown": (0, 0.44, 1.60),
        "face": (0, 0.56, 1.53),
        "back": (0, -0.13, 1.08),
    },
}


def _import_source(src):
    """
    The source mesh, cleaned and normalised into builder space.

    Meshy's files arrive split along every UV seam — measured, ~1,200 islands and 10,000
    non-manifold edges per kangaroo — which automatic weighting reads as a thousand loose pieces.
    Merged by distance they are one closed surface. Then it is turned to face +Y like every other
    builder, stood on z = 0 at the body plan's height, and decimated to the character budget:
    the 12,500 triangles Meshy returns are three times what sixteen animals on a Quest can afford.
    """
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=src["path"])
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    if len(meshes) != 1:
        raise AssertionError(f"{src['path']}: expected one mesh, found {len(meshes)}")
    ob = meshes[0]
    world = ob.matrix_world.copy()
    ob.parent = None
    ob.matrix_world = Matrix.Identity(4)
    ob.data.transform(world)
    for o in new:
        if o is not ob:
            bpy.data.objects.remove(o, do_unlink=True)

    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.to_mesh(ob.data)
    bm.free()
    while ob.data.uv_layers:
        ob.data.uv_layers.remove(ob.data.uv_layers[0])
    ob.data.materials.clear()

    ob.data.transform(Matrix.Rotation(math.pi, 4, "Z"))
    zs = [v.co.z for v in ob.data.vertices]
    ob.data.transform(Matrix.Scale(src["height"] / (max(zs) - min(zs)), 4))
    xs = [v.co.x for v in ob.data.vertices]
    ob.data.transform(Matrix.Translation((-(max(xs) + min(xs)) / 2, 0, -min(v.co.z for v in ob.data.vertices))))

    bpy.context.view_layer.objects.active = ob
    decimate = ob.modifiers.new("decimate", "DECIMATE")
    decimate.ratio = min(1.0, src["triangles"] / max(1, len(ob.data.polygons)))
    decimate.use_symmetry = True
    decimate.symmetry_axis = "X"
    bpy.ops.object.modifier_apply(modifier=decimate.name)
    return ob


def _paint_source(ob, src, mats):
    """
    Colour by region from the animal's own palette: cream chest and belly, dark eyes and nose,
    accent paws, feet and tail tip. The mesh arrives with no material at all, and the game's art
    is flat palette colour rather than textures, so the regions are geometry, not an image.
    """
    for key in ("body", "belly", "accent", "dark"):
        ob.data.materials.append(mats[key])
    body, belly, accent, dark = 0, 1, 2, 3
    eyes = [Vector(e) for e in src["eyes"]]
    nose = Vector(src["nose"])
    paw = Vector(src["paw"])
    shoulder = Vector(src["shoulder"])

    def near_arm(c, reach):
        # Distance from the forearm segment on this side: the arms lie against the chest, and a
        # rule written for "front of the torso" paints them cream along with it.
        m = Vector((abs(c.x), c.y, c.z))
        axis = paw - shoulder
        t = max(0.0, min(1.0, (m - shoulder).dot(axis) / axis.length_squared))
        return (m - (shoulder + axis * t)).length < reach

    for poly in ob.data.polygons:
        c, n = poly.center, poly.normal
        index = body
        # Where the torso's front surface is at this height: the back leans forward as it rises.
        front = 0.10 + (c.z - 0.9) * 0.57
        if any((c - e).length < 0.028 for e in eyes) or (c - nose).length < 0.035:
            index = dark
        elif c.z < 0.045 and c.y > -0.12:
            index = accent  # soles and toes
        elif c.y < -0.48 and c.z < 0.1:
            index = accent  # tail tip
        elif (Vector((abs(c.x), c.y, c.z)) - paw).length < 0.06:
            index = accent  # paws
        elif 0.6 < c.z < 1.36 and c.y > front and n.y > 0.45 and abs(c.x) < 0.12 and not near_arm(c, 0.05):
            index = belly  # chest and belly, between the arms
        poly.material_index = index


def build_from_source(spec, mats, src):
    """A source mesh on the body plan's skeleton, with sockets at its own measured landmarks."""
    ob = _import_source(src)
    _paint_source(ob, src, mats)
    hx, hy, hz = src["hip"]
    kx, ky, kz = src["knee"]
    ax, ay, az = src["hock"]
    tx, ty, tz = src["toe"]
    (h0, h1, s1) = src["spine"]
    bones = [
        ("root", (0, 0, 0.0), (0, 0, 0.12), None),
        ("hips", h0, h1, "root"),
        ("spine", h1, s1, "hips"),
        ("head", src["head"][0], src["head"][1], "spine"),
        ("jaw", src["jaw"][0], src["jaw"][1], "head"),
    ]
    tail = src["tail"]
    for i in range(len(tail) - 1):
        bones.append((f"tail.{i + 1}", tail[i], tail[i + 1], "hips" if i == 0 else f"tail.{i}"))
    sx, sy, sz = src["shoulder"]
    px, py, pz = src["paw"]
    for side, sign in (("L", 1), ("R", -1)):
        bones += [
            (f"thigh.{side}", (hx * sign, hy, hz), (kx * sign, ky, kz), "hips"),
            (f"shin.{side}", (kx * sign, ky, kz), (ax * sign, ay, az), f"thigh.{side}"),
            (f"foot.{side}", (ax * sign, ay, az), (tx * sign, ty, tz), f"shin.{side}"),
            (f"arm.{side}", (sx * sign, sy, sz), (px * sign, py, pz), "spine"),
        ]
    sockets = {
        "socket_head": ("head", src["crown"]),
        "socket_face": ("head", src["face"]),
        "socket_back": ("spine", src["back"]),
    }
    sockets.update(_hand_sockets("arm", lambda x: (x, py, pz), px))
    return [ob], bones, src["plan"], sockets


PLANS = {
    "hopper": build_hopper,
    "upright": build_upright,
    "waddler": build_waddler,
    "quadruped": build_quadruped,
}


# --------------------------------------------------------------------------------------------
# Animation
# --------------------------------------------------------------------------------------------


def _legs(plan):
    """(front-ish, back-ish) bone name pairs, so one animator drives two and four legs alike."""
    if plan == "quadruped":
        return [
            ("frontupper.L", "frontlower.L"), ("frontupper.R", "frontlower.R"),
            ("backupper.L", "backlower.L"), ("backupper.R", "backlower.R"),
        ]
    return [("thigh.L", "shin.L"), ("thigh.R", "shin.R")]


def animate(arm, plan, tail_bones):
    """
    Key the five clips.

    The cycles are sine-driven rather than hand-posed: the phase offsets are what make a gait
    read, and they are easier to get right as numbers than as poses. Quadrupeds use a diagonal
    pattern — front-left with back-right — because a four-legged walk with both left legs moving
    together reads as a pantomime horse.
    """
    legs = _legs(plan)
    # Arms exist on the two-legged plans only; a quadruped's front limbs are already in `legs`.
    arms = [b for b in ("arm.L", "arm.R") if b in arm.pose.bones]
    """
    Phase per leg, in fractions of a cycle.

    Quadrupeds move diagonally — front-left with back-right — because a four-legged walk with both
    left legs together reads as a pantomime horse.

    A hopper's legs stay in phase, which is the whole point of it. Both hind feet leave and land
    together; that is what a kangaroo *is*, and the game is named after it. The first version gave
    hoppers the same alternating stride as a person, so the signature animal of Kangaroo Chase ran
    like a man in a costume — and the procedural avatar it replaced had hopped correctly, so the
    model was a regression in exactly the thing players look at most.
    """
    if plan == "quadruped":
        phases = [0.0, 0.5, 0.5, 0.0]
    elif plan == "hopper":
        phases = [0.0, 0.0]
    else:
        phases = [0.0, 0.5]

    hopping = plan == "hopper"
    waddling = plan == "waddler"

    def gait(name, swing, lift, bob, lean):
        clip = Clip(arm, name, LENGTHS[name])
        n = LENGTHS[name]
        steps = [1, n // 4, n // 2, (3 * n) // 4]
        # A waddler takes small steps and gets its speed from the roll, so the legs swing about
        # half as far; a full human stride under a rolling body reads as a stagger.
        if waddling:
            swing *= 0.5
            lift *= 0.45
        # A hop is one launch per cycle, not two footfalls, so the body rises once and higher —
        # and it is the arc that sells the weight, not the legs.
        rise = bob * (2.6 if hopping else 1.0)
        for (upper, lower), phase in zip(legs, phases):
            ukeys, lkeys = [], []
            for f in steps:
                t = (f - 1) / n + phase
                ukeys.append((f, (swing * math.sin(t * math.tau), 0, 0)))
                # The lower joint only ever folds one way; a knee that bends backwards is the
                # thing people notice before anything else about a walk.
                lkeys.append((f, (-lift * max(0.0, math.sin(t * math.tau + 1.2)), 0, 0)))
            clip.cycle(upper, ukeys)
            clip.cycle(lower, lkeys)
        # Negative is forward on these rigs. It was `+lean`, and measured through the real clips
        # every animal's run leaned *back* — the kangaroo's head 0.225 m behind where it idles —
        # which reads as braking, not running. A runner leans into the run.
        clip.cycle("spine", [(f, (-lean, 0, 0)) for f in steps])
        if waddling:
            # A waddle is a roll, not a stride.
            #
            # `visual.build` has said "waddler" since the roster was written and the animation
            # ignored it, so the penguin marched past like a small man in a dinner jacket. What
            # makes a waddle is the body tipping side to side over each planted foot while the
            # legs barely swing — so the roll goes on the hips, a quarter-cycle behind the legs,
            # which is the moment the weight has finished transferring.
            clip.cycle(
                "hips",
                [(f, (0, 14.0 * math.sin(((f - 1) / n - 0.25) * math.tau), 0)) for f in steps],
            )
        # Arms, counter-swinging against the legs.
        #
        # They were never keyed at all, which is why every screenshot showed a kangaroo sprinting
        # past with two rigid blocks held out at its sides like a mannequin. Counter-swing is what
        # makes a two-legged run read as a run rather than a slide: the arm opposite the forward
        # leg comes forward, which is also how a real kangaroo balances a hop.
        for index, bone in enumerate(arms):
            phase = 0.5 if index else 0.0
            clip.cycle(
                bone,
                [(f, (-swing * 0.75 * math.sin(((f - 1) / n + phase + 0.5) * math.tau), 0, 0)) for f in steps],
            )
        clip.cycle(
            "root",
            [(f, (0, 0, 0)) for f in steps],
        )
        # Vertical travel on the root. Twice per stride for a walker, once for a hopper: a hop is
        # a single launch and a single landing, and bobbing twice makes it read as a jog.
        for f in steps + [n]:
            t = (f - 1) / n
            lift_curve = math.sin(t * math.pi) ** 0.7 if hopping else abs(math.sin(t * math.tau))
            clip.key("root", f, (0, 0, 0), loc=(0, 0, rise * lift_curve))
        # The tail is the counterweight, so on a hopper it swings in pitch against the body rather
        # than wagging sideways: down on the launch, up as the legs come forward for the landing.
        for i, tb in enumerate(tail_bones):
            if hopping:
                # Amplitude falls off along the chain. Bones are parented in sequence, so giving
                # every segment the same nineteen degrees compounds to nearly sixty at the tip —
                # which swung the end of the tail far enough to pull the spheres apart and left a
                # kangaroo hopping ahead of three loose brown lumps. Tapering keeps the whole tail
                # inside the arc the geometry can bend through.
                amplitude = swing * 0.42 / (1 + i)
                clip.cycle(
                    tb,
                    [(f, (-amplitude * math.sin(((f - 1) / n) * math.tau + i * 0.2), 0, 0)) for f in steps],
                )
            else:
                clip.cycle(tb, [(f, (0, 0, swing * 0.35 * math.sin(((f - 1) / n) * math.tau + i * 0.4))) for f in steps])
        return clip

    gait("walk", swing=22.0, lift=26.0, bob=0.035, lean=2.0)
    gait("run", swing=38.0, lift=44.0, bob=0.075, lean=8.0)

    # Idle: breathing, not stillness. A model that holds one pose exactly reads as frozen, which
    # is a state this game actually has, so idle must not look like it.
    idle = Clip(arm, "idle", LENGTHS["idle"])
    n = LENGTHS["idle"]
    idle.cycle("spine", [(1, (0, 0, 0)), (n // 2, (2.5, 0, 0))])
    idle.cycle("head", [(1, (0, 0, 0)), (n // 3, (-3.0, 2.0, 0)), (2 * n // 3, (1.5, -2.0, 0))])
    for f in (1, n // 2, n):
        idle.key("root", f, (0, 0, 0), loc=(0, 0, 0.012 * math.sin(((f - 1) / n) * math.tau)))
    for i, tb in enumerate(tail_bones):
        idle.cycle(tb, [(1, (0, 0, 0)), (n // 2, (0, 0, 5.0 + 2.0 * i))])
    for bone in arms:
        idle.cycle(bone, [(1, (0, 0, 0)), (n // 2, (4.5, 0, 0))])

    # Jump: crouch, extend, tuck. Not a loop — the renderer plays it once.
    jump = Clip(arm, "jump", LENGTHS["jump"])
    for (upper, lower), _ in zip(legs, phases):
        jump.key(upper, 1, (0, 0, 0))
        jump.key(upper, 4, (34, 0, 0))
        jump.key(upper, 9, (-30, 0, 0))
        jump.key(upper, 16, (14, 0, 0))
        jump.key(upper, LENGTHS["jump"], (0, 0, 0))
        jump.key(lower, 1, (0, 0, 0))
        jump.key(lower, 4, (-46, 0, 0))
        jump.key(lower, 9, (-8, 0, 0))
        jump.key(lower, 16, (-34, 0, 0))
        jump.key(lower, LENGTHS["jump"], (0, 0, 0))
    jump.key("root", 1, (0, 0, 0), loc=(0, 0, 0))
    jump.key("root", 4, (0, 0, 0), loc=(0, 0, -0.12))
    jump.key("root", 9, (0, 0, 0), loc=(0, 0, 0.10))
    jump.key("root", LENGTHS["jump"], (0, 0, 0), loc=(0, 0, 0))
    for bone in arms:
        jump.key(bone, 1, (0, 0, 0))
        jump.key(bone, 4, (26, 0, 0))
        jump.key(bone, 9, (-52, 0, 0))
        jump.key(bone, LENGTHS["jump"], (0, 0, 0))
    for i, tb in enumerate(tail_bones):
        jump.key(tb, 1, (0, 0, 0))
        jump.key(tb, 9, (-20.0 / (1 + i), 0, 0))
        jump.key(tb, LENGTHS["jump"], (0, 0, 0))

    # Hit: a recoil that is legible from across the map, which is where tags happen.
    hit = Clip(arm, "hit", LENGTHS["hit"])
    # A recoil throws the head *back*. These were negative, which on these rigs is forward, so a
    # tagged animal nodded into the hit (head +0.07 m forward at the peak) instead of reeling.
    hit.key("spine", 1, (0, 0, 0))
    hit.key("spine", 3, (24, 0, 8))
    hit.key("spine", 9, (-8, 0, -3))
    hit.key("spine", LENGTHS["hit"], (0, 0, 0))
    for bone in arms:
        hit.key(bone, 1, (0, 0, 0))
        hit.key(bone, 3, (-34, 0, 0))
        hit.key(bone, LENGTHS["hit"], (0, 0, 0))
    hit.key("head", 1, (0, 0, 0))
    hit.key("head", 3, (28, 0, 12))
    hit.key("head", LENGTHS["hit"], (0, 0, 0))

    _emotes(arm, legs, arms, tail_bones)


def _emotes(arm, legs, arms, tail_bones):
    """
    The seven emotes.

    Posed on whatever bones the body actually has rather than on a fixed skeleton: a quadruped has
    no `arm.L`, and a frog has no tail, so each loop runs over what the builder produced. That is
    why a wave reads on a kangaroo and on a wolf without two versions of it.

    They are one-shot clips, not cycles — the renderer plays each once and falls back to the
    movement clips — so the last frame returns to the rest pose and nothing is keyed to loop.
    """
    hips = [upper for upper, _ in legs]
    knees = [lower for _, lower in legs]

    def settle(clip, length):
        """Return every posed bone to rest on the final frame, so the blend out is clean."""
        for bone in (["spine", "head", "root"] + arms + hips + knees + tail_bones):
            if bone in arm.pose.bones:
                clip.key(bone, length, (0, 0, 0), loc=(0, 0, 0) if bone == "root" else None)

    # Wave: one arm up, two beats of the wrist. A quadruped has no arm to raise, so it rocks its
    # whole front end instead — the gesture still reads as "over here".
    n = LENGTHS["emote_wave"]
    wave = Clip(arm, "emote_wave", n)
    raised = arms[:1] or hips[:1]
    for bone in raised:
        wave.key(bone, 1, (0, 0, 0))
        wave.key(bone, 6, (-96, 0, 18))
        wave.key(bone, 13, (-96, 0, -16))
        wave.key(bone, 20, (-96, 0, 18))
        wave.key(bone, 27, (-96, 0, -10))
    wave.key("spine", 1, (0, 0, 0))
    wave.key("spine", 13, (-6, 0, 4))
    wave.key("head", 1, (0, 0, 0))
    wave.key("head", 13, (-8, 0, 6))
    settle(wave, n)

    # Dance: a hip sway with a counter-rotating head, the two things that make anything read as
    # dancing. Four beats over a second and a half.
    n = LENGTHS["emote_dance"]
    dance = Clip(arm, "emote_dance", n)
    for beat in range(5):
        f = 1 + beat * (n - 1) // 4
        side = 1 if beat % 2 == 0 else -1
        dance.key("spine", f, (0, 0, 14 * side))
        dance.key("head", f, (-4, 0, -10 * side))
        dance.key("root", f, (0, 0, 6 * side), loc=(0, 0, 0.05 if beat % 2 else 0.0))
        for i, bone in enumerate(arms):
            dance.key(bone, f, (-52 - 20 * side * (1 if i == 0 else -1), 0, 22 * side))
        for i, tb in enumerate(tail_bones):
            dance.key(tb, f, (0, 0, -18 * side / (1 + i)))
    settle(dance, n)

    # Taunt (a point, on the two-legged plans): lean in, one arm straight out, hold, withdraw.
    n = LENGTHS["emote_taunt"]
    taunt = Clip(arm, "emote_taunt", n)
    taunt.key("spine", 1, (0, 0, 0))
    taunt.key("spine", 8, (14, 0, 0))
    taunt.key("spine", 26, (14, 0, 0))
    taunt.key("head", 1, (0, 0, 0))
    taunt.key("head", 8, (6, 0, 0))
    taunt.key("head", 26, (6, 0, 0))
    for bone in arms[:1] or hips[:1]:
        taunt.key(bone, 1, (0, 0, 0))
        taunt.key(bone, 8, (-78, 0, 0))
        taunt.key(bone, 26, (-72, 0, 0))
    settle(taunt, n)

    # Sit: fold the legs, drop the root, let the tail flop. The one emote that changes silhouette.
    n = LENGTHS["emote_sit"]
    sit = Clip(arm, "emote_sit", n)
    for bone in hips:
        sit.key(bone, 1, (0, 0, 0))
        sit.key(bone, 10, (64, 0, 0))
        sit.key(bone, 28, (64, 0, 0))
    for bone in knees:
        sit.key(bone, 1, (0, 0, 0))
        sit.key(bone, 10, (-88, 0, 0))
        sit.key(bone, 28, (-88, 0, 0))
    sit.key("root", 1, (0, 0, 0), loc=(0, 0, 0))
    sit.key("root", 10, (0, 0, 0), loc=(0, 0, -0.30))
    sit.key("root", 28, (0, 0, 0), loc=(0, 0, -0.30))
    sit.key("spine", 10, (-10, 0, 0))
    sit.key("spine", 28, (-10, 0, 0))
    for i, tb in enumerate(tail_bones):
        sit.key(tb, 10, (18.0 / (1 + i), 0, 0))
        sit.key(tb, 28, (14.0 / (1 + i), 0, 0))
    settle(sit, n)

    # Backflip: crouch, launch, a full rotation on the root, land. The root carries the spin so it
    # works on any body plan; the legs only have to tuck.
    n = LENGTHS["emote_backflip"]
    flip = Clip(arm, "emote_backflip", n)
    flip.key("root", 1, (0, 0, 0), loc=(0, 0, 0))
    flip.key("root", 5, (0, 0, 0), loc=(0, 0, -0.18))
    flip.key("root", 11, (-170, 0, 0), loc=(0, 0, 0.55))
    flip.key("root", 17, (-340, 0, 0), loc=(0, 0, 0.30))
    flip.key("root", 22, (-360, 0, 0), loc=(0, 0, -0.08))
    flip.key("root", n, (0, 0, 0), loc=(0, 0, 0))
    for bone in hips:
        flip.key(bone, 1, (0, 0, 0))
        flip.key(bone, 5, (40, 0, 0))
        flip.key(bone, 13, (72, 0, 0))
        flip.key(bone, 22, (26, 0, 0))
    for bone in knees:
        flip.key(bone, 5, (-56, 0, 0))
        flip.key(bone, 13, (-96, 0, 0))
        flip.key(bone, 22, (-30, 0, 0))
    for bone in arms:
        flip.key(bone, 1, (0, 0, 0))
        flip.key(bone, 11, (-120, 0, 0))
        flip.key(bone, 22, (-20, 0, 0))
    settle(flip, n)

    # Power nap: sink, tip over, breathe. Twice the length of the others because the joke is that
    # it takes a while.
    n = LENGTHS["emote_sleep"]
    sleep = Clip(arm, "emote_sleep", n)
    sleep.key("root", 1, (0, 0, 0), loc=(0, 0, 0))
    sleep.key("root", 16, (0, 0, 0), loc=(0, 0, -0.34))
    sleep.key("root", 30, (-72, 0, 0), loc=(0, 0, -0.44))
    sleep.key("root", 56, (-72, 0, 0), loc=(0, 0, -0.44))
    sleep.key("root", n, (0, 0, 0), loc=(0, 0, 0))
    for bone in hips:
        sleep.key(bone, 16, (58, 0, 0))
        sleep.key(bone, 56, (58, 0, 0))
    for bone in knees:
        sleep.key(bone, 16, (-84, 0, 0))
        sleep.key(bone, 56, (-84, 0, 0))
    # The breath: a slow rise and fall on the spine while it is down.
    sleep.key("spine", 30, (-6, 0, 0))
    sleep.key("spine", 40, (2, 0, 0))
    sleep.key("spine", 50, (-6, 0, 0))
    sleep.key("head", 30, (-18, 0, 10))
    sleep.key("head", 56, (-18, 0, 10))
    settle(sleep, n)

    # Victory hop: three bounces, arms up, chest out. The one you press after winning a bout.
    n = LENGTHS["emote_victory"]
    victory = Clip(arm, "emote_victory", n)
    for i, f in enumerate((1, 12, 23)):
        victory.key("root", f, (0, 0, 0), loc=(0, 0, 0))
        victory.key("root", f + 5, (0, 0, 0), loc=(0, 0, 0.26 - i * 0.05))
    victory.key("root", n, (0, 0, 0), loc=(0, 0, 0))
    for bone in arms:
        victory.key(bone, 1, (0, 0, 0))
        victory.key(bone, 6, (-142, 0, 0))
        victory.key(bone, 17, (-128, 0, 0))
        victory.key(bone, 28, (-142, 0, 0))
    for bone in hips:
        victory.key(bone, 6, (-16, 0, 0))
        victory.key(bone, 17, (-16, 0, 0))
    victory.key("spine", 6, (-12, 0, 0))
    victory.key("spine", 17, (-8, 0, 0))
    victory.key("head", 6, (-14, 0, 0))
    settle(victory, n)


# --------------------------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------------------------


def skin_parts(parts, bones, name):
    """
    Join, rig and weight an animal: heat weighting for the body, rigid pins for the rest.

    Pinned parts are joined in *after* the heat solve, not before. `lib.pin` only relabels
    weights once the solve is done, so a pinned part used to be solved anyway — and small closed
    islands are exactly what destabilise it. Measured with the dragon's long neck: the whole solve
    failed on 9 roster builds in 40 (every other animal: 0 in 640), a failure that depends on
    floating-point summation order, so it came and went with build order and process state. A
    neck bone of its own brought it to 2 in 40, and "pinning" the neck changed nothing, because
    pinning never took it out of the solve. Keeping pinned parts out of it does.

    Ears and eyes are the original reason pins exist: heat weighting skipped them — measured,
    every animal's 440 eye vertices and every round-eared animal's 104 ear vertices came out on
    the exporter's `neutral_bone` and stayed put while the head moved.
    """
    pinned = [p for p in parts if lib.is_pinned(p)]
    free = [p for p in parts if not lib.is_pinned(p)]
    mesh = join(free, name)
    arm = armature(f"{name}_rig", bones)
    skin(mesh, arm)
    lib.join_into(mesh, pinned)
    lib.apply_pins(mesh)
    return mesh, arm


def build_animal(spec, out_path, capsule):
    lib.reset()
    lib.reset_materials()
    v = spec["visual"]
    mats = {
        "body": material(f"{spec['id']}_body", v["body"]),
        "accent": material(f"{spec['id']}_accent", v["accent"]),
        "belly": material(f"{spec['id']}_belly", v["belly"]),
        "dark": material(f"{spec['id']}_eye", 0x14181F, roughness=0.35),
    }

    plan_name = v.get("build")
    if plan_name not in PLANS:
        raise ValueError(
            f"{spec['id']}: build={plan_name!r} is not a body plan (have {sorted(PLANS)})"
        )
    source = SOURCE_MESHES.get(spec["id"])
    if source and os.path.exists(source["path"]):
        if source["plan"] != plan_name:
            raise ValueError(f"{spec['id']}: source mesh is rigged as {source['plan']}, spec says {plan_name}")
        parts, bones, plan, sockets = build_from_source(spec, mats, source)
    else:
        parts, bones, plan, sockets = PLANS[plan_name](spec, mats)

        # A part drawn wholly inside other parts is invisible, and worse than invisible: see
        # `lib.hidden_parts`. Refused before it can reach the weighting step it destabilises.
        hidden = lib.hidden_parts(parts)
        if hidden:
            raise AssertionError(f"{spec['id']}: parts hidden inside other parts: {hidden}")
        # And the opposite: a part touching nothing floats. Measured on the art as it shipped, this
        # was every upright and waddler animal's arms, all four paws of every quadruped, the shark's
        # tail fin and — once the arms were fixed — every waddler's tail. None of it looked wrong in
        # the numbers; all of it looked wrong in a render.
        loose = lib.detached_parts(parts)
        if loose:
            raise AssertionError(f"{spec['id']}: parts touching nothing: {loose}")

    mesh, arm = skin_parts(parts, bones, spec["id"])
    # Anything else auto-weighting dropped would ride `neutral_bone` and stay behind in every clip.
    # Refused here rather than shipped: `animal-motion.test.ts` checks the files, this stops the build.
    left = lib.unweighted_vertices(mesh)
    if left:
        raise AssertionError(f"{spec['id']}: {left} vertices have no bone weight")

    # Sockets go on before a single clip is keyed. `bone_socket` places each one in world space
    # against the bone's *current* pose, and once `animate` has run that is whatever frame of the
    # last clip happens to be active — measured, it put a human's hat socket 0.24 m behind the
    # skull and swayed a penguin's sideways by 9 cm, both from a victory pose frozen into rest.
    for name, (bone, world_pos) in sockets.items():
        lib.bone_socket(arm, bone, name, world_pos)

    tail_bones = [b[0] for b in bones if b[0].startswith("tail")]
    animate(arm, plan, tail_bones)

    # The model has to fit the capsule every animal shares, or it floats, sinks, or sticks out of
    # its own hitbox. Checked rather than trusted: the numbers above were typed by hand.
    mesh.data.calc_loop_triangles()
    zs = [(mesh.matrix_world @ v0.co).z for v0 in mesh.data.vertices]
    height, lowest = max(zs) - min(zs), min(zs)
    target = capsule["standHeight"]
    if abs(height - target) > target * 0.22:
        raise AssertionError(f"{spec['id']}: {height:.2f}m tall against a {target}m capsule")
    if abs(lowest) > 0.10:
        raise AssertionError(f"{spec['id']}: feet at z={lowest:.2f}, expected the origin")

    # Face the glTF convention: the front of an asset faces +Z.
    #
    # Every builder above works facing Blender +Y, and the exporter maps +Y to glTF −Z. So every
    # animal shipped facing backwards. Measured by loading the real files through three.js's own
    # GLTFLoader and attaching them to an Avatar, in body space where gameplay forward is +Z: the
    # wolf's snout at z −0.63 and its tail reaching +1.03, the kangaroo's snout at −0.09 and its tail
    # at +0.71. Every animal ran tail first. Nothing caught it because nothing asked which way the
    # nose points — the geometry tests hash positions, and a turned-round mesh hashes the same.
    #
    # Fixed here, not by rotating models on load: an art pack authored to the spec already faces
    # +Z, and a client-side flip would turn every correct model round to fix ours. Rotating the
    # armature object turns the skinned mesh and the sockets with it (both are its children), and
    # leaves every clip untouched, because clips are keyed in bone-local space.
    arm.rotation_euler = (0.0, 0.0, math.pi)
    bpy_update()

    tris = lib.triangle_count(mesh)
    # Normals stay: they have to follow the bones on a skinned mesh. UVs go — nothing here
    # samples a texture, so they are coordinates into an image that does not exist.
    size = lib.export_glb(out_path, animated=True, uvs=False)
    return {"id": spec["id"], "plan": plan, "triangles": tris, "bytes": size, "height": round(height, 3)}
