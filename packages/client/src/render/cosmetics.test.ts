import { LAUNCH_ANIMALS, LAUNCH_COSMETICS, SnapFlags, registerAnimals } from '@kc/core';
import type { CosmeticDef, PlayerSnapshot } from '@kc/core';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';

import { Avatar } from './Avatar.js';
import { TrailHistory, buildCosmetic, hasRecipe } from './cosmetics.js';
import type { CosmeticBuild } from './cosmetics.js';

/**
 * Cosmetics are what a player chose, and in a free game with no stats for sale they are the only
 * thing anyone chooses. Measured before this file existed: seventeen visual items rendered as nine
 * meshes (both effects and both trails were the same static torus), and the gloves leaked onto the
 * hands on every equip. See `cosmetics.ts`.
 */

const VISUAL = LAUNCH_COSMETICS.filter((c) => c.slot !== 'emote');

function standing(id: string, speed = 0): PlayerSnapshot {
  return {
    id, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: speed, yaw: 0, pitch: 0,
    flags: SnapFlags.Grounded, voice: 0, hands: null,
  } as unknown as PlayerSnapshot;
}

/** Every mesh a build draws, as geometry kind and vertex count — what a player could tell apart. */
function signature(build: CosmeticBuild): string {
  const parts: string[] = [];
  const visit = (object: THREE.Object3D) =>
    object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) parts.push(`${mesh.geometry.type}:${mesh.geometry.getAttribute('position')?.count ?? 0}`);
    });
  visit(build.node);
  build.handNodes.forEach(visit);
  return parts.sort().join(',');
}

function internals(avatar: Avatar) {
  return avatar as unknown as {
    hands: THREE.Group[];
    materials: THREE.Material[];
    geometries: THREE.BufferGeometry[];
    cosmetics: CosmeticBuild[];
  };
}

beforeAll(() => {
  registerAnimals(LAUNCH_ANIMALS);
});

describe('the cosmetic catalog', () => {
  it('found enough items to be worth checking', () => {
    expect(VISUAL.length).toBeGreaterThanOrEqual(17);
  });

  it('gives every visual item a recipe of its own rather than its slot fallback', () => {
    const borrowed = VISUAL.filter((c) => !hasRecipe(c.visual.shape)).map((c) => `${c.id} (${c.visual.shape})`);
    expect(borrowed).toEqual([]);
  });

  it('draws every visual item as a different object', () => {
    const seen = new Map<string, string>();
    const clones: string[] = [];
    for (const def of VISUAL) {
      const build = buildCosmetic(def) as CosmeticBuild;
      expect(build, def.id).not.toBeNull();
      const sig = signature(build);
      expect(sig, `${def.id} draws nothing`).not.toBe('');
      const previous = seen.get(sig);
      if (previous) clones.push(`${previous} = ${def.id}`);
      else seen.set(sig, def.id);
    }
    expect(clones).toEqual([]);
  });

  it('draws nothing for an emote, which is an animation', () => {
    const emote = LAUNCH_COSMETICS.find((c) => c.slot === 'emote') as CosmeticDef;
    expect(buildCosmetic(emote)).toBeNull();
  });

  it('falls back to its slot for a shape this client has never seen, rather than vanishing', () => {
    const unknown: CosmeticDef = { ...(VISUAL[0] as CosmeticDef), id: 'cdn_hat', visual: { color: 0xffffff, shape: 'from_the_future' } };
    expect(buildCosmetic(unknown)).not.toBeNull();
  });
});

describe('equipping on an avatar', () => {
  it('takes the gloves off again when they are unequipped', () => {
    const avatar = new Avatar('kangaroo', false);
    const { hands } = internals(avatar);
    const baseline = hands.map((h) => h.children.length);
    avatar.setCosmetics({ hands: 'hands_gloves' });
    expect(hands.map((h) => h.children.length)).toEqual(baseline.map((n) => n + 1));
    avatar.setCosmetics({});
    expect(hands.map((h) => h.children.length)).toEqual(baseline);
    avatar.dispose();
  });

  it('does not stack or grow across repeated equips', () => {
    const avatar = new Avatar('kangaroo', false);
    const inner = internals(avatar);
    const baseline = inner.hands.map((h) => h.children.length);
    const materials = inner.materials.length;
    const geometries = inner.geometries.length;
    for (let i = 0; i < 3; i++) {
      avatar.setCosmetics({ hands: 'hands_boxing', hat: 'hat_crown', trail: 'trail_rainbow' });
      avatar.setCosmetics({ hands: 'hands_gloves', effect: 'effect_leaves' });
    }
    expect(inner.hands.map((h) => h.children.length)).toEqual(baseline.map((n) => n + 1));
    expect(inner.cosmetics.length).toBe(2);
    // The body's own lists do not grow: a cosmetic's resources are its own and go with it.
    expect(inner.materials.length).toBe(materials);
    expect(inner.geometries.length).toBe(geometries);
    avatar.dispose();
  });

  it('frees what an unequipped cosmetic made', () => {
    const avatar = new Avatar('kangaroo', false);
    avatar.setCosmetics({ hat: 'hat_explorer' });
    const build = internals(avatar).cosmetics[0] as CosmeticBuild;
    let freed = 0;
    for (const g of build.geometries) g.addEventListener('dispose', () => freed++);
    avatar.setCosmetics({});
    expect(freed).toBe(build.geometries.length);
    expect(build.node.parent).toBeNull();
    avatar.dispose();
  });
});

describe('cosmetics that move', () => {
  function run(avatar: Avatar, seconds: number, speed: number, from = 0): number {
    let z = from;
    const dt = 1 / 60;
    for (let t = 0; t < seconds; t += dt) {
      z += speed * dt;
      avatar.update({ ...standing(avatar.group.name || 'kangaroo', speed), z }, dt, new THREE.Vector3(0, 1.5, -4));
    }
    return z;
  }

  it('lays a trail behind a running avatar and none behind a standing one', () => {
    const avatar = new Avatar('kangaroo', false);
    avatar.setCosmetics({ trail: 'trail_rainbow' });
    const ribbon = (internals(avatar).cosmetics[0] as CosmeticBuild).node.children[0] as THREE.Mesh;
    run(avatar, 1, 0);
    expect(ribbon.visible).toBe(false);
    const end = run(avatar, 1, 6);
    expect(ribbon.visible).toBe(true);
    expect(ribbon.geometry.drawRange.count).toBeGreaterThan(0);
    // The ribbon trails *behind*: the running avatar moved +z, so the drawn points are at or
    // behind its current position in world space.
    const positions = ribbon.geometry.getAttribute('position') as THREE.BufferAttribute;
    ribbon.updateWorldMatrix(true, false);
    const oldest = new THREE.Vector3().fromBufferAttribute(positions, 0).applyMatrix4(ribbon.matrixWorld);
    expect(oldest.z).toBeLessThan(end - 1);
    // And it goes away once the avatar has stood still for longer than the trail lives.
    run(avatar, 1.5, 0, end);
    expect(ribbon.visible).toBe(false);
    avatar.dispose();
  });

  it('kicks up dust only on the ground', () => {
    const history = new TrailHistory(10, 0.3, 0.7);
    const at = new THREE.Vector3();
    for (let i = 0; i < 30; i++) history.step(at.set(0, 0, i * 0.2), 1 / 60, false);
    expect(history.points.length).toBe(0);
    for (let i = 0; i < 30; i++) history.step(at.set(0, 0, i * 0.2), 1 / 60, true);
    expect(history.points.length).toBeGreaterThan(5);
  });

  it('moves an effect on a loaded model too, not only on the procedural body', () => {
    // `update` returns early once a model is attached. Cosmetic motion has to run before that
    // return, or every player whose model loaded — which is every player — gets a frozen aura.
    const avatar = new Avatar('kangaroo', false);
    const scene = new THREE.Object3D();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.5, 0.4)));
    // A clip, or `attachModel` makes no mixer and `update` never takes the model branch at all —
    // the first version of this test had none, and passed with the animation call in the wrong
    // place, which is the mutation it exists to catch.
    const idle = new THREE.AnimationClip('idle', 1, [new THREE.VectorKeyframeTrack('.position', [0, 1], [0, 0, 0, 0, 0, 0])]);
    avatar.attachModel({ scene, clips: [idle] });
    expect((avatar as unknown as { mixer: unknown }).mixer).not.toBeNull();
    avatar.setCosmetics({ effect: 'effect_sparkle' });
    const spark = (internals(avatar).cosmetics[0] as CosmeticBuild).node.children[0] as THREE.Object3D;
    run(avatar, 0.1, 0);
    const before = spark.position.clone();
    run(avatar, 0.5, 0);
    expect(spark.position.distanceTo(before)).toBeGreaterThan(0.05);
    avatar.dispose();
  });
});

describe('gloves on a loaded model', () => {
  /** Drawn means the node and every ancestor are visible — hidden anywhere up the chain is not. */
  function drawn(object: THREE.Object3D): boolean {
    for (let o: THREE.Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
    return true;
  }

  function modelWithHands(): { scene: THREE.Object3D; clips: THREE.AnimationClip[]; sockets: THREE.Object3D[] } {
    const scene = new THREE.Object3D();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.5, 0.4)));
    const sockets = ['socket_hand_L', 'socket_hand_R'].map((name, i) => {
      const s = new THREE.Object3D();
      s.name = name;
      s.position.set(i === 0 ? -0.25 : 0.25, 0.8, 0.1);
      scene.add(s);
      return s;
    });
    const idle = new THREE.AnimationClip('idle', 1, [new THREE.VectorKeyframeTrack('.position', [0, 1], [0, 0, 0, 0, 0, 0])]);
    return { scene, clips: [idle], sockets };
  }

  function step(avatar: Avatar, hands: PlayerSnapshot['hands']): void {
    avatar.update({ ...standing('kangaroo'), hands } as PlayerSnapshot, 1 / 60, new THREE.Vector3(0, 1.5, 4));
  }

  it('draws them on the model\'s own paws when nothing is tracking the hands', () => {
    // Before: the gloves hung on the avatar's hand groups, which the model path hides, so on PC
    // and mobile — every player without a headset — an equipped glove was never drawn.
    const avatar = new Avatar('kangaroo', false);
    const { scene, clips, sockets } = modelWithHands();
    avatar.attachModel({ scene, clips });
    avatar.setCosmetics({ hands: 'hands_boxing' });
    step(avatar, null);
    const gloves = (internals(avatar).cosmetics[0] as CosmeticBuild).handNodes;
    expect(gloves.length).toBe(2);
    gloves.forEach((glove, i) => {
      expect(drawn(glove), `glove ${i} is not drawn`).toBe(true);
      expect(glove.parent?.parent).toBe(sockets[i]);
    });
    avatar.dispose();
  });

  it('moves them onto the tracked hands in a headset, and back when tracking stops', () => {
    const avatar = new Avatar('kangaroo', false);
    const { scene, clips } = modelWithHands();
    avatar.attachModel({ scene, clips });
    avatar.setCosmetics({ hands: 'hands_gloves' });
    const tracked = [{ x: -0.3, y: 1, z: 0.3 }, { x: 0.3, y: 1, z: 0.3 }] as unknown as PlayerSnapshot['hands'];
    step(avatar, tracked);
    const { hands, cosmetics } = internals(avatar);
    const gloves = (cosmetics[0] as CosmeticBuild).handNodes;
    gloves.forEach((glove, i) => {
      expect(glove.parent).toBe(hands[i]);
      expect(drawn(glove)).toBe(true);
    });
    step(avatar, null);
    gloves.forEach((glove) => expect(drawn(glove)).toBe(true));
    avatar.dispose();
  });
});
