import * as THREE from 'three';
import type { Collider, LevelDef, PropInstance, SurfaceMaterial } from '@kc/core';
import type { PerformanceProfile } from '../platform/Platform.js';
import type { AssetLibrary } from './AssetLibrary.js';

/**
 * Which authored model stands in for which prop kind, and how many variants it has.
 *
 * `palm` and `tree` share a model deliberately — the jungle needs two silhouettes far less than
 * it needs four different trees, and the variant picker already gives it those. `torch` has no
 * model and keeps its procedural shape, which is the point of the table: a kind missing from here
 * is not broken, it is simply still procedural.
 */
const MODEL_PROPS: Record<string, { base: string; variants: number }> = {
  rock: { base: 'rock', variants: 4 },
  boulder: { base: 'boulder-tall', variants: 2 },
  log: { base: 'log', variants: 3 },
  bush: { base: 'bush', variants: 4 },
  flower: { base: 'flower', variants: 3 },
  mushroom: { base: 'mushroom', variants: 3 },
  tree: { base: 'tree', variants: 4 },
  palm: { base: 'tree', variants: 4 },
  vine: { base: 'vine', variants: 3 },
  stalagmite: { base: 'stalagmite', variants: 3 },
  crystal: { base: 'crystal', variants: 3 },
  banner: { base: 'banner', variants: 2 },
};

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

  /** Instanced meshes built from procedural geometry, replaced if authored models arrive. */
  private proceduralProps: THREE.InstancedMesh[] = [];
  private disposed = false;

  constructor(
    private readonly level: LevelDef,
    private readonly profile: PerformanceProfile,
    private readonly assets?: AssetLibrary,
  ) {
    this.buildBackdrop();
    this.buildColliders();
    this.buildProps();
    this.buildCheckpoints();
    if (this.assets) void this.upgradeProps(this.assets);
  }

  /**
   * Distant ground, far outside the play area, so the world does not end in mid-air.
   *
   * The level is a set of floor slabs with nothing underneath them, and at 0.0075 fog density the
   * edge is only about 40% hazed at the distance a player reaches it — so walking to the boundary
   * and looking out showed sky *below* the ground as well as above it, and the whole map read as
   * a slab floating in blue. Caught in a screenshot, not in code: it is invisible from anywhere
   * near the middle of the map and unmissable from the rim.
   *
   * Purely decorative. No collider, no entry in the `LevelDef`, nothing the simulation can see —
   * so it cannot change where anyone can stand, and client and server still build the same world.
   *
   * Placed below the lowest floor rather than level with the ground: the slabs then read as a
   * plateau standing above a plain, which is a landscape, instead of a sheet lying on another
   * sheet, which is a seam.
   */
  private buildBackdrop(): void {
    let lowest = 0;
    for (const collider of this.level.colliders) {
      const bottom = collider.kind === 'box' ? collider.center.y - collider.half.y : collider.center.y;
      lowest = Math.min(lowest, bottom);
    }

    // Wide enough that its own edge is beyond the fog: at this density anything past ~250 m is
    // fully hazed into the sky colour, so the plain has no visible end of its own.
    const geometry = new THREE.PlaneGeometry(1400, 1400);
    const material = new THREE.MeshLambertMaterial({ color: 0x5a6b45 });
    const plane = new THREE.Mesh(geometry, material);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = lowest - 14;
    // Never casts or receives: it is scenery at a distance, and shadowing a 1400 m plane would
    // cost the whole shadow map's resolution for something nobody stands on.
    plane.castShadow = false;
    plane.receiveShadow = false;
    // Drawn first, so it can never z-fight its way in front of real geometry.
    plane.renderOrder = -1;
    this.disposables.push(geometry, material);
    this.group.add(plane);
  }

  /**
   * Swap the procedural prop shapes for the authored models, once they have downloaded.
   *
   * Late and optional, for the same reason the avatars upgrade late: the world must be standing
   * the instant a match starts, and a cone is a better tree than an empty clearing while a few
   * hundred kilobytes are in flight. If a file is missing the cone simply stays.
   *
   * Each kind becomes one instanced mesh *per variant*, with the instances dealt out between
   * them. Four rocks drawn two hundred times each is four draw calls; the same two hundred rocks
   * all identical is one draw call and a world that looks stamped out — and the repetition is far
   * more noticeable than any single model's quality.
   */
  private async upgradeProps(assets: AssetLibrary): Promise<void> {
    const byKind = this.propsByKind();
    const built: THREE.InstancedMesh[] = [];

    for (const [kind, props] of byKind) {
      const model = MODEL_PROPS[kind];
      if (!model) continue;

      const variants = await Promise.all(
        Array.from({ length: model.variants }, (_, i) => assets.loadGeometry(`/models/props/${model.base}-${i + 1}.glb`)),
      );
      const usable = variants.filter((g): g is THREE.BufferGeometry => g !== null);
      if (usable.length === 0) continue;
      // The renderer can be torn down while a download is in flight — a player leaving a match is
      // the common case — and adding meshes to a disposed group leaks every one of them.
      if (this.disposed) return;

      const budget = Math.min(props.length, this.profile.foliageBudget);
      // Vertex colours carry the two-tone baked in by the Blender pass, so the material is white
      // and does the multiplying. No `instanceColor` here: it would multiply again and tint the
      // moss along with the stone.
      //
      // `flatShading` is load-bearing, not a style choice. The prop files deliberately ship
      // without a normal attribute — glTF requires a renderer to compute flat normals when it is
      // absent, which is what makes them a third of the size. `GLTFLoader` sets this flag itself
      // for exactly that case, but this material is built here rather than by the loader, so
      // nothing had set it: the shader got no normals, Lambert returned no diffuse light, and
      // every bush and fern in the world rendered solid black.
      const material = new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xffffff, flatShading: true });
      this.disposables.push(material);

      const perVariant: PropInstance[][] = usable.map(() => []);
      for (let i = 0; i < budget; i++) {
        const prop = props[i] as PropInstance;
        (perVariant[i % usable.length] as PropInstance[]).push(prop);
      }

      const matrix = new THREE.Matrix4();
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      const up = new THREE.Vector3(0, 1, 0);

      for (let v = 0; v < usable.length; v++) {
        const list = perVariant[v] as PropInstance[];
        if (list.length === 0) continue;
        const mesh = new THREE.InstancedMesh(usable[v] as THREE.BufferGeometry, material, list.length);
        mesh.castShadow = this.profile.shadows && kind !== 'flower' && kind !== 'bush';
        mesh.receiveShadow = true;
        for (let i = 0; i < list.length; i++) {
          const prop = list[i] as PropInstance;
          position.set(prop.position.x, prop.position.y, prop.position.z);
          quaternion.setFromAxisAngle(up, prop.yaw);
          scale.setScalar(prop.scale);
          matrix.compose(position, quaternion, scale);
          mesh.setMatrixAt(i, matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        this.group.add(mesh);
        built.push(mesh);
      }

      // Only now is the procedural version redundant. Removing it earlier would blink the world
      // empty for however long the download took.
      for (const mesh of this.proceduralProps) {
        if (mesh.userData.kind !== kind) continue;
        mesh.removeFromParent();
        mesh.dispose();
        this.instanced = this.instanced.filter((m) => m !== mesh);
      }
      this.proceduralProps = this.proceduralProps.filter((m) => m.userData.kind !== kind);
    }

    this.instanced.push(...built);
  }

  private propsByKind(): Map<string, PropInstance[]> {
    const byKind = new Map<string, PropInstance[]>();
    for (const prop of this.level.props) {
      const list = byKind.get(prop.kind) ?? [];
      list.push(prop);
      byKind.set(prop.kind, list);
    }
    return byKind;
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
    const byKind = this.propsByKind();

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
      // Tagged so `upgradeProps` can retire exactly the kind it replaced, and no other.
      mesh.userData.kind = kind;
      this.group.add(mesh);
      this.instanced.push(mesh);
      this.proceduralProps.push(mesh);
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
    // Read by `upgradeProps`, which can still be awaiting a download when a player leaves.
    this.disposed = true;
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
