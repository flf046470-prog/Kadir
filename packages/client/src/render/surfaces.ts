import * as THREE from 'three';
import { surfaceTextureData } from './textures.js';
import type { PerformanceProfile } from '../platform/Platform.js';
import type { SurfaceMaterial } from '@kc/core';

/**
 * Turns generated texture data into three.js materials.
 *
 * The world is drawn with `InstancedMesh`: one unit box scaled per instance, so a 124 m floor and a
 * 1 m boulder share the same geometry and therefore the same UVs. Per-instance UV scaling is not
 * available without giving up instancing, which is what keeps the whole jungle inside a few dozen
 * draw calls.
 *
 * So the texture coordinate comes from *world position* instead, sampled on all three axes and
 * blended by the surface normal — triplanar mapping. It gives every instance the same texel density
 * whatever its size, needs no UVs at all, and has no seams at box corners. It costs three samples
 * per map instead of one, which is why it is tiered rather than always on.
 */

/** How much world space one texture tile covers, in metres. Larger reads as coarser stone. */
const TILE_METRES: Partial<Record<SurfaceMaterial, number>> = {
  dirt: 3,
  rock: 4,
  wood: 2.5,
  foliage: 2,
  water: 6,
  metal: 2,
  sand: 2.5,
  stone: 3.5,
  ice: 6,
  snow: 3,
};

/**
 * What each tier can afford.
 *
 * The flags are separate rather than one number because they cost very differently: dropping the
 * normal map saves a third of the samples, dropping triplanar saves two thirds of what is left, and
 * dropping textures entirely still leaves a Standard material lit by the environment — which is
 * most of the improvement and costs nothing per pixel.
 */
export interface SurfaceQuality {
  textures: boolean;
  normalMap: boolean;
  triplanar: boolean;
  size: number;
}

export function surfaceQualityFor(profile: PerformanceProfile): SurfaceQuality {
  // Keyed off the same numbers the profile already uses to decide shadows and draw distance, so a
  // device that cannot afford shadows is never handed a 1024² normal map either.
  if (!profile.shadows) return { textures: false, normalMap: false, triplanar: false, size: 0 };
  if (profile.shadowMapSize <= 1024) return { textures: true, normalMap: false, triplanar: true, size: 256 };
  return { textures: true, normalMap: true, triplanar: true, size: 512 };
}

/**
 * Build the three textures for a material.
 *
 * Cached per (material, size) for the lifetime of the page: the same ice appears on hundreds of
 * colliders and in both maps, and generating a 512² set costs real milliseconds.
 */
const cache = new Map<string, { map: THREE.DataTexture; normalMap: THREE.DataTexture; ormMap: THREE.DataTexture }>();

function texturesFor(material: SurfaceMaterial, size: number) {
  const key = `${material}:${size}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const data = surfaceTextureData(material, size);
  const make = (bytes: Uint8ClampedArray, srgb: boolean): THREE.DataTexture => {
    const texture = new THREE.DataTexture(new Uint8Array(bytes.buffer.slice(0)), size, size, THREE.RGBAFormat);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 4;
    // Only the albedo is colour. A normal map or a roughness value pushed through the sRGB curve
    // comes back as the wrong number, which shows up as lighting that is subtly but consistently
    // wrong and is very hard to see as a cause.
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  };

  const built = {
    map: make(data.albedo, true),
    normalMap: make(data.normal, false),
    ormMap: make(data.orm, false),
  };
  cache.set(key, built);
  return built;
}

/** Drop every cached texture. Called when the renderer is disposed, not between levels. */
export function disposeSurfaceTextures(): void {
  for (const set of cache.values()) {
    set.map.dispose();
    set.normalMap.dispose();
    set.ormMap.dispose();
  }
  cache.clear();
}

/**
 * Rewrite a standard material's shader to sample in world space on three axes.
 *
 * Done with `onBeforeCompile` rather than a custom `ShaderMaterial` so the material keeps
 * everything three.js already does properly — shadows, fog, instancing, tone mapping, the
 * environment map — and only the three lines that decide *where* to sample are replaced.
 *
 * The blend weight is the surface normal raised to a power and normalised: at a box corner the two
 * faces cross-fade rather than switching, which is what removes the hard line a projection-per-face
 * approach leaves behind.
 */
function applyTriplanar(material: THREE.MeshStandardMaterial, tile: number, withNormal: boolean): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTriplanarScale = { value: 1 / tile };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vTriWorld;
         varying vec3 vTriNormal;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
         // worldpos_vertex only defines worldPosition when something else asked for it, so the
         // position is recomputed here rather than depended on.
         vec4 triWorld = modelMatrix * vec4( transformed, 1.0 );
         #ifdef USE_INSTANCING
           triWorld = modelMatrix * instanceMatrix * vec4( transformed, 1.0 );
         #endif
         vTriWorld = triWorld.xyz;
         // Instances carry their own rotation, so the normal has to go through it as well or every
         // rotated box samples as though it were axis-aligned. A plain mat3 rather than the inverse
         // transpose is enough here: every collider is a box, sphere or cylinder scaled along the
         // same axes its faces point down, so the direction survives and the normalize fixes the
         // length.
         #ifdef USE_INSTANCING
           vTriNormal = normalize( mat3( modelMatrix ) * mat3( instanceMatrix ) * objectNormal );
         #else
           vTriNormal = normalize( mat3( modelMatrix ) * objectNormal );
         #endif`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uTriplanarScale;
         varying vec3 vTriWorld;
         varying vec3 vTriNormal;

         vec3 triWeights() {
           // Power 4 keeps each face dominant across most of its area and confines the blend to a
           // narrow band at the corner; lower powers wash the whole surface into a triple average.
           vec3 w = pow( abs( vTriNormal ), vec3( 4.0 ) );
           return w / max( w.x + w.y + w.z, 1e-4 );
         }

         vec4 triSample( sampler2D tex, vec3 w, float scale ) {
           vec4 x = texture2D( tex, vTriWorld.zy * scale );
           vec4 y = texture2D( tex, vTriWorld.xz * scale );
           vec4 z = texture2D( tex, vTriWorld.xy * scale );
           return x * w.x + y * w.y + z * w.z;
         }`,
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
           vec3 triW = triWeights();
           vec4 sampledDiffuseColor = triSample( map, triW, uTriplanarScale );
           diffuseColor *= sampledDiffuseColor;
         #endif`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = roughness;
         #ifdef USE_ROUGHNESSMAP
           roughnessFactor *= triSample( roughnessMap, triWeights(), uTriplanarScale ).g;
         #endif`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `float metalnessFactor = metalness;
         #ifdef USE_METALNESSMAP
           metalnessFactor *= triSample( metalnessMap, triWeights(), uTriplanarScale ).b;
         #endif`,
      )
      .replace(
        '#include <aomap_fragment>',
        `#ifdef USE_AOMAP
           float ambientOcclusion = ( triSample( aoMap, triWeights(), uTriplanarScale ).r - 1.0 ) * aoMapIntensity + 1.0;
           reflectedLight.indirectDiffuse *= ambientOcclusion;
         #endif`,
      );

    if (withNormal) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#ifdef USE_NORMALMAP
           // Whiteout triplanar normal blending.
           //
           // The first version added the sampled tangent normal straight onto the shading normal,
           // which is wrong twice over and measurably so. A tangent-space normal has z near 1
           // pointing out of its own surface, so adding it to a floor's normal tilts that floor
           // about forty-five degrees toward world +Z — every flat surface in the map ends up
           // facing the same wrong way, which lights it uniformly and flattens it. Measured as
           // contrast: the glacier's standard deviation fell from 82 at the tier below to 19 here,
           // with post-processing off, so the normal map was the only suspect left.
           //
           // And three.js shades in *view* space, so even a correctly blended world normal has to
           // be transformed before it is assigned.
           //
           // Whiteout blending reorients each projection's tangent normal around its own axis and
           // then mixes them, which is the standard solution and the only one that keeps a box's
           // three faces consistent with each other.
           // Named apart from the one in the albedo block on purpose: both are spliced into the
           // same scope of main(), and declaring vec3 triW twice is a GLSL redefinition error. It
           // fails the whole program, so the material silently stops drawing — the glacier floor
           // vanished and the map rendered as rocks floating over the sky, with the only clue in a
           // console the screenshot probe was not reporting.
           vec3 triWn = triWeights();
           vec3 triWorldN = normalize( vTriNormal );

           vec3 tnX = texture2D( normalMap, vTriWorld.zy * uTriplanarScale ).xyz * 2.0 - 1.0;
           vec3 tnY = texture2D( normalMap, vTriWorld.xz * uTriplanarScale ).xyz * 2.0 - 1.0;
           vec3 tnZ = texture2D( normalMap, vTriWorld.xy * uTriplanarScale ).xyz * 2.0 - 1.0;

           tnX.xy *= normalScale;
           tnY.xy *= normalScale;
           tnZ.xy *= normalScale;

           tnX = vec3( tnX.xy + triWorldN.zy, abs( tnX.z ) * triWorldN.x );
           tnY = vec3( tnY.xy + triWorldN.xz, abs( tnY.z ) * triWorldN.y );
           tnZ = vec3( tnZ.xy + triWorldN.xy, abs( tnZ.z ) * triWorldN.z );

           vec3 triBlended = normalize(
             tnX.zyx * triWn.x + tnY.xzy * triWn.y + tnZ.xyz * triWn.z
           );

           normal = normalize( ( viewMatrix * vec4( triBlended, 0.0 ) ).xyz );
         #endif`,
      );
    }
  };

  // Changing the shader after a material has been compiled needs a new program.
  material.customProgramCacheKey = () => `triplanar:${tile}:${withNormal ? 1 : 0}`;
  material.needsUpdate = true;
}

export interface SurfaceMaterialOptions {
  /** Base colour when textures are off, and the tint textures are multiplied by when they are on. */
  color: number;
  transparent?: boolean;
  opacity?: number;
  /** Flat shading suits the untextured look; textured surfaces want smooth normals to perturb. */
  flatShading?: boolean;
  /**
   * Take surface *detail* from the texture set but not its colour.
   *
   * For props, which carry their own colour per instance — the foliage tint that makes one canopy
   * a different green from its neighbour. Sampling the albedo as well would multiply two greens
   * together and darken every leaf in the world. This keeps the normal, roughness and occlusion,
   * which is where the sense of a real surface comes from, and drops the one channel that clashes.
   * It is also a sample cheaper.
   */
  detailOnly?: boolean;
  /** Per-instance colour from `InstancedMesh.instanceColor`, or per-vertex colour. */
  vertexColors?: boolean;
}

/**
 * The material for one surface kind.
 *
 * Always `MeshStandardMaterial`, at every tier. Before this the whole game was `MeshLambertMaterial`
 * — no roughness, no metalness, no environment response — so a sheet of ice and a patch of dirt
 * differed only in hue. Standard costs more per pixel than Lambert, but without it the environment
 * map has nothing to reflect off and the textures have no roughness channel to drive, so the two
 * cheapest ways to make this look real are both unavailable.
 */
export function createSurfaceMaterial(
  material: SurfaceMaterial,
  quality: SurfaceQuality,
  options: SurfaceMaterialOptions,
): THREE.MeshStandardMaterial {
  const params: THREE.MeshStandardMaterialParameters = {
    color: options.color,
    roughness: 0.85,
    metalness: 0,
    ...(options.transparent ? { transparent: true, opacity: options.opacity ?? 1 } : {}),
  };

  if (options.vertexColors) params.vertexColors = true;

  if (!quality.textures) {
    // Untextured still benefits from the environment and the tone mapping, so this tier is a long
    // way from where the game started even though it samples nothing.
    return new THREE.MeshStandardMaterial({ ...params, flatShading: options.flatShading ?? true });
  }

  const textures = texturesFor(material, quality.size);
  const standard = new THREE.MeshStandardMaterial({
    ...params,
    // White, because the generated albedo already carries this material's colour. Passing the tint
    // as well multiplies the two, and since both are mid-tones the product is far darker than
    // either: the first build did exactly that and the jungle floor came out near-black while the
    // untextured props beside it stayed bright, which read as a lighting bug rather than a
    // double-multiply.
    color: options.detailOnly ? options.color : 0xffffff,
    ...(options.detailOnly ? {} : { map: textures.map }),
    roughnessMap: textures.ormMap,
    metalnessMap: textures.ormMap,
    aoMap: textures.ormMap,
    roughness: 1,
    metalness: 1,
    ...(quality.normalMap ? { normalMap: textures.normalMap } : {}),
    // Detail-only props keep flat shading: their geometry is deliberately faceted low-poly and
    // smoothing it to carry a normal map would round off the silhouette the art depends on.
    flatShading: options.detailOnly ? (options.flatShading ?? true) : false,
  });

  if (quality.triplanar) {
    applyTriplanar(standard, TILE_METRES[material] ?? 3, quality.normalMap && !options.detailOnly);
  }
  return standard;
}

/** The world size of one tile for a material, exposed for tests and for prop materials. */
export function tileMetres(material: SurfaceMaterial): number {
  return TILE_METRES[material] ?? 3;
}
