import * as THREE from 'three';

/**
 * The environment map, built from a procedural sky instead of a downloaded HDRI.
 *
 * Image-based lighting is the single largest thing missing from this renderer. A `MeshStandardMaterial`
 * with nothing to reflect is *flatter* than the Lambert material it replaces — it has a specular
 * term and no light to put in it, so smooth surfaces come out dark and dead. Ice is the worst case
 * and the glacier is half ice.
 *
 * Generated rather than fetched for the same reasons the textures are: nothing to download on a
 * phone, no licence to clear on a web-delivered game where every file is extractable, works
 * offline, and it can take each level's own sky colour — the jungle's warm blue and the glacier's
 * pale grey light their worlds differently without shipping two HDRIs.
 *
 * It is not a physically measured sky and does not need to be. What a reflection has to get right
 * is *direction* and *rough magnitude*: bright above, darker below, a hot spot where the sun is.
 * Beyond that the PMREM blur removes the detail anyway.
 */

/** Vertical gradient with a sun disc, evaluated per fragment on the inside of a box. */
const SKY_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;

const SKY_FRAGMENT = /* glsl */ `
  varying vec3 vDir;
  uniform vec3 uSky;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunDir;
  uniform float uSunStrength;

  void main() {
    vec3 dir = normalize( vDir );

    // Two gradients rather than one: sky to horizon above, horizon to ground below. A single
    // top-to-bottom ramp puts the brightest part of the "ground" right at the horizon, which
    // lights the undersides of everything as though the floor were glowing.
    float up = dir.y;
    vec3 colour = up > 0.0
      ? mix( uHorizon, uSky, pow( clamp( up, 0.0, 1.0 ), 0.65 ) )
      : mix( uHorizon, uGround, pow( clamp( -up, 0.0, 1.0 ), 0.5 ) );

    // The sun: a wide soft lobe plus a small hot core. The lobe is what actually shapes a specular
    // highlight once the PMREM blur has smeared the core away at high roughness.
    float cosAngle = dot( dir, normalize( uSunDir ) );
    float lobe = pow( clamp( cosAngle, 0.0, 1.0 ), 48.0 );
    float core = smoothstep( 0.9985, 0.9995, cosAngle );
    colour += uSunStrength * ( lobe * 0.6 + core * 8.0 );

    gl_FragColor = vec4( colour, 1.0 );
  }
`;

export interface SkyOptions {
  /** The level's own sky colour, used for the zenith. */
  skyColor: number;
  /** The level's `ambientColor` — the light bouncing back off its ground. */
  groundColor: number;
  /** Direction the sun sits in, matching the directional light so highlights agree with shadows. */
  sunDirection: THREE.Vector3;
  /** Scales the sun lobe. Dropped in enclosed places so a cave does not reflect an outdoor sun. */
  sunStrength?: number;
}

/**
 * Render a sky into a PMREM-filtered environment texture.
 *
 * The caller owns the result and must dispose it; `Renderer` rebuilds one per level and disposes
 * the previous, because a level change is rare and an environment texture is a few megabytes of
 * GPU memory that would otherwise accumulate for the session.
 */
export function buildSkyEnvironment(renderer: THREE.WebGLRenderer, options: SkyOptions): THREE.Texture {
  const sky = new THREE.Color(options.skyColor);
  const ground = new THREE.Color(options.groundColor);

  // The horizon is a desaturated blend of the two. Taking it straight from the sky colour leaves a
  // hard band where the gradient turns over, which reads as a seam in every reflection.
  const horizon = sky.clone().lerp(ground, 0.45).lerp(new THREE.Color(0xffffff), 0.25);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSky: { value: sky },
      uHorizon: { value: horizon },
      uGround: { value: ground },
      uSunDir: { value: options.sunDirection.clone().normalize() },
      uSunStrength: { value: options.sunStrength ?? 1 },
    },
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    // The sky is authored in linear values on purpose — it is a light source, not a picture, so it
    // must not be pushed through the sRGB transfer function on the way in.
    toneMapped: false,
  });

  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), material);
  scene.add(mesh);

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const target = pmrem.fromScene(scene, 0.02, 0.1, 100);

  // Everything here is scaffolding; only the render target's texture outlives the call.
  mesh.geometry.dispose();
  material.dispose();
  pmrem.dispose();

  return target.texture;
}
