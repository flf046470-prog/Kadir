import * as THREE from 'three';
import type { LevelDef, QualityTier, Settings } from '@kc/core';
import type { PerformanceProfile, PlatformKind } from '../platform/Platform.js';

export interface RendererOptions {
  container: HTMLElement;
  platform: PlatformKind;
  profile: PerformanceProfile;
  pixelRatio: number;
}

/**
 * Rendering shell: canvas, camera rig, lights, fog, and the adaptive frame governor.
 *
 * The camera lives inside a "rig" group. In VR the headset drives the camera *inside* the rig
 * and the rig is placed at the player's simulated feet — which is precisely the separation the
 * VR player model needs (room-scale movement inside a simulated body).
 */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** Player origin. Position this at the simulated feet position every frame. */
  readonly rig = new THREE.Group();
  readonly sun: THREE.DirectionalLight;

  private profile: PerformanceProfile;
  private pixelRatio: number;
  private container: HTMLElement;
  private frameTimes: number[] = [];
  private lastTierChange = 0;
  private currentTier: QualityTier = 'medium';
  private governorEnabled = true;

  /** Fired when the governor changes tier, so the UI/analytics can react. */
  onTierChange: ((tier: QualityTier) => void) | null = null;

  constructor(options: RendererOptions) {
    this.container = options.container;
    this.profile = options.profile;
    this.pixelRatio = options.pixelRatio;

    this.renderer = new THREE.WebGLRenderer({
      antialias: options.profile.antialias,
      powerPreference: options.platform === 'mobile' ? 'low-power' : 'high-performance',
      alpha: false,
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(this.pixelRatio * options.profile.renderScale);
    this.renderer.setSize(options.container.clientWidth || 1, options.container.clientHeight || 1, false);
    this.renderer.shadowMap.enabled = options.profile.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.xr.enabled = options.platform === 'vr';
    options.container.append(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(options.platform === 'vr' ? 90 : 72, 1, 0.05, 600);
    this.camera.position.set(0, 1.6, 0);
    this.rig.add(this.camera);
    this.scene.add(this.rig);

    const hemi = new THREE.HemisphereLight(0xbfe6ff, 0x3d5232, 1.15);
    this.scene.add(hemi);

    this.sun = new THREE.DirectionalLight(0xfff2d0, 1.9);
    this.sun.position.set(48, 80, 26);
    this.sun.castShadow = options.profile.shadows;
    this.sun.shadow.mapSize.set(options.profile.shadowMapSize, options.profile.shadowMapSize);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 220;
    const extent = 70;
    this.sun.shadow.camera.left = -extent;
    this.sun.shadow.camera.right = extent;
    this.sun.shadow.camera.top = extent;
    this.sun.shadow.camera.bottom = -extent;
    this.sun.shadow.bias = -0.0008;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    globalThis.addEventListener('resize', this.onResize);
    this.onResize();
  }

  applyLevel(level: LevelDef): void {
    this.scene.background = new THREE.Color(level.skyColor);
    this.scene.fog = new THREE.FogExp2(level.skyColor, level.fogDensity);
    this.camera.far = Math.max(200, this.profile.drawDistance * 2.2);
    this.camera.updateProjectionMatrix();
  }

  setProfile(profile: PerformanceProfile, tier: QualityTier): void {
    this.profile = profile;
    this.currentTier = tier;
    this.renderer.setPixelRatio(this.pixelRatio * profile.renderScale);
    this.renderer.shadowMap.enabled = profile.shadows;
    this.sun.castShadow = profile.shadows;
    this.sun.shadow.mapSize.set(profile.shadowMapSize, profile.shadowMapSize);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.camera.far = Math.max(200, profile.drawDistance * 2.2);
    this.camera.updateProjectionMatrix();
    this.onResize();
  }

  get tier(): QualityTier {
    return this.currentTier;
  }

  setGovernorEnabled(enabled: boolean): void {
    this.governorEnabled = enabled;
  }

  applySettings(settings: Settings): void {
    this.governorEnabled = settings.graphics.quality === 'auto';
  }

  /**
   * Adaptive quality. Sustained frame times above budget drop a tier; a long comfortable
   * stretch promotes one. Hysteresis (10 s between changes) stops it oscillating.
   */
  governFrame(dtMs: number, now: number): void {
    if (!this.governorEnabled) return;
    this.frameTimes.push(dtMs);
    if (this.frameTimes.length > 180) this.frameTimes.shift();
    if (this.frameTimes.length < 120 || now - this.lastTierChange < 10_000) return;

    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 16;
    const budget = 1000 / this.profile.targetFps;

    let next: QualityTier | null = null;
    if (p90 > budget * 1.35) next = this.currentTier === 'high' ? 'medium' : this.currentTier === 'medium' ? 'low' : null;
    else if (p90 < budget * 0.7) next = this.currentTier === 'low' ? 'medium' : this.currentTier === 'medium' ? 'high' : null;

    if (next && next !== this.currentTier) {
      this.currentTier = next;
      this.lastTierChange = now;
      this.frameTimes.length = 0;
      this.onTierChange?.(next);
    }
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  setAnimationLoop(loop: ((time: number, frame?: XRFrame) => void) | null): void {
    this.renderer.setAnimationLoop(loop);
  }

  /** Keep the shadow frustum centred on the player — one cascade is enough at this scale. */
  updateShadowFocus(x: number, z: number): void {
    if (!this.profile.shadows) return;
    this.sun.position.set(x + 48, 80, z + 26);
    this.sun.target.position.set(x, 0, z);
    this.sun.target.updateMatrixWorld();
  }

  dispose(): void {
    globalThis.removeEventListener('resize', this.onResize);
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private onResize = (): void => {
    const width = this.container.clientWidth || globalThis.innerWidth;
    const height = this.container.clientHeight || globalThis.innerHeight;
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };
}
