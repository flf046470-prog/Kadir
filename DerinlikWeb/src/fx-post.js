import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// fx-post: the image as a lens and a sensor would record it.
// Render -> bloom on HDR highlights -> tone mapping -> a display-space finishing pass with a
// per-chapter grade, lens vignette, sensor grain, slight chromatic aberration, Echo distortion and the camcorder look
// (DV NightShot: desaturated, green-cast, interlaced, noisy, blooming). 'low' renders the plain image.
// Screen-space AO (GTAOPass) was tried and left out: it crashed the software GPU used for testing, so it could not be
// verified. Contact shadowing comes from the baked AO in the PBR sets instead.

const PASS_GRADE = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
    uLift: { value: new THREE.Vector3() }, uGain: { value: new THREE.Vector3(1, 1, 1) }, uSat: { value: 1 },
    uVignette: { value: .32 }, uGrain: { value: .035 }, uCA: { value: .0012 },
    uCam: { value: 0 }, uEcho: { value: 0 }, uPulse: { value: 0 },
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes;
    uniform vec3 uLift; uniform vec3 uGain; uniform float uSat;
    uniform float uVignette; uniform float uGrain; uniform float uCA; uniform float uCam; uniform float uEcho; uniform float uPulse;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv, c = uv - .5;
      // Echo: the world breathes; the Second Voice tears the image sideways for a moment
      float wob = uEcho * .0006 + uPulse * .01;
      uv.x += sin(uv.y * 23.0 + uTime * 2.3) * wob + sin(uv.y * 71.0 - uTime * 5.0) * wob * .35;
      // lens: lateral chromatic aberration grows towards the edges (and with the Echo)
      float ca = uCA * (1.0 + uEcho * .6 + uPulse * 4.0) * dot(c, c) * 4.0;
      vec3 col = vec3(texture2D(tDiffuse, uv + c * ca).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - c * ca).b);
      // grade (display space): lift/gain per chapter, then saturation
      col = col * uGain + uLift * (1.0 - col);
      float l = dot(col, vec3(.2126, .7152, .0722));
      col = mix(vec3(l), col, uSat);
      // camcorder: Sony-style NightShot on a 2000s DV tape
      if (uCam > 0.0) {
        float il = mod(floor(gl_FragCoord.y), 2.0);                                       // interlace lines
        vec3 dv = mix(vec3(l), col, .38) * vec3(.86, 1.05, .9);                          // desaturated, green cast
        dv += vec3(.02, .035, .025) * smoothstep(.55, 1.0, l);                           // highlights smear
        dv *= .94 + .06 * il;
        dv += (hash(gl_FragCoord.xy + fract(uTime * 7.0) * 100.0) - .5) * .09;            // sensor noise in the dark
        col = mix(col, dv, uCam);
      }
      // lens vignette (cos^4 falloff, softened) and film grain stronger in the shadows
      float v = 1.0 - uVignette * smoothstep(.15, .85, length(c * vec2(uRes.x / uRes.y, 1.0)) * 1.05);
      col *= v;
      float g = hash(gl_FragCoord.xy * .7 + fract(uTime) * 311.0) - .5;
      col += g * uGrain * (1.0 - l * .7);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

// Per chapter: lift (shadow tint), gain (highlight tint), saturation. Measured by eye against reference photos of
// basements under tungsten, Cappadocian tuff under oil lamps, Soviet bunkers under fluorescent tubes, Paris catacombs.
const GRADES = [
  { lift: [.006, .005, .008], gain: [1.02, 1.0, .96], sat: .88 },   // Sakarya: tungsten, cold shadows
  { lift: [.01, .006, .003], gain: [1.04, .99, .92], sat: .92 },    // Nevşehir: warm stone, ochre
  { lift: [.0, .008, .01], gain: [.95, 1.0, 1.03], sat: .8 },       // SIFIR-17: teal-grey cold
  { lift: [.008, .006, .004], gain: [1.03, 1.0, .94], sat: .86 },   // Paris: candle amber, limestone
];

let composer = null, renderPass, bloomPass, outputPass, gradePass;
const size = new THREE.Vector2();
function build() {
  renderer.getSize(size);
  composer = new EffectComposer(renderer);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(size.x, size.y);
  renderPass = new RenderPass(scene, camera); composer.addPass(renderPass);
  // only true light sources bloom: bulb glass, flames, the gate core (linear HDR > ~2); lit walls never do
  bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), .3, .35, 2.2);
  composer.addPass(bloomPass);
  outputPass = new OutputPass(); composer.addPass(outputPass);
  gradePass = new ShaderPass(PASS_GRADE); composer.addPass(gradePass);
  applyQuality();
}
function applyQuality() {
  const qy = FX.quality;
  if (qy === 'low') { FX.render = null; canvasFilter(false); return; }
  if (!composer) { build(); return; }
  bloomPass.strength = qy === 'high' ? .3 : .25;
  gradePass.uniforms.uGrain.value = qy === 'high' ? .035 : .028;
  FX.render = (dt) => { composer.render(dt); };
  canvasFilter(true);
}
// the core styles the camcorder with a CSS filter on #view.cam; the shader does it now
let filterStyle = null;
function canvasFilter(shaderOwnsIt) {
  if (shaderOwnsIt && !filterStyle) { filterStyle = document.createElement('style'); filterStyle.textContent = '#view.cam{filter:none!important}'; document.head.appendChild(filterStyle); }
  if (!shaderOwnsIt && filterStyle) { filterStyle.remove(); filterStyle = null; }
}

let camK = 0, pulse = 0, echo = 0;
FX.on('init', applyQuality);
FX.on('quality', applyQuality);
FX.on('resize', (w, h) => { if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); bloomPass.resolution.set(w / 2, h / 2); } });
FX.on('chapter', (i) => {
  const g = GRADES[i] || GRADES[0];
  if (!gradePass) return;
  gradePass.uniforms.uLift.value.set(...g.lift); gradePass.uniforms.uGain.value.set(...g.gain); gradePass.uniforms.uSat.value = g.sat;
});
FX.on('echo', (lvl) => { echo = lvl; });
FX.on('say', (who) => { if (who === 'İkinci Ses') pulse = 1; });
FX.on('catch', () => { pulse = 1.4; });
FX.on('transit', () => { pulse = .8; });
FX.on('draw', (dt) => {
  if (!gradePass || !FX.render) return;
  camK += ((state.camRaised ? 1 : 0) - camK) * Math.min(1, (dt || .016) * 10);
  pulse = Math.max(0, pulse - (dt || .016) * 1.6);
  const u = gradePass.uniforms;
  u.uTime.value = performance.now() / 1000; u.uCam.value = camK; u.uEcho.value = echo / 8; u.uPulse.value = pulse;
  renderer.getSize(size); u.uRes.value.copy(size);
  // the camcorder's auto-gain blows highlights a little more than the eye (but never hides what it reveals)
  bloomPass.strength = (FX.quality === 'high' ? .3 : .25) + camK * .1;
});
