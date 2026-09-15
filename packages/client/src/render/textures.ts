import { fbm, heightToNormal, ridged, valueNoise, worley } from './noise.js';
import type { FbmOptions } from './noise.js';
import type { SurfaceMaterial } from '@kc/core';

/**
 * Surface textures, generated rather than downloaded.
 *
 * The game had no textures at all — not one `TextureLoader` call anywhere — so every surface was a
 * flat colour lit by a single lambert term, and a 124 m ice shelf was one unbroken sheet of pale
 * blue. Texture is most of what separates "a box painted grey" from "stone".
 *
 * Generated because this game is delivered over the web, which makes every served file extractable
 * and puts the good commercial texture libraries out of reach on licence grounds. Generating is not
 * the compromise it sounds like: there is no download, nothing to cache, nothing to attribute, it
 * works offline, and — because the noise is seeded — every client produces byte-identical maps, the
 * same property that lets the level geometry be built from a seed instead of shipped.
 *
 * Three maps per material, in the glTF packing so three.js can use them directly:
 *   albedo  RGBA — the colour
 *   normal  RGBA — tangent-space, from the height field
 *   orm     RGBA — ambient occlusion in R, roughness in G, metalness in B
 *
 * ORM is packed into one image rather than split into three because three.js reads roughness from
 * green and metalness from blue of whatever texture it is given; one upload instead of three is a
 * third of the texture memory and a third of the samples in the shader, which is the difference
 * between this being affordable on a Quest and not.
 */

export interface SurfaceTextureData {
  albedo: Uint8ClampedArray;
  normal: Uint8ClampedArray;
  orm: Uint8ClampedArray;
  size: number;
}

/**
 * How one material is built.
 *
 * `height` is the shape of the surface and drives both the normal map and the ambient occlusion;
 * `tint` turns that height into colour. Keeping them separate is what stops every material looking
 * like the same grey noise with a hue rotation.
 */
interface Recipe {
  /** Base colour, before the height field modulates it. */
  color: [number, number, number];
  /** How far the albedo swings between the deepest and highest points, 0..1. */
  contrast: number;
  /** Roughness at the lowest and highest points of the height field. */
  roughness: [number, number];
  metalness: number;
  /** Bump strength fed to the normal generator. */
  bump: number;
  /** Height field, 0..1. */
  height: (u: number, v: number, seed: number) => number;
  /** Optional extra colour variation that does not come from the height — veins, grain, grime. */
  stain?: (u: number, v: number, seed: number) => number;
}

/**
 * Frequency presets.
 *
 * A recipe may scale `u` or `v` before sampling to stretch a pattern along one axis — wood grain,
 * brushed metal — but **only by a positive integer**. `fbm` wraps its lattice at the octave period,
 * which assumes the inputs span exactly one tile; scaling by 0.25 samples a quarter of the tile and
 * the edges stop meeting. Four recipes here did exactly that and the tiling test caught all four.
 */
const BROAD: FbmOptions = { octaves: 5, frequency: 4, lacunarity: 2.1, gain: 0.55 };
const FINE: FbmOptions = { octaves: 4, frequency: 12, lacunarity: 2.3, gain: 0.5 };
const CREASE: FbmOptions = { octaves: 4, frequency: 3, lacunarity: 2.2, gain: 0.6 };

const RECIPES: Record<SurfaceMaterial, Recipe> = {
  /** Loose earth: broad undulation with pebbles pressed into it. */
  dirt: {
    color: [0.43, 0.33, 0.21],
    contrast: 0.45,
    roughness: [1, 0.88],
    metalness: 0,
    bump: 2.6,
    height: (u, v, s) => fbm(u, v, BROAD, s) * 0.6 + (1 - worley(u, v, 9, s + 31)) * 0.4,
  },
  /** Weathered stone: ridged creases, which is what rock actually is and what fbm alone never is. */
  rock: {
    color: [0.48, 0.5, 0.53],
    contrast: 0.4,
    roughness: [0.95, 0.72],
    metalness: 0,
    bump: 3.4,
    height: (u, v, s) => ridged(u, v, CREASE, s) * 0.65 + fbm(u, v, FINE, s + 7) * 0.35,
  },
  /** Grain runs one way, so the noise is stretched hard along v. */
  wood: {
    color: [0.42, 0.29, 0.17],
    contrast: 0.5,
    roughness: [0.85, 0.6],
    metalness: 0,
    bump: 1.8,
    height: (u, v, s) => {
      // Rings: a slowly varying field read through a sawtooth, which is what makes grain read as
      // lines rather than as smears.
      const warp = fbm(u, v, BROAD, s) * 0.5;
      const rings = (u * 14 + warp * 6) % 1;
      return rings * 0.55 + fbm(u * 3, v, FINE, s + 13) * 0.45;
    },
  },
  /** Leaves: cells with soft edges, plus mottling so a canopy is not one flat green. */
  foliage: {
    color: [0.22, 0.48, 0.24],
    contrast: 0.55,
    roughness: [0.95, 0.78],
    metalness: 0,
    bump: 2.2,
    height: (u, v, s) => (1 - worley(u, v, 7, s)) * 0.55 + fbm(u, v, BROAD, s + 3) * 0.45,
    stain: (u, v, s) => fbm(u, v, { ...BROAD, frequency: 2 }, s + 77),
  },
  /** Ripples. Nearly smooth, because the roughness is what makes water look wet. */
  water: {
    color: [0.16, 0.44, 0.58],
    contrast: 0.18,
    roughness: [0.14, 0.04],
    metalness: 0.1,
    bump: 1.1,
    height: (u, v, s) => fbm(u * 2, v, { octaves: 3, frequency: 6, lacunarity: 2, gain: 0.5 }, s),
  },
  /** Brushed metal: fine directional scratches over a smooth base. */
  metal: {
    color: [0.58, 0.61, 0.65],
    contrast: 0.2,
    roughness: [0.55, 0.28],
    metalness: 0.92,
    bump: 0.9,
    height: (u, v, s) => fbm(u, v * 8, FINE, s) * 0.7 + fbm(u, v, BROAD, s + 5) * 0.3,
  },
  /** Grain, fine and even. */
  sand: {
    color: [0.78, 0.69, 0.5],
    contrast: 0.3,
    roughness: [1, 0.92],
    metalness: 0,
    bump: 1.6,
    height: (u, v, s) => (1 - worley(u, v, 22, s)) * 0.45 + fbm(u, v, BROAD, s + 9) * 0.55,
  },
  /** Cut stone: flatter than rock, with hairline fracture. */
  stone: {
    color: [0.53, 0.54, 0.56],
    contrast: 0.28,
    roughness: [0.88, 0.66],
    metalness: 0,
    bump: 2,
    height: (u, v, s) => fbm(u, v, BROAD, s) * 0.7 + ridged(u, v, { ...CREASE, frequency: 6 }, s + 17) * 0.3,
  },
  /**
   * Ice: broad smooth sheets cut by sharp cracks.
   *
   * The cracks are ridged noise at a low frequency and high contrast, and they are most of why a
   * glacier reads as ice rather than as pale plastic. Roughness is low and *varies* — polished
   * where the sheet is intact, scuffed in the cracks — because a uniformly shiny surface reads as
   * plastic no matter what colour it is.
   */
  ice: {
    color: [0.62, 0.79, 0.86],
    contrast: 0.32,
    roughness: [0.42, 0.06],
    metalness: 0,
    bump: 2.8,
    height: (u, v, s) => {
      const cracks = ridged(u, v, { octaves: 3, frequency: 3, lacunarity: 2.4, gain: 0.65 }, s);
      // Raised to a power so the crease stays narrow instead of spreading into a smear.
      return Math.pow(cracks, 3.2) * 0.75 + fbm(u, v, BROAD, s + 21) * 0.25;
    },
    stain: (u, v, s) => fbm(u, v, { ...BROAD, frequency: 2 }, s + 41),
  },
  /** Packed snow: fine granular sparkle over soft drifts. */
  snow: {
    color: [0.9, 0.93, 0.96],
    contrast: 0.16,
    roughness: [0.96, 0.78],
    metalness: 0,
    bump: 1.4,
    height: (u, v, s) => (1 - worley(u, v, 26, s)) * 0.35 + fbm(u, v, BROAD, s + 11) * 0.65,
  },
};

/** Stable per-material seed, so a material looks the same in every session and on every client. */
function seedFor(material: SurfaceMaterial): number {
  let h = 2166136261;
  for (let i = 0; i < material.length; i++) {
    h ^= material.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 8;
}

/**
 * Build the three maps for one material.
 *
 * Pure: in a seeded number and a size, out three byte arrays. Nothing here touches a canvas, a
 * texture or a GPU, which is what lets the whole thing be tested in a process with no DOM — the
 * same split that let the darkness curve be checked without a browser.
 */
export function surfaceTextureData(material: SurfaceMaterial, size: number): SurfaceTextureData {
  const recipe = RECIPES[material] ?? RECIPES.rock;
  const seed = seedFor(material);

  const height = new Float32Array(size * size);
  const albedo = new Uint8ClampedArray(size * size * 4);
  const orm = new Uint8ClampedArray(size * size * 4);

  const [r, g, b] = recipe.color;
  const [roughLow, roughHigh] = recipe.roughness;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const h = Math.min(1, Math.max(0, recipe.height(u, v, seed)));
      height[y * size + x] = h;

      // Colour swings around the base rather than only downward, so a material keeps its intended
      // average brightness however much contrast it asks for.
      const swing = (h - 0.5) * recipe.contrast;
      const stain = recipe.stain ? (recipe.stain(u, v, seed) - 0.5) * 0.14 : 0;

      const i = (y * size + x) * 4;
      albedo[i] = (r + swing + stain) * 255;
      albedo[i + 1] = (g + swing + stain) * 255;
      albedo[i + 2] = (b + swing + stain) * 255;
      albedo[i + 3] = 255;

      // Ambient occlusion from the height itself: the low places are the ones light struggles to
      // reach. Cheap, and on a surface this shallow it is indistinguishable from a baked cavity
      // map — which would need the geometry this texture has not seen.
      orm[i] = (0.45 + 0.55 * h) * 255;
      orm[i + 1] = (roughLow + (roughHigh - roughLow) * h) * 255;
      orm[i + 2] = recipe.metalness * 255;
      orm[i + 3] = 255;
    }
  }

  return { albedo, normal: heightToNormal(height, size, recipe.bump), orm, size };
}

/** Every material the generator knows, for tests and for warming the cache. */
export function texturedMaterials(): SurfaceMaterial[] {
  return Object.keys(RECIPES) as SurfaceMaterial[];
}

/**
 * The parts of a recipe a test needs, without handing out the table itself.
 *
 * `height` and `stain` are exposed because the property that matters most cannot be checked from
 * the finished bytes: a recipe must be *exactly* periodic in u and v, and a small untiled term
 * hidden under a noisy one moves the pixels too little to stand out from the material's own
 * grain. Asserting periodicity on the field itself catches it at any weight.
 */
export function recipeFor(material: SurfaceMaterial): {
  metalness: number;
  roughness: [number, number];
  seed: number;
  height: (u: number, v: number, seed: number) => number;
  stain?: ((u: number, v: number, seed: number) => number) | undefined;
} {
  const recipe = RECIPES[material] ?? RECIPES.rock;
  return {
    metalness: recipe.metalness,
    roughness: recipe.roughness,
    seed: seedFor(material),
    height: recipe.height,
    ...(recipe.stain ? { stain: recipe.stain } : {}),
  };
}

/** Keeps `valueNoise` reachable for a recipe that wants a raw lattice rather than a fractal sum. */
export const rawNoise = valueNoise;
