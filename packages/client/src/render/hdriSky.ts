import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

/**
 * A photographed sky per map, where the sky used to be a gradient.
 *
 * `sky.ts` builds the environment from two colours and a sun lobe, and the background was a flat
 * `level.skyColor`. Both are honest approximations, and both read as a render: a real sky has
 * cloud, a haze band at the horizon and a sun that is actually bright. These are Poly Haven "pure
 * sky" HDRIs (CC0, credited in `@kc/core`'s `BUNDLED_ASSET_CREDITS`) — sky only, no ground, so the
 * map's own geometry is the ground — one file per map, only the current map's is fetched.
 *
 * Three things have to agree with the rest of the renderer or the photo reads as pasted on:
 *
 * - **The sun.** The directional light that casts every shadow is fixed at `SUN_OFFSET`. The
 *   HDRI's own sun is wherever the photographer's was, so the panorama is rotated about the
 *   vertical until its brightest point sits on our light's azimuth (`skyRotation`). Elevation is
 *   left alone: tilting a photographed sky tilts its horizon.
 * - **The sun's energy.** A pure-sky HDRI stores the sun at thousands of times the sky's
 *   radiance. Lit from the environment *and* the directional light, every surface would get the
 *   sun twice. It is clamped (`SUN_CLAMP`) before anything sees it; the directional light carries
 *   the sun, the environment carries the sky.
 * - **The fog.** Distant geometry fades to the fog colour, and a fog colour that is not the
 *   photographed horizon draws a seam around the whole map. `analyseSky` measures the horizon
 *   band and the renderer fogs to it.
 */

export interface SkyPhoto {
  /** Served path under `public/`. */
  file: string;
  /** Linear multiplier so the three maps sit at a similar brightness under the same exposure. */
  exposure: number;
}

export const SKY_PHOTOS: Readonly<Record<string, SkyPhoto>> = {
  'jungle-world': { file: '/sky/kloofendal_48d_partly_cloudy_puresky.hdr', exposure: 1 },
  'outback-station': { file: '/sky/autumn_field_puresky.hdr', exposure: 1 },
  'glacier-world': { file: '/sky/sunflowers_puresky.hdr', exposure: 1 },
};

/** Radiance ceiling after the sun is removed from the environment's job. */
export const SUN_CLAMP = 24;

export interface SkyAnalysis {
  /** Azimuth of the brightest texel, as `atan2(z, x)` in three.js's equirect convention. */
  sunAzimuth: number;
  sunElevation: number;
  /** Mean linear radiance of the band 0–4° above the horizon — the colour distant fog fades to. */
  horizon: [number, number, number];
  /** How many texels the clamp touched: the sun disc, and nothing else, on a pure sky. */
  clamped: number;
}

/**
 * Find the sun, measure the horizon, and clamp the sun — in place, on RGBA float data laid out
 * top row first, the way `HDRLoader` returns a Radiance file.
 *
 * three.js samples an equirect texture at `u = atan(z, x) / 2π + 0.5`, `v = asin(y) / π + 0.5`,
 * and a `DataTexture` with `flipY` puts the first row at `v = 1`. So texel (column c, row r) looks
 * along azimuth `(u − 0.5)·2π` and elevation `(0.5 − (r + 0.5) / height)·π`.
 */
export function analyseSky(data: Float32Array, width: number, height: number, clampTo = SUN_CLAMP): SkyAnalysis {
  let best = -1;
  let bestIndex = 0;
  const horizonTop = Math.floor(height * (0.5 - 4 / 180));
  const horizonBottom = Math.floor(height * 0.5);
  const sum = [0, 0, 0];
  let horizonCount = 0;
  let clamped = 0;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const i = (r * width + c) * 4;
      const red = data[i] as number;
      const green = data[i + 1] as number;
      const blue = data[i + 2] as number;
      const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      if (luminance > best) {
        best = luminance;
        bestIndex = r * width + c;
      }
      if (r >= horizonTop && r < horizonBottom) {
        sum[0] = (sum[0] as number) + red;
        sum[1] = (sum[1] as number) + green;
        sum[2] = (sum[2] as number) + blue;
        horizonCount++;
      }
      if (luminance > clampTo) {
        const k = clampTo / luminance;
        data[i] = red * k;
        data[i + 1] = green * k;
        data[i + 2] = blue * k;
        clamped++;
      }
    }
  }
  const column = bestIndex % width;
  const row = Math.floor(bestIndex / width);
  const u = (column + 0.5) / width;
  const n = Math.max(1, horizonCount);
  return {
    sunAzimuth: (u - 0.5) * Math.PI * 2,
    sunElevation: (0.5 - (row + 0.5) / height) * Math.PI,
    horizon: [(sum[0] as number) / n, (sum[1] as number) / n, (sum[2] as number) / n],
    clamped,
  };
}

/**
 * The Y rotation, for `scene.backgroundRotation` / `scene.environmentRotation`, that brings a sky
 * whose sun is at `skySunAzimuth` round onto a light at `lightDirection`.
 *
 * three.js negates the Euler before building the lookup matrix (`WebGLBackground`,
 * `WebGLPrograms`), so a rotation of θ samples the panorama at azimuth φ + θ for a world direction
 * at φ. Held to that by a test that runs the same negation, not by this comment.
 */
export function skyRotation(skySunAzimuth: number, lightDirection: THREE.Vector3): number {
  const lightAzimuth = Math.atan2(lightDirection.z, lightDirection.x);
  return skySunAzimuth - lightAzimuth;
}

/**
 * The fog colour for a measured horizon: its hue, at no more than `FOG_LUMINANCE_CAP`.
 *
 * Measured horizons: jungle 0.47, glacier 0.48, outback **0.92** — a clear desert sky is deep blue
 * overhead (zenith 0.12) and blazing at the horizon. Fogged to that, the outback's walls faded to
 * near-white at mid distance and the map read as washed out, while its ground contrast had in fact
 * gone *up* (lower-half std 0.095 → 0.108). Capping at the other two maps' own horizon keeps the
 * haze the colour of the sky it sits under without bleaching everything behind it.
 */
export const FOG_LUMINANCE_CAP = 0.5;

export function fogColourFor(horizon: readonly [number, number, number]): [number, number, number] {
  const [r, g, b] = horizon;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const k = luminance > FOG_LUMINANCE_CAP ? FOG_LUMINANCE_CAP / luminance : 1;
  return [r * k, g * k, b * k];
}

export interface LoadedSky {
  texture: THREE.DataTexture;
  analysis: SkyAnalysis;
  horizon: THREE.Color;
}

/** Fetch, decode, analyse and clamp one sky. Null when the file is missing or undecodable. */
export async function loadSkyPhoto(photo: SkyPhoto): Promise<LoadedSky | null> {
  try {
    const response = await fetch(photo.file);
    if (!response.ok) return null;
    const loader = new HDRLoader();
    loader.setDataType(THREE.FloatType);
    const parsed = loader.parse(await response.arrayBuffer());
    const data = parsed.data as Float32Array;
    if (photo.exposure !== 1) for (let i = 0; i < data.length; i++) if (i % 4 !== 3) data[i] = (data[i] as number) * photo.exposure;
    const analysis = analyseSky(data, parsed.width, parsed.height);
    // Half floats on the GPU: a float texture is not filterable on most mobile GPUs, a Quest's
    // included, and a sky sampled with nearest filtering shows every texel at the horizon.
    const half = new Uint16Array(data.length);
    for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(data[i] as number);
    const texture = new THREE.DataTexture(half, parsed.width, parsed.height, THREE.RGBAFormat, THREE.HalfFloatType);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.LinearSRGBColorSpace;
    texture.flipY = true;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    const [r, g, b] = fogColourFor(analysis.horizon);
    return { texture, analysis, horizon: new THREE.Color(r, g, b) };
  } catch {
    return null;
  }
}
