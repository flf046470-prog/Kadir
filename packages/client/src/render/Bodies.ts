import * as THREE from 'three';
import { BODY_DEFS } from '@kc/core';
import type { BodyKind, EntitySnapshot } from '@kc/core';

/**
 * Loose balls, as the simulation reports them (`@kc/core` `bodies/`).
 *
 * One `InstancedMesh` per kind — every ball in the game is two draw calls — and no spin on the
 * wire: a ball rolls by exactly as far as it moved, about the axis perpendicular to its travel, so
 * each client turns the mesh itself from consecutive positions. Right for rolling, which is what a
 * ball on the ground does nearly all the time; a spinning throw simply shows no spin in flight.
 */

const MAX_PER_KIND = 32;

/** A size-5 ball: twelve black pentagons at an icosahedron's vertices, white hexagons between. */
function footballGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, 4);
  const ico = new THREE.IcosahedronGeometry(1, 0);
  const centres: THREE.Vector3[] = [];
  const p = ico.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i).normalize();
    if (!centres.some((c) => c.distanceToSquared(v) < 1e-6)) centres.push(v);
  }
  ico.dispose();
  const position = geometry.getAttribute('position');
  const colours = new Float32Array(position.count * 3);
  const v = new THREE.Vector3();
  const white = new THREE.Color(0xf4f4f0);
  const black = new THREE.Color(0x1a1a1c);
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i).normalize();
    // A pentagon on a size-5 ball spans about 20° of arc from its centre.
    const dark = centres.some((c) => c.dot(v) > Math.cos(THREE.MathUtils.degToRad(19)));
    (dark ? black : white).toArray(colours, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return geometry;
}

/** Six coloured gores and white caps — the beach ball everyone recognises at fifty metres. */
function beachballGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(1, 36, 20);
  const position = geometry.getAttribute('position');
  const colours = new Float32Array(position.count * 3);
  const gores = [0xe23b3b, 0xf7f3ea, 0x2f6fd6, 0xf2c230, 0xf7f3ea, 0x2fae5a].map((hex) => new THREE.Color(hex));
  const cap = new THREE.Color(0xf7f3ea);
  const v = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i);
    const colour = Math.abs(v.y) > 0.93 ? cap : (gores[Math.floor(((Math.atan2(v.z, v.x) / (Math.PI * 2) + 1) % 1) * gores.length)] as THREE.Color);
    colour.toArray(colours, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return geometry;
}

interface Rolling {
  quaternion: THREE.Quaternion;
  last: THREE.Vector3;
  seen: number;
}

export class BodyView {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<BodyKind, THREE.InstancedMesh>();
  private readonly rolling = new Map<number, Rolling>();
  private readonly disposables: (THREE.BufferGeometry | THREE.Material)[] = [];
  private frame = 0;

  constructor(shadows = true) {
    const make = (kind: BodyKind, geometry: THREE.BufferGeometry, roughness: number): void => {
      const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0 });
      const mesh = new THREE.InstancedMesh(geometry, material, MAX_PER_KIND);
      mesh.count = 0;
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      // Instances move every frame and the bounding sphere is never recomputed.
      mesh.frustumCulled = false;
      this.meshes.set(kind, mesh);
      this.group.add(mesh);
      this.disposables.push(geometry, material);
    };
    make('football', footballGeometry(), 0.55);
    // Glossy vinyl: it should catch the sky.
    make('beachball', beachballGeometry(), 0.28);
  }

  update(entities: readonly EntitySnapshot[]): void {
    this.frame++;
    const counts = new Map<BodyKind, number>();
    const matrix = new THREE.Matrix4();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    const axis = new THREE.Vector3();
    const step = new THREE.Quaternion();
    for (const entity of entities) {
      if (entity.kind !== 'body') continue;
      const kind = entity.gadgetId as BodyKind;
      const mesh = this.meshes.get(kind);
      const def = BODY_DEFS[kind];
      if (!mesh || !def) continue;
      const index = counts.get(kind) ?? 0;
      if (index >= MAX_PER_KIND) continue;
      counts.set(kind, index + 1);
      position.set(entity.x, entity.y, entity.z);
      let state = this.rolling.get(entity.id);
      if (!state) {
        state = { quaternion: new THREE.Quaternion(), last: position.clone(), seen: this.frame };
        this.rolling.set(entity.id, state);
      }
      const dx = position.x - state.last.x;
      const dz = position.z - state.last.z;
      const travelled = Math.hypot(dx, dz);
      // A jump bigger than a ball can roll in a frame is a reset or a teleport, not a roll.
      if (travelled > 1e-5 && travelled < 3) {
        axis.set(dz, 0, -dx).normalize();
        step.setFromAxisAngle(axis, travelled / def.radius);
        state.quaternion.premultiply(step);
      }
      state.last.copy(position);
      state.seen = this.frame;
      scale.setScalar(def.radius);
      mesh.setMatrixAt(index, matrix.compose(position, state.quaternion, scale));
    }
    for (const [kind, mesh] of this.meshes) {
      mesh.count = counts.get(kind) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (const [id, state] of this.rolling) if (state.seen !== this.frame) this.rolling.delete(id);
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const item of this.disposables) item.dispose();
    for (const mesh of this.meshes.values()) mesh.dispose();
  }
}
