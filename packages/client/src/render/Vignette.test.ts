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

describe('eye cover', () => {
  it('goes black the frame the eye enters a wall, even with the vignette off, and clears quickly after', () => {
    const camera = new THREE.PerspectiveCamera();
    const vignette = new Vignette(camera);
    const mesh = camera.children[0] as THREE.Mesh;
    vignette.update(1 / 72, STILL);
    vignette.setEyeCover(1, 1 / 72);
    expect(vignette.eyeCover).toBe(1);
    expect(mesh.visible).toBe(true);
    expect((mesh.material as THREE.ShaderMaterial).uniforms.uBlink!.value).toBe(1);
    // The vignette's own per-frame update must not wipe it out.
    vignette.update(1 / 72, STILL);
    expect(mesh.visible).toBe(true);
    for (let i = 0; i < 12; i++) {
      vignette.update(1 / 72, STILL);
      vignette.setEyeCover(0, 1 / 72);
    }
    expect(vignette.eyeCover).toBe(0);
    expect(mesh.visible).toBe(false);
  });
});
