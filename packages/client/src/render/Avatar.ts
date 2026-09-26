import * as THREE from 'three';
import type { AnimalDef, AnimalVisual, PlayerSnapshot } from '@kc/core';
import { EMOTE_CLIPS, SnapFlags, emoteClip, getAnimal, getCosmetic } from '@kc/core';
import { AssetLibrary } from './AssetLibrary.js';
import type { LoadedModel } from './AssetLibrary.js';
import { buildCosmetic, disposeCosmetic } from './cosmetics.js';
import type { CosmeticBuild, CosmeticFrame } from './cosmetics.js';

/**
 * Clip names the renderer asks a model for.
 *
 * A contract, not a convention: `tools/blender/characters.py` writes exactly these, and a pack
 * that uses other names simply animates less rather than failing — `AssetLibrary.findClip`
 * tolerates exporter prefixes, and a missing clip leaves the avatar on the nearest one it has.
 */
export const CLIP_NAMES = ['idle', 'walk', 'run', 'jump', 'hit', ...EMOTE_CLIPS] as const;
export type ClipName = (typeof CLIP_NAMES)[number];

/**
 * The socket node names `tools/blender/characters.py` writes into every generated animal.
 *
 * A model can rename any of them through `AnimalModelRef.sockets`; anything it leaves out falls
 * back to these, and a model with none of them falls back to its bones.
 */
export const DEFAULT_MODEL_SOCKETS: Readonly<Record<string, string>> = {
  head: 'socket_head',
  face: 'socket_face',
  back: 'socket_back',
  handL: 'socket_hand_L',
  handR: 'socket_hand_R',
};

/**
 * The jaw hinge, in the jaw bone's own space.
 *
 * `tools/blender/characters.py` builds the jaw as a bone running from under the head out along the
 * snout, so the bone's local Y is the length of the jaw and local X is the hinge it swings on —
 * the same axis for every body plan, because `_jaw_bone` is shared by all of them.
 */
const JAW_AXIS = new THREE.Vector3(1, 0, 0);
/** How far a fully open mouth swings, in radians. About 29 degrees. */
const JAW_OPEN_RADIANS = 0.5;
/** Scratch, so lip sync allocates nothing per frame per avatar. */
const JAW_SWING = new THREE.Quaternion();

/**
 * The leg bones every generated animal carries, from `tools/blender/characters.py`.
 *
 * Only the thighs are listed: shins and feet are their children, so collapsing a thigh takes the
 * rest of the chain with it. Naming both halves of a pair that the generator always writes
 * together keeps this readable against the rig rather than clever.
 */
const LEG_BONES = ['thigh.L', 'thigh.R'] as const;

/**
 * Small, not zero.
 *
 * A bone scaled to exactly zero has a singular matrix, three.js inverts it for skinning, and the
 * NaN that comes back is written into every vertex weighted to that bone — which does not hide a
 * leg, it makes the entire animal disappear.
 */
const LEGLESS_BONE_SCALE = 0.001;

/**
 * Pick the clip that matches what the player is doing.
 *
 * Split out and exported because it is the part worth testing: it is pure, and every bug in it
 * ("runs on the spot while standing still", "never leaves the jump") is a behaviour a test can
 * state in one line. The thresholds are in metres per second against a 7.2 m/s top speed.
 */
export function clipFor(state: {
  grounded: boolean;
  speed: number;
  hitTimer: number;
  emoteId?: number;
}): ClipName {
  /**
   * An emote loses to everything that is not standing still.
   *
   * Being hit, leaving the ground or running are all things the player can see happening to their
   * body, and a gesture that kept playing through them would read as the avatar ignoring the game.
   * Walking out of an emote cancelling it is also the only way to stop one early — there is no
   * cancel button, and being stuck in a three-second nap while a kangaroo closes in is exactly the
   * kind of thing a player would never forgive.
   */
  if (state.hitTimer > 0) return 'hit';
  if (!state.grounded) return 'jump';
  if (state.speed > 4.2) return 'run';
  if (state.speed > 0.5) return 'walk';
  const emote = emoteClip(state.emoteId ?? 0);
  if (emote) return emote as ClipName;
  return 'idle';
}

/** The three clips that describe moving on the ground, and how much of each to use. */
export interface LocomotionBlend {
  idle: number;
  walk: number;
  run: number;
}

/** Below this the body is standing still. */
export const WALK_START = 0.5;
/** Where the walk cycle is at full weight and the run has not started. */
export const WALK_FULL = 2.4;
/** Where the run cycle is at full weight. */
export const RUN_FULL = 7;

/**
 * How much idle, walk and run to mix at a given ground speed.
 *
 * `clipFor` picks exactly one clip and switches at 4.2 m/s, so a player accelerating through that
 * number went from a walk to a full run between one frame and the next. The 0.25 s crossfade in
 * `playClip` hides the seam but not the jump in *rate*: the legs change stride length instantly,
 * which is the single most obvious thing wrong with the way the game moves.
 *
 * Blending three clips by weight costs nothing extra — the mixer already evaluates whichever
 * actions are enabled — and it needs no new animation. It is also the part of "AAA locomotion"
 * that is actually about code rather than about art.
 *
 * Deliberately linear between the anchors. Smoothstep here reads as the avatar hesitating at the
 * transition, because the *speed* is already the output of a physics ramp and easing an eased
 * value twice is what makes a character feel like it is wading.
 */
export function locomotionBlend(speed: number): LocomotionBlend {
  const v = Number.isFinite(speed) ? Math.max(0, speed) : 0;
  if (v <= WALK_START) return { idle: 1, walk: 0, run: 0 };
  if (v < WALK_FULL) {
    const t = (v - WALK_START) / (WALK_FULL - WALK_START);
    return { idle: 1 - t, walk: t, run: 0 };
  }
  if (v < RUN_FULL) {
    const t = (v - WALK_FULL) / (RUN_FULL - WALK_FULL);
    return { idle: 0, walk: 1 - t, run: t };
  }
  return { idle: 0, walk: 0, run: 1 };
}

/**
 * How fast to play the gait cycles, as a multiple of their authored rate.
 *
 * Blending two cycles that run at their own speeds is what produces the skating you see in games
 * that blend naively: the feet of the walk and the feet of the run are in different places, so the
 * average of the two is a foot that never quite commits to the ground. Driving both from one
 * stride rate keeps them in step, and tying that rate to the actual ground speed is also what
 * makes a slow walk look slow instead of looking like a walk cycle played at walking pace while
 * the body creeps.
 *
 * Clamped at both ends: below the floor a nearly-stationary player would play a stride every ten
 * seconds, and above the ceiling a player launched by a jump pad would blur.
 */
export function strideRate(speed: number): number {
  const v = Number.isFinite(speed) ? Math.max(0, speed) : 0;
  return Math.min(1.8, Math.max(0.55, v / 4.6));
}

/**
 * How a body plan is put together.
 *
 * Every length is in metres and every angle in radians, measured on the rest pose. The numbers
 * are the whole difference between a kangaroo and a person, so they live in one table rather
 * than scattered through the build method — a new plan is a row here.
 */
interface BodyPlan {
  /** Height of the hip joint. A hopper crouches low; a person stands tall. */
  hipHeight: number;
  /** Forward lean of the torso. A kangaroo's spine is nearly horizontal at speed. */
  lean: number;
  /** Thigh angled forward-down, shin angled back-down: the Z-fold of a digitigrade leg. */
  thigh: { length: number; radius: number; angle: number };
  shin: { length: number; radius: number; angle: number };
  foot: { length: number; width: number; height: number };
  /** How far apart the legs stand. */
  stance: number;
  torso: { length: number; radius: number };
  neck: { length: number; angle: number };
  /** Forelimbs. A hopper's are small and held up in front of the chest. */
  arm: { length: number; radius: number; angle: number; drop: number };
  /** Extra bend the legs take on landing, on top of the rest pose. */
  crouchBend: number;
  /** How much the tail lifts when airborne — the counterweight swing. */
  tailLift: number;
  /**
   * How the tail is carried at rest, as the root angle. Near π/2 runs it straight out behind
   * like a hopper's counterweight; lower lets it hang, which is what a tail on legs does.
   */
  tailCarry: number;
}

/**
 * Rest angle of each tail joint after the root, in order.
 *
 * Positive lifts the chain towards horizontal. The first joint does most of the work — the tail
 * leaves the hips steeply and then flattens — and the last two barely move, which is what gives
 * the tail its slight downward droop at the tip instead of a dead straight line.
 */
const TAIL_JOINT_REST = [0.34, 0.16, 0.08];

const PLANS: Record<AnimalVisual['build'], BodyPlan> = {
  /**
   * The kangaroo. Everything here is chosen so the silhouette reads at distance: the mass sits
   * low and back over enormous haunches, the spine leans out over the toes, and the tail runs
   * out behind as a third limb. Take any one of those away and it becomes a rabbit.
   */
  hopper: {
    // A red kangaroo stands as tall as a person, so the hip sits high and the legs are long —
    // an earlier pass had it squatting at knee height and it read as a rabbit.
    hipHeight: 0.56,
    lean: 0.5,
    // Negative thigh angle throws the knee *forward*; the shin then folds back under the hip and
    // the long foot points forward again. That Z, not the ears, is what says "kangaroo".
    thigh: { length: 0.34, radius: 0.15, angle: -0.75 },
    shin: { length: 0.4, radius: 0.09, angle: 1.7 },
    foot: { length: 0.44, width: 0.15, height: 0.08 },
    stance: 0.17,
    torso: { length: 0.4, radius: 0.24 },
    // Positive angle is measured in world space, so the neck rises out of the leaning chest and
    // carries the head forward rather than tipping it back over the shoulders.
    neck: { length: 0.2, angle: 0.25 },
    arm: { length: 0.22, radius: 0.05, angle: 1.15, drop: 0.06 },
    crouchBend: 0.45,
    tailLift: 0.5,
    tailCarry: 1.02,
  },
  /** A person: legs under the hips, spine vertical, arms down. */
  upright: {
    hipHeight: 0.64,
    lean: 0.06,
    thigh: { length: 0.28, radius: 0.11, angle: -0.08 },
    shin: { length: 0.28, radius: 0.09, angle: 0.16 },
    foot: { length: 0.24, width: 0.12, height: 0.08 },
    stance: 0.13,
    torso: { length: 0.4, radius: 0.2 },
    neck: { length: 0.1, angle: 0 },
    arm: { length: 0.3, radius: 0.055, angle: 0.12, drop: 0.02 },
    crouchBend: 0.5,
    tailLift: 0.1,
    // Everything that stands on its legs lets the tail hang: carried level it reads as a plank.
    tailCarry: 0.5,
  },
  /** Short legs tucked under a heavy body, flippers instead of arms. */
  waddler: {
    hipHeight: 0.29,
    lean: 0.12,
    thigh: { length: 0.12, radius: 0.08, angle: -0.12 },
    shin: { length: 0.1, radius: 0.07, angle: 0.24 },
    foot: { length: 0.22, width: 0.13, height: 0.06 },
    stance: 0.11,
    torso: { length: 0.46, radius: 0.26 },
    neck: { length: 0.04, angle: 0 },
    arm: { length: 0.26, radius: 0.04, angle: 0.05, drop: 0.0 },
    crouchBend: 0.3,
    tailLift: 0.05,
    tailCarry: 0.35,
  },
  /**
   * The wolf, the fox and the tiger: a horizontal spine carried low.
   *
   * **This rig has two legs, so this row is an approximation and says so.** `BodyPlan` describes
   * one pair of legs and one pair of arms; a real four-legged body is `tools/blender/characters.py`'s
   * `build_quadruped`, and that is what every one of these animals actually renders as, because
   * all three carry a `model`. This row is what the *fallback* draws when the `.glb` does not
   * load — a deep lean, a low hip and forelimbs reaching for the ground, which reads as an animal
   * on all fours rather than a person.
   *
   * It exists at all because the entry was missing while `build` was optional, so this lookup
   * fell back to `upright` while the mesh pipeline fell back to `quadruped` — the same animal
   * standing up or dropping to four legs depending on whether a file loaded. A named row and a
   * required `build` are what stop the two ends inventing different defaults.
   */
  quadruped: {
    hipHeight: 0.52,
    // Nearly horizontal: this one number is most of what separates a dog from a person.
    lean: 1.15,
    thigh: { length: 0.26, radius: 0.1, angle: -0.35 },
    shin: { length: 0.26, radius: 0.08, angle: 0.55 },
    foot: { length: 0.2, width: 0.13, height: 0.08 },
    stance: 0.17,
    torso: { length: 0.52, radius: 0.21 },
    // The neck lifts the head back up out of a spine that is already pointing at the floor.
    neck: { length: 0.22, angle: 0.5 },
    // Forelimbs reach down and forward to the ground instead of hanging at the sides.
    arm: { length: 0.34, radius: 0.075, angle: 0.95, drop: 0.16 },
    crouchBend: 0.4,
    tailLift: 0.18,
    tailCarry: 0.42,
  },
};

/**
 * Procedural animal avatars.
 *
 * Bodies are built from primitives driven by `AnimalDef.visual`, so a new animal is a data
 * entry — no mesh pipeline, no download, and every animal automatically has the same hitbox.
 * Cosmetics attach to named sockets (head, face, back, tail, hands).
 *
 * The skeleton is articulated rather than a pile of static primitives: hips, a leaning torso,
 * a two-joint leg per side and a segmented tail. That is what lets one class render a kangaroo
 * and a person from the same code and have both look like themselves.
 */
/**
 * How far `AnimalVisual.scale` may stretch an avatar, either way.
 *
 * Size is not on the cosmetic-only list's "never speed, jump, health or attack", but on maps whose
 * whole subject is being seen, a much smaller silhouette is harder to spot — which is an advantage
 * however it got there. The shipped roster spans 0.90 (frog) to 1.06 (tiger), so this band holds
 * everything that exists while refusing a hand-edited 0.3.
 */
const MIN_ANIMAL_SCALE = 0.85;
const MAX_ANIMAL_SCALE = 1.15;

export function animalScaleFor(scale: number | undefined): number {
  if (!Number.isFinite(scale) || scale === undefined) return 1;
  return Math.min(MAX_ANIMAL_SCALE, Math.max(MIN_ANIMAL_SCALE, scale));
}

export class Avatar {
  readonly group = new THREE.Group();
  readonly head = new THREE.Group();
  readonly body = new THREE.Group();
  /**
   * Carries `AnimalVisual.scale`, and nothing else ever writes to it.
   *
   * It exists because `body.scale` is rewritten every frame — `applySquash` sets all three axes
   * absolutely and the breath loop sets `x`/`z` back to 1 — so an animal's size assigned there is
   * gone on the next tick. A parent multiplies instead of competing, which also keeps the rule at
   * one site rather than being multiplied into both writes and drifting the way this project's
   * sun position and VR bindings both did.
   *
   * It wraps `body` alone, not `group`. The hands are siblings because in VR they track real
   * controllers and must stay where the controller is; the role ring is a sibling because its
   * radius encodes *role* — 1.5x chaser, 1.25x fighter — and is the colourblind-safe channel, so
   * a big animal must not read as a more urgent one. The name sprite is UI.
   */
  private readonly bodyScale = new THREE.Group();
  readonly hands: [THREE.Group, THREE.Group];

  private animal: AnimalDef;
  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private sockets: Record<string, THREE.Group> = {};
  /** Equipped cosmetics, each owning its own geometry and materials — see `cosmetics.ts`. */
  private cosmetics: CosmeticBuild[] = [];
  private cosmeticClock = 0;
  /**
   * Where a glove goes on the loaded model, one per hand, or null before a model (or on an art
   * pack without hand sockets). The avatar's own hand groups are hidden once a model loads —
   * "the model has its own arms" — so gloves hung on them were never drawn for anyone not in a
   * headset. See `placeHandCosmetics`.
   */
  private modelHands: (THREE.Object3D | null)[] = [null, null];
  private handsTracked = false;
  private readonly cosmeticFrame: CosmeticFrame = {
    time: 0, dt: 0, origin: new THREE.Vector3(), speed: 0, grounded: true,
  };
  /**
   * The lower jaw, hinged at the back of the head.
   *
   * Lip sync is one bone in a game like this: the avatars are stylised, seen at a distance, and
   * usually moving fast. A jaw that opens with the speaker's own measured mic level reads as
   * "that one is talking" from across the map, which is the entire job — phoneme-accurate
   * visemes would cost a viseme rig, a per-frame analyser per peer, and nobody would notice.
   */
  private jaw: THREE.Mesh | null = null;
  private jawHinge: THREE.Group | null = null;
  private mouthOpen = 0;
  private nameSprite: THREE.Sprite | null = null;
  private roleRing: THREE.Mesh | null = null;
  private hopPhase = 0;

  /**
   * The articulated bits, kept as groups so `update` can pose them.
   *
   * A hopper's legs are the animation: the Z-fold closing on take-off and opening for the
   * landing is what makes a hop read as a hop rather than as a model sliding upwards. Holding
   * references beats searching the graph every frame with sixteen avatars on screen.
   */
  private hips = new THREE.Group();
  private torsoPivot = new THREE.Group();
  private legs: { hip: THREE.Group; knee: THREE.Group; ankle: THREE.Group }[] = [];
  /**
   * Whether this player's legs are hidden — true for anyone wearing a headset.
   *
   * A headset tracks a head and two hands. It does not track legs, so a VR player's legs can only
   * ever be a guess made from where their body is sliding, and the guess is wrong in the way that
   * matters most: they are the one part of yourself you see by looking down. It is why Gorilla
   * Tag, Rec Room and VRChat without full-body tracking all end the body at the waist.
   *
   * Applied per *player* rather than per viewer, so a VR player looks the same to everyone. A PC
   * player watching them would otherwise see legs walking a path nobody's legs took.
   */
  private legless = false;
  private tailJoints: THREE.Group[] = [];
  private plan: BodyPlan = PLANS.upright;
  /** Rest angle of the tail root, kept so posing returns to the built silhouette. */
  private tailRootRest = 0;

  /**
   * The authored model, when one loaded.
   *
   * Null is the normal case, not an error case: the game is fully playable with no art pack, the
   * procedural body is what every player saw before models existed, and a failed download must
   * leave a playable avatar rather than an invisible one. So the two paths coexist — the model
   * hides the procedural meshes rather than replacing the object that owns them, which keeps the
   * nameplate, role ring, cosmetic sockets and disposal working untouched.
   */
  private modelRoot: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<ClipName, THREE.AnimationAction>();
  private currentClip: ClipName | null = null;
  /** Jaw bone inside an authored model, so lip sync survives the switch away from the built jaw. */
  private modelJaw: THREE.Object3D | null = null;
  /**
   * The jaw bone's own rest orientation, captured when the model is attached.
   *
   * Lip sync has to open the mouth *from* wherever the rig put the jaw, not move it to an absolute
   * angle. Writing `jaw.rotation.x` directly did the latter, and the rest pose is nowhere near
   * zero: measured across all seven generated animals the jaw's rest quaternion is
   * (-0.74, 0, 0, 0.6726) for the upright and hopper plans and (-0.3126, 0, 0, 0.9499) for the
   * quadrupeds — that is -95.5 and -36.4 degrees, the jaw hinged down along the snout. Forcing
   * `rotation.x = mouthOpen * 0.5` threw all of that away on every frame, so the jaw sat 95.5
   * degrees off its rig position *in silence* and 124 degrees off while speaking. Not a lip sync
   * bug that appears when someone talks: a permanently dislocated jaw on every animal in the game.
   */
  private modelJawRest: THREE.Quaternion | null = null;
  /** Seconds left on the one-shot hit reaction. */
  private hitTimer = 0;
  private wasTagged = false;
  private emotePhase = 0;

  constructor(animalId: string, castShadow: boolean) {
    this.animal = getAnimal(animalId) ?? (getAnimal('kangaroo') as AnimalDef);
    this.hands = [new THREE.Group(), new THREE.Group()];
    this.build(castShadow);
  }

  get animalId(): string {
    return this.animal.id;
  }

  /** True once an authored model is driving this avatar instead of the procedural body. */
  get hasModel(): boolean {
    return this.modelRoot !== null;
  }

  /** Which clip is playing, or null on the procedural path. Read-only; for tests and debugging. */
  get playingClip(): ClipName | null {
    return this.currentClip;
  }

  /**
   * Swap in an authored model and start its clips.
   *
   * Arrives late by design — loading is asynchronous and a player must be visible the instant
   * they join, so the avatar is built procedurally first and upgraded when the file lands. That
   * also means this can be called on an avatar that is already in a scene and already being
   * updated every frame, so it must leave a consistent object behind at every step.
   */
  attachModel(loaded: LoadedModel): void {
    if (this.modelRoot) return; // already upgraded; a second call would stack two bodies
    // Hide rather than delete: `dispose()` walks `materials` and `geometries`.
    this.body.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) node.visible = false;
    });

    this.modelRoot = loaded.scene;
    this.body.add(loaded.scene);
    this.moveSocketsOntoModel(loaded.scene);

    if (loaded.clips.length > 0) {
      this.mixer = new THREE.AnimationMixer(loaded.scene);
      for (const name of CLIP_NAMES) {
        const clip = AssetLibrary.findClip(loaded.clips, name);
        if (!clip) continue;
        const action = this.mixer.clipAction(clip);
        if (name === 'jump' || name === 'hit') {
          // One-shots. Without this they loop, and a player who is tagged once spends the rest
          // of the round flinching.
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
        }
        this.actions.set(name, action);
      }
      const idle = this.actions.get('idle');
      if (idle) {
        idle.play();
        this.currentClip = 'idle';
      }
    }

    this.modelJaw = loaded.scene.getObjectByName('jaw') ?? null;
    this.applyLegless();

    // Captured before a single frame runs, so it is the rig's pose rather than one the mixer has
    // already blended part-way into a clip.
    this.modelJawRest = this.modelJaw ? this.modelJaw.quaternion.clone() : null;
  }

  /**
   * Hang the cosmetic sockets on the loaded model's own bones.
   *
   * The sockets are built from the procedural rig, and the comment that used to sit in
   * `attachModel` claimed their positions were "still the right place to hang a hat" once the
   * model replaced the body. **Measured, they are not.** The procedural body plan in `PLANS` and
   * the bone coordinates in `tools/blender/characters.py` are two independent implementations of
   * the same body plan in two languages — this file's recurring "two lists that drift" defect,
   * across a language boundary this time — and nothing ever asserted they agree. Comparing the
   * procedural hat socket against each model's own bounding box:
   *
   *   penguin −0.400 m   panda −0.385 m   fox −0.370 m   bear −0.335 m   wolf −0.280 m
   *
   * i.e. a penguin's hat sat forty centimetres below the top of the penguin, at about chest
   * height, and a human's and a lion's sat *above* their model entirely. The waddlers are worst
   * because the two rigs disagree most there: `PLANS.waddler` drops the hip to 0.29 m and
   * shortens the legs, while `build_upright(wide=True)` keeps a normal upright's bone heights and
   * only widens the body — so the procedural penguin is 1.167 m tall and `penguin.glb` is 1.540 m.
   *
   * A socket has to follow the body that is actually on screen, so when a model arrives each
   * socket moves onto the matching bone and keeps its local offset. Bones are matched by name
   * because that name is already a contract: `CLIP_NAMES`' doc says the Blender pipeline writes
   * exactly these, and `modelJaw` above already looks one up the same way.
   *
   * **Named socket nodes win, and only the generator can place them.** `characters.py` exports
   * `socket_head` / `socket_face` / `socket_back`, derived from the same numbers that build the
   * head and torso, so there is one source for "where is the skull". The bounding box used before
   * was the tip of a kangaroo's thirty-centimetre ears, not its crown. A model can rename them
   * through `AnimalModelRef.sockets`, the field that existed for exactly this and was read by
   * nothing until now.
   *
   * The bone fallback stays for an art pack that ships no socket nodes: the socket rides the
   * matching bone and the hat goes on the bounding-box top — right for most heads, wrong for tall
   * ears, and a pack that minds can ship sockets.
   *
   * **Orientation comes from the body, not the bone.** A quadruped's head bone points forward
   * along the neck, so a hat parented to it with no correction tilts ~60° onto the animal's nose.
   * Each head/face/back socket is rotated once, at rest, so its world frame matches the body's —
   * upright, facing forward — and from then on it turns with the bone it rides, which is what lets
   * a hat follow the head through an emote. The tail socket keeps the bone frame: a tail cosmetic
   * is meant to run along the tail.
   */
  private moveSocketsOntoModel(scene: THREE.Object3D): void {
    // three.js strips dots from glTF node names, so `tail.1` arrives as `tail1` — documented in
    // CLAUDE.md, and it has cost a whole probe run before.
    const bone = (...names: string[]): THREE.Object3D | null => {
      for (const name of names) {
        const found = scene.getObjectByName(name);
        if (found) return found;
      }
      return null;
    };
    const named: Record<string, string> = { ...DEFAULT_MODEL_SOCKETS, ...this.animal.model?.sockets };
    const authored = (slot: string): THREE.Object3D | null => AssetLibrary.findSocket(scene, named[slot]);

    const head = bone('head');
    const targets: Record<string, { node: THREE.Object3D | null; authored: boolean }> = {};
    for (const slot of ['head', 'face', 'back'] as const) {
      const node = authored(slot);
      targets[slot] = node
        ? { node, authored: true }
        : { node: slot === 'back' ? bone('spine', 'hips') : head, authored: false };
    }
    targets.tail = { node: authored('tail') ?? bone('tail1', 'tail.1', 'tail', 'hips'), authored: false };

    // `updateWorldMatrix(true, true)` walks *up* as well as down. `updateMatrixWorld` only walks
    // down, so it composes against whatever the ancestors last held — and this can be called on
    // an avatar that is already in a scene and already being updated every frame, per the note on
    // `attachModel`. A stale ancestor put the crown 0.03 m out on a scaled body, which is small
    // enough to read as a tuning question rather than the bug it is.
    scene.updateWorldMatrix(true, true);
    const crown = new THREE.Box3().setFromObject(scene).max.y;
    const bodyRotation = this.body.getWorldQuaternion(new THREE.Quaternion());

    for (const [slot, { node: target, authored: isAuthored }] of Object.entries(targets)) {
      const socket = this.sockets[slot];
      if (!socket || !target) continue; // nothing to ride: leave it on the procedural rig
      const offset = socket.position.clone();
      target.add(socket);
      target.updateWorldMatrix(true, false);
      if (isAuthored) {
        socket.position.set(0, 0, 0);
      } else if (slot === 'head' && Number.isFinite(crown)) {
        socket.position.copy(
          target.worldToLocal(new THREE.Vector3().setFromMatrixPosition(target.matrixWorld).setY(crown)),
        );
      } else {
        socket.position.copy(offset);
      }
      if (slot !== 'tail') {
        socket.quaternion.copy(target.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(bodyRotation));
      }
    }

    // Hand sockets only exist on the model: the procedural body's hands *are* `this.hands`.
    (['handL', 'handR'] as const).forEach((slot, i) => {
      const node = authored(slot);
      if (!node) return;
      const socket = new THREE.Group();
      socket.name = `cosmetic_${slot}`;
      node.add(socket);
      node.updateWorldMatrix(true, false);
      socket.quaternion.copy(node.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(bodyRotation));
      this.modelHands[i] = socket;
    });
    this.placeHandCosmetics();
  }

  /**
   * Put each glove where the hand that is actually drawn is: the tracked hand in a headset, the
   * model's own forelimb otherwise, and the procedural hand before any model has loaded.
   */
  private placeHandCosmetics(): void {
    for (const build of this.cosmetics) {
      build.handNodes.forEach((node, i) => {
        const target = (!this.handsTracked && this.modelHands[i]) || this.hands[i];
        if (target && node.parent !== target) target.add(node);
      });
    }
  }

  /**
   * Hide or show this avatar's legs.
   *
   * Safe to call before a model has loaded and safe to call twice: the model path re-applies it
   * on attach, because the authored body arrives seconds after the procedural one it replaces.
   */
  /**
   * Show only the parts of yourself that are really where they appear to be.
   *
   * This used to be `group.visible = false` at the call site, with a comment saying it hid the
   * head "so it never blocks the view". It hid the group, and the group is also where the hands
   * and the role ring live — so a headset rendered **neither**. Nothing else in the client draws
   * a hand: `VRInput` adds three.js's controller, grip and hand objects to the rig, and those are
   * empty groups with no model factory behind them. So the game whose VR locomotion is climbing
   * with your arms and whose combat is throwing punches showed the player no arms at all, and the
   * role ring — the only role indicator a headset can see, since the HUD is DOM — went with them.
   *
   * The body stays hidden, and that part was right: the head sits at the camera, and a torso and
   * tail posed from a sliding capsule are a guess about a body nobody is tracking. The hands are
   * not a guess — `update` puts them exactly where the tracked poses say — and the ring is a flat
   * disc at y=0.03 that cannot block anything.
   *
   * Hiding `body` rather than its meshes also survives `attachModel`, which parents the authored
   * model to `body`.
   */
  setFirstPerson(firstPerson: boolean): void {
    this.body.visible = !firstPerson;
  }

  setLegless(legless: boolean): void {
    if (this.legless === legless) return;
    this.legless = legless;
    this.applyLegless();
  }

  get isLegless(): boolean {
    return this.legless;
  }

  /**
   * Two bodies, two ways to take the legs off.
   *
   * The procedural avatar builds each leg as its own group, so hiding the hip hides the whole
   * chain. The authored models cannot be treated that way: every animal exports as a *single*
   * skinned mesh — one mesh, four primitives — so there is no leg object to hide. What they do
   * have is named bones (`thigh.L`, `shin.L`, `foot.L` and the mirror), and collapsing the thigh
   * collapses everything skinned to it and to its children down to the hip joint, which is where
   * the torso already is. The body simply ends there.
   *
   * Scaled to a small number rather than to zero: a zero-scale bone gives the skinning matrix no
   * inverse, and three.js propagates the resulting NaN into every vertex the bone touches — which
   * does not hide a leg, it deletes the whole animal.
   */
  private applyLegless(): void {
    for (const leg of this.legs) leg.hip.visible = !this.legless;

    const root = this.modelRoot;
    if (!root) return;
    const scale = this.legless ? LEGLESS_BONE_SCALE : 1;
    for (const name of LEG_BONES) {
      const bone = root.getObjectByName(name);
      if (bone) bone.scale.setScalar(scale);
    }
  }

  /**
   * Cross-fade to a clip, or do nothing if it is already playing.
   *
   * The fade is short — a quarter of a second — because these transitions happen constantly at a
   * 20 Hz snapshot rate, and a long blend turns every direction change into a slide.
   */
  /**
   * Emote without clips.
   *
   * The procedural body plan is what a player sees when a model has not loaded yet, or for an
   * animal that ships without one. Leaving emotes to the model path alone would mean a button that
   * works sometimes, which is worse than one that never does — a player cannot tell a missing
   * feature from a dropped input.
   *
   * These are gestures rather than reproductions of the baked clips: a bow and a bob read at the
   * distance this game is played at, and matching seven hand-keyed animations with procedural
   * curves would be a lot of code to arrive somewhere less good.
   */
  private poseEmote(snapshot: PlayerSnapshot, grounded: boolean, speed: number, dt: number): boolean {
    // The same precedence the model path uses, so the two never disagree about whether an emote
    // is playing.
    const active = snapshot.emoteId > 0 && grounded && speed <= 0.5 && this.hitTimer <= 0;
    if (!active) {
      this.emotePhase = 0;
      return false;
    }
    this.emotePhase += dt;
    const t = this.emotePhase;

    switch (snapshot.emoteId) {
      case 2: // dance — sway from the hips with a counter-rotating head
        this.body.rotation.z = Math.sin(t * 6) * 0.22;
        this.body.position.y = Math.abs(Math.sin(t * 6)) * 0.08;
        this.head.rotation.z = -Math.sin(t * 6) * 0.18;
        break;
      case 3: // taunt — lean in and hold
        this.body.rotation.x = 0.26;
        this.body.position.y = 0;
        break;
      case 4: // sit — drop and settle
        this.body.position.y = -0.3 * Math.min(1, t * 3);
        this.body.rotation.x = -0.16 * Math.min(1, t * 3);
        break;
      case 5: // backflip — one rotation, then upright
        this.body.rotation.x = -Math.PI * 2 * Math.min(1, t / 1.25);
        this.body.position.y = Math.sin(Math.min(1, t / 1.25) * Math.PI) * 0.7;
        break;
      case 6: // power nap — tip over and breathe
        this.body.rotation.x = -1.25 * Math.min(1, t * 1.5);
        this.body.position.y = -0.34 * Math.min(1, t * 1.5);
        this.body.scale.y = 1 + Math.sin(t * 2.2) * 0.03;
        break;
      case 7: // victory hop — three bounces
        this.body.position.y = Math.abs(Math.sin(t * 7)) * 0.3;
        this.body.rotation.x = -0.12;
        break;
      default: // wave — rock towards the camera; the arm is raised below
        this.body.rotation.z = Math.sin(t * 7) * 0.09;
        this.body.rotation.x = -0.08;
        break;
    }
    return true;
  }

  /**
   * Run idle, walk and run together, weighted by speed and locked to one stride.
   *
   * Two details do the work. The weights come from `locomotionBlend`, so there is no threshold to
   * cross. And both gaits are driven from a single `strideRate`, with the run's playhead slaved to
   * the walk's — blending two cycles that each run at their own rate is exactly how naive blending
   * produces skating feet, because the average of two legs in different places is a leg that never
   * commits to the ground.
   *
   * Anything that is not one of the three is faded out rather than stopped, so coming back from a
   * punch or a hop rejoins the gait instead of snapping to it.
   */
  private blendLocomotion(speed: number): void {
    if (!this.mixer) return;
    const weights = locomotionBlend(speed);
    const rate = strideRate(speed);

    for (const [name, action] of this.actions) {
      if (name === 'idle' || name === 'walk' || name === 'run') continue;
      if (action.getEffectiveWeight() > 0.001) action.fadeOut(0.2);
    }

    const walk = this.actions.get('walk');
    const run = this.actions.get('run');
    for (const [name, weight] of [
      ['idle', weights.idle],
      ['walk', weights.walk],
      ['run', weights.run],
    ] as const) {
      const action = this.actions.get(name);
      if (!action) continue;
      if (weight <= 0.001) {
        action.setEffectiveWeight(0);
        continue;
      }
      if (!action.isRunning()) {
        action.reset();
        action.play();
      }
      action.enabled = true;
      action.setEffectiveWeight(weight);
      action.timeScale = name === 'idle' ? 1 : rate;
    }

    // Phase lock. The two gaits are authored at different lengths — a stride of walk is 24 frames
    // and a stride of run is 16 — so matching the playback rate is not enough on its own; the run
    // has to be told where in its own cycle the walk currently is.
    if (walk && run && weights.walk > 0.001 && weights.run > 0.001) {
      const walkLength = walk.getClip().duration;
      const runLength = run.getClip().duration;
      if (walkLength > 0 && runLength > 0) run.time = (walk.time / walkLength) * runLength;
    }

    /**
     * Report the heaviest of the three, not "blending".
     *
     * `currentClip` is two things at once: what `playClip` crossfades *from*, and what
     * `playingClip` tells the outside world the body is doing. Clearing it during a blend was the
     * first attempt and it broke the second job — the avatar tests ask what a player at 2 m/s is
     * doing and got `null` back, which is a worse answer than "walking" in every way that matters.
     * The dominant clip is the true answer to both questions: it is what a viewer would call it,
     * and it is the right action for an incoming punch or hop to fade away from.
     */
    this.currentClip = weights.run >= weights.walk && weights.run >= weights.idle
      ? 'run'
      : weights.walk >= weights.idle
        ? 'walk'
        : 'idle';
  }

  private playClip(name: ClipName): void {
    if (!this.mixer || this.currentClip === name) return;
    const next = this.actions.get(name);
    if (!next) return;
    const previous = this.currentClip ? this.actions.get(this.currentClip) : null;
    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    if (previous && previous !== next) {
      next.crossFadeFrom(previous, 0.25, true);
    }
    /**
     * Fade out anything the gait blend left running.
     *
     * `crossFadeFrom` only knows about the one action named in `currentClip`, and the blend leaves
     * up to three weighted at once with no single name among them — so without this a punch or a
     * hop plays *on top of* a full-weight run, and the mixer adds the two poses together.
     */
    for (const [other, action] of this.actions) {
      if (other === name || other === this.currentClip) continue;
      if (action.getEffectiveWeight() > 0.001) action.fadeOut(0.25);
    }
    next.play();
    this.currentClip = name;
  }

  /**
   * One body material.
   *
   * Standard rather than lambert so an avatar sits in the same lighting as the world around it.
   * With the scene lit by an environment map, a lambert body receives none of it and reads as a
   * cut-out pasted over the picture — the mismatch is far more obvious than the flat shading was.
   *
   * Rough and non-metallic: fur and hide, with just enough specular response to catch the sky.
   */
  private mat(color: number, options: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.82, metalness: 0, ...options });
    this.materials.push(material);
    return material;
  }

  private geo<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  private build(castShadow: boolean): void {
    const visual = this.animal.visual;
    const bodyMat = this.mat(visual.body);
    const accentMat = this.mat(visual.accent);
    const bellyMat = this.mat(visual.belly);

    // `?? PLANS.upright` stays as a runtime guard only: `build` is required by the type, but an
    // animal can arrive from a CDN JSON or a future editor, and an unknown plan must draw
    // *something* rather than throw inside the render loop. It is no longer a default the data is
    // allowed to rely on — see the `quadruped` row above for what having two of those cost.
    const plan = PLANS[visual.build] ?? PLANS.upright;
    this.plan = plan;

    // Hips carry everything. Placing the joint explicitly is what lets the legs fold underneath
    // the body instead of dangling off the bottom of a capsule.
    this.hips.position.y = plan.hipHeight;
    this.body.add(this.hips);

    // Haunches: on a hopper this is the widest part of the animal and most of why it reads as
    // one. Modelled as a single mass across the hips rather than two thighs meeting in a seam.
    const haunch = new THREE.Mesh(this.geo(new THREE.SphereGeometry(plan.thigh.radius * 1.3, 9, 7)), bodyMat);
    haunch.position.z = -plan.thigh.radius * 0.75;
    haunch.scale.set(1.4, 1.05, 1.2);
    haunch.castShadow = castShadow;
    this.hips.add(haunch);

    // Torso leans forward out of the hips, so the chest sits over the toes and the tail has
    // something to counterbalance.
    this.torsoPivot.rotation.x = plan.lean;
    this.hips.add(this.torsoPivot);

    const torso = new THREE.Mesh(
      this.geo(new THREE.CapsuleGeometry(plan.torso.radius, plan.torso.length, 4, 9)),
      bodyMat,
    );
    torso.position.y = plan.torso.length / 2 + 0.04;
    torso.castShadow = castShadow;
    this.torsoPivot.add(torso);

    // Pale front, from the throat down. A kangaroo's cream belly is most of its contrast.
    const belly = new THREE.Mesh(this.geo(new THREE.CapsuleGeometry(plan.torso.radius * 0.72, plan.torso.length * 0.8, 3, 8)), bellyMat);
    belly.position.set(0, plan.torso.length / 2, plan.torso.radius * 0.45);
    belly.scale.set(1, 1, 0.6);
    this.torsoPivot.add(belly);

    this.buildLegs(plan, bodyMat, accentMat, castShadow);
    this.buildArms(plan, bodyMat, accentMat, castShadow);

    // Head + face.
    const skull = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.22, 10, 8)), bodyMat);
    skull.castShadow = castShadow;
    this.head.add(skull);

    const snout = this.buildSnout(visual.snout, bodyMat, bellyMat);
    if (snout) this.head.add(snout);
    for (const ear of this.buildEars(visual.ears, bodyMat, accentMat)) this.head.add(ear);

    const eyeGeo = this.geo(new THREE.SphereGeometry(0.045, 6, 5));
    const eyeMat = this.mat(0x14181c);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(side * 0.09, 0.05, 0.19);
      this.head.add(eye);
    }

    // Jaw. Hinged at the back so it swings down and forward like a mouth rather than sliding.
    this.jawHinge = new THREE.Group();
    this.jawHinge.position.set(0, -0.06, 0.02);
    this.jaw = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.17, 0.06, 0.2)), bellyMat);
    this.jaw.position.set(0, -0.03, 0.11);
    this.jawHinge.add(this.jaw);
    this.head.add(this.jawHinge);

    // The head rides on a neck out of the top of the leaning torso, and the neck angle cancels
    // part of the lean so the animal looks where it is going instead of at the ground.
    const neck = new THREE.Group();
    neck.position.y = plan.torso.length + 0.06;
    neck.rotation.x = plan.neck.angle - plan.lean;
    this.torsoPivot.add(neck);

    const neckMesh = new THREE.Mesh(this.geo(new THREE.CapsuleGeometry(0.1, plan.neck.length, 3, 6)), bodyMat);
    neckMesh.position.y = plan.neck.length / 2;
    neck.add(neckMesh);

    this.head.position.y = plan.neck.length + 0.17;
    neck.add(this.head);

    // Tail — the kangaroo's third leg. Segmented so it can arc and swing; a single straight
    // capsule pointing backwards is the thing that made the old avatar look like a toy.
    this.buildTail(visual.tail, bodyMat, accentMat, castShadow);

    // Hands: visible for everyone, but only VR players drive them from real tracking.
    const handGeo = this.geo(new THREE.SphereGeometry(0.09, 7, 6));
    for (const hand of this.hands) {
      const mesh = new THREE.Mesh(handGeo, accentMat);
      mesh.castShadow = castShadow;
      hand.add(mesh);
      this.group.add(hand);
    }

    this.sockets.head = new THREE.Group();
    this.sockets.head.position.y = 0.2;
    this.head.add(this.sockets.head);

    this.sockets.face = new THREE.Group();
    this.sockets.face.position.set(0, 0.03, 0.2);
    this.head.add(this.sockets.face);

    // A backpack rides the shoulders, so it hangs off the leaning torso and tips with it.
    this.sockets.back = new THREE.Group();
    this.sockets.back.position.set(0, this.plan.torso.length * 0.72, -this.plan.torso.radius * 0.9);
    this.torsoPivot.add(this.sockets.back);

    // Tail cosmetics attach to the base joint rather than the hips, so they follow the swing.
    this.sockets.tail = new THREE.Group();
    (this.tailJoints[0] ?? this.hips).add(this.sockets.tail);

    this.bodyScale.scale.setScalar(animalScaleFor(this.animal.visual.scale));
    this.bodyScale.add(this.body);
    this.group.add(this.bodyScale);

    const ringGeo = this.geo(new THREE.RingGeometry(0.42, 0.56, 18));
    const ringMat = this.mat(0xffffff, { transparent: true, opacity: 0.0, side: THREE.DoubleSide });
    this.roleRing = new THREE.Mesh(ringGeo, ringMat);
    this.roleRing.rotation.x = -Math.PI / 2;
    this.roleRing.position.y = 0.03;
    this.group.add(this.roleRing);
  }

  /**
   * A digitigrade leg: hip → thigh → knee → shin → ankle → foot.
   *
   * The joints are empty groups and the meshes hang off them, which is what makes the leg
   * poseable — rotating the knee group swings the shin *and* the foot, the way a real one does.
   * The old avatar drew the whole leg as one capsule, so there was nothing to bend.
   */
  private buildLegs(plan: BodyPlan, bodyMat: THREE.Material, accentMat: THREE.Material, castShadow: boolean): void {
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.name = side < 0 ? 'hip.l' : 'hip.r';
      hip.position.set(side * plan.stance, 0, 0);
      hip.rotation.x = plan.thigh.angle;
      this.hips.add(hip);

      const thigh = new THREE.Mesh(this.geo(new THREE.CapsuleGeometry(plan.thigh.radius, plan.thigh.length, 4, 7)), bodyMat);
      thigh.position.y = -plan.thigh.length / 2;
      thigh.castShadow = castShadow;
      hip.add(thigh);

      const knee = new THREE.Group();
      knee.name = side < 0 ? 'knee.l' : 'knee.r';
      knee.position.y = -plan.thigh.length;
      knee.rotation.x = plan.shin.angle;
      hip.add(knee);

      const shin = new THREE.Mesh(this.geo(new THREE.CapsuleGeometry(plan.shin.radius, plan.shin.length, 3, 6)), bodyMat);
      shin.position.y = -plan.shin.length / 2;
      shin.castShadow = castShadow;
      knee.add(shin);

      const ankle = new THREE.Group();
      ankle.name = side < 0 ? 'ankle.l' : 'ankle.r';
      ankle.position.y = -plan.shin.length;
      // The ankle cancels the two joints above it, so the foot lies flat on the ground whatever
      // the leg is doing — which is the point of a plantigrade foot on a digitigrade leg.
      ankle.rotation.x = -(plan.thigh.angle + plan.shin.angle);
      knee.add(ankle);

      const foot = new THREE.Mesh(
        this.geo(new THREE.BoxGeometry(plan.foot.width, plan.foot.height, plan.foot.length)),
        accentMat,
      );
      // Centred on the ankle, not stacked above it: a capsule's end cap extends a radius past
      // its joint, and with the foot on top of the ankle that cap came out through the sole.
      foot.position.set(0, 0, plan.foot.length * 0.28);
      foot.castShadow = castShadow;
      ankle.add(foot);

      this.legs.push({ hip, knee, ankle });
    }
  }

  /**
   * Forelimbs, attached to the chest.
   *
   * They are cosmetic on every platform: the `hands` groups are what VR drives and what the
   * punch reads from, and those are positioned in world space. These are here so the body does
   * not look like a torso with two floating spheres near it.
   */
  private buildArms(plan: BodyPlan, bodyMat: THREE.Material, accentMat: THREE.Material, castShadow: boolean): void {
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * (plan.torso.radius * 0.8), plan.torso.length * 0.78, 0);
      shoulder.rotation.x = plan.arm.angle;
      shoulder.rotation.z = side * plan.arm.drop;
      this.torsoPivot.add(shoulder);

      const arm = new THREE.Mesh(this.geo(new THREE.CapsuleGeometry(plan.arm.radius, plan.arm.length, 3, 6)), bodyMat);
      arm.position.y = -plan.arm.length / 2;
      arm.castShadow = castShadow;
      shoulder.add(arm);

      const paw = new THREE.Mesh(this.geo(new THREE.SphereGeometry(plan.arm.radius * 1.3, 6, 5)), accentMat);
      paw.position.y = -plan.arm.length;
      shoulder.add(paw);
    }
  }

  private buildEars(kind: string, bodyMat: THREE.Material, accentMat: THREE.Material): THREE.Mesh[] {
    if (kind === 'none') return [];
    const out: THREE.Mesh[] = [];
    const geometry =
      kind === 'tall'
        ? this.geo(new THREE.CapsuleGeometry(0.05, 0.24, 3, 5))
        : kind === 'pointed'
          ? this.geo(new THREE.ConeGeometry(0.09, 0.22, 4))
          : kind === 'fin'
            ? this.geo(new THREE.ConeGeometry(0.1, 0.3, 3))
            : this.geo(new THREE.SphereGeometry(0.1, 6, 5));
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(geometry, side < 0 ? bodyMat : accentMat);
      ear.position.set(side * 0.12, 0.24, kind === 'fin' ? -0.05 : 0);
      ear.rotation.z = side * 0.22;
      out.push(ear);
    }
    return out;
  }

  private buildSnout(kind: string, bodyMat: THREE.Material, bellyMat: THREE.Material): THREE.Mesh | null {
    switch (kind) {
      case 'long': {
        const snout = new THREE.Mesh(this.geo(new THREE.CapsuleGeometry(0.08, 0.16, 3, 6)), bodyMat);
        snout.position.set(0, -0.02, 0.22);
        snout.rotation.x = Math.PI / 2;
        return snout;
      }
      case 'beak': {
        const beak = new THREE.Mesh(this.geo(new THREE.ConeGeometry(0.08, 0.2, 4)), bellyMat);
        beak.position.set(0, -0.01, 0.24);
        beak.rotation.x = Math.PI / 2;
        return beak;
      }
      case 'flat': {
        const flat = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.22, 0.08, 0.14)), bodyMat);
        flat.position.set(0, -0.04, 0.2);
        return flat;
      }
      default: {
        const short = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.1, 7, 6)), bodyMat);
        short.position.set(0, -0.02, 0.19);
        short.scale.set(1, 0.8, 1.1);
        return short;
      }
    }
  }

  /**
   * A tail built as a chain of tapering segments rooted at the hips.
   *
   * Tapering matters more than length: a kangaroo's tail is as thick as its thigh where it
   * leaves the body and finger-thin at the tip, and that taper is what stops it reading as a
   * pipe glued to the back. The chain is stored in `tailJoints` so `update` can run a travelling
   * wave down it — the whole tail lags the body, each segment lagging the one before.
   */
  private buildTail(kind: string, bodyMat: THREE.Material, accentMat: THREE.Material, castShadow: boolean): void {
    if (kind === 'stub') {
      const stub = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.12, 6, 5)), bodyMat);
      stub.position.set(0, 0.02, -0.2);
      this.hips.add(stub);
      return;
    }

    // Base radius by tail kind, and how much of it survives to the tip.
    const base = kind === 'thick' ? 0.12 : kind === 'bushy' ? 0.13 : kind === 'fin' ? 0.16 : 0.07;
    const segments = kind === 'thin' ? 3 : 4;
    const length = (kind === 'thick' ? 0.86 : kind === 'bushy' ? 0.6 : 0.66) / segments;

    // Rooted low and behind the hips, dropping away from the body and then flattening out — the
    // arc a kangaroo's tail makes when it is standing on it.
    const root = new THREE.Group();
    root.position.set(0, 0.04, -0.17);
    root.rotation.x = kind === 'fin' ? 0.4 : this.plan.tailCarry;
    this.tailRootRest = root.rotation.x;
    this.hips.add(root);

    let parent: THREE.Group = root;
    for (let i = 0; i < segments; i++) {
      const t = i / segments;
      const radius = base * (1 - t * 0.72);
      const material = kind === 'bushy' && i >= segments - 2 ? accentMat : bodyMat;
      const mesh = new THREE.Mesh(this.geo(new THREE.CapsuleGeometry(radius, length, 3, 6)), material);
      // Segments are built along -Y and the joint is rotated, so the chain hangs naturally.
      mesh.position.y = -length / 2;
      mesh.castShadow = castShadow && i < 2;
      parent.add(mesh);

      const joint = new THREE.Group();
      joint.position.y = -length;
      // Each joint lifts the chain a little further towards level, so the tail leaves the body
      // angled down and then runs out straight behind — the arc it rests in when standing.
      joint.rotation.x = TAIL_JOINT_REST[Math.min(i, TAIL_JOINT_REST.length - 1)] as number;
      parent.add(joint);
      this.tailJoints.push(joint);
      parent = joint;
    }

    this.tailJoints.unshift(root);
  }

  /**
   * Equip cosmetics by slot. Unknown or unowned ids are simply ignored.
   *
   * Everything the previous set made is detached *and freed* first. It used to be detached only,
   * and only from the sockets: gloves live on the hand objects, so unequipping left them on and
   * every equip in the menu stacked another pair (measured `5/5` hand children after three swaps),
   * and every equip's geometry and materials stayed in this avatar's lists until it was disposed.
   */
  setCosmetics(cosmetics: Record<string, string>): void {
    this.clearCosmetics();
    for (const [slot, id] of Object.entries(cosmetics)) {
      const def = getCosmetic(id);
      if (!def) continue;
      const parent = this.sockets[socketForSlot(slot)];
      if (!parent) continue;
      const build = buildCosmetic(def, this.hands.length);
      if (!build) continue;
      parent.add(build.node);
      this.cosmetics.push(build);
    }
    this.placeHandCosmetics();
  }

  private clearCosmetics(): void {
    for (const build of this.cosmetics) disposeCosmetic(build);
    this.cosmetics = [];
  }

  /** Move the cosmetics that move: effects, glows, flames, and the trails that record the path. */
  private animateCosmetics(dt: number, speed: number, grounded: boolean): void {
    if (this.cosmetics.length === 0) return;
    this.cosmeticClock += dt;
    const frame = this.cosmeticFrame;
    frame.time = this.cosmeticClock;
    frame.dt = dt;
    frame.speed = speed;
    frame.grounded = grounded;
    this.group.updateWorldMatrix(true, false);
    this.group.getWorldPosition(frame.origin);
    for (const build of this.cosmetics) build.animate?.(frame);
  }

  /** Nameplate above the head. Pass `show = false` for the local player — you know who you are,
   * and at third-person distance your own plate covers the middle of the screen. */
  setName(name: string, color = '#f2f7f0', show = true): void {
    this.clearNameSprite();
    if (!show) return;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.strokeText(name, 128, 32);
    ctx.fillStyle = color;
    ctx.fillText(name, 128, 32);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    this.materials.push(material);
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(1.1, 0.28, 1);
    sprite.position.y = 1.65;
    sprite.renderOrder = 10;
    this.group.add(sprite);
    this.nameSprite = sprite;
  }

  /**
   * Drop the current nameplate, texture included.
   *
   * The plate is a canvas baked into a texture, and a texture is not freed by disposing the
   * material that points at it — that is the one every three.js leak is made of. Renaming an
   * avatar, or replacing the plate on a new round, used to strand one 256x64 texture per call
   * with nothing left holding a reference to dispose it.
   */
  private clearNameSprite(): void {
    if (!this.nameSprite) return;
    const material = this.nameSprite.material;
    this.nameSprite.removeFromParent();
    this.nameSprite = null;
    const index = this.materials.indexOf(material);
    if (index >= 0) this.materials.splice(index, 1);
    disposeMaterial(material);
  }

  /**
   * Role ring on the ground — how you spot the chaser across a canyon.
   *
   * Role was carried by hue alone, and `settings.colorblindSafe` was declared, defaulted and read
   * by nothing. Hue alone is the wrong channel for it: the chaser's red and the fighter's yellow
   * sit on the axis that protanopia and deuteranopia compress, so the two most urgent states in
   * the game — someone is hunting you, someone is fighting you — were the pair most likely to
   * merge, for roughly one man in twelve.
   *
   * So the ring now carries the role in **size** as well, always and for everyone: a chaser's ring
   * is half again as wide as a runner's, which survives any palette, any distance at which the
   * colour has washed out, and a screenshot in greyscale. `colorblindSafe` then also swaps the
   * palette for blue/orange/white, which separates under all three common dichromacies where
   * red/cyan/yellow does not.
   */
  setRole(role: string, colorblindSafe = false): void {
    if (!this.roleRing) return;
    const material = this.roleRing.material as THREE.MeshStandardMaterial;
    // [hue, safe hue, opacity, ring scale]
    const style: Record<string, [number, number, number, number]> = {
      chaser: [0xff4d4d, 0xff8c1a, 0.85, 1.5],
      infected: [0xff4d4d, 0xff8c1a, 0.85, 1.5],
      runner: [0x4cc9f0, 0x2b6cff, 0.35, 1],
      fighter: [0xffd166, 0xf2f2f2, 0.5, 1.25],
    };
    const preset = style[role];
    if (!preset) {
      material.opacity = 0;
      return;
    }
    const [hue, safeHue, opacity, scale] = preset;
    material.color.setHex(colorblindSafe ? safeHue : hue);
    material.opacity = opacity;
    this.roleRing.scale.set(scale, scale, 1);
  }

  /**
   * Drive the avatar from a snapshot. Hops are animated procedurally from vertical velocity, so
   * remote players read correctly without shipping animation clips.
   */
  update(snapshot: PlayerSnapshot, dt: number, cameraPosition: THREE.Vector3): void {
    this.group.position.set(snapshot.x, snapshot.y, snapshot.z);
    this.body.rotation.y = snapshot.yaw;

    const grounded = (snapshot.flags & SnapFlags.Grounded) !== 0;
    const crouching = (snapshot.flags & SnapFlags.Crouching) !== 0;
    const speed = Math.hypot(snapshot.vx, snapshot.vz);

    // The stagger flag is a level, not an edge, and it can still be set on the snapshot after the
    // one-shot has played out. Timing the reaction from the rising edge is what stops a stunned
    // player from restarting the flinch on every packet.
    const tagged = (snapshot.flags & SnapFlags.Staggered) !== 0;
    if (tagged && !this.wasTagged) this.hitTimer = 0.45;
    this.wasTagged = tagged;
    if (this.hitTimer > 0) this.hitTimer = Math.max(0, this.hitTimer - dt);

    // Before the model branch below, which returns early: cosmetics move on either body.
    this.animateCosmetics(dt, speed, grounded);

    if (this.mixer) {
      this.updateModel(snapshot, dt, grounded, crouching, speed);
      this.updateNameplate(cameraPosition);
      return;
    }

    // Squash on landing, stretch in the air: the classic readability trick.
    const stretch = grounded ? 1 - Math.min(0.25, speed * 0.012) : 1 + Math.min(0.3, Math.abs(snapshot.vy) * 0.02);
    const squash = crouching ? 0.65 : 1 / stretch;
    this.body.scale.set(squash, stretch * (crouching ? 0.7 : 1), squash);

    if (grounded && speed > 0.5) {
      this.hopPhase += dt * (4 + speed * 0.8);
      this.body.position.y = Math.abs(Math.sin(this.hopPhase)) * 0.12;
      this.body.rotation.x = Math.sin(this.hopPhase) * 0.06;
    } else {
      this.hopPhase = 0;
      this.body.position.y += (0 - this.body.position.y) * Math.min(1, dt * 10);
      this.body.rotation.x += (0 - this.body.rotation.x) * Math.min(1, dt * 10);
    }

    this.poseLegs(grounded, crouching, speed, dt);
    this.poseTail(grounded, speed, dt);

    // An emote, for a body with no clips to play. Written on top of the pose the lines above just
    // set, in the same order the model path resolves them: only a player standing still emotes, so
    // the hop phase is zero here and there is nothing to fight over.
    const emoting = this.poseEmote(snapshot, grounded, speed, dt);

    this.head.rotation.x = -snapshot.pitch * 0.5;

    // Lip sync. Smoothed towards the replicated mic level rather than snapped to it: at a 20 Hz
    // snapshot rate the raw value steps visibly, and a jaw that chatters between two positions
    // looks worse than one that does not move at all.
    const target = Math.min(1, Math.max(0, snapshot.voice));
    this.mouthOpen += (target - this.mouthOpen) * Math.min(1, dt * 18);
    if (this.jawHinge) this.jawHinge.rotation.x = this.mouthOpen * 0.55;

    const hands = snapshot.hands;
    for (let i = 0; i < 2; i++) {
      const hand = this.hands[i] as THREE.Group;
      if (hands) {
        const target = hands[i];
        if (target) hand.position.set(target.x, target.y, target.z);
        hand.visible = true;
      } else {
        // Non-VR players get procedural arms so the avatar never looks broken.
        const side = i === 0 ? -1 : 1;
        const swing = grounded ? Math.sin(this.hopPhase + (i === 0 ? 0 : Math.PI)) * 0.12 : 0.25;
        const forward = 0.22 + swing;
        if (emoting) {
          // A raised, waving arm on the left; the right stays where the emote pose put it.
          const lift = i === 0 ? Math.sin(this.emotePhase * 7) * 0.18 : 0;
          hand.position.set(
            Math.cos(snapshot.yaw) * side * 0.3 + Math.sin(snapshot.yaw) * 0.1,
            0.72 + (i === 0 ? 0.42 + lift : 0.05),
            -Math.sin(snapshot.yaw) * side * 0.3 + Math.cos(snapshot.yaw) * 0.1,
          );
          hand.visible = true;
          continue;
        }
        hand.position.set(
          Math.cos(snapshot.yaw) * side * 0.28 + Math.sin(snapshot.yaw) * forward,
          0.72 + swing * 0.4,
          -Math.sin(snapshot.yaw) * side * 0.28 + Math.cos(snapshot.yaw) * forward,
        );
        hand.visible = true;
      }
    }

    this.updateNameplate(cameraPosition);
  }

  /**
   * Drive an authored model: choose a clip, advance the mixer, keep lip sync alive.
   *
   * Everything the procedural path does by posing groups, the clips do instead — so none of the
   * squash, hop phase or leg folding runs here. Doing both would fight: the mixer writes bone
   * transforms every frame and the procedural code would write over them, which reads as a model
   * vibrating between two poses.
   */
  private updateModel(
    snapshot: PlayerSnapshot,
    dt: number,
    grounded: boolean,
    crouching: boolean,
    speed: number,
  ): void {
    const clip = clipFor({ grounded, speed, hitTimer: this.hitTimer, emoteId: snapshot.emoteId });
    if (clip === 'idle' || clip === 'walk' || clip === 'run') this.blendLocomotion(speed);
    else this.playClip(clip);
    (this.mixer as THREE.AnimationMixer).update(dt);

    // Crouch is a state the clips do not cover, and it changes the player's actual capsule
    // height, so it stays a scale — the one piece of procedural posing the model path keeps.
    const target = crouching ? 0.68 : 1;
    this.body.scale.y += (target - this.body.scale.y) * Math.min(1, dt * 12);
    this.body.scale.x = this.body.scale.z = 1;

    this.head.rotation.x = -snapshot.pitch * 0.5;

    const voice = Math.min(1, Math.max(0, snapshot.voice));
    this.mouthOpen += (voice - this.mouthOpen) * Math.min(1, dt * 18);
    // A model with no jaw bone simply does not lip sync; it must not throw, because whether a
    // third-party pack has one is not something this code gets to decide.
    //
    // Applied after the rest pose and in the bone's own space, so the mouth opens along the hinge
    // the rig built rather than snapping to an absolute angle in the parent's frame. `multiply`
    // rather than `premultiply` for exactly that reason: the jaw's local X *is* the hinge axis,
    // and in the head's frame it is not.
    if (this.modelJaw && this.modelJawRest) {
      this.modelJaw.quaternion
        .copy(this.modelJawRest)
        .multiply(JAW_SWING.setFromAxisAngle(JAW_AXIS, this.mouthOpen * JAW_OPEN_RADIANS));
    }

    // Hands still track in VR: they are separate groups outside the model, and a hand that stops
    // following the controller is far more noticeable than one that does not match the mesh.
    const hands = snapshot.hands;
    for (let i = 0; i < 2; i++) {
      const hand = this.hands[i] as THREE.Group;
      if (hands) {
        const pose = hands[i];
        if (pose) hand.position.set(pose.x, pose.y, pose.z);
        hand.visible = true;
      } else {
        hand.visible = false; // the model has its own arms
      }
    }
    if (this.handsTracked !== Boolean(hands)) {
      this.handsTracked = Boolean(hands);
      this.placeHandCosmetics();
    }
  }

  private updateNameplate(cameraPosition: THREE.Vector3): void {
    if (!this.nameSprite) return;
    const distance = this.group.position.distanceTo(cameraPosition);
    this.nameSprite.visible = distance < 42;
    const scale = Math.max(1, distance * 0.045);
    this.nameSprite.scale.set(1.1 * scale, 0.28 * scale, 1);
  }

  /**
   * Fold and unfold the legs across the hop.
   *
   * The cycle is deliberately asymmetric. A kangaroo spends most of a hop extended and only
   * snaps closed around the landing, so the bend is driven by `sin` raised to a power — that
   * keeps the leg near-straight through the arc and compresses it sharply at the bottom, which
   * is what sells the weight. A symmetrical sine looks like a bouncing spring.
   */
  private poseLegs(grounded: boolean, crouching: boolean, speed: number, dt: number): void {
    const plan = this.plan;
    if (this.legs.length === 0) return;

    let bend: number;
    if (crouching) {
      bend = plan.crouchBend;
    } else if (grounded && speed > 0.5) {
      const compression = Math.max(0, Math.sin(this.hopPhase)) ** 3;
      bend = plan.crouchBend * compression;
    } else if (!grounded) {
      // Legs trail slightly tucked in the air rather than hanging straight down.
      bend = plan.crouchBend * 0.35;
    } else {
      bend = 0;
    }

    const blend = Math.min(1, dt * 14);
    for (const leg of this.legs) {
      const hipTarget = plan.thigh.angle + bend * 0.55;
      const kneeTarget = plan.shin.angle - bend;
      leg.hip.rotation.x += (hipTarget - leg.hip.rotation.x) * blend;
      leg.knee.rotation.x += (kneeTarget - leg.knee.rotation.x) * blend;
      // Keep the sole flat whatever the joints above are doing.
      leg.ankle.rotation.x = -(leg.hip.rotation.x + leg.knee.rotation.x);
    }
  }

  /**
   * Swing the tail as a counterweight.
   *
   * Two things drive it: it lifts when the animal is airborne — that is the actual job of a
   * kangaroo's tail, trading angular momentum with the body — and a travelling wave runs down
   * the chain so the tip lags the base. The lag is what makes it look heavy; a tail that moves
   * rigidly in one piece looks like a rudder.
   */
  private poseTail(grounded: boolean, speed: number, dt: number): void {
    if (this.tailJoints.length === 0) return;
    const blend = Math.min(1, dt * 10);
    const lift = grounded ? 0 : -this.plan.tailLift;
    const sway = Math.sin(this.hopPhase * 0.9) * Math.min(0.22, 0.05 + speed * 0.02);

    for (let i = 0; i < this.tailJoints.length; i++) {
      const joint = this.tailJoints[i] as THREE.Group;
      // Later segments get more of the swing and more of the delay.
      const share = (i + 1) / this.tailJoints.length;
      const phase = this.hopPhase - i * 0.45;
      const rest = i === 0 ? this.tailRootRest : (TAIL_JOINT_REST[Math.min(i - 1, TAIL_JOINT_REST.length - 1)] as number);
      const targetX = rest + lift * share;
      const targetZ = sway * share + Math.sin(phase) * 0.04 * share;
      joint.rotation.x += (targetX - joint.rotation.x) * blend;
      joint.rotation.z += (targetZ - joint.rotation.z) * blend;
    }
  }

  setDetailed(detailed: boolean): void {
    // Distant avatars drop their hands and nameplate; the body silhouette is what matters.
    for (const hand of this.hands) hand.visible = detailed;
    if (this.nameSprite) this.nameSprite.visible = detailed;
  }

  dispose(): void {
    // The mixer holds a binding per animated node; without this the avatar's bones stay
    // reachable from it and the whole cloned skeleton outlives the player who left.
    if (this.mixer) {
      this.mixer.stopAllAction();
      if (this.modelRoot) this.mixer.uncacheRoot(this.modelRoot);
      this.mixer = null;
    }
    this.actions.clear();
    this.currentClip = null;
    /**
     * The model's own geometry and materials are deliberately NOT disposed.
     *
     * `SkeletonUtils.clone` shares both with the cached source in `AssetLibrary` — that sharing is
     * the point, since sixteen kangaroos in a room should not be sixteen uploads of the same mesh.
     * Freeing them here would empty the buffers out from under every other player wearing the same
     * animal, and the bug would look like other people's avatars vanishing when someone else quits.
     * The library owns them and frees them in its own `dispose`.
     */
    this.modelRoot = null;
    this.modelJaw = null;
    this.modelJawRest = null;

    this.clearCosmetics();
    for (const material of this.materials) disposeMaterial(material);
    for (const geometry of this.geometries) geometry.dispose();
    this.group.removeFromParent();
    this.group.clear();
  }
}

/**
 * Free a material and anything it holds on the GPU.
 *
 * `Material.dispose()` releases the material and leaves its textures alone, because a texture is
 * usually shared between materials and three.js will not guess. Here nothing is shared — every
 * map is baked for one avatar — so the material owning it is the right place to free it, and not
 * doing so leaked a texture per nameplate for the life of the tab.
 */
function disposeMaterial(material: THREE.Material): void {
  for (const key of ['map', 'alphaMap', 'emissiveMap', 'normalMap'] as const) {
    (material as unknown as Record<string, THREE.Texture | null | undefined>)[key]?.dispose();
  }
  material.dispose();
}

function socketForSlot(slot: string): string {
  switch (slot) {
    case 'hat':
      return 'head';
    case 'mask':
    case 'glasses':
      return 'face';
    case 'backpack':
      return 'back';
    case 'tail':
      return 'tail';
    default:
      return 'back';
  }
}
