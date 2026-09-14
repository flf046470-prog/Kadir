import * as THREE from 'three';
import type { AnimalDef, CosmeticDef, PlayerSnapshot } from '@kc/core';
import { SnapFlags, getAnimal, getCosmetic } from '@kc/core';
import { AssetLibrary } from './AssetLibrary.js';
import type { LoadedModel } from './AssetLibrary.js';

/**
 * Clip names the renderer asks a model for.
 *
 * A contract, not a convention: `tools/blender/characters.py` writes exactly these, and a pack
 * that uses other names simply animates less rather than failing — `AssetLibrary.findClip`
 * tolerates exporter prefixes, and a missing clip leaves the avatar on the nearest one it has.
 */
export const CLIP_NAMES = ['idle', 'walk', 'run', 'jump', 'hit'] as const;
export type ClipName = (typeof CLIP_NAMES)[number];

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
 * Pick the clip that matches what the player is doing.
 *
 * Split out and exported because it is the part worth testing: it is pure, and every bug in it
 * ("runs on the spot while standing still", "never leaves the jump") is a behaviour a test can
 * state in one line. The thresholds are in metres per second against a 7.2 m/s top speed.
 */
export function clipFor(state: { grounded: boolean; speed: number; hitTimer: number }): ClipName {
  if (state.hitTimer > 0) return 'hit';
  if (!state.grounded) return 'jump';
  if (state.speed > 4.2) return 'run';
  if (state.speed > 0.5) return 'walk';
  return 'idle';
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

const PLANS: Record<'hopper' | 'upright' | 'waddler', BodyPlan> = {
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
export class Avatar {
  readonly group = new THREE.Group();
  readonly head = new THREE.Group();
  readonly body = new THREE.Group();
  readonly hands: [THREE.Group, THREE.Group];

  private animal: AnimalDef;
  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private sockets: Record<string, THREE.Group> = {};
  private cosmeticNodes = new Map<string, THREE.Object3D>();
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
    // Hide rather than delete: `dispose()` walks `materials` and `geometries`, and the cosmetic
    // sockets are empty groups whose *positions* are still the right place to hang a hat.
    this.body.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) node.visible = false;
    });

    this.modelRoot = loaded.scene;
    this.body.add(loaded.scene);

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
    // Captured before a single frame runs, so it is the rig's pose rather than one the mixer has
    // already blended part-way into a clip.
    this.modelJawRest = this.modelJaw ? this.modelJaw.quaternion.clone() : null;
  }

  /**
   * Cross-fade to a clip, or do nothing if it is already playing.
   *
   * The fade is short — a quarter of a second — because these transitions happen constantly at a
   * 20 Hz snapshot rate, and a long blend turns every direction change into a slide.
   */
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
    next.play();
    this.currentClip = name;
  }

  private mat(color: number, options: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
    const material = new THREE.MeshLambertMaterial({ color, flatShading: true, ...options });
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

    const plan = PLANS[visual.build ?? 'upright'] ?? PLANS.upright;
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

    this.group.add(this.body);

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

  /** Equip cosmetics by slot. Unknown or unowned ids are simply ignored. */
  setCosmetics(cosmetics: Record<string, string>): void {
    for (const [, node] of this.cosmeticNodes) node.removeFromParent();
    this.cosmeticNodes.clear();

    for (const [slot, id] of Object.entries(cosmetics)) {
      const def = getCosmetic(id);
      if (!def) continue;
      const node = this.buildCosmetic(def);
      if (!node) continue;
      const socket = socketForSlot(slot);
      const parent = this.sockets[socket];
      if (!parent) continue;
      parent.add(node);
      this.cosmeticNodes.set(slot, node);
    }
  }

  private buildCosmetic(def: CosmeticDef): THREE.Object3D | null {
    const material = this.mat(def.visual.color);
    switch (def.slot) {
      case 'hat': {
        const geometry =
          def.visual.shape === 'crown'
            ? this.geo(new THREE.CylinderGeometry(0.17, 0.19, 0.14, 7, 1, true))
            : def.visual.shape === 'brim'
              ? this.geo(new THREE.CylinderGeometry(0.13, 0.26, 0.16, 10))
              : this.geo(new THREE.ConeGeometry(0.18, 0.2, 5));
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.y = 0.08;
        return mesh;
      }
      case 'mask':
        return new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.26, 0.16, 0.06)), material);
      case 'glasses': {
        const group = new THREE.Group();
        const lens = this.geo(new THREE.CircleGeometry(0.07, 8));
        for (const side of [-1, 1]) {
          const mesh = new THREE.Mesh(lens, material);
          mesh.position.set(side * 0.09, 0.04, 0.02);
          group.add(mesh);
        }
        return group;
      }
      case 'backpack':
        return new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.28, 0.32, 0.18)), material);
      case 'tail':
        return new THREE.Mesh(this.geo(new THREE.CapsuleGeometry(0.1, 0.4, 3, 6)), material);
      case 'hands': {
        const group = new THREE.Group();
        // Hand cosmetics attach to the hands themselves rather than a body socket.
        const geometry = this.geo(new THREE.SphereGeometry(0.11, 7, 6));
        for (const hand of this.hands) {
          const mesh = new THREE.Mesh(geometry, material);
          hand.add(mesh);
          group.add(new THREE.Object3D());
        }
        return group;
      }
      case 'effect':
      case 'trail': {
        const mesh = new THREE.Mesh(
          this.geo(new THREE.TorusGeometry(0.5, 0.03, 4, 14)),
          this.mat(def.visual.color, { transparent: true, opacity: 0.55 }),
        );
        mesh.rotation.x = Math.PI / 2;
        return mesh;
      }
      default:
        return null;
    }
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

  /** Role colour ring on the ground — how you spot the chaser across a canyon. */
  setRole(role: string): void {
    if (!this.roleRing) return;
    const material = this.roleRing.material as THREE.MeshLambertMaterial;
    switch (role) {
      case 'chaser':
      case 'infected':
        material.color.setHex(0xff4d4d);
        material.opacity = 0.85;
        break;
      case 'runner':
        material.color.setHex(0x4cc9f0);
        material.opacity = 0.35;
        break;
      case 'fighter':
        material.color.setHex(0xffd166);
        material.opacity = 0.5;
        break;
      default:
        material.opacity = 0;
    }
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
    this.playClip(clipFor({ grounded, speed, hitTimer: this.hitTimer }));
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
