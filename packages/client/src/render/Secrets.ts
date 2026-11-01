import * as THREE from 'three';
import { secretKey } from '@kc/core';
import type { LevelDef, SecretDef } from '@kc/core';
import type { AssetLibrary } from './AssetLibrary.js';

/** The Blender model (`tools/blender/boomerang.py`): a blade lying flat in XZ, elbow at the origin. */
export const BOOMERANG_URL = '/models/props/boomerang.glb';
/** Turns a second about the vertical. Slow enough to read the shape, quick enough to catch an eye. */
const SPIN = 1.6;
const BOB = 0.12;
const TILT = 0.45;

interface Item {
  def: SecretDef;
  node: THREE.Group;
  phase: number;
}

/**
 * The golden boomerangs of the loaded map (`LevelDef.secrets`), spinning over their perches.
 *
 * Only this client's own finds are hidden: which ones *you* have found is the whole point, and the
 * list lives on your profile (`PlayerProfile.secretsFound`, keyed `<levelId>:<id>`). Everybody else
 * still sees one you have taken, because they have not.
 *
 * Until the model arrives, and in a build with no art, each is drawn as two gold bars in a V, so a
 * boomerang is never invisible on a perch somebody climbed sixteen metres to reach.
 */
export class SecretsView {
  readonly group = new THREE.Group();
  private readonly items: Item[] = [];
  private readonly gold = new THREE.MeshStandardMaterial({ color: 0xf2b632, metalness: 1, roughness: 0.3, emissive: 0x3a2600 });
  private readonly barGeometry = new THREE.BoxGeometry(0.42, 0.035, 0.1);
  private disposed = false;

  constructor(
    level: LevelDef,
    assets: AssetLibrary | null,
    found: ReadonlySet<string> = new Set(),
  ) {
    (level.secrets ?? []).forEach((def, i) => {
      const node = new THREE.Group();
      node.name = `secret:${def.id}`;
      node.position.set(def.position.x, def.position.y, def.position.z);
      node.add(this.fallback());
      node.visible = !found.has(secretKey(level.id, def.id));
      this.group.add(node);
      this.items.push({ def, node, phase: i * 2.1 });
    });
    if (assets && this.items.length > 0) void this.upgrade(assets);
  }

  /** How many are on screen: what a test, or a curious player, can count. */
  get visibleCount(): number {
    return this.items.filter((item) => item.node.visible).length;
  }

  /** This client found one: it is gone from their world for good. */
  markFound(id: string): void {
    for (const item of this.items) if (item.def.id === id) item.node.visible = false;
  }

  animate(time: number): void {
    for (const item of this.items) {
      if (!item.node.visible) continue;
      const t = time + item.phase;
      item.node.rotation.set(TILT * Math.sin(t * 0.7), t * SPIN, 0);
      item.node.position.y = item.def.position.y + Math.sin(t * 1.9) * BOB;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.group.removeFromParent();
    this.barGeometry.dispose();
    this.gold.dispose();
  }

  private fallback(): THREE.Object3D {
    const v = new THREE.Group();
    for (const side of [-1, 1]) {
      const bar = new THREE.Mesh(this.barGeometry, this.gold);
      bar.position.set(side * 0.16, 0, -0.12);
      bar.rotation.y = side * 0.6;
      v.add(bar);
    }
    return v;
  }

  private async upgrade(assets: AssetLibrary): Promise<void> {
    const models = await Promise.all(this.items.map(() => assets.load({ url: BOOMERANG_URL })));
    if (this.disposed) return;
    models.forEach((model, i) => {
      const item = this.items[i];
      if (!model || !item) return;
      // Centred on its bounds, so it spins about its middle rather than about the elbow.
      const box = new THREE.Box3().setFromObject(model.scene);
      model.scene.position.sub(box.getCenter(new THREE.Vector3()));
      item.node.clear();
      item.node.add(model.scene);
    });
  }
}
