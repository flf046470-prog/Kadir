// fx-lighting: how light behaves in a real dark place.
// - Flashlight: an LED reflector cookie (hot centre, reflector ring, soft spill), a single bounce light where the beam
//   lands (a lit wall faintly lights the room around it), and a nervous flicker while the Copy hunts.
// - Lamps: a glare halo on every bulb and flame, hanging bulbs that sway in the draught and swing when a door slams.
// - One shadowed lamp per chapter on 'high'.
// - Reflections: a small environment probe per chapter for the materials marked userData.fxReflective (water, ice).
// Quality: 'low' keeps only the cookie; 'medium' adds halos, sway and a cheaper bounce; 'high' adds the lamp shadow.

const q = () => FX.quality;

/* ---------------------------------------------------------------- flashlight cookie */
function cookieTexture() {
  const n = 256, cv = document.createElement('canvas'); cv.width = cv.height = n;
  const g = cv.getContext('2d'), img = g.createImageData(n, n);
  let s = 1234567; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const smudges = Array.from({ length: 9 }, () => [rnd() * 2 - 1, rnd() * 2 - 1, .05 + rnd() * .12, .05 + rnd() * .08]);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = (x + .5) / n * 2 - 1, v = (y + .5) / n * 2 - 1, r = Math.hypot(u, v);
    let k = Math.exp(-Math.pow(r / .3, 2)) * .9 + .1;                       // hotspot
    k = Math.max(k, .34 * Math.exp(-Math.pow((r - .6) / .05, 2)) + .16);       // reflector edge ring
    k *= 1 - .06 * Math.sin(r * 46) * Math.exp(-r * 1.5);                       // faint reflector facets
    k *= r > .98 ? 0 : Math.min(1, (.98 - r) / .3) * .85 + .15 * (1 - r);       // spill fading to the rim
    for (const [cx, cy, rad, a] of smudges) { const d = Math.hypot(u - cx, v - cy) / rad; if (d < 1) k *= 1 - a * (1 - d * d); } // lens dirt
    const i = (y * n + x) * 4, c = Math.max(0, Math.min(255, k * 255));
    img.data[i] = c; img.data[i + 1] = c * .985; img.data[i + 2] = c * .955; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
torch.map = cookieTexture();
torch.angle = .62; torch.penumbra = .35;   // the cookie now shapes the edge; a wider cone keeps the spill

/* ---------------------------------------------------------------- bounce light */
const bounce = new THREE.PointLight(0xffe8cf, 0, 7, 2); bounce.castShadow = false; scene.add(bounce);
const ray = new THREE.Raycaster(); ray.far = 14;
const rayDir = new THREE.Vector3(), rayFrom = new THREE.Vector3(), nrm = new THREE.Vector3();
let bounceTick = 0, bounceTarget = 0;
function updateBounce() {
  if (!torch.visible || q() === 'low' || !W.occluders.length) { bounceTarget = 0; return; }
  if (bounceTick++ % (q() === 'high' ? 2 : 4)) return;
  torch.getWorldPosition(rayFrom); torch.target.getWorldPosition(rayDir); rayDir.sub(rayFrom).normalize();
  ray.set(rayFrom, rayDir);
  const hit = ray.intersectObjects(W.occluders, false)[0];
  if (!hit || !hit.face) { bounceTarget = 0; return; }
  nrm.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
  bounce.position.copy(hit.point).addScaledVector(nrm, .35);
  // inverse-square from the torch, times a typical wall albedo; the spill keeps a little light even far away
  bounceTarget = torch.intensity * .2 / Math.max(1, hit.distance * hit.distance * .35);
}

/* ---------------------------------------------------------------- flashlight nerves */
let hunted = false, flick = 1;
FX.on('chase', (on) => { hunted = !!on; });
FX.on('catch', () => { flick = 0; });
const TORCH_BASE = torch.intensity;

/* ---------------------------------------------------------------- lamp halos, sway, shadows */
function haloTexture() {
  const n = 128, cv = document.createElement('canvas'); cv.width = cv.height = n;
  const g = cv.getContext('2d'), grd = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(.12, 'rgba(255,255,255,.55)');
  grd.addColorStop(.35, 'rgba(255,255,255,.12)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, n, n);
  return new THREE.CanvasTexture(cv);
}
const haloMap = haloTexture();
let lamps = [], shadowLamp = null;
function setupLamps() {
  lamps = [];
  for (const b of W.lights) {
    const size = b.kind === 'flame' ? .5 : b.kind === 'alarm' ? .7 : .85;
    const m = new THREE.SpriteMaterial({ map: haloMap, color: new THREE.Color(b.color).multiplyScalar(1.6), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: true });
    const s = new THREE.Sprite(m); s.scale.setScalar(size); s.renderOrder = 4; s.userData.shared = true;
    b.group.add(s);
    lamps.push({ b, halo: s, size, home: b.group.position.clone(), ang: 0, vel: 0, amp: .025 + Math.random() * .02, ph: Math.random() * 6.28, swing: b.kind === 'bulb' });
  }
  applyQuality();
}
function pickShadowLamp() {
  if (shadowLamp) { shadowLamp.light.castShadow = false; shadowLamp = null; }
  if (q() !== 'high') return;
  const cand = W.lights.filter((b) => b.kind === 'bulb').sort((a, b) => b.base - a.base)[0];
  if (!cand) return;
  shadowLamp = cand;
  const l = cand.light; l.castShadow = true; l.shadow.mapSize.set(512, 512); l.shadow.bias = -.002; l.shadow.normalBias = .02; l.shadow.camera.near = .1; l.shadow.radius = 3;
}
function applyQuality() {
  const lo = q() === 'low';
  for (const L of lamps) L.halo.visible = !lo;
  pickShadowLamp();
}
FX.on('quality', applyQuality);

const kick = (pos, power, radius) => {
  for (const L of lamps) if (L.swing) { const d = L.home.distanceTo(pos); if (d < radius) L.vel += power * (1 - d / radius) * (Math.random() < .5 ? -1 : 1); }
};
FX.on('slam', (p) => kick(p, 1.2, 10));
FX.on('mover', ({ mesh }) => kick(mesh.position, .6, 9));

/* ---------------------------------------------------------------- environment probe for reflective materials */
let probe = null;
function captureProbe(spec) {
  if (q() === 'low') return;
  const targets = [];
  W.group.traverse((o) => { if (o.material && o.material.userData && o.material.userData.fxReflective) targets.push(o.material); });
  if (!targets.length) return;
  const rt = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType });
  const cam = new THREE.CubeCamera(.05, 40, rt);
  cam.position.set(spec.spawn[0], 1.2, spec.spawn[1]);
  const torchWas = torch.visible; torch.visible = false;
  cam.update(renderer, scene);
  torch.visible = torchWas; applyQuality();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromCubemap(rt.texture);   // a render target: disposing only its texture would leak the framebuffer
  pmrem.dispose(); rt.dispose();
  if (probe) probe.dispose();
  probe = env;
  for (const m of new Set(targets)) { m.envMap = env.texture; m.envMapIntensity = m.opacity < 1 ? .35 : .9; m.needsUpdate = true; }  // ice is matte-ish; water mirrors
}

FX.on('chapter', (i, spec) => {
  setupLamps();
  // let fx-materials finish dressing (textures decode asynchronously) before the probe looks at the room
  const gen = worldGen;
  (FX.materialsReady || Promise.resolve()).then(() => { if (gen === worldGen) try { captureProbe(spec); } catch (e) { console.error('fx-lighting probe', e); } });
});

/* ---------------------------------------------------------------- per frame */
FX.on('frame', (dt) => {
  // torch: steady LED, but it stutters while the Copy is hunting and dies for a moment when it catches you
  if (hunted) flick = Math.random() < .06 ? .15 + Math.random() * .4 : Math.min(1, flick + dt * 6);
  else flick = Math.min(1, flick + dt * 2.5);
  torch.intensity = TORCH_BASE * flick;
  updateBounce();
  bounce.intensity += (bounceTarget * flick - bounce.intensity) * Math.min(1, dt * 12);
  // hanging bulbs: a damped pendulum (cord ~0.45 m) nudged by a slow draught
  for (const L of lamps) {
    const b = L.b;
    if (L.swing && q() !== 'low') {
      const draught = Math.sin(simTime * .7 + L.ph) * L.amp;
      L.vel += (-(L.ang - draught) * 21 - L.vel * .9) * dt; L.ang += L.vel * dt;
      const a = Math.max(-.6, Math.min(.6, L.ang));
      b.group.position.set(L.home.x + Math.sin(a) * .45 * Math.cos(L.ph), L.home.y - (1 - Math.cos(a)) * .45, L.home.z + Math.sin(a) * .45 * Math.sin(L.ph));
      b.group.rotation.set(a * Math.sin(L.ph), 0, -a * Math.cos(L.ph));
    }
    const k = b.on ? Math.max(0, b.light.intensity / (b.base || 1)) : 0;
    L.halo.material.opacity = Math.min(1, k) * (b.kind === 'flame' ? .8 : 1);
    L.halo.scale.setScalar(L.size * (.85 + .15 * Math.min(1.4, k)));
  }
});
FX.on('reset', () => {
  for (const L of lamps) L.halo.material.dispose();
  if (shadowLamp) shadowLamp.light.shadow.dispose();   // the light leaves with the old world; its shadow map would stay on the GPU
  lamps = []; shadowLamp = null; bounce.intensity = 0; bounceTarget = 0;
});
