import * as THREE from 'three';
import { getGadget } from '@kc/core';
import type { EntitySnapshot } from '@kc/core';

/**
 * Capped the same as the wire format (`MAX_ENTITIES` in `packages/net/src/snapshot-codec.ts`), so
 * the pool is never the reason an entity that reached the client goes unrendered.
 */
const POOL_SIZE = 64;

export interface EntityStyle {
  color: number;
  opacity: number;
  /** Flattens the shared sphere into a disc for a trap sitting flush with the ground. */
  yScale: number;
}

/**
 * How one live gadget entity should look, picked from `kind` first and the gadget's own `visual`
 * tag second — the same tag `AudioSystem.gadgetFire` already picks a sound from (its own comment
 * claims this pairing exists; nothing on the render side backed it up until this file). Reusing it
 * rather than a second per-gadget-id table means a gadget added to the catalog is visible the
 * moment it is audible, with nothing new to keep in step.
 */
export function styleForEntity(kind: EntitySnapshot['kind'], visual: string | undefined): EntityStyle {
  if (kind === 'cloud') return { color: 0xdcdcdc, opacity: 0.4, yScale: 1 };
  if (kind === 'placed') return { color: 0xffb347, opacity: 0.6, yScale: 0.06 };
  switch (visual) {
    case 'rifle':
      return { color: 0xff5533, opacity: 1, yScale: 1 };
    case 'canister':
      return { color: 0x6fd7ff, opacity: 1, yScale: 1 };
    case 'grenade':
      return { color: 0x5a6a4a, opacity: 1, yScale: 1 };
    default:
      return { color: 0xffffff, opacity: 1, yScale: 1 };
  }
}

/**
 * Every live gadget projectile, placed trap and smoke cloud, drawn from a fixed pool of unlit
 * spheres.
 *
 * `Snapshot.entities` (see `@kc/core`) has always carried this — id, kind, position, radius, sent
 * whole every tick specifically because "a missed trap is a player standing on something they
 * cannot see", per that type's own comment. Nothing between the wire and the screen ever read it:
 * `NetClient.handleBinary` decoded it and only forwarded `tick` and `players`, so a freeze-gun
 * bolt, a thrown smoke bomb and a placed snare all fired, flew and landed in complete visual
 * silence — a sound and a haptic pulse, and nothing that moved, sat on the ground or hung in the
 * air. `GameClient` now forwards `entities` and drives this class from it every frame.
 *
 * Unlit (`MeshBasicMaterial`) rather than standard, the same choice `LevelRenderer.buildCheckpoints`
 * already makes for its rings: these are stylised gameplay markers, not physical surfaces with a
 * material to shade, and skipping the light response is also the cheaper draw. One shared sphere
 * geometry, scaled per instance and flattened into a disc for a trap, rather than one geometry per
 * kind — the entities that need telling apart at a glance are told apart by colour and size, which
 * a scale already buys.
 */
export class GadgetEntityView {
  readonly group = new THREE.Group();
  private pool: THREE.Mesh[] = [];
  private materials: THREE.MeshBasicMaterial[] = [];
  private geometry = new THREE.SphereGeometry(1, 12, 8);

  constructor() {
    for (let i = 0; i < POOL_SIZE; i++) {
      const material = new THREE.MeshBasicMaterial({ transparent: true });
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.visible = false;
      this.materials.push(material);
      this.pool.push(mesh);
      this.group.add(mesh);
    }
  }

  /** Reposition and restyle the pool from this frame's live entities; hide whatever is left over. */
  update(entities: EntitySnapshot[]): void {
    const count = Math.min(entities.length, this.pool.length);
    for (let i = 0; i < count; i++) {
      const entity = entities[i] as EntitySnapshot;
      const mesh = this.pool[i] as THREE.Mesh;
      const material = this.materials[i] as THREE.MeshBasicMaterial;
      const style = styleForEntity(entity.kind, getGadget(entity.gadgetId)?.visual);

      mesh.position.set(entity.x, entity.y, entity.z);
      // Floored, not because a radius of 0 is expected, but because a degenerate one must shrink
      // to invisible rather than to a NaN scale that then vanishes the whole shared geometry.
      const diameter = Math.max(0.08, entity.radius * 2);
      mesh.scale.set(diameter, diameter * style.yScale, diameter);
      material.color.setHex(style.color);
      material.opacity = style.opacity;
      mesh.visible = true;
    }
    for (let i = count; i < this.pool.length; i++) (this.pool[i] as THREE.Mesh).visible = false;
  }

  dispose(): void {
    this.geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}
