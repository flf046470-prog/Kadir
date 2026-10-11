import { fbm, heightToNormal, ridged, valueNoise, worley, worleyEdge } from './noise.js';
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
  /**
   * Colour and roughness written directly, for a surface whose look is not a function of its
   * height: ice is clear in one place and frosted white in the next at the same height, and a
   * colour that only swings with height cannot say that. Overrides `color`, `contrast`, `stain`
   * and `roughness` where present; `height` still drives the normal and the occlusion.
   */
  shade?: (u: number, v: number, seed: number, h: number) => Shade;
}

/** Linear colour 0..1 and roughness 0..1 at one texel. */
interface Shade {
  rgb: [number, number, number];
  roughness: number;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function mix3(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * The parts of glacier ice inside one tile, shared by its height and its colour so the two cannot
 * disagree about where a crack is.
 *
 * - `crack`: fractures — Worley cell edges, which run straight and meet at angles, kept only where
 *   a broad mask allows so they stay open lines rather than closing into a pavement of polygons.
 * - `bubble`: air trapped as the ice formed — small white dots, sparse.
 * - `depth`: how far down the eye sees into clear ice, so it is not one flat blue.
 *
 * Frost and snow lying on the ice are *not* here. They are the largest features ice has, and a
 * feature as big as a quarter of the tile repeats visibly every six metres: drawn into the tile,
 * the glacier came out stamped with the same white cloud in a grid. The shader lays them in world
 * space instead (`TRI_FROST` in `surfaces.ts`), where nothing repeats.
 */
function iceFields(u: number, v: number, s: number): { crack: number; bubble: number; depth: number } {
  const open = smoothstep(0.52, 0.62, fbm(u, v, { octaves: 3, frequency: 3, lacunarity: 2, gain: 0.5 }, s + 59));
  const coarse = (1 - smoothstep(0.008, 0.035, worleyEdge(u, v, 5, s + 61))) * open;
  const fine = (1 - smoothstep(0.006, 0.02, worleyEdge(u, v, 14, s + 67))) * open * 0.2;
  const crack = Math.max(coarse, fine);
  const pit = worley(u, v, 48, s + 71);
  const keep = valueNoise(u * 48, v * 48, 48, s + 73) > 0.7 ? 1 : 0;
  const bubble = (1 - smoothstep(0.06, 0.16, pit)) * keep;
  const depth = fbm(u, v, BROAD, s + 21);
  return { crack, bubble, depth };
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
  /** Baked red earth: sand's even grain, cracked by the broad polygons of a dry claypan. */
  redEarth: {
    color: [0.69, 0.39, 0.21],
    contrast: 0.34,
    roughness: [1, 0.9],
    metalness: 0,
    bump: 1.9,
    height: (u, v, s) => (1 - worley(u, v, 7, s)) * 0.55 + fbm(u, v, FINE, s + 13) * 0.45,
  },
  /** Weathered sandstone: rock's creases, warmer and with the bedding a little more even. */
  redRock: {
    color: [0.55, 0.34, 0.23],
    contrast: 0.42,
    roughness: [0.96, 0.74],
    metalness: 0,
    bump: 3.1,
    height: (u, v, s) => ridged(u, v, CREASE, s) * 0.6 + fbm(u, v, BROAD, s + 23) * 0.4,
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
   * Glacier ice: clear blue sheets with frost lying over them, a fracture network, and air bubbles.
   *
   * It used to be ridged fBm — creases along the contours of smooth noise — cubed to keep them
   * narrow. Those creases wander and loop, and in a render of the glacier's rink and walls they
   * read as the light pattern on the floor of a swimming pool: soft bright worms on pale blue,
   * nothing that says ice. What does is in `iceFields` — cracks that run straight and stop, and
   * bubbles — and, in the shader, frost: white and matte beside ice that is blue and glossy.
   *
   * The average colour is kept where the glacier was art-directed — its fog cap, exposure and dust
   * were measured against it. And it is deliberately *not* mirror-smooth anywhere: at 0.06 the shelf
   * became a true mirror that reflected the sky back from eye height, and the ground vanished.
   */
  ice: {
    color: [0.62, 0.79, 0.86],
    contrast: 0,
    roughness: [0.4, 0.2],
    metalness: 0,
    bump: 2.2,
    height: (u, v, s) => {
      const f = iceFields(u, v, s);
      // A crack is a groove; the rest is wind-scoured, almost flat.
      return 0.6 - f.crack * 0.35 + (fbm(u, v, FINE, s + 9) - 0.5) * 0.14;
    },
    shade: (u, v, s) => {
      const f = iceFields(u, v, s);
      // Clear ice, brightened towards the palette's mean: frost (added in world space) is what
      // whitens a glacier, and the tile alone must still read as ice where there is none.
      const clear = mix3([0.48, 0.69, 0.8], [0.62, 0.8, 0.88], f.depth);
      // A fracture plane scatters light, so a crack in clear ice shows white.
      let rgb = mix3(clear, [0.86, 0.93, 0.97], f.crack * 0.75);
      rgb = mix3(rgb, [0.9, 0.95, 0.98], f.bubble);
      // Wind scour: faint streaks one way, 24 cells along u against 4 along v.
      const scour = (fbm(u * 6, v, { octaves: 3, frequency: 4, lacunarity: 2, gain: 0.5 }, s + 31) - 0.5) * 0.05;
      rgb = [rgb[0] + scour, rgb[1] + scour, rgb[2] + scour];
      const roughness = 0.24 + f.crack * 0.22 + (fbm(u, v, FINE, s + 37) - 0.5) * 0.08;
      return { rgb, roughness };
    },
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

      const i = (y * size + x) * 4;
      const shade = recipe.shade?.(u, v, seed, h);
      if (shade) {
        albedo[i] = shade.rgb[0] * 255;
        albedo[i + 1] = shade.rgb[1] * 255;
        albedo[i + 2] = shade.rgb[2] * 255;
      } else {
        // Colour swings around the base rather than only downward, so a material keeps its intended
        // average brightness however much contrast it asks for.
        const swing = (h - 0.5) * recipe.contrast;
        const stain = recipe.stain ? (recipe.stain(u, v, seed) - 0.5) * 0.14 : 0;
        albedo[i] = (r + swing + stain) * 255;
        albedo[i + 1] = (g + swing + stain) * 255;
        albedo[i + 2] = (b + swing + stain) * 255;
      }
      albedo[i + 3] = 255;

      // Ambient occlusion from the height itself: the low places are the ones light struggles to
      // reach. Cheap, and on a surface this shallow it is indistinguishable from a baked cavity
      // map — which would need the geometry this texture has not seen.
      orm[i] = (0.45 + 0.55 * h) * 255;
      orm[i + 1] = (shade ? shade.roughness : roughLow + (roughHigh - roughLow) * h) * 255;
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
  shade?: ((u: number, v: number, seed: number, h: number) => Shade) | undefined;
} {
  const recipe = RECIPES[material] ?? RECIPES.rock;
  return {
    metalness: recipe.metalness,
    roughness: recipe.roughness,
    seed: seedFor(material),
    height: recipe.height,
    ...(recipe.stain ? { stain: recipe.stain } : {}),
    ...(recipe.shade ? { shade: recipe.shade } : {}),
  };
}

/** Keeps `valueNoise` reachable for a recipe that wants a raw lattice rather than a fractal sum. */
export const rawNoise = valueNoise;
