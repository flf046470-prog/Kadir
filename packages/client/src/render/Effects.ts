import * as THREE from 'three';
import { getGadget } from '@kc/core';
import type { SimEvent, SurfaceMaterial, Vec3 } from '@kc/core';
import { styleForEntity } from './GadgetEntities.js';

/**
 * World effects: the dust a landing kicks up, the sparks off a punch, the burst when somebody is
 * caught.
 *
 * There were none. Every event the game has — a kangaroo landing on red dirt, a fist connecting, a
 * freeze bolt hitting, a player being tagged — produced a sound and, for the local player, a
 * haptic pulse, and nothing whatever on screen. The body landed and the ground did not notice. For
 * somebody watching another player that is the whole of the feedback, and it was absent.
 *
 * Two constraints decide the shape:
 *
 * - **A headset must hold 72 Hz.** Every particle in the game is one of two `THREE.Points` — soft
 *   (dust, snow, spray; normal blending) and glow (sparks; additive) — so all of it is two draw
 *   calls, whatever is happening. The pools are fixed-size typed arrays: nothing is allocated per
 *   burst, and a room full of landings cannot grow a frame.
 * - **The half with a right answer is testable without a GPU.** `ParticlePool` and
 *   `recipeFor` are plain arithmetic; `WorldEffects` only points two geometries at their arrays.
 */

export const MAX_PARTICLES = 384;

/** One particle to spawn. Sizes are world metres (diameter). */
export interface ParticleSpec {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds. */
  life: number;
  size: number;
  /** Metres of diameter gained per second — dust spreads as it hangs. */
  grow: number;
  alpha: number;
  color: number;
  /** m/s² downward. Dust barely falls; grit and droplets drop like stones. */
  gravity: number;
  /** Fraction of velocity lost per second (exponential). */
  drag: number;
}

/**
 * A fixed pool of live particles, packed at the front of its arrays so the draw range is exactly
 * the live count. Dead ones are swap-removed; a full pool drops new spawns rather than recycling
 * a live one — dropping the newest is invisible, stealing an old one makes it vanish mid-air.
 */
export class ParticlePool {
  readonly position: Float32Array;
  readonly color: Float32Array;
  readonly size: Float32Array;
  readonly alpha: Float32Array;
  private readonly velocity: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly startSize: Float32Array;
  private readonly grow: Float32Array;
  private readonly startAlpha: Float32Array;
  private readonly gravity: Float32Array;
  private readonly drag: Float32Array;
  count = 0;
  private readonly tmpColor = new THREE.Color();

  constructor(readonly capacity = MAX_PARTICLES) {
    this.position = new Float32Array(capacity * 3);
    this.color = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.velocity = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.startSize = new Float32Array(capacity);
    this.grow = new Float32Array(capacity);
    this.startAlpha = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
  }

  spawn(p: ParticleSpec): boolean {
    if (this.count >= this.capacity || !(p.life > 0)) return false;
    const i = this.count++;
    const i3 = i * 3;
    this.position[i3] = p.x;
    this.position[i3 + 1] = p.y;
    this.position[i3 + 2] = p.z;
    this.velocity[i3] = p.vx;
    this.velocity[i3 + 1] = p.vy;
    this.velocity[i3 + 2] = p.vz;
    // Colours are authored in sRGB like every other hex in the renderer; the geometry holds linear.
    this.tmpColor.setHex(p.color);
    this.color[i3] = this.tmpColor.r;
    this.color[i3 + 1] = this.tmpColor.g;
    this.color[i3 + 2] = this.tmpColor.b;
    this.age[i] = 0;
    this.life[i] = p.life;
    this.startSize[i] = p.size;
    this.size[i] = p.size;
    this.grow[i] = p.grow;
    this.startAlpha[i] = p.alpha;
    // Born invisible and faded in over the first few frames, so a burst swells rather than pops.
    this.alpha[i] = 0;
    this.gravity[i] = p.gravity;
    this.drag[i] = p.drag;
    return true;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    let i = 0;
    while (i < this.count) {
      const age = (this.age[i] as number) + dt;
      const life = this.life[i] as number;
      if (age >= life) {
        this.remove(i);
        continue;
      }
      this.age[i] = age;
      const i3 = i * 3;
      const keep = Math.exp(-(this.drag[i] as number) * dt);
      const vx = (this.velocity[i3] as number) * keep;
      const vy = (this.velocity[i3 + 1] as number) * keep - (this.gravity[i] as number) * dt;
      const vz = (this.velocity[i3 + 2] as number) * keep;
      this.velocity[i3] = vx;
      this.velocity[i3 + 1] = vy;
      this.velocity[i3 + 2] = vz;
      this.position[i3] = (this.position[i3] as number) + vx * dt;
      this.position[i3 + 1] = (this.position[i3 + 1] as number) + vy * dt;
      this.position[i3 + 2] = (this.position[i3 + 2] as number) + vz * dt;
      this.size[i] = (this.startSize[i] as number) + (this.grow[i] as number) * age;
      this.alpha[i] = (this.startAlpha[i] as number) * fadeAt(age / life);
      i++;
    }
  }

  clear(): void {
    this.count = 0;
  }

  private remove(i: number): void {
    const last = --this.count;
    if (i === last) return;
    const i3 = i * 3;
    const l3 = last * 3;
    for (let k = 0; k < 3; k++) {
      this.position[i3 + k] = this.position[l3 + k] as number;
      this.velocity[i3 + k] = this.velocity[l3 + k] as number;
      this.color[i3 + k] = this.color[l3 + k] as number;
    }
    this.age[i] = this.age[last] as number;
    this.life[i] = this.life[last] as number;
    this.size[i] = this.size[last] as number;
    this.startSize[i] = this.startSize[last] as number;
    this.grow[i] = this.grow[last] as number;
    this.alpha[i] = this.alpha[last] as number;
    this.startAlpha[i] = this.startAlpha[last] as number;
    this.gravity[i] = this.gravity[last] as number;
    this.drag[i] = this.drag[last] as number;
  }
}

/** 0 → 1 over the first 12 % of a life, then an eased fall to 0: a puff swells, then thins. */
export function fadeAt(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  if (t < 0.12) return t / 0.12;
  const u = (t - 0.12) / 0.88;
  return (1 - u) * (1 - u * 0.5);
}

/** One layer of what a landing throws up: a cloud, or the heavy bits in it. */
export interface KickLayer {
  color: number;
  /** Colour jitter, ± fraction of lightness. */
  jitter: number;
  /** Multiplier on the impact-scaled particle count. */
  count: number;
  size: number;
  grow: number;
  life: number;
  alpha: number;
  gravity: number;
  drag: number;
  /** Outward speed at a reference 8 m/s impact. */
  spread: number;
  lift: number;
  /** Drawn as light (additive) — sparks off metal. */
  glow?: boolean;
}

export interface GroundKick {
  /** The cloud: big, soft, slow, hangs in the air. */
  puff?: KickLayer;
  /** Grit, chips, droplets, leaves: small, fast, falls. */
  chips?: KickLayer;
}

const PUFF: KickLayer = { color: 0xa88c68, jitter: 0.1, count: 1, size: 0.55, grow: 1.35, life: 1.15, alpha: 0.42, gravity: 0.3, drag: 3.4, spread: 2.6, lift: 0.6 };
const CHIPS: KickLayer = { color: 0x6d5535, jitter: 0.15, count: 0.45, size: 0.075, grow: 0, life: 0.55, alpha: 1, gravity: 9.8, drag: 1.3, spread: 2, lift: 2.6 };

/**
 * Per material, because the ground is the point. Two measured lessons are baked in:
 *
 * - **Dust is paler than the ground it comes off.** A first pass coloured each cloud like its
 *   surface — red earth threw red dust — and in a render of the outback it vanished into the
 *   ground it was drawn over. Kicked-up dust is dry, fine and lit from every side, so it reads
 *   lighter; these colours are the ground's hue at a higher lightness.
 * - **Grit alone is invisible.** Rock and ice gave 7 cm chips and nothing else, a few pixels at the
 *   distance you watch another player from. Every surface that throws bits also throws a faint
 *   cloud, so the event registers before the eye resolves the chips.
 */
export const GROUND_KICKS: Record<SurfaceMaterial, GroundKick> = {
  dirt: { puff: PUFF, chips: CHIPS },
  redEarth: { puff: { ...PUFF, color: 0xd09a74, count: 1.2 }, chips: { ...CHIPS, color: 0x8c4a2c } },
  sand: { puff: { ...PUFF, color: 0xe6d3aa, count: 1.25, grow: 1.6 }, chips: { ...CHIPS, color: 0xc9ae7c, count: 0.3 } },
  snow: {
    puff: { ...PUFF, color: 0xf6f9fd, jitter: 0.03, count: 1.3, size: 0.6, grow: 1.6, life: 1.45, alpha: 0.72, gravity: 0.2 },
    chips: { ...CHIPS, color: 0xffffff, jitter: 0.02, size: 0.09, count: 0.5 },
  },
  ice: {
    puff: { ...PUFF, color: 0xeaf5ff, jitter: 0.03, count: 0.45, size: 0.4, alpha: 0.3 },
    chips: { ...CHIPS, color: 0xe2f4ff, jitter: 0.04, count: 0.8, size: 0.08, lift: 2.8 },
  },
  rock: { puff: { ...PUFF, color: 0xbab6ad, count: 0.45, size: 0.42, alpha: 0.3 }, chips: { ...CHIPS, color: 0x87847d, count: 0.7 } },
  stone: { puff: { ...PUFF, color: 0xc2beb5, count: 0.45, size: 0.42, alpha: 0.3 }, chips: { ...CHIPS, color: 0x95928a, count: 0.7 } },
  redRock: { puff: { ...PUFF, color: 0xc99372, count: 0.5, size: 0.42, alpha: 0.32 }, chips: { ...CHIPS, color: 0x8f5234, count: 0.7 } },
  wood: { puff: { ...PUFF, color: 0xb09472, count: 0.35, alpha: 0.28 }, chips: { ...CHIPS, color: 0x7a5a38, count: 0.55, size: 0.09 } },
  foliage: {
    puff: { ...PUFF, color: 0x9cae7a, count: 0.3, alpha: 0.22 },
    // Leaves: flutter down slowly rather than dropping like grit.
    chips: { ...CHIPS, color: 0x4f8a3a, jitter: 0.22, count: 0.8, size: 0.14, life: 1.6, gravity: 1.3, drag: 3.5, spread: 1.6, lift: 2.6 },
  },
  water: {
    // Spray, not dust: a quick white mist and droplets that go up and fall straight back.
    puff: { ...PUFF, color: 0xf2f9fc, jitter: 0.03, count: 0.7, size: 0.5, grow: 1.1, life: 0.6, alpha: 0.5, gravity: 1.5 },
    chips: { ...CHIPS, color: 0xd8eef7, jitter: 0.04, count: 1.4, size: 0.12, life: 0.8, gravity: 9.8, drag: 0.8, spread: 1.5, lift: 4.4 },
  },
  metal: { chips: { ...CHIPS, color: 0xffd9a0, jitter: 0.08, count: 0.6, size: 0.07, life: 0.4, drag: 2, spread: 2.8, glow: true } },
};

/** Below this impact speed a landing is a step, not an event — nothing is kicked up. */
export const LAND_FX_MIN_SPEED = 2.5;

/** Effects farther than this from the camera are not spawned: they would be a few pixels of fog. */
export const FX_RANGE = 70;

export interface Recipe {
  soft: ParticleSpec[];
  glow: ParticleSpec[];
}

type Rand = () => number;

function jitterColor(hex: number, amount: number, rand: Rand): number {
  if (amount <= 0) return hex;
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l * (1 + (rand() * 2 - 1) * amount))));
  return c.getHex();
}

function range(rand: Rand, lo: number, hi: number): number {
  return lo + (hi - lo) * rand();
}

/** A ring of ground kick around a point, scaled by impact speed. */
/** A footfall's dust: a landing's kick at a third of the size, as a bound lands at ~3 m/s. */
export function footfallRecipe(at: Vec3, material: SurfaceMaterial | undefined, rand: Rand): Recipe {
  const out: Recipe = { soft: [], glow: [] };
  groundKick(at, material, 3, rand, out, 0.35);
  return out;
}

function groundKick(at: Vec3, material: SurfaceMaterial | undefined, speed: number, rand: Rand, out: Recipe, scale = 1): void {
  const kick = GROUND_KICKS[material ?? 'dirt'] ?? GROUND_KICKS.dirt;
  const strength = Math.min(2.2, speed / 8);
  for (const layer of [kick.puff, kick.chips]) {
    if (!layer) continue;
    const n = Math.round(Math.min(24, (5 + speed * 0.9) * layer.count * scale));
    const list = layer.glow ? out.glow : out.soft;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + range(rand, -0.3, 0.3);
      const r = range(rand, 0.12, 0.38);
      const outward = layer.spread * strength * range(rand, 0.55, 1.15);
      list.push({
        x: at.x + Math.sin(a) * r,
        y: at.y + 0.05,
        z: at.z + Math.cos(a) * r,
        vx: Math.sin(a) * outward,
        vy: layer.lift * strength * range(rand, 0.4, 1.1),
        vz: Math.cos(a) * outward,
        life: layer.life * range(rand, 0.75, 1.25),
        size: layer.size * range(rand, 0.7, 1.3) * (0.8 + strength * 0.25),
        grow: layer.grow * range(rand, 0.7, 1.3),
        alpha: layer.alpha,
        color: jitterColor(layer.color, layer.jitter, rand),
        gravity: layer.gravity,
        drag: layer.drag,
      });
    }
  }
}

/**
 * A single bright disc for a tenth of a second: the frame an impact happens on. Sparks alone read
 * as a spray of dots arriving from nowhere; the flash is what says "here, now".
 */
function flash(at: Vec3, color: number, size: number, list: ParticleSpec[]): void {
  list.push({ x: at.x, y: at.y, z: at.z, vx: 0, vy: 0, vz: 0, life: 0.14, size, grow: size * 2, alpha: 0.9, color, gravity: 0, drag: 0 });
}

/** A sphere of sparks: a hit, a catch, a freeze. */
function sparks(at: Vec3, color: number, count: number, speed: number, size: number, life: number, rand: Rand, list: ParticleSpec[]): void {
  for (let i = 0; i < count; i++) {
    // Uniform on the sphere, biased upward so a burst reads above the body rather than into the floor.
    const u = rand() * 2 - 1;
    const t = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const v = speed * range(rand, 0.5, 1.1);
    list.push({
      x: at.x,
      y: at.y,
      z: at.z,
      vx: s * Math.cos(t) * v,
      vy: Math.abs(u) * v * 0.9 + v * 0.25,
      vz: s * Math.sin(t) * v,
      life: life * range(rand, 0.7, 1.2),
      size: size * range(rand, 0.7, 1.3),
      grow: 0,
      alpha: 1,
      color: jitterColor(color, 0.08, rand),
      gravity: 5,
      drag: 3.5,
    });
  }
}

/** A flat ring racing outward — reads at distance where sparks are specks. */
function shockRing(at: Vec3, color: number, count: number, speed: number, rand: Rand, list: ParticleSpec[]): void {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    list.push({
      x: at.x,
      y: at.y,
      z: at.z,
      vx: Math.sin(a) * speed,
      vy: range(rand, -0.1, 0.3),
      vz: Math.cos(a) * speed,
      life: 0.45,
      size: 0.22,
      grow: 0.5,
      alpha: 0.85,
      color,
      gravity: 0,
      drag: 4,
    });
  }
}

function offset(p: Vec3, dy: number): Vec3 {
  return { x: p.x, y: p.y + dy, z: p.z };
}

export const TAG_COLOR = 0xff6a2a;
export const PUNCH_COLOR = 0xfff1b0;
export const FREEZE_COLOR = 0x9fe6ff;

/**
 * What an event looks like, as particles. Pure: the same event and random stream give the same
 * burst, which is what lets a test say "a landing on snow is a bigger, whiter cloud than on rock".
 *
 * `lastGround` is the material a jump took off from when the jump event does not say (wall jumps
 * and bounces carry none).
 */
export function recipeFor(event: SimEvent, rand: Rand, lastGround?: SurfaceMaterial): Recipe {
  const out: Recipe = { soft: [], glow: [] };
  const at = event.position;
  switch (event.type) {
    case 'land':
      if (event.magnitude >= LAND_FX_MIN_SPEED) groundKick(at, event.material, event.magnitude, rand, out);
      break;
    case 'jump':
      // Push-off: a smaller kick than the landing, from the ground the feet just left. Wall jumps
      // and bounce pads are not ground.
      if (event.data === 'wall' || event.data === 'bouncy') break;
      groundKick(at, event.material ?? lastGround, 5 + event.magnitude * 4, rand, out, 0.45);
      break;
    case 'wallBounce':
      groundKick(offset(at, 0.7), event.material, event.magnitude, rand, out, 0.6);
      break;
    case 'tag': {
      const chest = offset(at, 0.95);
      flash(chest, 0xffd2a8, 1.3, out.glow);
      sparks(chest, TAG_COLOR, 34, 7.5, 0.26, 0.75, rand, out.glow);
      shockRing(offset(at, 0.15), 0xffe2c8, 20, 7.5, rand, out.soft);
      break;
    }
    case 'punchHit': {
      const hit = event.magnitude;
      flash(at, 0xfff6d8, 0.7, out.glow);
      sparks(at, PUNCH_COLOR, Math.round(10 + Math.min(14, hit * 0.5)), 6, 0.15, 0.38, rand, out.glow);
      break;
    }
    case 'status':
      if (event.data === 'frozen') {
        flash(offset(at, 0.9), 0xd8f6ff, 1.4, out.glow);
        sparks(offset(at, 0.9), FREEZE_COLOR, 28, 3.6, 0.18, 0.95, rand, out.glow);
        groundKick(at, 'snow', 9, rand, out, 0.8);
      } else if (event.data === 'snared') {
        groundKick(at, 'dirt', 6, rand, out, 0.8);
      }
      break;
    case 'gadgetHit': {
      const visual = typeof event.data === 'string' ? getGadget(event.data)?.visual : undefined;
      const style = styleForEntity('projectile', visual);
      flash(at, style.color, 0.9, out.glow);
      sparks(at, style.color, 18, 4.5, 0.15, 0.5, rand, out.glow);
      break;
    }
    case 'respawn': {
      const body = offset(at, 0.6);
      for (let i = 0; i < 16; i++) {
        const a = rand() * Math.PI * 2;
        out.soft.push({
          x: body.x + Math.sin(a) * 0.3,
          y: body.y + range(rand, -0.4, 0.5),
          z: body.z + Math.cos(a) * 0.3,
          vx: Math.sin(a) * range(rand, 0.4, 1.2),
          vy: range(rand, 0.6, 1.6),
          vz: Math.cos(a) * range(rand, 0.4, 1.2),
          life: range(rand, 0.7, 1.1),
          size: range(rand, 0.45, 0.65),
          grow: 1.1,
          alpha: 0.55,
          color: 0xf4f1ea,
          gravity: -0.4,
          drag: 2.5,
        });
      }
      break;
    }
    case 'goal':
      // The net lights up in the scoring side's colour, big enough to read from the far goal.
      sparks(offset(at, 1.2), event.data === 'red' ? 0xff5a4f : 0x3d8bff, 64, 6.5, 0.26, 1.3, rand, out.glow);
      break;
    case 'checkpoint':
    case 'lapComplete':
      sparks(offset(at, 1), 0xffd35a, event.type === 'lapComplete' ? 44 : 24, 4.8, 0.2, 0.95, rand, out.glow);
      break;
    case 'bodyHit':
      // A ball landing on dust kicks up a little of it; a kick scuffs the ground at the ball.
      if ((event.data === 'bounce' && event.magnitude > 3) || event.data === 'kick') {
        groundKick(offset(at, -0.2), event.material ?? lastGround, event.magnitude, rand, out, 0.3);
      }
      break;
    case 'stagger':
      sparks(offset(at, 1.4), 0xfff4a0, 8, 1.6, 0.16, 0.8, rand, out.glow);
      break;
    default:
      break;
  }
  return out;
}

/** mulberry32 — small, fast, and seedable so a test can reproduce a burst. */
export function seededRandom(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A soft round sprite, built as data rather than on a canvas so it exists under Node too. Alpha
 * falls off as a smoothstep from the centre: a square point sprite reads as a pixel, a disc with a
 * hard edge reads as a confetti dot, and a soft one reads as dust.
 */
function softDisc(size = 32): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const d = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2);
      const t = 1 - d;
      const a = t * t * (3 - 2 * t);
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

/**
 * `PointsMaterial` with a per-particle size (world metres) and alpha.
 *
 * The size is multiplied by `projectionMatrix[1][1]`, which makes it a true world-space diameter:
 * three.js's own attenuation (`scale / -z`, `scale` = half the viewport height) omits the focal
 * term, so a "0.3 m" puff drawn with it would be 0.3 m only at a 90° field of view — which is the
 * headset's, and not the flat screen's 72°. Written this way it is the same size in both.
 */
function particleMaterial(map: THREE.Texture, additive: boolean): THREE.PointsMaterial {
  const material = new THREE.PointsMaterial({
    size: 1,
    map,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    sizeAttenuation: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSize;\nattribute float aAlpha;\nvarying float vAlpha;')
      .replace('gl_PointSize = size;', 'gl_PointSize = size * aSize * projectionMatrix[1][1];\n\tvAlpha = aAlpha;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAlpha;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n\tdiffuseColor.a *= vAlpha;');
  };
  return material;
}

function dynamicAttribute(array: Float32Array, size: number): THREE.BufferAttribute {
  const attribute = new THREE.BufferAttribute(array, size);
  attribute.setUsage(THREE.DynamicDrawUsage);
  return attribute;
}

function poolGeometry(pool: ParticlePool): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const attr = dynamicAttribute;
  geometry.setAttribute('position', attr(pool.position, 3));
  geometry.setAttribute('color', attr(pool.color, 3));
  geometry.setAttribute('aSize', attr(pool.size, 1));
  geometry.setAttribute('aAlpha', attr(pool.alpha, 1));
  geometry.setDrawRange(0, 0);
  return geometry;
}

export class WorldEffects {
  readonly group = new THREE.Group();
  readonly soft: ParticlePool;
  readonly glow: ParticlePool;
  private readonly softGeometry: THREE.BufferGeometry;
  private readonly glowGeometry: THREE.BufferGeometry;
  private readonly softMaterial: THREE.PointsMaterial;
  private readonly glowMaterial: THREE.PointsMaterial;
  private readonly map: THREE.DataTexture;
  private readonly rand: Rand;
  /** Ground each player last stood on, for jump events that do not say. */
  private readonly ground = new Map<string, SurfaceMaterial>();
  /**
   * A landed projectile reports twice (see CLAUDE.md, Measurement hazards): once from the payload
   * at the victim and once from the detonation. One burst, not two, keyed per tick.
   */
  private readonly seenGadgetHits = new Set<string>();
  private seenTick = -1;

  /** `scale` thins every burst — the low tier and a headset below `high` get fewer particles. */
  constructor(
    private readonly scale = 1,
    seed = 1,
  ) {
    const capacity = Math.max(64, Math.round(MAX_PARTICLES * Math.min(1, scale)));
    this.soft = new ParticlePool(capacity);
    this.glow = new ParticlePool(Math.round(capacity / 2));
    this.rand = seededRandom(seed);
    this.map = softDisc();
    this.softMaterial = particleMaterial(this.map, false);
    this.glowMaterial = particleMaterial(this.map, true);
    this.softGeometry = poolGeometry(this.soft);
    this.glowGeometry = poolGeometry(this.glow);
    const soft = new THREE.Points(this.softGeometry, this.softMaterial);
    const glow = new THREE.Points(this.glowGeometry, this.glowMaterial);
    for (const points of [soft, glow]) {
      // Positions move every frame and the bounding sphere is never recomputed; culling against a
      // stale one would drop live bursts.
      points.frustumCulled = false;
      points.renderOrder = 2;
      this.group.add(points);
    }
  }

  handleEvent(event: SimEvent, camera?: Vec3): void {
    if (event.type === 'land' && event.material) this.ground.set(event.playerId, event.material);
    if (camera) {
      const dx = event.position.x - camera.x;
      const dy = event.position.y - camera.y;
      const dz = event.position.z - camera.z;
      if (dx * dx + dy * dy + dz * dz > FX_RANGE * FX_RANGE) return;
    }
    if (event.type === 'gadgetHit') {
      if (event.tick !== this.seenTick) {
        this.seenGadgetHits.clear();
        this.seenTick = event.tick;
      }
      const key = `${event.playerId}:${event.otherId ?? ''}:${String(event.data ?? '')}`;
      if (this.seenGadgetHits.has(key)) return;
      this.seenGadgetHits.add(key);
    }
    const recipe = recipeFor(event, this.rand, this.ground.get(event.playerId));
    const keep = Math.min(1, this.scale);
    for (const p of recipe.soft) if (keep >= 1 || this.rand() < keep) this.soft.spawn(p);
    for (const p of recipe.glow) if (keep >= 1 || this.rand() < keep) this.glow.spawn(p);
  }

  /** A bound's footfall: a small puff from the ground the feet landed on. */
  footfall(at: Vec3, material: SurfaceMaterial | undefined, camera?: Vec3): void {
    if (camera) {
      const dx = at.x - camera.x;
      const dy = at.y - camera.y;
      const dz = at.z - camera.z;
      if (dx * dx + dy * dy + dz * dz > FX_RANGE * FX_RANGE) return;
    }
    const recipe = footfallRecipe(at, material, this.rand);
    const keep = Math.min(1, this.scale);
    for (const p of recipe.soft) if (keep >= 1 || this.rand() < keep) this.soft.spawn(p);
    for (const p of recipe.glow) if (keep >= 1 || this.rand() < keep) this.glow.spawn(p);
  }

  /**
   * How dark the player's zone is, 0..1. Particles are unlit, so without this a cave's dust would
   * glow as if it were in the sun. Sparks are light and stay bright.
   */
  setDarkness(darkness: number): void {
    this.softMaterial.color.setScalar(1 - 0.65 * Math.min(1, Math.max(0, darkness)));
  }

  update(dt: number): void {
    this.soft.update(dt);
    this.glow.update(dt);
    this.sync(this.softGeometry, this.soft);
    this.sync(this.glowGeometry, this.glow);
  }

  clear(): void {
    this.soft.clear();
    this.glow.clear();
    this.ground.clear();
    this.sync(this.softGeometry, this.soft);
    this.sync(this.glowGeometry, this.glow);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.softGeometry.dispose();
    this.glowGeometry.dispose();
    this.softMaterial.dispose();
    this.glowMaterial.dispose();
    this.map.dispose();
  }

  private sync(geometry: THREE.BufferGeometry, pool: ParticlePool): void {
    const drawn = geometry.drawRange.count;
    geometry.setDrawRange(0, pool.count);
    if (pool.count === 0 && drawn === 0) return;
    for (const name of ['position', 'color', 'aSize', 'aAlpha']) {
      const attribute = geometry.getAttribute(name) as THREE.BufferAttribute;
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, pool.count * attribute.itemSize);
      attribute.needsUpdate = true;
    }
  }
}
