import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildLevel, DEFAULT_SETTINGS } from '@kc/core';
import type { BoxCollider, Collider, CylinderCollider } from '@kc/core';
import { BRANCH_TAPER, LevelRenderer, branchGeometry, branchMatrix } from './LevelRenderer.js';
import { profileFor } from '../platform/Platform.js';

/**
 * A tree branch is a box to the physics and a bough to the eye (`BoxCollider.drawAs`). Drawn as the
 * box it was, every tree in the jungle was a post with planks nailed round it. What has a right
 * answer without a GPU: every branch is drawn once and never as a box, and the bough lies inside its
 * box with its top on the box's top — a player stands on what they see — and its root in the trunk.
 */

const isBranch = (c: Collider): c is BoxCollider => c.kind === 'box' && c.drawAs === 'branch';

describe('tree branches', () => {
  const level = buildLevel('jungle-world');
  const branches = level.colliders.filter(isBranch);
  const trunks = level.colliders.filter((c): c is CylinderCollider => c.kind === 'cylinder' && c.surface.material === 'wood');

  it('draws every branch once, as a bough', () => {
    expect(branches.length).toBeGreaterThan(50);
    const renderer = new LevelRenderer(level, profileFor('pc', 'high', DEFAULT_SETTINGS));
    let drawn = 0;
    renderer.group.traverse((obj) => {
      if (obj instanceof THREE.InstancedMesh && obj.userData.kind === 'branch') drawn += obj.count;
    });
    expect(drawn).toBe(branches.length);
  });

  it('lies inside its box, with its top on the box top, and its root in the trunk', () => {
    const geometry = branchGeometry();
    const position = geometry.getAttribute('position');
    const matrix = new THREE.Matrix4();
    const point = new THREE.Vector3();
    for (const branch of branches) {
      branchMatrix(branch, matrix);
      const toLocal = new THREE.Matrix4()
        .compose(new THREE.Vector3(branch.center.x, branch.center.y, branch.center.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), branch.yaw), new THREE.Vector3(1, 1, 1))
        .invert();
      let topAtTrunk = -Infinity;
      let topAtTip = -Infinity;
      let rootEnd = Infinity;
      for (let i = 0; i < position.count; i++) {
        point.fromBufferAttribute(position, i).applyMatrix4(matrix).applyMatrix4(toLocal);
        // Never outside the box sideways, above it, or past its tip.
        expect(Math.abs(point.x)).toBeLessThanOrEqual(branch.half.x + 1e-3);
        expect(point.y).toBeLessThanOrEqual(branch.half.y + 1e-3);
        expect(point.z).toBeLessThanOrEqual(branch.half.z + 1e-3);
        if (point.z < -branch.half.z) topAtTrunk = Math.max(topAtTrunk, point.y);
        if (point.z > branch.half.z - 1e-3) topAtTip = Math.max(topAtTip, point.y);
        rootEnd = Math.min(rootEnd, point.z);
      }
      // Standing on it: the top is the box's top where it leaves the trunk, a couple of centimetres
      // under it at the tip.
      expect(topAtTrunk).toBeCloseTo(branch.half.y, 3);
      expect(topAtTip).toBeCloseTo(branch.half.y * BRANCH_TAPER, 3);
      expect(branch.half.y - topAtTip).toBeLessThan(0.03);
      // The root is inside a trunk, so no gap shows where a flat end met round bark.
      const root = new THREE.Vector3(0, 0, rootEnd)
        .applyQuaternion(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), branch.yaw))
        .add(new THREE.Vector3(branch.center.x, branch.center.y, branch.center.z));
      const inside = trunks.some((t) => Math.hypot(root.x - t.center.x, root.z - t.center.z) < t.radius && Math.abs(root.y - t.center.y) < t.halfHeight);
      expect(inside, `branch ${branch.id}'s root is in a trunk`).toBe(true);
    }
  });
});
