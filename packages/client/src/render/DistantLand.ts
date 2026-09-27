import * as THREE from 'three';
import type { LevelDef } from '@kc/core';

/**
 * The land beyond the map: a ring of hills, peaks or mesas standing behind the edge cliffs.
 *
 * Every map is a rectangle walled by `LevelBuilder.enclose`, and above those walls there used to be
 * nothing but sky — a pure-sky photograph has no ground in it — so each world read as a yard with a
 * fence round it rather than a place in a landscape. This draws the landscape: one mesh, vertex
 * coloured, no textures, no shadows, no colliders (nobody can reach it; the cliffs are in the way).
 *
 * Budget: `SEGMENTS × RINGS × 2` triangles (≈2.7k) in one draw call, which a headset draws twice.
 * The one real cost is the far plane, which has to reach it — see `reach`.
 */

const SEGMENTS = 112;
const RINGS = 12;
/** Metres from the map's corner to the ring's inner edge. */
const GAP = 20;
/** How far the land runs out from there. */
const DEPTH = 420;
/** Where across the ring (0 inner, 1 horizon) the land is highest. */
const PEAK_T = 0.45;
/**
 * The ring is fogged at a fraction of the scene's density. At the map's own density it vanished:
 * exp2 fog of 0.011 (the glacier) is 93 % opaque at 150 m, so hills past the walls came out as sky.
 * Distant land should read as hazy, not as absent — aerial perspective, not a curtain.
 */
export const DISTANT_LAND_FOG_SCALE = 0.35;

export interface DistantLandStyle {
  shape: 'hills' | 'peaks' | 'mesas';
  /** Tallest point, in metres above the map's floor. */
  height: number;
  low: number;
  mid: number;
  high: number;
}

/** Per map. Colours sit with each map's own palette (`MATERIAL_COLORS`) so the land matches the ground. */
export const DISTANT_LAND_STYLES: Readonly<Record<string, DistantLandStyle>> = {
  // Rolling forest: dark canopy, lighter ridges, bare rock only on the highest shoulders.
  'jungle-world': { shape: 'hills', height: 80, low: 0x2c4a28, mid: 0x3f6232, high: 0x6f7568 },
  // Grey rock under snow: the glacier sits in a basin of peaks.
  'glacier-world': { shape: 'peaks', height: 120, low: 0x4f5864, mid: 0x7d8792, high: 0xe4ecf2 },
  // Red mesas and buttes on a flat plain, the outback's one landform.
  'outback-station': { shape: 'mesas', height: 70, low: 0xb06437, mid: 0x8a5539, high: 0xc98a52 },
};

const FALLBACK: DistantLandStyle = DISTANT_LAND_STYLES['jungle-world'] as DistantLandStyle;

export interface DistantLandFrame {
  centreX: number;
  centreZ: number;
  floorY: number;
  inner: number;
  /**
   * The least peak height that clears the map's own walls, seen from its middle.
   *
   * The walls `enclose` builds are as tall as the tallest thing near them — 15 m on the outback,
   * 36 m round the jungle — and they hide everything below the angle they subtend. A fixed height
   * put the outback's mesas and the jungle's hills entirely behind them in a real game frame,
   * though both rendered fine on their own.
   */
  minPeak: number;
}

/** How far above the walls' angle the peaks should stand, seen from the middle of the map. */
const CLEARANCE_ANGLE = (10 * Math.PI) / 180;
const MAX_PEAK = 230;

/** Where the ring goes: round the map's bounding rectangle, on its floor. */
export function distantLandFrame(level: LevelDef): DistantLandFrame {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const c of level.colliders) {
    const hx = c.kind === 'box' ? Math.hypot(c.half.x, c.half.z) : c.radius;
    minX = Math.min(minX, c.center.x - hx);
    maxX = Math.max(maxX, c.center.x + hx);
    minZ = Math.min(minZ, c.center.z - hx);
    maxZ = Math.max(maxZ, c.center.z + hx);
  }
  if (!Number.isFinite(minX)) {
    minX = minZ = -50;
    maxX = maxZ = 50;
  }
  const ys = level.spawns.map((s) => s.position.y).sort((a, b) => a - b);
  const floorY = ys.length > 0 ? (ys[Math.floor(ys.length / 2)] as number) - 1 : 0;
  const centreX = (minX + maxX) / 2;
  const centreZ = (minZ + maxZ) / 2;
  const inner = Math.hypot(maxX - minX, maxZ - minZ) / 2 + GAP;
  // The steepest wall, as an angle above the horizon from the middle of the map. Edge cliffs when
  // the map has them; otherwise anything, so a hand-made map without `enclose` still gets land.
  const edges = level.colliders.filter((c) => c.zone === 'edge');
  let wallAngle = 0;
  for (const c of edges.length > 0 ? edges : level.colliders) {
    const top = c.center.y + (c.kind === 'box' ? c.half.y : c.kind === 'cylinder' ? c.halfHeight : c.radius) - floorY;
    const distance = Math.max(1, Math.hypot(c.center.x - centreX, c.center.z - centreZ));
    wallAngle = Math.max(wallAngle, Math.atan2(top, distance));
  }
  const peakRadius = inner + DEPTH * PEAK_T * PEAK_T;
  const minPeak = Math.min(MAX_PEAK, Math.tan(Math.min(1.3, wallAngle + CLEARANCE_ANGLE)) * peakRadius);
  return { centreX, centreZ, floorY, inner, minPeak };
}

/** Deterministic lattice noise in [0, 1], smooth, so the same map always has the same skyline. */
function lattice(x: number, y: number, seed: number): number {
  const hash = (ix: number, iy: number): number => {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0);
  const b = hash(x0 + 1, y0);
  const c = hash(x0, y0 + 1);
  const d = hash(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x: number, y: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < 4; o++) {
    sum += lattice(x * freq, y * freq, seed + o * 31) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum / norm;
}

function seedFor(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Height above the floor at a ring position: `t` 0 at the inner edge, 1 at the far horizon. */
export function distantLandHeight(style: DistantLandStyle, x: number, z: number, t: number, seed: number): number {
  // Low at the foot of the cliffs so the join hides behind them, highest a little under half way
  // out, easing off towards the horizon so the silhouette has depth rather than being one wall.
  // Peaking nearer made the glacier's range loom over the rink like a painted flat.
  const rise = Math.min(1, t / PEAK_T) ** 1.5 * (1 - 0.35 * Math.max(0, (t - 0.65) / 0.35));
  const n = fbm(x / 140, z / 140, seed);
  switch (style.shape) {
    case 'peaks': {
      const ridge = 1 - Math.abs(fbm(x / 90, z / 90, seed + 7) * 2 - 1);
      return style.height * rise * (0.25 + 0.75 * (0.5 * n + 0.5 * ridge ** 2));
    }
    case 'mesas': {
      // Flat tops and steep sides: the noise quantised into steps, softened just enough at the
      // treads that no triangle stands exactly vertical.
      // Thresholded low enough that buttes stand in most directions: at 1.6n − 0.45 the fbm's
      // narrow range left whole quarters of the horizon as bare plain.
      const v = Math.max(0, n * 2.2 - 0.62);
      const step = Math.floor(v * 3);
      const frac = v * 3 - step;
      const tread = Math.min(3, step + Math.min(1, Math.max(0, (frac - 0.8) / 0.2)));
      return style.height * rise * (tread / 3);
    }
    default:
      return style.height * rise * (0.35 + 0.65 * n);
  }
}

/** The ring mesh, coloured by height (and, for peaks, snow on what is high and not too steep). */
export function distantLandGeometry(frame: DistantLandFrame, style: DistantLandStyle, seed: number): THREE.BufferGeometry {
  const positions = new Float32Array(SEGMENTS * (RINGS + 1) * 3);
  const colours = new Float32Array(SEGMENTS * (RINGS + 1) * 3);
  const low = new THREE.Color(style.low);
  const mid = new THREE.Color(style.mid);
  const high = new THREE.Color(style.high);
  const c = new THREE.Color();
  for (let s = 0; s < SEGMENTS; s++) {
    const angle = (s / SEGMENTS) * Math.PI * 2;
    for (let r = 0; r <= RINGS; r++) {
      const t = r / RINGS;
      // Rings bunch up near the inner edge, where the land is closest and its shape is seen.
      const radius = frame.inner + DEPTH * t * t;
      const x = frame.centreX + Math.sin(angle) * radius;
      const z = frame.centreZ + Math.cos(angle) * radius;
      const h = distantLandHeight(style, x, z, t, seed);
      const i = (s * (RINGS + 1) + r) * 3;
      positions[i] = x;
      positions[i + 1] = frame.floorY + h;
      positions[i + 2] = z;
      const k = style.height > 0 ? h / style.height : 0;
      if (k < 0.45) c.copy(low).lerp(mid, k / 0.45);
      else c.copy(mid).lerp(high, Math.min(1, (k - 0.45) / 0.3));
      colours[i] = c.r;
      colours[i + 1] = c.g;
      colours[i + 2] = c.b;
    }
  }
  const index: number[] = [];
  for (let s = 0; s < SEGMENTS; s++) {
    const next = (s + 1) % SEGMENTS;
    for (let r = 0; r < RINGS; r++) {
      const a = s * (RINGS + 1) + r;
      const b = next * (RINGS + 1) + r;
      // Wound so the faces look inwards, at the map.
      index.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  // Snow does not lie on a cliff: steep faces show the rock under it, which is what gives a
  // snowfield its shape from a distance. All-white slopes read as a sheet of card.
  const normals = geometry.getAttribute('normal');
  for (let v = 0; v < normals.count; v++) {
    const steep = Math.min(1, Math.max(0, (0.82 - normals.getY(v)) / 0.2));
    if (steep <= 0) continue;
    c.setRGB(colours[v * 3] as number, colours[v * 3 + 1] as number, colours[v * 3 + 2] as number).lerp(mid, steep * 0.8);
    colours[v * 3] = c.r;
    colours[v * 3 + 1] = c.g;
    colours[v * 3 + 2] = c.b;
  }
  geometry.computeBoundingSphere();
  return geometry;
}

export class DistantLand {
  readonly mesh: THREE.Mesh;
  /** How far the camera must see to show the whole ring from anywhere on the map. */
  readonly reach: number;

  constructor(level: LevelDef) {
    const frame = distantLandFrame(level);
    const base = DISTANT_LAND_STYLES[level.id] ?? FALLBACK;
    const style = { ...base, height: Math.max(base.height, frame.minPeak) };
    const geometry = distantLandGeometry(frame, style, seedFor(level.id));
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <fog_fragment>',
        /* glsl */ `
        #ifdef USE_FOG
          #ifdef FOG_EXP2
            float distantFog = fogDensity * ${DISTANT_LAND_FOG_SCALE.toFixed(3)};
            float fogFactor = 1.0 - exp( - distantFog * distantFog * vFogDepth * vFogDepth );
          #else
            float fogFactor = smoothstep( fogNear, fogFar / ${DISTANT_LAND_FOG_SCALE.toFixed(3)}, vFogDepth );
          #endif
          gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
        #endif`,
      );
    };
    material.customProgramCacheKey = () => 'distant-land';
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'distant-land';
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    // Outer radius from the centre plus the furthest a camera can stand from it.
    this.reach = frame.inner + DEPTH + frame.inner - GAP;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
