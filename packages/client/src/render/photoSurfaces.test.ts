import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { BUNDLED_ASSET_CREDITS } from '@kc/core';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PHOTO_SURFACES, photoUrls } from './photoSurfaces.js';
import { createSurfaceMaterial, disposeSurfaceTextures, photoSurfacesSettled, setPhotoLoader } from './surfaces.js';
import type { SurfaceQuality } from './surfaces.js';

const FULL: SurfaceQuality = { textures: true, normalMap: true, triplanar: true, size: 64 };
const BASIC: SurfaceQuality = { textures: true, normalMap: false, triplanar: true, size: 32 };
const PUBLIC = fileURLToPath(new URL('../../public', import.meta.url));

/** A loader that hands back a plain texture tagged with the URL it was asked for. */
function fakeLoader(requested: string[], fail = false) {
  return async (url: string): Promise<THREE.Texture> => {
    requested.push(url);
    if (fail) throw new Error('404');
    const texture = new THREE.Texture();
    texture.name = url;
    return texture;
  };
}

afterEach(() => {
  disposeSurfaceTextures();
  setPhotoLoader(null);
});

describe('photographed surfaces', () => {
  it('replaces every slot of a material already built, once the set arrives', async () => {
    const requested: string[] = [];
    setPhotoLoader(fakeLoader(requested));
    const dirt = createSurfaceMaterial('dirt', FULL, { color: 0xffffff });
    // First frame: the procedural set, so nothing waits on the network.
    expect(dirt.map).toBeInstanceOf(THREE.DataTexture);
    await photoSurfacesSettled();
    expect(dirt.map?.name).toBe('/textures/dirt_color.jpg');
    expect(dirt.map?.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(dirt.normalMap?.name).toBe('/textures/dirt_normal.jpg');
    expect(dirt.normalMap?.colorSpace).not.toBe(THREE.SRGBColorSpace);
    expect(dirt.roughnessMap?.name).toBe('/textures/dirt_orm.jpg');
    expect(dirt.metalnessMap?.name).toBe('/textures/dirt_orm.jpg');
    expect(dirt.aoMap?.name).toBe('/textures/dirt_orm.jpg');
    expect(dirt.map?.wrapS).toBe(THREE.RepeatWrapping);
  });

  it('fetches a surface once, however many materials and tiers use it', async () => {
    const requested: string[] = [];
    setPhotoLoader(fakeLoader(requested));
    const a = createSurfaceMaterial('rock', FULL, { color: 0xffffff });
    const b = createSurfaceMaterial('rock', BASIC, { color: 0xffffff });
    await photoSurfacesSettled();
    expect(requested.filter((u) => u.includes('rock_color'))).toHaveLength(1);
    expect(a.map).toBe(b.map);
    // A tier without a normal map does not gain one.
    expect(b.normalMap).toBeNull();
    // Built after the photographs arrived: straight onto them, no procedural pass.
    const c = createSurfaceMaterial('rock', { ...FULL, size: 128 }, { color: 0xffffff });
    expect(c.map?.name).toBe('/textures/rock_color.jpg');
  });

  it('gives a detail-only prop the photographed relief but never its colour', async () => {
    setPhotoLoader(fakeLoader([]));
    const prop = createSurfaceMaterial('wood', FULL, { color: 0x336633, detailOnly: true });
    await photoSurfacesSettled();
    expect(prop.map).toBeNull();
    expect(prop.aoMap).toBeNull();
    expect(prop.roughnessMap?.name).toBe('/textures/wood_orm.jpg');
  });

  it('keeps the procedural set when a file is missing, and never asks for an unphotographed surface', async () => {
    const requested: string[] = [];
    setPhotoLoader(fakeLoader(requested, true));
    const sand = createSurfaceMaterial('sand', FULL, { color: 0xffffff });
    const water = createSurfaceMaterial('water', FULL, { color: 0xffffff });
    await photoSurfacesSettled();
    expect(sand.map).toBeInstanceOf(THREE.DataTexture);
    expect(water.map).toBeInstanceOf(THREE.DataTexture);
    expect(requested.some((u) => u.includes('water'))).toBe(false);
  });

  it('does not reach a disposed material', async () => {
    setPhotoLoader(fakeLoader([]));
    const gone = createSurfaceMaterial('snow', FULL, { color: 0xffffff });
    const before = gone.map;
    gone.dispose();
    await photoSurfacesSettled();
    expect(gone.map).toBe(before);
  });

  it('ships every file it asks for, as a JPEG, and credits every source', () => {
    const credited = BUNDLED_ASSET_CREDITS.map((c) => c.work).join('\n');
    for (const [material, source] of Object.entries(PHOTO_SURFACES)) {
      const urls = photoUrls(material as keyof typeof PHOTO_SURFACES);
      for (const url of Object.values(urls ?? {})) {
        const file = `${PUBLIC}${url}`;
        expect(existsSync(file), url).toBe(true);
        const head = readFileSync(file).subarray(0, 3);
        expect([...head], url).toEqual([0xff, 0xd8, 0xff]);
      }
      expect(credited).toContain(source);
    }
  });
});
