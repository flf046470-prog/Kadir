// fx-materials: real-world surfaces.
// - Puts the Blender-baked PBR sets from tools/bake_textures.py (textures/<set>_albedo|normal|orm) on the core's
//   shared materials as they are created ('material' event).
// - Gives each chapter believable floors ('build', before batching): mud in the wet tunnel, trodden soil, wet concrete.
// - Shader layers on top: rising damp with a salt line on porous walls; rime frost in SIFIR-17 (on during chapter 3 only).
// - Dressing after batching ('chapter'): puddles, frozen puddles, icicles, a snow drift, soot above every flame.
// Quality: 'high' uses the full textures; 'medium'/'low' downscale them to 512 px (a quarter of the GPU memory).
// Dressing is skipped on 'low'.

// Metres one texture tile covers; must match SETS[...]['size_m'] in tools/bake_textures.py. Box UVs are 1.6 m per unit.
const SIZE = {
  concrete_wet: 1.6, plaster_damp: 1.6, brick_old: 1.6, rock_rough: 1.6, tuff: 1.6, soil: 1.6, mud: 1.6, limestone: 1.6,
  paint_peeling: 1.6, tile_ceramic: 1.6, metal_rust: 1.0, wood_old: 1.0, ice: 1.0, frost: 0.5, snow: 1.0, bone: 0.3,
};
// Core material kind -> how it is dressed. tint multiplies the albedo; damp = height of the rising-damp tide line (m);
// frost = takes the SIFIR-17 rime layer; keepColor = only relief and roughness come from the set (painted metal).
const KIND = {
  concrete: { set: 'concrete_wet' },
  plaster: { set: 'plaster_damp', damp: .62 },
  stone: { set: 'rock_rough', damp: .45 },
  old: { set: 'brick_old', damp: .8 },
  slab: { set: 'limestone', tint: [.8, .76, .7] },
  wood: { set: 'wood_old' },
  tuff: { set: 'tuff', normalScale: .35 },
  soviet: { set: 'paint_peeling', frost: true },
  tile: { set: 'tile_ceramic', frost: true },
  lime: { set: 'limestone', damp: .5 },
  bone: { set: 'bone' },
  rust: { set: 'metal_rust', frost: true },
  metal: { set: 'metal_rust', keepColor: true, frost: true, normalScale: .6 },
};
// Extra floor materials (registered in matCache so the core batches them like its own).
const FLOORS = {
  mud: { set: 'mud' },
  soil: { set: 'soil' },
  dust: { set: 'soil', tint: [1.18, 1.08, .96] },  // trodden tuff dust in the underground city
};
const available = (set) => ['albedo', 'normal', 'orm'].every((k) => TEXTURE_DATA[`${set}_${k}`]);

/* ---------------------------------------------------------------- images and textures */
const images = {};   // set -> Promise<{albedo, normal, orm}> of decoded <img>
function loadSet(set) {
  if (!images[set]) {
    const one = (k) => { const im = new Image(); im.src = TEXTURE_DATA[`${set}_${k}`]; return im.decode().then(() => im); };
    images[set] = Promise.all(['albedo', 'normal', 'orm'].map(one)).then(([albedo, normal, orm]) => ({ albedo, normal, orm }));
  }
  return images[set];
}
const tierOf = (q) => (q === 'high' ? 'high' : 'mid');
let tier = tierOf(FX.quality);
const tex = {};      // set -> {albedo, normal, orm} THREE textures for the current tier
function makeTexture(img, srgb, set) {
  let src = img;
  if (tier === 'mid' && img.width > 512) {
    src = document.createElement('canvas'); src.width = src.height = 512;
    const g = src.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, 512, 512);
  }
  const t = new THREE.Texture(src);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), tier === 'high' ? 8 : 4);
  const r = 1.6 / SIZE[set]; t.repeat.set(r, r);
  t.needsUpdate = true;
  return t;
}
function texturesFor(set, imgs) {
  if (!tex[set]) tex[set] = { albedo: makeTexture(imgs.albedo, true, set), normal: makeTexture(imgs.normal, false, set), orm: makeTexture(imgs.orm, false, set) };
  return tex[set];
}

/* ---------------------------------------------------------------- shader layers (rising damp, rime frost) */
const uFrost = { value: 0 }, uFrostMap = { value: null }, uFrostOrm = { value: null };
const NOISE = /* glsl */`
varying vec3 vFxW;
float fxHash(vec3 p) { p = fract(p * .3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float fxNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(fxHash(i), fxHash(i + vec3(1, 0, 0)), f.x), mix(fxHash(i + vec3(0, 1, 0)), fxHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(fxHash(i + vec3(0, 0, 1)), fxHash(i + vec3(1, 0, 1)), f.x), mix(fxHash(i + vec3(0, 1, 1)), fxHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`;
function addLayers(mat, cfg) {
  if (!cfg.damp && !cfg.frost) return;
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = function (sh, r) {
    prev.call(this, sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFxW;').replace('#include <project_vertex>', `#include <project_vertex>
      { vec4 fxP = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        fxP = instanceMatrix * fxP;
      #endif
        vFxW = (modelMatrix * fxP).xyz; }`);
    let head = NOISE, albedo = '', rough = '', metal = '';
    // world-space normal (vNormal is view space; viewMatrix is orthonormal, so v * M is the inverse transform)
    const wn = 'vec3 fxWN = normalize((vec4(normalize(vNormal), 0.0) * viewMatrix).xyz);';
    if (cfg.damp) {
      // Capillary rise in porous masonry: a wavy tide line, darker and glossier below it, a white salt bloom just above.
      albedo += `
        float fxTide = ${cfg.damp.toFixed(2)} + .2 * (fxNoise(vec3((vFxW.x + vFxW.z) * 1.4, 0.0, 3.1)) - .5) + .06 * (fxNoise(vFxW * 6.0) - .5);
        float fxDamp = smoothstep(fxTide + .05, fxTide - .12, vFxW.y);
        float fxSalt = smoothstep(fxTide + .16, fxTide + .03, vFxW.y) * (1.0 - fxDamp) * smoothstep(.4, .75, fxNoise(vFxW * 11.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.7, .69, .64), fxSalt * .45);
        diffuseColor.rgb = mix(diffuseColor.rgb, pow(diffuseColor.rgb, vec3(1.3)) * .78, fxDamp);`;
      rough += 'roughnessFactor = mix(roughnessFactor, roughnessFactor * .5, fxDamp);';
    }
    if (cfg.frost) {
      sh.uniforms.fxFrost = uFrost; sh.uniforms.fxFrostMap = uFrostMap; sh.uniforms.fxFrostOrm = uFrostOrm;
      head += '\nuniform float fxFrost; uniform sampler2D fxFrostMap; uniform sampler2D fxFrostOrm;';
      // Rime grows from the cold floor line and in patches; the frost texture's own brightness breaks the edge into crystals.
      albedo += `
        float fxFrostK = 0.0; vec4 fxFO = vec4(1.0);
        if (fxFrost > 0.0) {
          ${wn}
          bool fxFlat = abs(fxWN.y) > .5;
          vec2 fxUv = (fxFlat ? vFxW.xz : vec2(vFxW.x + vFxW.z, vFxW.y)) / ${SIZE.frost.toFixed(2)};
          vec4 fxFA = texture2D(fxFrostMap, fxUv); fxFO = texture2D(fxFrostOrm, fxUv);
          float fxPatch = smoothstep(.5, .8, fxNoise(vFxW * .9) * .65 + fxNoise(vFxW * 3.3) * .35);
          float fxBand = fxFlat ? 0.0 : max(smoothstep(.75, .05, vFxW.y), .55 * smoothstep(2.15, 2.6, vFxW.y));
          float fxMask = clamp(fxBand * (.65 + .35 * fxPatch) + fxPatch * (fxFlat ? .55 : .35), 0.0, 1.0);
          float fxL = dot(fxFA.rgb, vec3(.2126, .7152, .0722));
          // frost_albedo is crystals on black: the mask decides where rime lies, the crystals add sparkle and break its edge
          // (only near a patch: crystals scattered over bare dark metal read as speckled granite, not frost)
          fxFrostK = fxFrost * smoothstep(.25, .65, fxMask + fxL * .8 * smoothstep(0.0, .35, fxMask) - .1);
          diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(.62, .66, .69), vec3(.93, .96, .98), smoothstep(0.0, .45, fxL)), fxFrostK);  // rime: white crystals, never darker than grey
        }`;
      rough += 'roughnessFactor = mix(roughnessFactor, fxFO.g, fxFrostK);';
      metal += 'metalnessFactor *= 1.0 - fxFrostK;';
    }
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${head}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${albedo}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${rough}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${metal}`);
  };
  mat.customProgramCacheKey = function () { return `${prevKey.call(this)}|fxm${cfg.damp ? 'd' + cfg.damp : ''}${cfg.frost ? 'f' : ''}`; };
  mat.needsUpdate = true;
}

/* ---------------------------------------------------------------- dressing a material with a set */
const dressed = [];  // {mat, cfg} for re-dressing when the quality tier changes
function applyMaps(mat, cfg, t) {
  const orig = mat.userData.fxOrig ?? (mat.userData.fxOrig = { map: mat.map, bumpMap: mat.bumpMap });
  if (cfg.keepColor) {
    mat.normalMap = t.normal; mat.roughnessMap = t.orm; mat.aoMap = t.orm;
    mat.roughness = Math.min(1, mat.roughness + .25);
  } else {
    mat.map = t.albedo; mat.normalMap = t.normal; mat.roughnessMap = t.orm; mat.aoMap = t.orm; mat.metalnessMap = t.orm;
    mat.roughness = 1; mat.metalness = 1;  // both come from the ORM map (G, B)
    mat.color.setRGB(...(cfg.tint ?? [1, 1, 1]));
  }
  mat.bumpMap = null;
  const ns = cfg.normalScale ?? 1; mat.normalScale.set(ns, ns);
  mat.aoMapIntensity = 1;
  for (const old of [orig.map, orig.bumpMap]) if (old && old !== mat.map && old.isCanvasTexture) old.dispose();
  mat.needsUpdate = true;
}
function dress(mat, cfg) {
  if (!available(cfg.set)) return;
  if (!dressed.some((d) => d.mat === mat)) { dressed.push({ mat, cfg }); addLayers(mat, cfg); }
  loadSet(cfg.set).then((imgs) => applyMaps(mat, cfg, texturesFor(cfg.set, imgs))).catch((e) => console.warn('fx-materials', cfg.set, e));
}
FX.on('material', (kind, mat) => { if (KIND[kind]) dress(mat, KIND[kind]); });
// Materials created before this module ran (none today, but the bus allows it).
for (const [kind, mat] of Object.entries(matCache)) if (KIND[kind]) dress(mat, KIND[kind]);

function floorMat(name) {
  const key = `fx-floor-${name}`;
  if (!matCache[key]) {
    matCache[key] = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
    dress(matCache[key], FLOORS[name]);
  }
  return matCache[key];
}

// Frost textures feed the SIFIR-17 layer; preload every set so the first chapter does not wait on decoding.
const frostReady = available('frost') ? loadSet('frost').then((imgs) => { const t = texturesFor('frost', imgs); uFrostMap.value = t.albedo; uFrostOrm.value = t.orm; }) : Promise.resolve();
FX.materialsReady = Promise.all([frostReady, ...Object.keys(SIZE).filter(available).map(loadSet)]).catch(() => {});

FX.on('quality', (q) => {
  if (tierOf(q) === tier) return;
  tier = tierOf(q);
  for (const set of Object.keys(tex)) { for (const t of Object.values(tex[set])) t.dispose(); delete tex[set]; }
  for (const { mat, cfg } of dressed) loadSet(cfg.set).then((imgs) => applyMaps(mat, cfg, texturesFor(cfg.set, imgs)));
  frostReady.then(() => available('frost') && loadSet('frost').then((imgs) => { const t = texturesFor('frost', imgs); uFrostMap.value = t.albedo; uFrostOrm.value = t.orm; }));
  if (dressing) dressing.visible = q !== 'low';
});

/* ---------------------------------------------------------------- per-chapter floors (before batching) */
// Floor boxes from room() are centred on the room; pick by chapter, the room's own material and where it sits.
const FLOOR_RULES = [
  (m, z) => (m === matCache.stone ? 'mud' : m === matCache.old && z < 27 ? 'soil' : m === matCache.old ? 'concrete' : null),  // Sakarya
  (m) => (m === matCache.tuff ? 'dust' : null),                                                                                 // Nevşehir
  () => null,                                                                                                                   // SIFIR-17 keeps its tiles
  (m, z) => (m !== matCache.lime ? null : z < 14 ? 'mud' : z < 22 ? 'concrete' : 'soil'),                                       // Paris
];
FX.on('build', (i) => {
  uFrost.value = i === 2 && uFrostMap.value ? 1 : 0;
  const rule = FLOOR_RULES[i];
  if (!rule) return;
  for (const o of W.group.children) {
    if (!o.isMesh || o.userData.surface !== 'floor') continue;
    const pick = rule(o.material, o.position.z);
    if (pick === 'concrete') o.material = M.concrete;
    else if (pick && available(FLOORS[pick].set)) o.material = floorMat(pick);
  }
});

/* ---------------------------------------------------------------- dressing (after batching) */
let dressing = null;
const shared = (mesh) => { mesh.userData.shared = true; return mesh; };  // geometry reused across chapters: not disposed on reset
function blobTexture(seed, soft) {   // irregular puddle / stain outline as an alpha map (white = opaque)
  const n = 256, cv = document.createElement('canvas'); cv.width = cv.height = n;
  const g = cv.getContext('2d'), img = g.createImageData(n, n);
  let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const k = Array.from({ length: 6 }, () => [rnd() * 6.283, .05 + rnd() * .09, 2 + Math.floor(rnd() * 5)]);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (x + .5) / n * 2 - 1, dy = (y + .5) / n * 2 - 1, a = Math.atan2(dy, dx);
    let r = .78; for (const [ph, amp, f] of k) r += amp * Math.sin(a * f + ph);
    const d = Math.hypot(dx, dy) / r, v = Math.max(0, Math.min(1, (1 - d) / soft));
    const i = (y * n + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = v * v * (3 - 2 * v) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(cv);
}
function sootTexture() {             // soft plume, darkest just above the flame, fading upwards
  const n = 128, cv = document.createElement('canvas'); cv.width = cv.height = n;
  const g = cv.getContext('2d'), img = g.createImageData(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = (x + .5) / n * 2 - 1, v = 1 - (y + .5) / n;               // v: 0 bottom .. 1 top
    const w = .25 + .55 * v, d = Math.abs(u) / w;
    const a = Math.max(0, 1 - d * d) * Math.pow(Math.sin(Math.PI * Math.min(1, v * 1.15)), .8) * (1 - .55 * v);
    const i = (y * n + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.min(255, a * 255); img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(cv);
}
let assets = null;
function getAssets() {
  if (assets) return assets;
  const plane = new THREE.PlaneGeometry(1, 1); plane.rotateX(-Math.PI / 2);
  const wallPlane = new THREE.PlaneGeometry(1, 1);
  const cone = new THREE.ConeGeometry(1, 1, 7, 1); cone.rotateX(Math.PI); cone.translate(0, -.5, 0);  // base at y 0, tip at y -1
  const mound = new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2);                   // snow drift (scaled flat)
  const blobs = [blobTexture(11, .35), blobTexture(97, .22), blobTexture(433, .3)];
  // fxReflective: fx-lighting gives these an environment probe so the water mirrors the room's lamps
  const water = (alphaMap) => { const m = new THREE.MeshStandardMaterial({ color: 0x050504, roughness: .03, metalness: 0, transparent: true, alphaMap, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); m.userData.fxReflective = true; return m; };
  const iceMat = (alphaMap) => {
    const m = new THREE.MeshStandardMaterial({ color: 0xc6dbe6, roughness: .2, metalness: 0, transparent: true, opacity: .85, alphaMap, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    m.userData.fxReflective = true;
    if (available('ice')) loadSet('ice').then((imgs) => { const t = texturesFor('ice', imgs); m.map = t.albedo; m.normalMap = t.normal; m.normalScale.set(.6, .6); m.roughnessMap = t.orm; m.roughness = 1; m.needsUpdate = true; });
    return m;
  };
  const snowMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  if (available('snow')) loadSet('snow').then((imgs) => { const t = texturesFor('snow', imgs); snowMat.map = t.albedo; snowMat.normalMap = t.normal; snowMat.roughnessMap = t.orm; snowMat.aoMap = t.orm; snowMat.needsUpdate = true; });
  assets = {
    plane, wallPlane, cone, mound,
    water: blobs.map(water), ice: blobs.map(iceMat), snow: snowMat,
    icicle: new THREE.MeshStandardMaterial({ color: 0xd4e8f2, roughness: .08, metalness: 0, transparent: true, opacity: .78, depthWrite: false }),
    soot: new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 1, metalness: 0, transparent: true, alphaMap: sootTexture(), opacity: .75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
  };
  return assets;
}
function flat(mats, x, z, sx, sz, rot, y = .002) {
  const a = getAssets(), m = shared(new THREE.Mesh(a.plane, mats[Math.abs(Math.round(x * 7 + z * 13)) % mats.length]));
  m.position.set(x, y, z); m.scale.set(sx, 1, sz); m.rotation.y = rot; m.receiveShadow = true; m.renderOrder = 1;
  dressing.add(m); return m;
}
function icicles(spans, seed) {       // spans: [x0, z0, x1, z1, y]: icicles hang along the segment under a pipe or lintel
  let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const list = [];
  for (const [x0, z0, x1, z1, y] of spans) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    for (let d = rnd() * .08; d < len; d += .05 + rnd() * .12) {
      const k = d / len, j = (rnd() - .5) * .05;
      list.push([x0 + (x1 - x0) * k + j * (z1 - z0) / len, y, z0 + (z1 - z0) * k + j * (x1 - x0) / len, .006 + rnd() * .014, .04 + Math.pow(rnd(), 2) * .3]);
    }
  }
  const a = getAssets(), inst = new THREE.InstancedMesh(a.cone, a.icicle, list.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  list.forEach(([x, y, z, r, len], i) => inst.setMatrixAt(i, m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(r, len, r))));
  inst.userData.shared = true; dressing.add(inst);
}
function sootAbove(lights) {          // every flame blackens the wall or niche right above it
  const ray = new THREE.Raycaster(), p = new THREE.Vector3(), n = new THREE.Vector3(), dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, z]) => new THREE.Vector3(x, 0, z));
  for (const b of lights) {
    if (b.kind !== 'flame') continue;
    b.group.getWorldPosition(p);
    let best = null;
    for (const d of dirs) {
      ray.set(p, d); ray.far = .6;
      const hit = ray.intersectObjects(W.occluders, false)[0];
      if (hit && hit.face && (!best || hit.distance < best.distance)) best = hit;
    }
    if (!best) continue;
    n.copy(best.face.normal).transformDirection(best.object.matrixWorld);
    if (Math.abs(n.y) > .3) continue;
    const m = shared(new THREE.Mesh(getAssets().wallPlane, getAssets().soot));
    m.scale.set(.42, .85, 1); m.position.copy(best.point).addScaledVector(n, .006); m.position.y = p.y + .38;
    m.lookAt(m.position.clone().add(n)); m.renderOrder = 1; dressing.add(m);
  }
}
const DRESS = [
  () => { // Sakarya: rain water that came down the stairwell, and the drip in the tunnel
    flat(getAssets().water, .95, 3.7, 1.1, .7, .4); flat(getAssets().water, -1.9, 1.1, .6, .45, 1.3);
    flat(getAssets().water, .22, 16.35, .75, .55, 2.2); flat(getAssets().water, -.15, 13.6, .5, .35, .7);
  },
  () => { sootAbove(W.lights); },  // Nevşehir: dry; centuries of lamp soot
  () => { // SIFIR-17: ice under the frozen pipes, icicles, snow blown into the entrance
    const a = getAssets();
    flat(a.ice, .15, 6.25, .9, .7, .3); flat(a.ice, -.35, 12.3, 1.1, .8, 1.9); flat(a.ice, .3, 18.1, .8, .6, 2.6); flat(a.ice, 4.4, 13.1, .9, .7, .9);
    // under the three ceiling pipes, the entrance door's lintel and the lab door's lintel
    icicles([[-.85, 6, .85, 6, 2.62], [-.85, 12, .85, 12, 2.62], [-.85, 18, .85, 18, 2.62], [-.55, 3.1, .55, 3.1, 2.2], [1.1, 11.35, 1.1, 12.65, 2.2]], 4242);
    for (const [x, z, sx, sy, sz] of [[-.75, .12, .85, .2, .4], [1.1, .1, .45, .12, .28]]) {
      const drift = shared(new THREE.Mesh(a.mound, a.snow)); drift.scale.set(sx, sy, sz); drift.position.set(x, -.04, z); drift.receiveShadow = true; dressing.add(drift);
    }
  },
  () => { // Paris: seepage pools in the ossuary corridor, soot above the candles and torches
    flat(getAssets().water, .1, 4.3, .95, .55, .2); flat(getAssets().water, -.25, 9.6, .7, .45, 1.1); flat(getAssets().water, -3.2, 33.5, 1.4, .9, .6);
    sootAbove(W.lights);
  },
];
FX.on('chapter', (i) => {
  dressing = new THREE.Group(); dressing.name = 'fx-materials dressing'; W.group.add(dressing);
  dressing.visible = FX.quality !== 'low';
  try { DRESS[i]?.(); } catch (e) { console.error('fx-materials dressing', e); }
});
