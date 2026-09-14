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

Clip names are the contract with the renderer: idle, walk, run, jump, hit.
"""

import math

import lib
from lib import Clip, armature, box, cone, join, material, skin, sphere

CLIPS = ("idle", "walk", "run", "jump", "hit")

# Frame counts. 24 fps, so walk is one second and a stride is half of it.
LENGTHS = {"idle": 48, "walk": 24, "run": 16, "jump": 24, "hit": 16}


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
            sphere("tail.1", (0, base_y - 0.20, base_z + 0.04), (0.16, 0.26, 0.16), mats["body"]),
            sphere("tail.2", (0, base_y - 0.42, base_z + 0.12), (0.20, 0.28, 0.20), mats["belly"]),
        ]
    # thick — a kangaroo's counterweight, thinning as it goes and resting toward the ground
    return [
        sphere("tail.1", (0, base_y - 0.18, base_z - 0.04), (0.20, 0.26, 0.19), mats["body"]),
        sphere("tail.2", (0, base_y - 0.42, base_z - 0.14), (0.16, 0.26, 0.15), mats["body"]),
        sphere("tail.3", (0, base_y - 0.62, base_z - 0.22), (0.11, 0.22, 0.10), mats["accent"]),
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
        parts.append(box(f"shin.{side}", (x, 0.00, 0.32), (0.15, 0.16, 0.38), mats["body"]))
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
        parts.append(box(f"shin.{side}", (x, 0, 0.34), (0.13, 0.14, 0.34), mats["body"]))
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
    return parts, bones, "upright"


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

    def gait(name, swing, lift, bob, lean):
        clip = Clip(arm, name, LENGTHS[name])
        n = LENGTHS[name]
        steps = [1, n // 4, n // 2, (3 * n) // 4]
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
                clip.cycle(
                    tb,
                    [(f, (-swing * 0.5 * math.sin(((f - 1) / n) * math.tau + i * 0.25), 0, 0)) for f in steps],
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
    for tb in tail_bones:
        jump.key(tb, 1, (0, 0, 0))
        jump.key(tb, 9, (-22, 0, 0))
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
