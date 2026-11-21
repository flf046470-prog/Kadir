import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { COMPOSER_SAMPLES, buildPostChain, disposePostChain, resizePostChain, skipInNormalPass } from './postChain.js';

/** Enough of a `WebGLRenderer` for the chain to be built and sized; nothing here draws. */
function fakeRenderer(width: number, height: number, ratio: number): THREE.WebGLRenderer {
  return {
    getPixelRatio: () => ratio,
    getSize: (v: THREE.Vector2) => v.set(width, height),
  } as unknown as THREE.WebGLRenderer;
}

function chain(antialias = true, ratio = 2) {
  const renderer = fakeRenderer(800, 450, ratio);
  return { renderer, post: buildPostChain(renderer, new THREE.Scene(), new THREE.PerspectiveCamera(), { antialias }) };
}

describe('post-processing chain', () => {
  it('multisamples the scene buffer when the profile antialiases', () => {
    expect(chain(true).post.composer.renderTarget1.samples).toBe(COMPOSER_SAMPLES);
    expect(chain(true).post.composer.renderTarget2.samples).toBe(COMPOSER_SAMPLES);
    expect(chain(false).post.composer.renderTarget1.samples).toBe(0);
  });

  it('draws at the canvas’s device pixels, not the pixel ratio squared', () => {
    const { renderer, post } = chain(true, 2);
    expect(post.composer.renderTarget1.width).toBe(1600);
    resizePostChain(post, renderer, 1000, 500);
    expect(post.composer.renderTarget1.width).toBe(2000);
    expect(post.composer.renderTarget1.height).toBe(1000);
    // Bloom and AO are sized by the composer with everything else.
    expect(post.ao.width).toBe(2000);
  });

  it('runs ambient occlusion before bloom and tone mapping last', () => {
    const names = chain().post.composer.passes.map((p) => p.constructor.name);
    expect(names.indexOf('SolidGtaoPass')).toBe(1);
    expect(names.indexOf('UnrealBloomPass')).toBeGreaterThan(1);
    expect(names.at(-1)).toBe('OutputPass');
  });

  it('frees every pass’s buffers', () => {
    const { post } = chain();
    let freed = 0;
    for (const pass of post.composer.passes) {
      const own = pass.dispose.bind(pass);
      pass.dispose = () => {
        freed++;
        own();
      };
    }
    disposePostChain(post);
    expect(freed).toBe(post.composer.passes.length);
  });
});

describe('the AO normal pass', () => {
  const mesh = (params: THREE.MeshBasicMaterialParameters = {}) =>
    new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(params));

  it('keeps solid surfaces and drops what is not drawn as one', () => {
    expect(skipInNormalPass(mesh())).toBe(false);
    expect(skipInNormalPass(mesh({ transparent: true, opacity: 0 }))).toBe(true);
    expect(skipInNormalPass(mesh({ depthWrite: false }))).toBe(true);
    expect(skipInNormalPass(new THREE.Sprite())).toBe(true);
    expect(skipInNormalPass(new THREE.Points())).toBe(true);
    expect(skipInNormalPass(new THREE.Group())).toBe(false);
  });

  it('hides them only for the normal pass and puts them back', () => {
    const { post } = chain();
    const scene = post.ao.scene;
    const solid = mesh();
    const ring = mesh({ transparent: true });
    const tag = new THREE.Sprite();
    scene.add(solid, ring, tag);
    post.ao._overrideVisibility();
    expect([solid.visible, ring.visible, tag.visible]).toEqual([true, false, false]);
    post.ao._restoreVisibility();
    expect([solid.visible, ring.visible, tag.visible]).toEqual([true, true, true]);
  });
});
