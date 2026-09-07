import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { toBodyLocal, toBodyLocalDirection } from './VRInput.js';

/**
 * The simulation's local -> world mapping, copied from `player/locomotion.ts`.
 * If these two ever disagree, VR hands land in mirrored positions and grabbing breaks.
 */
function simLocalToWorld(local: THREE.Vector3, origin: THREE.Vector3, yaw: number): THREE.Vector3 {
  const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  return new THREE.Vector3(
    origin.x + right.x * local.x + forward.x * local.z,
    origin.y + local.y,
    origin.z + right.z * local.x + forward.z * local.z,
  );
}

describe('VR body-local transform', () => {
  it('round-trips against the simulation mapping at every yaw', () => {
    const local = new THREE.Vector3(0.31, 1.24, 0.46);
    const origin = new THREE.Vector3(12, 3.5, -7);
    const out = new THREE.Vector3();

    for (let i = 0; i < 12; i++) {
      const yaw = (i / 12) * Math.PI * 2 - Math.PI;
      const world = simLocalToWorld(local, origin, yaw);
      toBodyLocal(out, world, origin, yaw);
      expect(out.x).toBeCloseTo(local.x, 6);
      expect(out.y).toBeCloseTo(local.y, 6);
      expect(out.z).toBeCloseTo(local.z, 6);
    }
  });

  it('keeps a right-hand offset on the right when facing east', () => {
    const origin = new THREE.Vector3();
    const out = new THREE.Vector3();
    // Facing +x (yaw = 90°), a hand at world -z is to the player's right.
    toBodyLocal(out, new THREE.Vector3(0, 1.2, -0.3), origin, Math.PI / 2);
    expect(out.x).toBeCloseTo(0.3, 6);
    expect(out.z).toBeCloseTo(0, 6);
  });

  it('transforms directions without the origin offset', () => {
    const out = new THREE.Vector3();
    toBodyLocalDirection(out, new THREE.Vector3(0, 0, 4), 0);
    expect(out.z).toBeCloseTo(4, 6);
    toBodyLocalDirection(out, new THREE.Vector3(4, 0, 0), Math.PI / 2);
    expect(out.z).toBeCloseTo(4, 6);
  });
});
