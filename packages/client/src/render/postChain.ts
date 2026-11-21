import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * MSAA samples on the composer's buffers when the profile wants antialiasing.
 *
 * `antialias: true` on the `WebGLRenderer` multisamples the *canvas* only. With post-processing on,
 * the scene is drawn into the composer's own render target, which three.js creates with no samples
 * at all — so the high tier, the one profile that both antialiases and post-processes, was the one
 * tier drawn with hard stair-stepped edges.
 */
export const COMPOSER_SAMPLES = 4;

/**
 * Ambient occlusion: the dimming of light in creases, under overhangs and where one thing stands on
 * another — the part of indirect light a single directional sun and a sky can never produce, and
 * what a game engine's global illumination is mostly paying for at play distance.
 *
 * World units (metres), not screen space, so the darkening under a boulder is the same size close up
 * and far away. 0.9 m is about half a kangaroo: enough to ground a rock or a trunk in the floor and
 * shade a cave corner, not so much that every wall grows a dark halo.
 */
export const AO_RADIUS = 0.9;
export const AO_THICKNESS = 1;
/**
 * How strongly the occlusion is multiplied into the picture. Below 1 because the hemisphere light
 * and the environment map already darken undersides a little; at 1 the two compound and crevices go
 * near black.
 */
export const AO_INTENSITY = 0.85;

/**
 * Whether an object would be drawn wrongly into the AO pass's normal and depth buffer.
 *
 * `GTAOPass` draws every visible mesh with one opaque `MeshNormalMaterial`. Anything the picture
 * does not draw as a solid surface then occludes as one: the comfort vignette is a quad on the
 * camera and would darken the whole screen, the cage's blended fence would cast a dark wall, a
 * role ring at opacity 0 would put a shadow under every player, and a sprite (name tags) would be
 * drawn as a camera-facing card. The pass itself only hides points and lines.
 */
export function skipInNormalPass(object: THREE.Object3D): boolean {
  if (!object.visible) return false;
  if ((object as THREE.Points).isPoints || (object as THREE.Line).isLine) return true;
  if ((object as THREE.Sprite).isSprite) return true;
  const material = (object as THREE.Mesh).material;
  if (!material) return false;
  const list = Array.isArray(material) ? material : [material];
  return list.some((m) => m.transparent || !m.depthWrite || !m.visible);
}

/** `GTAOPass` with the normal pass limited to what is drawn as a solid surface. */
export class SolidGtaoPass extends GTAOPass {
  private hidden: THREE.Object3D[] = [];

  // Both overrides replace private methods of `GTAOPass`, which has no typed declaration for them.
  _overrideVisibility(): void {
    const hidden = this.hidden;
    this.scene.traverse((object) => {
      if (skipInNormalPass(object)) {
        object.visible = false;
        hidden.push(object);
      }
    });
  }

  _restoreVisibility(): void {
    for (const object of this.hidden) object.visible = true;
    this.hidden.length = 0;
  }
}

export interface PostChain {
  composer: EffectComposer;
  ao: SolidGtaoPass;
  bloom: UnrealBloomPass;
}

export interface PostChainOptions {
  antialias: boolean;
}

/**
 * The flat-screen post-processing chain: scene → ambient occlusion → bloom → tone mapping.
 *
 * Tone mapping happens once, in `OutputPass`: three.js only tone-maps when it draws to the canvas or
 * an XR target, so the scene drawn into the composer's buffer is left linear.
 */
export function buildPostChain(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  options: PostChainOptions,
): PostChain {
  const size = renderer.getSize(new THREE.Vector2());
  const ratio = renderer.getPixelRatio();
  const target = new THREE.WebGLRenderTarget(Math.max(1, size.x * ratio), Math.max(1, size.y * ratio), {
    type: THREE.HalfFloatType,
    samples: options.antialias ? COMPOSER_SAMPLES : 0,
  });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));

  const ao = new SolidGtaoPass(scene, camera, Math.max(1, size.x * ratio), Math.max(1, size.y * ratio));
  // Every prop and log ships without a normal attribute and is drawn with `flatShading`, which
  // derives normals from screen-space derivatives. The pass's own `MeshNormalMaterial` is not flat,
  // so it read a missing attribute as zero and every log, bush and fern came out fully occluded —
  // near black in a real frame. Flat normals are the true face normals, which is what AO wants.
  ao.normalMaterial.flatShading = true;
  ao.updateGtaoMaterial({ radius: AO_RADIUS, thickness: AO_THICKNESS, distanceExponent: 1, scale: 1, samples: 16 });
  ao.blendIntensity = AO_INTENSITY;
  composer.addPass(ao);

  /**
   * Bloom, thresholded above what a *diffuse* surface can produce.
   *
   * The first attempt used 0.85, the value most examples ship, and the glacier came back washed to
   * near-white while the jungle looked right — the threshold is compared against linear radiance
   * before tone mapping, and a white snowfield under the sun plus the environment sits around 1.2 to
   * 1.8. Above 2.0 only things genuinely brighter than a lit white surface spill: the sun's glint off
   * ice, a crystal, a portal veil.
   */
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.5, 2);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const chain = { composer, ao, bloom };
  // A composer given its own target takes that target's size, in device pixels, as its CSS size.
  resizePostChain(chain, renderer, size.x, size.y);
  return chain;
}

/**
 * Free the chain's GPU buffers. `EffectComposer.dispose` frees its own two buffers and not its
 * passes', so a governor dropping and regaining a tier used to leave bloom's mip chain behind each
 * time.
 */
export function disposePostChain(chain: PostChain): void {
  for (const pass of chain.composer.passes) pass.dispose();
  chain.composer.dispose();
}

/**
 * Resize the chain to a canvas of `width` × `height` CSS pixels.
 *
 * `EffectComposer.setSize` applies the pixel ratio itself, to every buffer and every pass. The
 * renderer used to hand it device pixels as well, so on a 2× display the composer drew at four times
 * the canvas's pixel count — sixteen times a 1× screen's — and bloom, resized separately, at a
 * quarter of that.
 */
export function resizePostChain(chain: PostChain, renderer: THREE.WebGLRenderer, width: number, height: number): void {
  chain.composer.setPixelRatio(renderer.getPixelRatio());
  chain.composer.setSize(width, height);
}
