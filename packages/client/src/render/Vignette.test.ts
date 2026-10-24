import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Vignette } from './Vignette.js';

const STILL = { speed: 0, turning: false, airborne: false, strength: 0 };

describe('teleport blink', () => {
  it('covers the view at once and fades back in within a third of a second', () => {
    const camera = new THREE.PerspectiveCamera();
    const vignette = new Vignette(camera);
    vignette.blink();
    expect(vignette.blinkCover).toBe(1);
    const mesh = camera.children[0] as THREE.Mesh;
    expect(mesh.visible).toBe(true);
    vignette.update(1 / 60, STILL);
    expect(vignette.blinkCover).toBeGreaterThan(0.9);
    for (let i = 0; i < 20; i++) vignette.update(1 / 60, STILL);
    expect(vignette.blinkCover).toBe(0);
    expect(mesh.visible).toBe(false);
  });

  it('blinks even for a player who switched the comfort vignette off', () => {
    const camera = new THREE.PerspectiveCamera();
    const vignette = new Vignette(camera);
    vignette.update(1 / 60, { ...STILL, speed: 20 });
    expect(vignette.intensity).toBe(0);
    vignette.blink();
    vignette.update(1 / 60, { ...STILL, speed: 20 });
    expect(vignette.blinkCover).toBeGreaterThan(0.9);
    expect((camera.children[0] as THREE.Mesh).visible).toBe(true);
  });
});
