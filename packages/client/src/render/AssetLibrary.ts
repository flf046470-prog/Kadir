import * as THREE from 'three';

export interface ModelRef {
  /** URL of a .glb/.gltf file, relative to the client's public root. */
  url: string;
  scale?: number;
  /** Y offset applied after loading, so a model authored at any origin lines up with the rig. */
  offsetY?: number;
  /** Node names inside the model to use as cosmetic sockets. */
  sockets?: Partial<Record<'head' | 'face' | 'back' | 'tail' | 'handL' | 'handR', string>>;
}

/**
 * Optional art-asset layer.
 *
 * The game ships fully playable with procedural geometry; this loader lets an art pack be
 * dropped in later without touching gameplay. Rules that keep that safe:
 *
 *  - Models are **visual only**. Collision, grips and hitboxes come from level/player data, so
 *    a model swap can never change the balance of a match.
 *  - Loading is best-effort: a missing or broken file logs once and falls back to the
 *    procedural avatar rather than breaking the session.
 *  - GLTFLoader is imported dynamically, so builds with no art pack never pay for it.
 *
 * Licensing note: anything served here is downloadable by players. Prefer CC0 sources
 * (Quaternius, Kenney, Poly Pizza) for a web build; asset-store EULAs often restrict
 * redistribution of raw asset files. See docs/ASSETS.md.
 */
export class AssetLibrary {
  private cache = new Map<string, Promise<THREE.Object3D | null>>();
  private loader: unknown = null;
  private warned = new Set<string>();

  constructor(private readonly enabled = true) {}

  /** Returns a fresh clone of the model, or null when unavailable. */
  async load(ref: ModelRef): Promise<THREE.Object3D | null> {
    if (!this.enabled) return null;
    let entry = this.cache.get(ref.url);
    if (!entry) {
      entry = this.loadOnce(ref);
      this.cache.set(ref.url, entry);
    }
    const source = await entry;
    if (!source) return null;

    const clone = source.clone(true);
    if (ref.scale && ref.scale !== 1) clone.scale.setScalar(ref.scale);
    if (ref.offsetY) clone.position.y += ref.offsetY;
    return clone;
  }

  private async loadOnce(ref: ModelRef): Promise<THREE.Object3D | null> {
    try {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      this.loader ??= new GLTFLoader();
      const loader = this.loader as InstanceType<typeof GLTFLoader>;
      const gltf = await loader.loadAsync(ref.url);
      const scene = gltf.scene;
      scene.traverse((node) => {
        if ((node as THREE.Mesh).isMesh) {
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });
      return scene;
    } catch (error) {
      if (!this.warned.has(ref.url)) {
        this.warned.add(ref.url);
        console.warn(`[assets] falling back to procedural geometry for ${ref.url}:`, (error as Error).message);
      }
      return null;
    }
  }

  /** Look up a socket node by name, for attaching cosmetics to an authored model. */
  static findSocket(root: THREE.Object3D, name: string | undefined): THREE.Object3D | null {
    if (!name) return null;
    return root.getObjectByName(name) ?? null;
  }

  dispose(): void {
    this.cache.clear();
  }
}
