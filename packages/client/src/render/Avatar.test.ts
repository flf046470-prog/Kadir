import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';

import { LAUNCH_ANIMALS, SnapFlags, listAnimals, registerAnimals } from '@kc/core';
import type { PlayerSnapshot } from '@kc/core';
import { Avatar } from './Avatar.js';

/**
 * The procedural skeleton, checked as geometry.
 *
 * A body plan is a table of angles and lengths, and the failure mode of a table of angles is
 * silent: the animal still renders, still animates, and simply stands with its feet a hand's
 * width under the ground or floating above it. Nothing throws and no existing test notices —
 * while building these plans that mistake was made twice, in both directions.
 *
 * So these tests measure the built body in world space rather than asserting on the numbers
 * that produced it. They would also catch the more serious version: a body plan that changed
 * how tall or wide a player's *hitbox* is would be a fairness bug, and the guarantee this game
 * makes is that a look never becomes an advantage.
 */

/**
 * Build an avatar and pose it as a player standing still on the ground.
 *
 * Posing matters: `update` is what places the hands, and a freshly constructed avatar still has
 * them at the origin. Measuring before that would be measuring a state no player ever sees.
 */
function build(id: string): Avatar {
  const avatar = new Avatar(id, false);
  const snapshot = {
    id,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    pitch: 0,
    flags: SnapFlags.Grounded,
    voice: 0,
    hands: null,
  } as unknown as PlayerSnapshot;
  const eye = new THREE.Vector3(0, 1.5, 4);
  // A few frames, because the joints ease towards their pose rather than snapping to it.
  for (let i = 0; i < 120; i++) avatar.update(snapshot, 1 / 60, eye);
  avatar.group.updateMatrixWorld(true);
  return avatar;
}

/** World-space bounding box of everything the avatar draws. */
function bounds(avatar: Avatar): THREE.Box3 {
  return new THREE.Box3().setFromObject(avatar.group);
}

function joint(avatar: Avatar, name: string): THREE.Vector3 {
  const node = avatar.group.getObjectByName(name);
  if (!node) throw new Error(`no joint named ${name}`);
  return node.getWorldPosition(new THREE.Vector3());
}

/** Lowest point of the foot hanging off the named ankle. */
function footBottom(avatar: Avatar, ankleName: string): number {
  const ankle = avatar.group.getObjectByName(ankleName);
  if (!ankle) throw new Error(`no joint named ${ankleName}`);
  const foot = ankle.children.find((child) => (child as THREE.Mesh).isMesh);
  if (!foot) throw new Error(`${ankleName} has no foot`);
  return new THREE.Box3().setFromObject(foot).min.y;
}

beforeAll(() => {
  registerAnimals(LAUNCH_ANIMALS);
});

describe('every animal stands on the ground', () => {
  it.each(LAUNCH_ANIMALS.map((a) => a.id))('%s puts its soles on the floor', (id) => {
    const avatar = build(id);

    // Measured on the foot rather than on the whole avatar. The feet are axis-aligned boxes, so
    // their world bounds are exact; a bounding box drawn around a *rotated capsule* is inflated
    // to its corners and over-reports by several centimetres, which would make this assertion
    // about the leg's angle rather than about where the animal stands.
    const sole = Math.min(footBottom(avatar, 'ankle.l'), footBottom(avatar, 'ankle.r'));
    expect(sole, `${id} sole height`).toBeGreaterThan(-0.03);
    expect(sole, `${id} sole height`).toBeLessThan(0.05);
    avatar.dispose();
  });

  it.each(LAUNCH_ANIMALS.map((a) => a.id))('%s keeps the rest of itself above ground', (id) => {
    const avatar = build(id);
    // Looser, because of the capsule-corner inflation above — this catches a whole limb pointing
    // the wrong way, not a centimetre of overhang.
    expect(bounds(avatar).min.y, `${id} lowest point`).toBeGreaterThan(-0.12);
    avatar.dispose();
  });

  it.each(LAUNCH_ANIMALS.map((a) => a.id))('%s is a plausible size', (id) => {
    const avatar = build(id);
    const size = bounds(avatar).getSize(new THREE.Vector3());

    // Loose bounds, deliberately: the point is to catch a plan that produces a giant or a speck,
    // not to freeze the art direction. A body twice anyone else's height would also give its
    // player a different-looking hitbox to shoot at, which is the fairness problem.
    expect(size.y, `${id} height`).toBeGreaterThan(0.5);
    expect(size.y, `${id} height`).toBeLessThan(2.2);
    expect(size.x, `${id} width`).toBeLessThan(1.6);
    avatar.dispose();
  });
});

describe('the hopper body plan', () => {
  it('folds the leg into a Z — knee ahead of the hip, ankle behind it', () => {
    const roo = build('kangaroo');
    const hip = joint(roo, 'hip.l');
    const knee = joint(roo, 'knee.l');
    const ankle = joint(roo, 'ankle.l');

    // +Z is the direction the animal faces.
    expect(knee.z, 'knee should lead').toBeGreaterThan(hip.z + 0.05);
    expect(ankle.z, 'ankle should trail').toBeLessThan(knee.z - 0.1);
    // And the joints must descend in order, or it is not a leg.
    expect(knee.y).toBeLessThan(hip.y);
    expect(ankle.y).toBeLessThan(knee.y);
    roo.dispose();
  });

  it('carries the tail out behind the body, not through the floor', () => {
    const roo = build('kangaroo');
    const box = bounds(roo);

    // The tail is the deepest thing on the animal, so the bounding box reaches well behind it.
    expect(box.min.z, 'tail reach').toBeLessThan(-0.6);
    roo.dispose();
  });

  it('stands taller than it is wide, like an animal balanced on two legs', () => {
    const size = bounds(build('kangaroo')).getSize(new THREE.Vector3());
    expect(size.y).toBeGreaterThan(size.x);
  });
});

describe('body plans are a look, never an advantage', () => {
  /**
   * The rule the whole cosmetic system rests on, restated for body plans: a plan lives entirely
   * in `AnimalVisual`, and nothing in `AnimalVisual` reaches movement. If a build ever appeared
   * in `feel`, picking the right-looking animal would start winning rounds.
   */
  it('leaves every animal with the same movement profile it declared', () => {
    for (const animal of listAnimals()) {
      const feel = animal.feel as Record<string, number>;
      for (const [field, value] of Object.entries(feel)) {
        expect(Math.abs(value), `${animal.id}.${field}`).toBeLessThanOrEqual(0.03);
      }
    }
  });

  it('gives no animal a different standing height than the rest by more than a hand', () => {
    const heights = LAUNCH_ANIMALS.map((a) => {
      const avatar = build(a.id);
      const height = bounds(avatar).getSize(new THREE.Vector3()).y;
      avatar.dispose();
      return { id: a.id, height };
    });

    // Silhouettes differ — a penguin is not a kangaroo — but not so much that one animal is a
    // meaningfully smaller target than another.
    const tallest = Math.max(...heights.map((h) => h.height));
    const shortest = Math.min(...heights.map((h) => h.height));
    expect(tallest - shortest, JSON.stringify(heights)).toBeLessThan(0.75);
  });
});
