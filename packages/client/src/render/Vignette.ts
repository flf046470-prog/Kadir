import * as THREE from 'three';

import { approach, vignetteIntensity } from '../platform/vr/comfort.js';
import type { VignetteInput } from '../platform/vr/comfort.js';

/**
 * Comfort vignette: narrows peripheral vision while the player is moving fast or turning.
 *
 * Restricting the periphery during motion is the intervention with the most consistent evidence
 * behind it for reducing simulator sickness — the discomfort comes from peripheral optic flow
 * the inner ear cannot corroborate, so hiding that flow removes the conflict.
 *
 * It is a mesh parented to the camera rather than a DOM overlay or a post-process pass: in an
 * immersive session there is no DOM in front of the player, and a post-process pass would cost
 * a full-screen resolve per eye on a Quest that needs to hold 72 fps.
 *
 * Written so that a player who set the strength to 0 sees nothing at all — the mesh is hidden
 * outright rather than drawn fully transparent, because "invisible" and "not drawn" differ by a
 * per-eye blend the headset cannot spare.
 */
export class Vignette {
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private amount = 0;

  constructor(camera: THREE.Camera) {
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      // Drawn from inside, so it must not be culled by facing.
      side: THREE.DoubleSide,
      uniforms: {
        uAmount: { value: 0 },
        uColor: { value: new THREE.Color(0x000000) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      // Radial falloff from the centre. As uAmount rises the clear inner circle shrinks, so
      // the effect reads as the world narrowing rather than as the screen dimming.
      fragmentShader: /* glsl */ `
        uniform float uAmount;
        uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
          float d = distance(vUv, vec2(0.5)) * 2.0;
          float inner = mix(1.35, 0.28, clamp(uAmount, 0.0, 1.0));
          float outer = inner + 0.45;
          float a = smoothstep(inner, outer, d);
          if (a <= 0.001) discard;
          gl_FragColor = vec4(uColor, a);
        }
      `,
    });

    // Sized to over-cover the near plane at the distance it sits, so no eye can see past its
    // edge at any IPD or FOV.
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), this.material);
    this.mesh.position.set(0, 0, -0.6);
    this.mesh.scale.setScalar(0.62);
    this.mesh.renderOrder = 10_000;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    camera.add(this.mesh);
  }

  /** Call once per frame with the player's current motion. */
  update(dt: number, input: VignetteInput): void {
    const target = vignetteIntensity(input);
    this.amount = approach(this.amount, target, dt);

    const visible = this.amount > 0.01;
    this.mesh.visible = visible;
    if (visible) this.material.uniforms.uAmount!.value = this.amount;
  }

  /** Current strength, 0..1. Exposed for tests and the settings preview. */
  get intensity(): number {
    return this.amount;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
