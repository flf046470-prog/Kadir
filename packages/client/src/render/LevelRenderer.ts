import * as THREE from 'three';
import type { Collider, LevelDef, PropInstance, SurfaceMaterial } from '@kc/core';
import type { PerformanceProfile } from '../platform/Platform.js';

const MATERIAL_COLORS: Record<SurfaceMaterial, number> = {
  dirt: 0x6d5535,
  rock: 0x7b7f86,
  wood: 0x7a5230,
  foliage: 0x3f8f4a,
  water: 0x2f7fa8,
  metal: 0x9aa3ad,
  sand: 0xd8c48c,
  stone: 0x8c8f94,
};

const PROP_TINTS = [0x3f8f4a, 0x2f7a3c, 0x57a05a, 0x76b06a];

/**
 * Builds the visible world from a `LevelDef`.
 *
 * Static geometry is merged per material and props are drawn with `InstancedMesh`, so the whole
 * jungle costs a few dozen draw calls instead of a few thousand — the single most important
 * thing for holding frame rate on a phone or a Quest.
 */
export class LevelRenderer {
  readonly group = new THREE.Group();
  private disposables: (THREE.BufferGeometry | THREE.Material)[] = [];
  private instanced: THREE.InstancedMesh[] = [];
  private checkpointRings: THREE.Mesh[] = [];

  constructor(
    private readonly level: LevelDef,
    private readonly profile: PerformanceProfile,
  ) {
    this.buildColliders();
    this.buildProps();
    this.buildCheckpoints();
  }

  private material(material: SurfaceMaterial): THREE.Material {
    const color = MATERIAL_COLORS[material] ?? 0x888888;
    const isWater = material === 'water';
    const mat = new THREE.MeshLambertMaterial({
      color,
      transparent: isWater,
      opacity: isWater ? 0.72 : 1,
      flatShading: true,
    });
    this.disposables.push(mat);
    return mat;
  }

  /** One mesh per (material × shape), instanced across every collider that uses it. */
  private buildColliders(): void {
    const buckets = new Map<string, { collider: Collider; index: number }[]>();
    this.level.colliders.forEach((collider, index) => {
      const key = `${collider.kind}:${collider.surface.material}`;
      const list = buckets.get(key) ?? [];
      list.push({ collider, index });
      buckets.set(key, list);
    });

    const box = new THREE.BoxGeometry(1, 1, 1);
    const sphere = new THREE.IcosahedronGeometry(1, 1);
    const cylinder = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
    this.disposables.push(box, sphere, cylinder);

    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();

    for (const [key, list] of buckets) {
      const kind = key.split(':')[0] as Collider['kind'];
      const material = list[0]?.collider.surface.material ?? 'dirt';
      const geometry = kind === 'box' ? box : kind === 'sphere' ? sphere : cylinder;
      const mesh = new THREE.InstancedMesh(geometry, this.material(material), list.length);
      mesh.castShadow = this.profile.shadows;
      mesh.receiveShadow = true;

      list.forEach((entry, i) => {
        const collider = entry.collider;
        position.set(collider.center.x, collider.center.y, collider.center.z);
        quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), collider.kind === 'box' ? collider.yaw : 0);
        if (collider.kind === 'box') scale.set(collider.half.x * 2, collider.half.y * 2, collider.half.z * 2);
        else if (collider.kind === 'sphere') scale.setScalar(collider.radius);
        else scale.set(collider.radius, collider.halfHeight * 2, collider.radius);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(i, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.group.add(mesh);
      this.instanced.push(mesh);
    }
  }

  /** Decorative props: instanced, budgeted by quality tier, sorted so nearby ones survive culling. */
  private buildProps(): void {
    const byKind = new Map<string, PropInstance[]>();
    for (const prop of this.level.props) {
      const list = byKind.get(prop.kind) ?? [];
      list.push(prop);
      byKind.set(prop.kind, list);
    }

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);

    for (const [kind, props] of byKind) {
      const geometry = propGeometry(kind);
      if (!geometry) continue;
      this.disposables.push(geometry);
      const budget = Math.min(props.length, this.profile.foliageBudget);
      const material = new THREE.MeshLambertMaterial({ flatShading: true, vertexColors: false, color: 0xffffff });
      this.disposables.push(material);
      const mesh = new THREE.InstancedMesh(geometry, material, budget);
      mesh.castShadow = this.profile.shadows && kind !== 'flower' && kind !== 'bush';
      mesh.receiveShadow = true;
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(budget * 3), 3);

      const color = new THREE.Color();
      for (let i = 0; i < budget; i++) {
        const prop = props[i] as PropInstance;
        position.set(prop.position.x, prop.position.y, prop.position.z);
        quaternion.setFromAxisAngle(up, prop.yaw);
        scale.setScalar(prop.scale);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(i, matrix);
        color.setHex(propColor(kind, prop.tint));
        mesh.setColorAt(i, color);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.group.add(mesh);
      this.instanced.push(mesh);
    }
  }

  private buildCheckpoints(): void {
    const geometry = new THREE.TorusGeometry(1.6, 0.14, 6, 20);
    this.disposables.push(geometry);
    for (const checkpoint of this.level.checkpoints) {
      const material = new THREE.MeshBasicMaterial({
        color: checkpoint.finish ? 0xffd166 : 0x4cc9f0,
        transparent: true,
        opacity: 0.75,
      });
      this.disposables.push(material);
      const ring = new THREE.Mesh(geometry, material);
      ring.position.set(checkpoint.position.x, checkpoint.position.y + 1.6, checkpoint.position.z);
      ring.rotation.x = Math.PI / 2;
      ring.visible = false; // shown only in parkour
      this.group.add(ring);
      this.checkpointRings.push(ring);
    }
  }

  /** Parkour shows the route; other modes hide it so the map reads clean. */
  setCheckpointsVisible(visible: boolean, activeIndex = -1): void {
    this.checkpointRings.forEach((ring, index) => {
      ring.visible = visible;
      const material = ring.material as THREE.MeshBasicMaterial;
      material.opacity = index === activeIndex ? 0.95 : 0.35;
    });
  }

  animate(time: number): void {
    for (let i = 0; i < this.checkpointRings.length; i++) {
      const ring = this.checkpointRings[i] as THREE.Mesh;
      if (!ring.visible) continue;
      ring.rotation.z = time * 0.7 + i;
    }
  }

  dispose(): void {
    for (const mesh of this.instanced) mesh.dispose();
    for (const item of this.disposables) item.dispose();
    this.group.clear();
  }
}

function propGeometry(kind: string): THREE.BufferGeometry | null {
  switch (kind) {
    case 'tree':
      return new THREE.ConeGeometry(3.2, 9, 7, 1);
    case 'palm':
      return new THREE.ConeGeometry(2.4, 6, 5, 1);
    case 'bush':
      return new THREE.IcosahedronGeometry(0.9, 0);
    case 'flower':
      return new THREE.ConeGeometry(0.18, 0.55, 4, 1);
    case 'rock':
    case 'boulder':
      return new THREE.DodecahedronGeometry(1, 0);
    case 'mushroom':
      return new THREE.SphereGeometry(1, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.5);
    case 'log':
      return new THREE.CylinderGeometry(0.55, 0.55, 3.2, 6);
    case 'stalagmite':
      return new THREE.ConeGeometry(0.8, 3, 5, 1);
    case 'crystal':
      return new THREE.OctahedronGeometry(0.6, 0);
    case 'vine':
      return new THREE.CylinderGeometry(0.06, 0.06, 2.4, 4);
    case 'banner':
      return new THREE.PlaneGeometry(1.2, 1.8);
    case 'torch':
      return new THREE.CylinderGeometry(0.08, 0.08, 1.1, 4);
    default:
      return null;
  }
}

function propColor(kind: string, tint: number): number {
  switch (kind) {
    case 'tree':
    case 'palm':
    case 'bush':
      return PROP_TINTS[tint % PROP_TINTS.length] ?? 0x3f8f4a;
    case 'flower':
      return [0xff7ab6, 0xffd166, 0xf4978e, 0xa0e7e5][tint % 4] ?? 0xffd166;
    case 'rock':
    case 'boulder':
    case 'stalagmite':
      return 0x7b7f86;
    case 'mushroom':
      return 0xef476f;
    case 'crystal':
      return 0x6ee7ff;
    case 'log':
    case 'vine':
      return 0x7a5230;
    case 'banner':
      return [0xef476f, 0xffd166, 0x06d6a0][tint % 3] ?? 0xffd166;
    default:
      return 0xcccccc;
  }
}
