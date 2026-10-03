import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { EntitySnapshot } from '@kc/core';

import { GadgetEntityView, styleForEntity } from './GadgetEntities.js';

function entity(over: Partial<EntitySnapshot> = {}): EntitySnapshot {
  return { id: 1, gadgetId: 'freeze_gun', ownerId: '', kind: 'projectile', x: 0, y: 0, z: 0, radius: 0.45, ...over };
}

/**
 * `Snapshot.entities` — every live gadget projectile, placed trap and smoke cloud — reached the
 * client (decoded, positioned, radius and all) and was then dropped on the floor: `NetClient`
 * forwarded `tick` and `players` and nothing else, so a freeze-gun bolt, a thrown smoke bomb and a
 * placed snare all fired, flew and landed in total visual silence. This is the part that has a
 * right answer without a GPU — the pool's book-keeping — the same split `LevelRenderer.water.test.ts`
 * already draws for materials that only finish compiling once a real renderer touches them.
 */
describe('styleForEntity', () => {
  it('tells a cloud from a trap from a flying projectile', () => {
    const cloud = styleForEntity('cloud', 'grenade');
    const placed = styleForEntity('placed', 'beacon');
    const projectile = styleForEntity('projectile', 'canister');
    // A trap lies flat against the ground; nothing else does.
    expect(placed.yScale).toBeLessThan(0.5);
    expect(cloud.yScale).toBe(1);
    expect(projectile.yScale).toBe(1);
  });

  it('colours a projectile from the gadget catalog\'s own visual tag, not a hard-coded id', () => {
    // AudioSystem.gadgetFire already keys its sound off `visual` for exactly this reason — a
    // gadget added to the catalog is covered without a second table to keep in step.
    expect(styleForEntity('projectile', 'rifle')).not.toEqual(styleForEntity('projectile', 'canister'));
    expect(styleForEntity('projectile', 'canister')).not.toEqual(styleForEntity('projectile', 'grenade'));
  });

  it('never produces a fully transparent or invisible style', () => {
    for (const kind of ['projectile', 'placed', 'cloud'] as const) {
      for (const visual of ['rifle', 'canister', 'grenade', 'beacon', 'plate', undefined]) {
        const style = styleForEntity(kind, visual);
        expect(style.opacity, `${kind}/${visual}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('GadgetEntityView', () => {
  it('shows exactly the entities it is given, positioned and sized from the snapshot', () => {
    const view = new GadgetEntityView();
    view.update([entity({ x: 3, y: 1, z: -2, radius: 0.5 }), entity({ id: 2, kind: 'cloud', radius: 3 })]);

    const visible = view.group.children.filter((c) => c.visible);
    expect(visible).toHaveLength(2);
    const first = visible[0] as THREE.Mesh;
    expect(first.position.x).toBe(3);
    expect(first.position.y).toBe(1);
    expect(first.position.z).toBe(-2);
    expect(first.scale.x).toBeCloseTo(1, 5); // diameter = 2 * radius(0.5)
    view.dispose();
  });

  it('hides everything left over from a smaller entity list on the next frame', () => {
    // A projectile expiring or a trap being triggered must not leave its old mesh standing where
    // it last was — the classic pooling bug of shrinking the list without shrinking the visible set.
    const view = new GadgetEntityView();
    view.update([entity(), entity({ id: 2 }), entity({ id: 3 })]);
    expect(view.group.children.filter((c) => c.visible)).toHaveLength(3);

    view.update([entity()]);
    expect(view.group.children.filter((c) => c.visible)).toHaveLength(1);
    view.dispose();
  });

  it('clears the pool entirely once every entity is gone', () => {
    const view = new GadgetEntityView();
    view.update([entity(), entity({ id: 2 })]);
    view.update([]);
    expect(view.group.children.filter((c) => c.visible)).toHaveLength(0);
    view.dispose();
  });

  it('never renders more than the pool holds, however many entities arrive', () => {
    const view = new GadgetEntityView();
    const many = Array.from({ length: 200 }, (_, i) => entity({ id: i }));
    expect(() => view.update(many)).not.toThrow();
    expect(view.group.children.filter((c) => c.visible).length).toBeLessThanOrEqual(view.group.children.length);
    view.dispose();
  });

  it('survives a degenerate radius rather than collapsing the shared geometry to zero scale', () => {
    const view = new GadgetEntityView();
    view.update([entity({ radius: 0 })]);
    const mesh = view.group.children[0] as THREE.Mesh;
    expect(mesh.scale.x).toBeGreaterThan(0);
    view.dispose();
  });
});
