import * as THREE from 'three';
import type { LevelDef, QualityTier, Settings } from '@kc/core';
import { profileFor } from '../platform/Platform.js';
import type { PerformanceProfile, PlatformKind } from '../platform/Platform.js';
import { isDemotion, nextTier } from './governor.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { buildSkyEnvironment } from './sky.js';

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
  /**
   * How much of the environment map's indirect light survives.
   *
   * Added when image-based lighting arrived, and not optional: `scene.environment` lights every
   * surface from every direction and `setDarkness` did not control it, so the first build with IBL
   * turned the cave back into an evenly lit room and silently undid the darkness work. Anything
   * that puts light into the scene has to dim with the rest of it.
   */
  envIntensity: number;
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
 * **Fog is only darkness if the fog is darker than what it hides.** The first version of this
 * ramped the density hard and the sky gently, and a screenshot from inside the cave came back
 * *brighter* than the same camera with the feature switched off: thick fog toward a 38%-of-sky
 * blue does not hide a cave, it fills it with sky. Measured at +2.4% where it was meant to be
 * far below. So the sky is now the aggressive half of the pair — at full darkness it keeps 5% of
 * the level's colour, which is an unlit interior rather than dusk — and density only decides how
 * quickly the geometry disappears into it.
 *
 * The ramp is a smoothstep rather than a line because the two ends want opposite things. A zone
 * declaring 0.05 is saying "very slightly enclosed" and must be indistinguishable from open air;
 * a linear 0.95 factor took 5% off the sky of the ordinary jungle, which is a visible dimming of
 * the whole map for a value that meant nothing. Smoothstep is flat at both ends and steep in the
 * middle, so 0.05 costs 0.7% and 0.75 costs 84%.
 *
 * The two light floors are the constraint that keeps "dark" playable, and they are floors rather
 * than gentle coefficients so that tuning the ramp can never quietly erase them. Without a sun a
 * cave has no edges at all and this game asks players to jump between ledges in there; without a
 * little hemisphere fill every surface the sun misses is pure black. The sky has no floor worth
 * defending, because a cave that opens onto nothing really should read as nothing.
 */
const SUN_FLOOR = 0.32;
const HEMI_FLOOR = 0.18;
/**
 * The environment keeps a tenth of its strength underground.
 *
 * Not zero, because the environment is what gives a smooth surface anything to reflect: an ice
 * column in an unlit crevasse with no indirect light at all goes matte black and loses its shape
 * entirely, which is worse than being a little brighter than a real cave would be.
 */
const ENV_FLOOR = 0.1;

export function darknessValues(darkness: number, baseFogDensity: number): DarknessValues {
  const amount = Number.isFinite(darkness) ? Math.max(0, Math.min(1, darkness)) : 0;
  const t = amount * amount * (3 - 2 * amount);
  return {
    amount,
    skyScale: 1 - t * 0.95,
    fogDensity: baseFogDensity * (1 + t * 5.5),
    hemiIntensity: HEMI_BASE * Math.max(HEMI_FLOOR, 1 - t * 0.88),
    sunIntensity: SUN_BASE * Math.max(SUN_FLOOR, 1 - t * 0.7),
    envIntensity: Math.max(ENV_FLOOR, 1 - t * 0.9),
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
  /** Scratch for the sRGB components of the sky, so `setDarkness` allocates nothing per frame. */
  private skyRgb = { r: 1, g: 1, b: 1 };
  private darkness = 0;
  /**
   * The level's image-based lighting, rebuilt per level and disposed with the old one.
   *
   * Held rather than left on the scene alone because it is a render target of a few megabytes and
   * a session that visits both maps repeatedly would otherwise accumulate one per visit.
   */
  private environment: THREE.Texture | null = null;
  /**
   * The post-processing chain, or null when the profile does not want one.
   *
   * `Settings.postProcessing` has existed since the settings screen did — offered as a toggle, set
   * true on the high profile — and had no consumer anywhere in the codebase. It switched nothing.
   */
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;

  private profile: PerformanceProfile;
  /** Kept so a settings change can recompute the profile — `profileFor` needs the platform. */
  private readonly platform: PlatformKind;
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
    this.platform = options.platform;
    this.pixelRatio = options.pixelRatio;

    this.renderer = new THREE.WebGLRenderer({
      antialias: options.profile.antialias,
      powerPreference: options.platform === 'mobile' ? 'low-power' : 'high-performance',
      alpha: false,
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // ACES filmic, replacing three.js's default of no tone mapping at all.
    //
    // Without it, anything brighter than white is clipped flat — which is most of a snowfield lit
    // by a sun and an environment — so highlights lose all their shape and the picture reads as
    // washed out rather than bright. ACES rolls those values off instead, and it is the curve the
    // rest of the industry grades against, so colours chosen here look the same elsewhere.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
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

    // Ground colour is a placeholder until `applyLevel` reads the level's own — 0x3d5232 is the
    // jungle floor, and it was the bounce light on every map until levels got to choose.
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
    this.buildComposer();
    this.onResize();
  }

  /**
   * Build or tear down the post-processing chain for the current profile.
   *
   * Never runs in VR, and the profile enforces that rather than this code trusting itself to: an
   * `EffectComposer` renders the scene into its own target, and WebXR owns the render target per
   * eye, so a composer in a headset renders one eye's worth of the wrong thing. `profileFor` sets
   * `postProcessing = false` for the VR platform outright.
   *
   * Tone mapping moves to `OutputPass` here, and is not applied twice: three.js only tone-maps when
   * the destination is the canvas or an XR target, so rendering into the composer's buffer skips
   * it and the final pass performs it once, reading the same `renderer.toneMapping` set in the
   * constructor.
   */
  private buildComposer(): void {
    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;
    if (!this.profile.postProcessing) return;

    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));

    /**
     * Bloom, thresholded above what a *diffuse* surface can produce.
     *
     * The first attempt used 0.85, the value most examples ship, and the glacier came back washed
     * to near-white while the jungle looked right — which is the whole diagnosis: the threshold is
     * compared against linear radiance before tone mapping, and a white snowfield with albedo 0.9
     * under a sun at 1.9 plus the environment sits around 1.2 to 1.8. The entire floor qualified as
     * a highlight, so bloom stopped being a highlight effect and became a fog.
     *
     * Above 2.0 only things genuinely brighter than a lit white surface spill: the sun's specular
     * glint off ice, a crystal, a torch. Strength can then be higher than it could when everything
     * qualified, because far less of the screen does.
     */
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.5, 2);
    composer.addPass(bloom);
    this.bloom = bloom;

    composer.addPass(new OutputPass());
    this.composer = composer;
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

    // The bounce light. `LevelDef.ambientColor` is declared by every level — the jungle's forest
    // 0x4c6b3f, the glacier's cold 0x6d8ba8 — and nothing had ever read it, so the hemisphere's
    // lower colour stayed fixed at the jungle floor green for every map.
    //
    // Only the ground half is bound. Rebinding the sky half to `level.skyColor` was tried first
    // and measured: it moved the glacier *away* from blue, because the hand-picked 0xbfe6ff is a
    // more saturated tint than the pale sky the map wants behind its horizon. `skyColor` already
    // has two jobs — background and fog — and a third that fights them is not an improvement.
    //
    // Worth knowing how small this is. `groundColor` lights surfaces facing *downward*, and a map
    // of floors seen from above has almost none, so the honest delta here is a percent or two on
    // undersides and overhangs. It is correct rather than dramatic: a declared field that nothing
    // read now reads, and a map that wants cold bounce light gets it.
    if (this.hemi) this.hemi.groundColor.set(level.ambientColor);

    // Image-based lighting, built from this level's own sky and ground rather than a downloaded
    // HDRI. It is what makes a `MeshStandardMaterial` worth having: with nothing to reflect, a
    // standard material is *flatter* than the lambert one it replaces, because it has a specular
    // term and no light to put in it. Ice is the worst case and half the glacier is ice.
    //
    // The sun direction is taken from the directional light rather than restated, so a highlight
    // in a reflection always agrees with the direction the shadows fall.
    this.environment?.dispose();
    this.environment = buildSkyEnvironment(this.renderer, {
      skyColor: level.skyColor,
      groundColor: level.ambientColor,
      sunDirection: this.sun.position.clone().normalize(),
    });
    this.scene.environment = this.environment;

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

    // Scaled in sRGB, not linear, because `skyScale` is a statement about how dark the sky should
    // *look*. `Color.multiplyScalar` works in the renderer's linear working space, where halving a
    // channel only takes about a quarter off the displayed brightness — the first attempt asked
    // for a fifth of the sky inside the cave and a screenshot came back at roughly half, still
    // reading as an overcast afternoon. Converting out, scaling, and converting back makes the
    // number mean what the zone data intends.
    this.baseSkyColor.getRGB(this.skyRgb, THREE.SRGBColorSpace);
    const sky = new THREE.Color().setRGB(
      this.skyRgb.r * values.skyScale,
      this.skyRgb.g * values.skyScale,
      this.skyRgb.b * values.skyScale,
      THREE.SRGBColorSpace,
    );
    this.scene.background = sky;
    const fog = this.scene.fog;
    if (fog instanceof THREE.FogExp2) {
      fog.color.copy(sky);
      fog.density = values.fogDensity;
    }

    if (this.hemi) this.hemi.intensity = values.hemiIntensity;
    this.sun.intensity = values.sunIntensity;
    // The environment lights every surface from every direction, so it has to dim with the rest or
    // a cave is simply a room with thicker fog. Missing this is how the first build with IBL threw
    // away the whole darkness feature without changing a line of it.
    this.scene.environmentIntensity = values.envIntensity;
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
    // The governor can drop a tier mid-match, and post-processing is one of the things a dropped
    // tier gives up — so the chain is rebuilt rather than left running at the old cost.
    this.buildComposer();
    this.onResize();
  }

  get tier(): QualityTier {
    return this.currentTier;
  }

  /** The profile in force right now, which is not the one the caller was constructed with. */
  get currentProfile(): PerformanceProfile {
    return this.profile;
  }

  setGovernorEnabled(enabled: boolean): void {
    this.governorEnabled = enabled;
  }

  /**
   * Apply a settings change to what is actually rendered.
   *
   * This used to set one boolean and stop, which meant every graphics setting on the Settings
   * screen was inert. `profileFor` reads shadows, post-processing, render scale, draw distance,
   * detailed players and target FPS out of the settings — and nothing recomputed the profile when
   * they changed. A player turning shadows off to claw back frame rate saw the toggle move and
   * nothing else, until the governor happened to change tier for its own reasons and quietly
   * applied their choice minutes later.
   *
   * With `quality: 'auto'` the governor still owns the tier, so the current one is kept and only
   * the explicit settings are re-applied over it. With a tier chosen by hand that tier wins and
   * the governor is off.
   */
  applySettings(settings: Settings): void {
    this.governorEnabled = settings.graphics.quality === 'auto';
    const tier = settings.graphics.quality === 'auto' ? this.currentTier : settings.graphics.quality;
    this.setProfile(profileFor(this.platform, tier, settings), tier);
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
      floorFps: this.profile.targetFps,
    });
    if (!next || next === this.currentTier) return;

    if (isDemotion(this.currentTier, next)) this.lastDemotion = now;
    this.currentTier = next;
    this.lastTierChange = now;
    this.frameTimes.length = 0;
    this.onTierChange?.(next);
  }

  render(): void {
    // `isPresenting` is checked as well as the profile because a session can begin after the
    // renderer was built — the player enters VR from a desktop page — and a composer left running
    // into an XR frame renders one eye of the wrong buffer.
    if (this.composer && !this.renderer.xr.isPresenting) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
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
    this.composer?.dispose();
    this.environment?.dispose();
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
    // The composer owns render targets sized in device pixels, so it needs the pixel ratio applied
    // — `setSize` on the renderer does that itself, `EffectComposer.setSize` does not.
    const ratio = this.renderer.getPixelRatio();
    this.composer?.setSize(width * ratio, height * ratio);
    this.bloom?.setSize(width * ratio, height * ratio);
  };
}
