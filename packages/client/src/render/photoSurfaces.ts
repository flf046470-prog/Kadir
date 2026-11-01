import * as THREE from 'three';
import type { SurfaceMaterial } from '@kc/core';

/**
 * Photographed surface sets (ambientCG, CC0; credited in `BUNDLED_ASSET_CREDITS`).
 *
 * The procedural sets in `textures.ts` stay as the first frame and the fallback: they are generated
 * on the spot, need no network and are what a build without these files draws. A photographed set
 * replaces them once it arrives (`surfaces.ts` swaps the textures on every material already built),
 * so a map is never blocked on a download and never flashes untextured.
 *
 * Each file was regraded offline, not shipped as downloaded:
 *
 * - **Colour is moved onto the map's palette.** Every channel is scaled so its mean lands on the
 *   procedural set's mean — the colour each map was art-directed in, and what its fog cap, exposure
 *   and dust colours were measured against. The photograph keeps its own detail and hue variation.
 * - **Roughness is moved the same way.** The measured maps run 0.1–0.4 lower than the tuned sets
 *   (dirt 0.57 against 0.94), which under a photographed sky reads as wet ground.
 * - **ORM is packed like the procedural one**: R occlusion (255 where the set has none), G
 *   roughness, B metalness (0 — none of these is metal).
 * - **Normals are OpenGL-convention, uploaded with `flipY`.** The procedural generator writes
 *   `(-dh/du, -dh/dv, 1)` with v increasing along a row as it is uploaded unflipped; a GL normal map
 *   uploaded flipped has the same meaning, so the triplanar blend reads both identically.
 *
 * Ice is deliberately not here. Every scanned ice set on ambientCG is a fractured mosaic, and on
 * the glacier's twenty-metre walls and its rink that mosaic read as swimming-pool tiles in a real
 * game frame — the procedural ice, streaked rather than tiled, is the more believable of the two.
 *
 * 512² JPEGs, ~0.2–0.4 MB per surface, and only the surfaces a map uses are fetched. Not precached:
 * `build-precache.mjs` sweeps `assets/` and `icons/` only, and a surface is not needed to boot.
 */
export const PHOTO_SURFACES: Partial<Record<SurfaceMaterial, string>> = {
  dirt: 'Ground085',
  rock: 'Rock030',
  stone: 'Rock051',
  sand: 'Ground080',
  wood: 'Bark012',
  snow: 'Snow006',
  redEarth: 'Ground067',
  redRock: 'Rock029',
};

export interface PhotoSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  ormMap: THREE.Texture;
}

/** Fetches one image as a texture. Injected so the swap can be tested without a DOM. */
export type PhotoLoader = (url: string) => Promise<THREE.Texture>;

export function photoUrls(material: SurfaceMaterial): { color: string; normal: string; orm: string } | null {
  if (!PHOTO_SURFACES[material]) return null;
  const base = `/textures/${material}`;
  return { color: `${base}_color.jpg`, normal: `${base}_normal.jpg`, orm: `${base}_orm.jpg` };
}

/** `TextureLoader` in a browser; nothing under Node, where there is no image decoder to use. */
export function defaultPhotoLoader(): PhotoLoader | null {
  if (typeof document === 'undefined') return null;
  const loader = new THREE.TextureLoader();
  return (url) => loader.loadAsync(url);
}

export async function loadPhotoSet(material: SurfaceMaterial, load: PhotoLoader): Promise<PhotoSet | null> {
  const urls = photoUrls(material);
  if (!urls) return null;
  const [map, normalMap, ormMap] = await Promise.all([load(urls.color), load(urls.normal), load(urls.orm)]);
  for (const texture of [map, normalMap, ormMap]) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    texture.flipY = true;
    texture.needsUpdate = true;
  }
  // Only the albedo is colour; see `texturesFor` for what the sRGB curve does to anything else.
  map.colorSpace = THREE.SRGBColorSpace;
  return { map, normalMap, ormMap };
}
