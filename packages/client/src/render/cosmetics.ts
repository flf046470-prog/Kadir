import type { CosmeticDef } from '@kc/core';
import * as THREE from 'three';

/**
 * Meshes for equipped cosmetics, one recipe per `visual.shape`.
 *
 * This used to be a switch on the *slot* inside `Avatar`, which read `visual.shape` for hats and
 * nothing else. Measured against the catalog: seventeen visual cosmetics rendered as **nine**
 * distinct meshes — both masks were one box, both glasses one pair of discs, both packs one box,
 * both tails one capsule, both gloves one sphere, and both effects *and* both trails the same
 * static torus lying flat at the hips. A player who earned the epic Rainbow Trail got the ring the
 * common Dust Trail draws, standing still. And the gloves leaked: they were added to the hand
 * objects while the group `setCosmetics` removed on the next equip was an empty placeholder, so
 * unequipping left them on and three swaps stacked five gloves on each hand.
 *
 * So each shape is a recipe, each build returns every geometry and material it made, and the
 * avatar gives them back on the next equip. Trails are trails: they record where the avatar has
 * been, in world space, and draw behind it only while it is moving. Effects move.
 *
 * Pure three.js, no renderer: `cosmetics.test.ts` builds every catalog item under Node.
 */

/** What one frame of the wearer looks like, for cosmetics that move. */
export interface CosmeticFrame {
  /** Seconds since the avatar was created — a clock, not a delta. */
  time: number;
  dt: number;
  /** The avatar's feet, in world space, this frame. */
  origin: THREE.Vector3;
  /** Horizontal speed, m/s. */
  speed: number;
  grounded: boolean;
}

/** One equipped cosmetic: where it hangs, what it animates, and everything it must give back. */
export interface CosmeticBuild {
  /** Hung on the slot's socket. */
  node: THREE.Object3D;
  /** One per hand, for items worn on the hands rather than on a socket. */
  handNodes: THREE.Object3D[];
  animate?: (frame: CosmeticFrame) => void;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
}

type Recipe = (kit: Kit, colors: Colors, hands: number) => Pick<CosmeticBuild, 'node' | 'handNodes' | 'animate'>;

interface Colors {
  main: number;
  accent: number;
}

class Kit {
  readonly geometries: THREE.BufferGeometry[] = [];
  readonly materials: THREE.Material[] = [];

  geo<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  mat(color: number, options: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.7, metalness: 0, ...options });
    this.materials.push(material);
    return material;
  }

  basic(options: THREE.MeshBasicMaterialParameters): THREE.MeshBasicMaterial {
    const material = new THREE.MeshBasicMaterial(options);
    this.materials.push(material);
    return material;
  }

  mesh(geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    return mesh;
  }
}

/** Darker or lighter than `color` by `amount` (−1..1), for an accent the catalog does not give. */
export function shade(color: number, amount: number): number {
  const c = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, THREE.MathUtils.clamp(hsl.l + amount, 0, 1));
  return c.getHex();
}

function star(outer: number, inner: number, points = 5): THREE.Shape {
  const shape = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

function leafShape(length: number, width: number): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(width, length * 0.5, 0, length);
  shape.quadraticCurveTo(-width, length * 0.5, 0, 0);
  return shape;
}

// ---------------------------------------------------------------------------------------------
// Trails: world-space history, drawn in the node's own frame every tick.
// ---------------------------------------------------------------------------------------------

/** Recent positions of the wearer's feet, oldest first, each with its age in seconds. */
export class TrailHistory {
  readonly points: { position: THREE.Vector3; age: number }[] = [];

  constructor(
    private readonly capacity: number,
    private readonly spacing: number,
    private readonly lifetime: number,
  ) {}

  /** Age every point, drop the expired, and record `origin` if it has moved far enough. */
  step(origin: THREE.Vector3, dt: number, emitting: boolean): void {
    for (const point of this.points) point.age += dt;
    while (this.points.length > 0 && (this.points[0] as { age: number }).age > this.lifetime) this.points.shift();
    if (!emitting) return;
    const newest = this.points[this.points.length - 1];
    if (newest && newest.position.distanceTo(origin) < this.spacing) return;
    this.points.push({ position: origin.clone(), age: 0 });
    if (this.points.length > this.capacity) this.points.shift();
  }
}

/** Put a world-space point into `node`'s local frame. */
function toLocal(node: THREE.Object3D, world: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  return node.worldToLocal(out.copy(world));
}

const RAINBOW = [0xef4444, 0xf97316, 0xfacc15, 0x22c55e, 0x3b82f6, 0x8b5cf6];

// ---------------------------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------------------------

const RECIPES: Record<string, Recipe> = {
  // --- hats: the head socket sits on the crown, oriented with the body (+Y up, +Z forward) ---
  leaf: (kit, c) => {
    const node = new THREE.Group();
    const leaf = kit.mesh(kit.geo(new THREE.SphereGeometry(0.5, 8, 4)), kit.mat(c.main), 0, 0.05, 0);
    leaf.scale.set(0.34, 0.07, 0.22);
    leaf.rotation.z = 0.25;
    const stem = kit.mesh(kit.geo(new THREE.CylinderGeometry(0.012, 0.018, 0.12, 5)), kit.mat(c.accent), 0.02, 0.12, -0.02);
    stem.rotation.z = -0.5;
    node.add(leaf, stem);
    return { node, handNodes: [] };
  },
  brim: (kit, c) => {
    const node = new THREE.Group();
    const felt = kit.mat(c.main);
    node.add(
      kit.mesh(kit.geo(new THREE.CylinderGeometry(0.27, 0.27, 0.025, 14)), felt, 0, 0.01, 0),
      kit.mesh(kit.geo(new THREE.CylinderGeometry(0.13, 0.15, 0.15, 12)), felt, 0, 0.09, 0),
      kit.mesh(kit.geo(new THREE.CylinderGeometry(0.152, 0.152, 0.035, 12)), kit.mat(c.accent), 0, 0.04, 0),
    );
    return { node, handNodes: [] };
  },
  crown: (kit, c) => {
    const node = new THREE.Group();
    const gold = kit.mat(c.main, { roughness: 0.35, metalness: 0.6 });
    node.add(kit.mesh(kit.geo(new THREE.CylinderGeometry(0.16, 0.17, 0.08, 10, 1, true)), gold, 0, 0.04, 0));
    const point = kit.geo(new THREE.ConeGeometry(0.035, 0.1, 4));
    const gem = kit.geo(new THREE.OctahedronGeometry(0.025));
    const gemMat = kit.mat(c.accent, { emissive: c.accent, emissiveIntensity: 0.4 });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      node.add(kit.mesh(point, gold, Math.sin(a) * 0.16, 0.13, Math.cos(a) * 0.16));
      node.add(kit.mesh(gem, gemMat, Math.sin(a) * 0.172, 0.04, Math.cos(a) * 0.172));
    }
    return { node, handNodes: [] };
  },

  // --- face: the face socket is on the front of the head, +Z pointing out of the face ---
  tribal: (kit, c) => {
    const node = new THREE.Group();
    const plate = kit.mesh(kit.geo(new THREE.CylinderGeometry(0.15, 0.12, 0.04, 6)), kit.mat(c.main), 0, 0, 0.03);
    plate.rotation.x = Math.PI / 2;
    plate.scale.set(1, 1, 1.25);
    node.add(plate);
    const socket = kit.geo(new THREE.CircleGeometry(0.035, 6));
    const dark = kit.mat(0x111111);
    for (const side of [-1, 1]) node.add(kit.mesh(socket, dark, side * 0.06, 0.03, 0.052));
    const stripe = kit.geo(new THREE.BoxGeometry(0.02, 0.1, 0.01));
    const paint = kit.mat(c.accent);
    for (const x of [-0.07, 0, 0.07]) node.add(kit.mesh(stripe, paint, x, -0.06, 0.052));
    return { node, handNodes: [] };
  },
  band: (kit, c) => {
    const node = new THREE.Group();
    const cloth = kit.mat(c.main, { side: THREE.DoubleSide });
    // A band round the head at eye level, open at the eyes, knotted at the back.
    const band = kit.mesh(kit.geo(new THREE.CylinderGeometry(0.2, 0.2, 0.07, 16, 1, true)), cloth, 0, 0.02, -0.16);
    node.add(band);
    const tail = kit.geo(new THREE.BoxGeometry(0.04, 0.14, 0.01));
    for (const side of [-1, 1]) {
      const end = kit.mesh(tail, cloth, side * 0.04, -0.04, -0.37);
      end.rotation.z = side * 0.35;
      node.add(end);
    }
    const hole = kit.geo(new THREE.CircleGeometry(0.03, 8));
    const white = kit.mat(0xf5f5f5);
    for (const side of [-1, 1]) node.add(kit.mesh(hole, white, side * 0.08, 0.03, 0.04));
    return { node, handNodes: [] };
  },
  round: (kit, c) => {
    const node = new THREE.Group();
    const frame = kit.mat(c.accent === c.main ? 0x2a2a2a : c.accent, { roughness: 0.4, metalness: 0.3 });
    const rim = kit.geo(new THREE.TorusGeometry(0.065, 0.012, 5, 14));
    const lens = kit.geo(new THREE.CircleGeometry(0.063, 14));
    const tint = kit.mat(c.main, { roughness: 0.15, transparent: true, opacity: 0.85 });
    for (const side of [-1, 1]) {
      node.add(kit.mesh(rim, frame, side * 0.09, 0.04, 0.03));
      node.add(kit.mesh(lens, tint, side * 0.09, 0.04, 0.028));
    }
    const bridge = kit.mesh(kit.geo(new THREE.CylinderGeometry(0.008, 0.008, 0.05, 4)), frame, 0, 0.05, 0.03);
    bridge.rotation.z = Math.PI / 2;
    node.add(bridge);
    return { node, handNodes: [] };
  },
  star: (kit, c) => {
    const node = new THREE.Group();
    const shape = kit.geo(new THREE.ExtrudeGeometry(star(0.085, 0.04), { depth: 0.015, bevelEnabled: false }));
    const pink = kit.mat(c.main, { roughness: 0.3, emissive: c.main, emissiveIntensity: 0.15 });
    for (const side of [-1, 1]) node.add(kit.mesh(shape, pink, side * 0.095, 0.04, 0.02));
    const bridge = kit.mesh(kit.geo(new THREE.BoxGeometry(0.04, 0.012, 0.012)), kit.mat(c.accent), 0, 0.055, 0.03);
    node.add(bridge);
    return { node, handNodes: [] };
  },

  // --- packs: the back socket is on the back surface, +Z pointing into the body ---
  vine: (kit, c) => {
    const node = new THREE.Group();
    const sack = kit.mesh(kit.geo(new THREE.SphereGeometry(0.5, 9, 7)), kit.mat(shade(c.main, -0.12)), 0, -0.02, -0.1);
    sack.scale.set(0.3, 0.34, 0.2);
    node.add(sack);
    const vine = kit.mat(c.main);
    const wrap = kit.geo(new THREE.TorusGeometry(0.155, 0.014, 4, 16));
    for (const [y, tilt] of [[0.06, 0.3], [-0.08, -0.25]] as const) {
      const ring = kit.mesh(wrap, vine, 0, y, -0.1);
      ring.rotation.set(Math.PI / 2, tilt, 0);
      ring.scale.set(1, 0.68, 1);
      node.add(ring);
    }
    const leaf = kit.geo(new THREE.ShapeGeometry(leafShape(0.12, 0.05)));
    const leafMat = kit.mat(shade(c.main, 0.12), { side: THREE.DoubleSide });
    for (const [x, y, r] of [[0.12, 0.12, -0.6], [-0.1, -0.1, 2.4], [0.02, 0.17, 0.2]] as const) {
      const l = kit.mesh(leaf, leafMat, x, y, -0.2);
      l.rotation.z = r;
      node.add(l);
    }
    return { node, handNodes: [] };
  },
  jet: (kit, c) => {
    const node = new THREE.Group();
    const tank = kit.geo(new THREE.CapsuleGeometry(0.065, 0.2, 3, 8));
    const shell = kit.mat(c.main, { roughness: 0.35, metalness: 0.4 });
    const nozzle = kit.geo(new THREE.CylinderGeometry(0.04, 0.06, 0.07, 8));
    const steel = kit.mat(0x9ca3af, { roughness: 0.3, metalness: 0.7 });
    const flame = kit.geo(new THREE.ConeGeometry(0.045, 0.16, 7));
    const fire = kit.basic({ color: 0xfb923c, transparent: true, opacity: 0.85 });
    const flames: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
      node.add(kit.mesh(tank, shell, side * 0.08, 0.02, -0.1));
      node.add(kit.mesh(nozzle, steel, side * 0.08, -0.2, -0.1));
      const f = kit.mesh(flame, fire, side * 0.08, -0.31, -0.1);
      f.rotation.x = Math.PI;
      flames.push(f);
      node.add(f);
    }
    node.add(kit.mesh(kit.geo(new THREE.BoxGeometry(0.1, 0.18, 0.05)), kit.mat(c.accent), 0, 0.02, -0.05));
    return {
      node,
      handNodes: [],
      // A toy: the flame flickers, and flares while the wearer is in the air.
      animate: ({ time, grounded }) => {
        for (let i = 0; i < flames.length; i++) {
          const f = flames[i] as THREE.Mesh;
          const flicker = 0.8 + 0.2 * Math.sin(time * 31 + i * 2.1);
          const length = (grounded ? 0.55 : 1.25) * flicker;
          f.scale.set(1, length, 1);
          f.position.y = -0.23 - 0.08 * length;
        }
      },
    };
  },

  // --- tails: the tail socket keeps the tail bone's frame, +Y running down the tail ---
  //
  // A sleeve over the animal's own tail, wider than it at the root. The first version was a
  // 0.1 m-radius tube, and a kangaroo's tail is 0.12 m in radius where the socket sits: rendered,
  // both tail cosmetics were entirely inside the tail of the game's default animal.
  stripe: (kit, c) => {
    const node = new THREE.Group();
    const a = kit.mat(c.main);
    const b = kit.mat(c.accent === c.main ? 0x1f1f1f : c.accent);
    const rings = 6;
    for (let i = 0; i < rings; i++) {
      const r0 = 0.155 - i * 0.017;
      const r1 = 0.155 - (i + 1) * 0.017;
      node.add(kit.mesh(kit.geo(new THREE.CylinderGeometry(r1, r0, 0.095, 9)), i % 2 === 0 ? a : b, 0, 0.02 + i * 0.095, 0));
    }
    return { node, handNodes: [] };
  },
  glow: (kit, c) => {
    const node = new THREE.Group();
    const glow = kit.mat(c.main, { emissive: c.main, emissiveIntensity: 1.1, roughness: 0.3 });
    node.add(kit.mesh(kit.geo(new THREE.ConeGeometry(0.15, 0.58, 10)), glow, 0, 0.27, 0));
    const orb = kit.mesh(kit.geo(new THREE.IcosahedronGeometry(0.09, 1)), glow, 0, 0.6, 0);
    node.add(orb);
    return {
      node,
      handNodes: [],
      animate: ({ time }) => {
        glow.emissiveIntensity = 0.8 + 0.5 * (0.5 + 0.5 * Math.sin(time * 3.2));
        const s = 1 + 0.12 * Math.sin(time * 3.2);
        orb.scale.set(s, s, s);
      },
    };
  },

  // --- hands: one object per hand, the hand's own origin is the fist ---
  gloves: (kit, c, hands) => {
    const palm = kit.geo(new THREE.SphereGeometry(0.1, 8, 6));
    const cuff = kit.geo(new THREE.TorusGeometry(0.075, 0.022, 5, 12));
    const leather = kit.mat(c.main);
    const trim = kit.mat(c.accent);
    const handNodes: THREE.Object3D[] = [];
    for (let i = 0; i < hands; i++) {
      const glove = new THREE.Group();
      const p = kit.mesh(palm, leather);
      p.scale.set(1, 0.85, 1.1);
      const ring = kit.mesh(cuff, trim, 0, 0, -0.08);
      glove.add(p, ring);
      handNodes.push(glove);
    }
    return { node: new THREE.Group(), handNodes };
  },
  boxing: (kit, c, hands) => {
    const fist = kit.geo(new THREE.SphereGeometry(0.15, 10, 8));
    const thumb = kit.geo(new THREE.SphereGeometry(0.055, 6, 4));
    const cuff = kit.geo(new THREE.CylinderGeometry(0.09, 0.1, 0.1, 10));
    const red = kit.mat(c.main, { roughness: 0.4 });
    const white = kit.mat(0xf8fafc);
    const handNodes: THREE.Object3D[] = [];
    for (let i = 0; i < hands; i++) {
      const glove = new THREE.Group();
      const f = kit.mesh(fist, red, 0, 0, 0.02);
      f.scale.set(1, 0.9, 1.15);
      const side = i === 0 ? 1 : -1;
      glove.add(f, kit.mesh(thumb, red, side * 0.1, 0.03, 0.06));
      const c2 = kit.mesh(cuff, white, 0, 0, -0.13);
      c2.rotation.x = Math.PI / 2;
      glove.add(c2);
      handNodes.push(glove);
    }
    return { node: new THREE.Group(), handNodes };
  },

  // --- effects: hung on the back socket, centred on the body a little in front of it ---
  sparkle: (kit, c) => {
    const node = new THREE.Group();
    // Big enough to read at play distance: at 0.035 m they were specks in a render from six metres.
    const spark = kit.geo(new THREE.OctahedronGeometry(0.065));
    const light = kit.basic({ color: c.main });
    const sparks: THREE.Mesh[] = [];
    for (let i = 0; i < 14; i++) {
      const s = kit.mesh(spark, light);
      sparks.push(s);
      node.add(s);
    }
    return {
      node,
      handNodes: [],
      animate: ({ time }) => {
        for (let i = 0; i < sparks.length; i++) {
          const s = sparks[i] as THREE.Mesh;
          const a = time * 1.1 + (i / sparks.length) * Math.PI * 2;
          const y = -0.55 + ((i * 0.37 + time * 0.35) % 1) * 1.1;
          s.position.set(Math.sin(a) * 0.5, y, 0.18 + Math.cos(a) * 0.5);
          const twinkle = Math.max(0.05, Math.sin(time * 7 + i * 1.7));
          s.scale.setScalar(twinkle);
          s.rotation.y = time * 3 + i;
        }
      },
    };
  },
  leaves: (kit, c) => {
    const node = new THREE.Group();
    const shape = kit.geo(new THREE.ShapeGeometry(leafShape(0.19, 0.075)));
    const greens = [kit.mat(c.main, { side: THREE.DoubleSide }), kit.mat(shade(c.main, -0.15), { side: THREE.DoubleSide })];
    const leaves: THREE.Mesh[] = [];
    for (let i = 0; i < 8; i++) {
      const l = kit.mesh(shape, greens[i % 2] as THREE.Material);
      leaves.push(l);
      node.add(l);
    }
    return {
      node,
      handNodes: [],
      // A swirl rising round the body and falling back, each leaf tumbling on its own axis.
      animate: ({ time }) => {
        for (let i = 0; i < leaves.length; i++) {
          const l = leaves[i] as THREE.Mesh;
          const a = -time * 1.6 + (i / leaves.length) * Math.PI * 2;
          const r = 0.48 + 0.08 * Math.sin(time * 2 + i);
          l.position.set(Math.sin(a) * r, -0.4 + 0.45 * (0.5 + 0.5 * Math.sin(time * 1.3 + i * 0.8)), 0.18 + Math.cos(a) * r);
          l.rotation.set(time * 2.3 + i, a, time * 1.7 + i * 0.5);
        }
      },
    };
  },

  // --- trails: drawn where the wearer has been, and only while they are moving ---
  dust: (kit, c) => {
    const node = new THREE.Group();
    const history = new TrailHistory(14, 0.35, 0.7);
    const puff = kit.geo(new THREE.IcosahedronGeometry(0.12, 0));
    const puffs: THREE.Mesh[] = [];
    const materials: THREE.MeshBasicMaterial[] = [];
    for (let i = 0; i < 14; i++) {
      const m = kit.basic({ color: c.main, transparent: true, opacity: 0.6, depthWrite: false });
      const p = kit.mesh(puff, m);
      p.visible = false;
      p.frustumCulled = false;
      puffs.push(p);
      materials.push(m);
      node.add(p);
    }
    const local = new THREE.Vector3();
    return {
      node,
      handNodes: [],
      // Kicked up from the ground: nothing while airborne or standing still.
      animate: ({ origin, dt, speed, grounded }) => {
        history.step(origin, dt, grounded && speed > 1.5);
        node.updateWorldMatrix(true, false);
        for (let i = 0; i < puffs.length; i++) {
          const p = puffs[i] as THREE.Mesh;
          const point = history.points[i];
          if (!point) {
            p.visible = false;
            continue;
          }
          const life = point.age / 0.7;
          p.visible = true;
          toLocal(node, point.position, local);
          p.position.set(local.x, local.y + 0.06 + life * 0.18, local.z);
          p.scale.setScalar(0.5 + life * 1.1);
          (materials[i] as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - life);
        }
      },
    };
  },
  rainbow: (kit) => {
    const capacity = 24;
    const history = new TrailHistory(capacity, 0.18, 0.9);
    const geometry = kit.geo(new THREE.BufferGeometry());
    const positions = new Float32Array(capacity * 2 * 3);
    const colors = new Float32Array(capacity * 2 * 3);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const index: number[] = [];
    for (let i = 0; i < capacity - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geometry.setIndex(index);
    geometry.setDrawRange(0, 0);
    const ribbon = new THREE.Mesh(
      geometry,
      kit.basic({ vertexColors: true, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
    );
    // The vertices move every frame, so a bounding sphere computed once would cull it wrongly.
    ribbon.frustumCulled = false;
    const node = new THREE.Group();
    node.add(ribbon);
    const local = new THREE.Vector3();
    const color = new THREE.Color();
    return {
      node,
      handNodes: [],
      // A vertical ribbon at body height, banded through the spectrum from the newest point back,
      // tapering to nothing at the oldest. Runs in the air too — it is a rainbow, not dust.
      animate: ({ origin, dt, speed }) => {
        history.step(origin, dt, speed > 1.2);
        node.updateWorldMatrix(true, false);
        const count = history.points.length;
        for (let i = 0; i < count; i++) {
          const point = history.points[i] as { position: THREE.Vector3; age: number };
          toLocal(node, point.position, local);
          const fromNewest = count - 1 - i;
          const taper = Math.max(0, 1 - point.age / 0.9);
          const half = 0.2 * taper;
          const mid = 0.55;
          positions.set([local.x, local.y + mid - half, local.z, local.x, local.y + mid + half, local.z], i * 6);
          color.setHex(RAINBOW[fromNewest % RAINBOW.length] as number);
          colors.set([color.r, color.g, color.b, color.r, color.g, color.b], i * 6);
        }
        geometry.setDrawRange(0, Math.max(0, count - 1) * 6);
        (geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
        (geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
        ribbon.visible = count > 1;
      },
    };
  },
};

/** The recipe a slot falls back to for a shape this client has never heard of (a CDN item). */
const SLOT_FALLBACK: Record<string, string> = {
  hat: 'brim',
  mask: 'band',
  glasses: 'round',
  backpack: 'vine',
  tail: 'stripe',
  hands: 'gloves',
  effect: 'sparkle',
  trail: 'dust',
};

/** Whether `shape` has a recipe of its own, rather than borrowing its slot's fallback. */
export function hasRecipe(shape: string): boolean {
  return Object.prototype.hasOwnProperty.call(RECIPES, shape);
}

/**
 * Build one cosmetic for an avatar with `hands` hands. `null` for slots with nothing to draw
 * (emotes) and for a slot this client does not know.
 */
export function buildCosmetic(def: CosmeticDef, hands = 2): CosmeticBuild | null {
  const recipe = hasRecipe(def.visual.shape)
    ? RECIPES[def.visual.shape]
    : SLOT_FALLBACK[def.slot] !== undefined
      ? RECIPES[SLOT_FALLBACK[def.slot] as string]
      : undefined;
  if (!recipe) return null;
  const kit = new Kit();
  const colors: Colors = { main: def.visual.color, accent: def.visual.accent ?? shade(def.visual.color, -0.25) };
  const built = recipe(kit, colors, hands);
  const scale = def.visual.scale;
  if (scale !== undefined && Number.isFinite(scale) && scale > 0) {
    // The catalog's own size multiplier, clamped: a cosmetic is cosmetic, and a hat the size of
    // a car is a wall to hide behind.
    const s = THREE.MathUtils.clamp(scale, 0.5, 1.6);
    built.node.scale.multiplyScalar(s);
    for (const h of built.handNodes) h.scale.multiplyScalar(s);
  }
  return { ...built, geometries: kit.geometries, materials: kit.materials };
}

/** Detach a build from wherever it hangs and free everything it made. */
export function disposeCosmetic(build: CosmeticBuild): void {
  build.node.removeFromParent();
  for (const h of build.handNodes) h.removeFromParent();
  for (const g of build.geometries) g.dispose();
  for (const m of build.materials) m.dispose();
}
