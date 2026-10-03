import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FOG_LUMINANCE_CAP, SKY_PHOTOS, SUN_CLAMP, analyseSky, fogColourFor, skyRotation } from './hdriSky.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** An equirect sky, top row first: blue above, a warmer band at the horizon, one hot texel. */
function syntheticSky(width: number, height: number, sun: { column: number; row: number }): Float32Array {
  const data = new Float32Array(width * height * 4);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const i = (r * width + c) * 4;
      const elevation = (0.5 - (r + 0.5) / height) * 180;
      const nearHorizon = elevation >= 0 && elevation < 4;
      data[i] = nearHorizon ? 1.2 : 0.3;
      data[i + 1] = nearHorizon ? 1.1 : 0.5;
      data[i + 2] = nearHorizon ? 1.0 : 1.4;
      data[i + 3] = 1;
    }
  }
  const s = (sun.row * width + sun.column) * 4;
  data[s] = 5000;
  data[s + 1] = 4800;
  data[s + 2] = 4500;
  return data;
}

describe('photographed skies', () => {
  it('finds the sun where it is, in three.js equirect coordinates', () => {
    const width = 256;
    const height = 128;
    // Column at u = 0.75 is azimuth +π/2 (+Z); row 32 of 128 is 45° up.
    const data = syntheticSky(width, height, { column: 192, row: 32 });
    const sky = analyseSky(data, width, height);
    expect(sky.sunAzimuth).toBeCloseTo(Math.PI / 2, 1);
    expect(sky.sunElevation).toBeCloseTo(Math.PI / 4, 1);
  });

  it('measures the horizon band, not the sky above it', () => {
    const sky = analyseSky(syntheticSky(256, 128, { column: 10, row: 10 }), 256, 128);
    expect(sky.horizon[0]).toBeCloseTo(1.2, 5);
    expect(sky.horizon[2]).toBeCloseTo(1.0, 5);
  });

  it('clamps the sun so the environment does not light the world with it a second time', () => {
    const data = syntheticSky(64, 32, { column: 5, row: 5 });
    const sky = analyseSky(data, 64, 32);
    expect(sky.clamped).toBe(1);
    let peak = 0;
    for (let i = 0; i < data.length; i += 4) {
      peak = Math.max(peak, 0.2126 * (data[i] as number) + 0.7152 * (data[i + 1] as number) + 0.0722 * (data[i + 2] as number));
    }
    expect(peak).toBeCloseTo(SUN_CLAMP, 3);
    // Colour is kept: the clamp scales, it does not whiten.
    const s = (5 * 64 + 5) * 4;
    expect((data[s] as number) / (data[s + 2] as number)).toBeCloseTo(5000 / 4500, 5);
  });

  it('rotates the panorama so its sun sits on our light, by three.js own convention', () => {
    const light = new THREE.Vector3(58, 45, 30).normalize();
    for (const skySun of [-2.5, -0.4, 0, 1.1, 3]) {
      const theta = skyRotation(skySun, light);
      // WebGLBackground / WebGLPrograms negate the Euler before building the lookup matrix.
      const euler = new THREE.Euler(0, -theta, 0);
      const lookup = new THREE.Matrix4().makeRotationFromEuler(euler);
      const sampled = light.clone().applyMatrix4(lookup);
      const azimuth = Math.atan2(sampled.z, sampled.x);
      const wrapped = Math.atan2(Math.sin(azimuth - skySun), Math.cos(azimuth - skySun));
      expect(Math.abs(wrapped)).toBeLessThan(1e-6);
    }
  });

  it('fogs to the horizon hue without bleaching a blazing desert horizon', () => {
    const lum = (c: [number, number, number]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const outback: [number, number, number] = [0.75, 0.95, 1.09];
    const fog = fogColourFor(outback);
    expect(lum(fog)).toBeCloseTo(FOG_LUMINANCE_CAP, 5);
    expect(fog[2] / fog[0]).toBeCloseTo(1.09 / 0.75, 5);
    // A horizon already under the cap is used exactly as measured.
    expect(fogColourFor([0.43, 0.47, 0.57])).toEqual([0.43, 0.47, 0.57]);
  });

  it('ships a sky file for every map it names', () => {
    for (const [level, photo] of Object.entries(SKY_PHOTOS)) {
      expect(existsSync(resolve(__dirname, '../../public', `.${photo.file}`)), level).toBe(true);
    }
  });
});
