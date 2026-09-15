import * as THREE from 'three';
import type { LevelDef, QualityTier, Settings } from '@kc/core';
import type { PerformanceProfile, PlatformKind } from '../platform/Platform.js';
import { isDemotion, nextTier } from './governor.js';

export interface RendererOptions {
  container: HTMLElement;
  platform: PlatformKind;
  profile: PerformanceProfile;
  pixelRatio: number;
}

/** Base light intensities, so darkness scales *these* rather than whatever was set last frame. */
const HEMI_BASE = 1.15;
const SUN_BASE = 1.9;

export interface DarknessValues {
  amount: number;
  skyScale: number;
  fogDensity: number;
  hemiIntensity: number;
  sunIntensity: number;
}

/**
 * What a zone's darkness does to the sky, the fog and the lights.
 *
 * Pure, and separated from the renderer it drives, because this is the part with a right answer
 * and the part that needs a GPU to run is not. `ZoneDef.darkness` had never been read by anything
 * — the jungle declares 0.05, the cave 0.75, the canyon 0.15, all documented as a "0..1
 * fog/darkness hint for the client" — so the cave was lit exactly like the clearing.
 *
 * Three things move together because moving one reads as a colour filter rather than a place: the
 * sky darkens so the fog has something to fade *into*, the fog thickens so the far wall vanishes,
 * and the lights drop so the geometry itself dims.
 *
 * The sun keeps 40% of its strength at full darkness on purpose. A cave with no directional light
 * has no edges at all, and a player needs to see the ledge they are about to jump to — "dark" has
 * to stay playable.
 */
export function darknessValues(darkness: number, baseFogDensity: number): DarknessValues {
  const amount = Number.isFinite(darkness) ? Math.max(0, Math.min(1, darkness)) : 0;
  return {
    amount,
    skyScale: 1 - amount * 0.82,
    fogDensity: baseFogDensity * (1 + amount * 5.5),
    hemiIntensity: HEMI_BASE * (1 - amount * 0.72),
    sunIntensity: SUN_BASE * (1 - amount * 0.6),
  };
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
  private hemi: THREE.HemisphereLight | null = null;
  /** The level's own fog and sky, kept so darkness is applied *to* them rather than compounding. */
  private baseFogDensity = 0;
  private baseSkyColor = new THREE.Color(0xffffff);
  private darkness = 0;

  private profile: PerformanceProfile;
  private pixelRatio: number;
  private container: HTMLElement;
  private frameTimes: number[] = [];
  private lastTierChange = 0;
  /** When the governor last dropped a tier, so it does not climb straight back into it. */
  private lastDemotion: number | null = null;
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

    const hemi = new THREE.HemisphereLight(0xbfe6ff, 0x3d5232, HEMI_BASE);
    this.scene.add(hemi);
    this.hemi = hemi;

    this.sun = new THREE.DirectionalLight(0xfff2d0, SUN_BASE);
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

    // Remembered so `setDarkness` has something to return to. Without a stored baseline every
    // frame would darken the *previous* frame's values and the world would fade to black.
    this.baseFogDensity = level.fogDensity;
    this.baseSkyColor.set(level.skyColor);
    this.darkness = 0;
    this.setDarkness(0);
  }

  /**
   * How enclosed the player is, 0..1 — the zone hint the level has always carried and nothing
   * ever read.
   *
   * `ZoneDef.darkness` is documented as "0..1 fog/darkness hint for the client" and set to 0.75
   * for the cave, 0.15 for the canyon and 0.05 for the jungle. No client code ever looked a zone
   * up, so the cave was lit exactly like the clearing outside it.
   *
   * Three things move together, because changing only one reads as a filter rather than a place:
   * the sky darkens so the fog has something to fade *into*, the fog thickens so the far wall of
   * the cave disappears, and the lights drop so the geometry itself is dimmer. The sun keeps a
   * little of its strength at full darkness — a cave with no directional light at all loses every
   * edge, and a player needs to see the ledge they are about to jump to.
   */
  setDarkness(darkness: number): void {
    const values = darknessValues(darkness, this.baseFogDensity);
    this.darkness = values.amount;

    const sky = this.baseSkyColor.clone().multiplyScalar(values.skyScale);
    this.scene.background = sky;
    const fog = this.scene.fog;
    if (fog instanceof THREE.FogExp2) {
      fog.color.copy(sky);
      fog.density = values.fogDensity;
    }

    if (this.hemi) this.hemi.intensity = values.hemiIntensity;
    this.sun.intensity = values.sunIntensity;
  }

  get currentDarkness(): number {
    return this.darkness;
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
   * Adaptive quality. Sustained long frames drop a tier; sustained headroom climbs one.
   *
   * The arithmetic lives in `governor.ts` so it can be tested without a GL context — the part
   * that goes wrong here is thresholds, not rendering, and a tier that oscillates looks fine in
   * every screenshot ever taken of it.
   */
  governFrame(dtMs: number, now: number): void {
    if (!this.governorEnabled) return;
    this.frameTimes.push(dtMs);
    if (this.frameTimes.length > 180) this.frameTimes.shift();

    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const next = nextTier({
      tier: this.currentTier,
      p90Ms: sorted[Math.floor(sorted.length * 0.9)] ?? 16,
      samples: this.frameTimes.length,
      sinceChangeMs: now - this.lastTierChange,
      sinceDemotionMs: this.lastDemotion === null ? Infinity : now - this.lastDemotion,
    });
    if (!next || next === this.currentTier) return;

    if (isDemotion(this.currentTier, next)) this.lastDemotion = now;
    this.currentTier = next;
    this.lastTierChange = now;
    this.frameTimes.length = 0;
    this.onTierChange?.(next);
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
