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

import lib
from lib import Clip, armature, box, cone, join, material, skin, sphere

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


def _head_parts(spec, mats, top, forward):
    """Head, snout, ears and eyes, sitting at `top` and facing +Y."""
    v = spec["visual"]
    parts = [sphere("head", (0, forward, top), (0.34, 0.36, 0.32), mats["body"])]

    snout = v.get("snout", "short")
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

    ears = v.get("ears", "none")
    for side, x in (("L", 0.13), ("R", -0.13)):
        if ears == "tall":
            parts.append(
                cone(f"ear.{side}", (x, forward - 0.04, top + 0.26), 0.06, 0.02, 0.30, mats["body"], vertices=6)
            )
        elif ears == "pointed":
            parts.append(
                cone(f"ear.{side}", (x, forward - 0.02, top + 0.19), 0.07, 0.01, 0.18, mats["body"], vertices=5)
            )
        elif ears == "round":
            parts.append(sphere(f"ear.{side}", (x, forward - 0.02, top + 0.18), (0.13, 0.05, 0.13), mats["body"]))

    for side, x in (("L", 0.12), ("R", -0.12)):
        parts.append(sphere(f"eye.{side}", (x, forward + 0.14, top + 0.06), (0.06, 0.05, 0.06), mats["dark"]))
    return parts


def _tail_parts(spec, mats, base_z, base_y):
    """Tail running backwards along -Y from the hips."""
    shape = spec["visual"].get("tail", "stub")
    if shape == "stub":
        return [sphere("tail", (0, base_y - 0.16, base_z), (0.13, 0.16, 0.13), mats["body"])]
    if shape == "bushy":
        return [
            sphere("tail.1", (0, base_y - 0.17, base_z + 0.04), (0.17, 0.30, 0.17), mats["body"]),
            sphere("tail.2", (0, base_y - 0.38, base_z + 0.11), (0.21, 0.32, 0.21), mats["belly"]),
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
    shape = spec["visual"].get("tail", "stub")
    if shape == "stub":
        return [("tail.1", (0, base_y, base_z), (0, base_y - 0.22, base_z), parent)]
    if shape == "bushy":
        return [
            ("tail.1", (0, base_y, base_z), (0, base_y - 0.26, base_z + 0.08), parent),
            ("tail.2", (0, base_y - 0.26, base_z + 0.08), (0, base_y - 0.52, base_z + 0.16), "tail.1"),
        ]
    return [
        ("tail.1", (0, base_y, base_z), (0, base_y - 0.26, base_z - 0.08), parent),
        ("tail.2", (0, base_y - 0.26, base_z - 0.08), (0, base_y - 0.50, base_z - 0.18), "tail.1"),
        ("tail.3", (0, base_y - 0.50, base_z - 0.18), (0, base_y - 0.70, base_z - 0.26), "tail.2"),
    ]


# --------------------------------------------------------------------------------------------
# Body plans
# --------------------------------------------------------------------------------------------


def build_hopper(spec, mats):
    """Kangaroo and frog: heavy hind legs, short arms, tail out behind."""
    parts = [
        sphere("hips", (0, -0.02, 0.82), (0.42, 0.44, 0.40), mats["body"]),
        sphere("chest", (0, 0.02, 1.10), (0.40, 0.38, 0.38), mats["body"]),
        sphere("belly", (0, 0.14, 0.95), (0.30, 0.22, 0.34), mats["belly"]),
    ]
    parts += _head_parts(spec, mats, 1.34, 0.04)
    parts += _tail_parts(spec, mats, 0.78, -0.02)

    for side, x in (("L", 0.16), ("R", -0.16)):
        parts.append(box(f"thigh.{side}", (x, -0.04, 0.66), (0.20, 0.26, 0.36), mats["body"]))
        parts.append(box(f"shin.{side}", (x, 0.00, 0.30), (0.15, 0.16, 0.42), mats["body"]))
        parts.append(box(f"foot.{side}", (x, 0.14, 0.05), (0.16, 0.44, 0.10), mats["accent"]))
        parts.append(box(f"arm.{side}", (x + 0.08 * (1 if side == "L" else -1), 0.10, 1.06), (0.10, 0.10, 0.28), mats["body"]))

    bones = [
        ("root", (0, 0, 0.0), (0, 0, 0.12), None),
        ("hips", (0, 0, 0.80), (0, 0, 0.98), "root"),
        ("spine", (0, 0, 0.98), (0, 0, 1.16), "hips"),
        ("head", (0, 0, 1.16), (0, 0.02, 1.42), "spine"),
    ]
    bones += _jaw_bone(1.34, 0.04)
    bones += _tail_bones(spec, 0.80, -0.02, "hips")
    for side, x in (("L", 0.16), ("R", -0.16)):
        bones += [
            (f"thigh.{side}", (x, -0.04, 0.82), (x, -0.02, 0.50), "hips"),
            (f"shin.{side}", (x, -0.02, 0.50), (x, 0.02, 0.12), f"thigh.{side}"),
            (f"foot.{side}", (x, 0.02, 0.10), (x, 0.30, 0.06), f"shin.{side}"),
            (f"arm.{side}", (x * 0.55, 0.06, 1.16), (x * 0.75, 0.14, 0.94), "spine"),
        ]
    return parts, bones, "hopper"


def build_upright(spec, mats):
    """Human and penguin: a vertical torso on two straight legs."""
    v = spec["visual"]
    wide = v.get("build") == "waddler"
    parts = [
        sphere("hips", (0, 0, 0.88), (0.34 + 0.08 * wide, 0.30, 0.28), mats["body"]),
        sphere("chest", (0, 0, 1.14), (0.38 + 0.10 * wide, 0.32, 0.34), mats["body"]),
        sphere("belly", (0, 0.13, 1.02), (0.26 + 0.08 * wide, 0.16, 0.34), mats["belly"]),
    ]
    parts += _head_parts(spec, mats, 1.38, 0.02)
    parts += _tail_parts(spec, mats, 0.86, -0.02)

    for side, x in (("L", 0.14), ("R", -0.14)):
        parts.append(box(f"thigh.{side}", (x, 0, 0.66), (0.15, 0.16, 0.34), mats["body"]))
        # The shin reaches down to the top of the foot. It used to stop at z=0.17 while the foot
        # ended at 0.08, leaving nine centimetres of nothing between them — which from the side
        # read as a bird walking along above its own detached feet.
        parts.append(box(f"shin.{side}", (x, 0, 0.30), (0.13, 0.14, 0.44), mats["body"]))
        parts.append(box(f"foot.{side}", (x, 0.10, 0.04), (0.14, 0.30, 0.08), mats["accent"]))
        if wide:
            # A flipper, angled out from the body so it reads as a wing rather than an arm.
            parts.append(
                box(f"arm.{side}", (x + 0.22 * (1 if side == "L" else -1), 0, 1.08), (0.07, 0.22, 0.34),
                    mats["accent"], rotation=(0, math.radians(12 if side == "L" else -12), 0))
            )
        else:
            parts.append(box(f"arm.{side}", (x + 0.14 * (1 if side == "L" else -1), 0, 1.06), (0.11, 0.11, 0.36), mats["body"]))

    bones = [
        ("root", (0, 0, 0.0), (0, 0, 0.12), None),
        ("hips", (0, 0, 0.86), (0, 0, 1.02), "root"),
        ("spine", (0, 0, 1.02), (0, 0, 1.20), "hips"),
        ("head", (0, 0, 1.20), (0, 0.02, 1.46), "spine"),
    ]
    bones += _jaw_bone(1.38, 0.02)
    bones += _tail_bones(spec, 0.86, -0.02, "hips")
    for side, x in (("L", 0.14), ("R", -0.14)):
        bones += [
            (f"thigh.{side}", (x, 0, 0.86), (x, 0, 0.50), "hips"),
            (f"shin.{side}", (x, 0, 0.50), (x, 0, 0.10), f"thigh.{side}"),
            (f"foot.{side}", (x, 0, 0.08), (x, 0.24, 0.04), f"shin.{side}"),
            (f"arm.{side}", (x * 1.2, 0, 1.22), (x * 2.0, 0, 0.90), "spine"),
        ]
    return parts, bones, "waddler" if wide else "upright"


def build_quadruped(spec, mats):
    """Wolf, fox, tiger: a horizontal spine carried on four legs."""
    parts = [
        sphere("chest", (0, 0.22, 0.96), (0.40, 0.42, 0.40), mats["body"]),
        sphere("barrel", (0, -0.06, 0.94), (0.38, 0.36, 0.38), mats["body"]),
        sphere("hips", (0, -0.34, 0.94), (0.38, 0.34, 0.36), mats["body"]),
        sphere("underside", (0, -0.04, 0.80), (0.28, 0.56, 0.16), mats["belly"]),
        cone("neck", (0, 0.44, 1.12), 0.17, 0.13, 0.32, mats["body"], vertices=8,
             rotation=(math.radians(58), 0, 0)),
    ]
    parts += _head_parts(spec, mats, 1.30, 0.58)
    parts += _tail_parts(spec, mats, 0.96, -0.34)

    # Front legs sit under the chest, hind legs under the hips.
    for side, x in (("L", 0.19), ("R", -0.19)):
        for tag, y in (("front", 0.26), ("back", -0.30)):
            parts.append(box(f"{tag}upper.{side}", (x, y, 0.66), (0.14, 0.16, 0.34), mats["body"]))
            parts.append(box(f"{tag}lower.{side}", (x, y, 0.32), (0.12, 0.13, 0.34), mats["body"]))
            parts.append(box(f"{tag}paw.{side}", (x, y + 0.05, 0.05), (0.14, 0.22, 0.10), mats["accent"]))

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
    return parts, bones, "quadruped"


PLANS = {"hopper": build_hopper, "upright": build_upright, "waddler": build_upright}


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
        clip.cycle("spine", [(f, (lean, 0, 0)) for f in steps])
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
    hit.key("spine", 1, (0, 0, 0))
    hit.key("spine", 3, (-24, 0, 8))
    hit.key("spine", 9, (8, 0, -3))
    hit.key("spine", LENGTHS["hit"], (0, 0, 0))
    for bone in arms:
        hit.key(bone, 1, (0, 0, 0))
        hit.key(bone, 3, (-34, 0, 0))
        hit.key(bone, LENGTHS["hit"], (0, 0, 0))
    hit.key("head", 1, (0, 0, 0))
    hit.key("head", 3, (-28, 0, 12))
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
    builder = PLANS.get(plan_name, build_quadruped)
    parts, bones, plan = builder(spec, mats)

    mesh = join(parts, spec["id"])
    arm = armature(f"{spec['id']}_rig", bones)
    skin(mesh, arm)

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

    tris = lib.triangle_count(mesh)
    # Normals stay: they have to follow the bones on a skinned mesh. UVs go — nothing here
    # samples a texture, so they are coordinates into an image that does not exist.
    size = lib.export_glb(out_path, animated=True, uvs=False)
    return {"id": spec["id"], "plan": plan, "triangles": tris, "bytes": size, "height": round(height, 3)}
