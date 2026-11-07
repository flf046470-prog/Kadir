/* ANTARKTIKA // WHITEOUT — A3D: Blender asset layer for the ICEWALK WebGL engine.
 *
 * Loads the GLB files built by antarktika/blender/scripts (station, ice cave,
 * Dr. Selin) and renders them inside the existing WebGL1 context with a light
 * PBR shader whose sun, fog and tone curve match the original terrain shader.
 * Gameplay data comes from glTF node extras (see blender/scripts/a3d_common.py):
 * colliders, walkable floors/ramps, zones, interaction anchors, lights, NPC path.
 *
 * Works offline: models are fetched relative to the page (served by the app's
 * antarktika:// scheme handler, or any http server). If loading fails (e.g. the
 * page is opened as file:// in a desktop browser) the engine keeps its original
 * procedural geometry and nothing below changes gameplay.
 */
(() => {
  'use strict';
  const MODELS = ['models/station.glb', 'models/ice_cave.glb', 'models/explorer.glb', 'models/fp_hands.glb'];
  const SUN = [-0.58, 0.47, -0.68];
  const MAXB = 20;
  const QUALITY = {
    low: { lights: 2, lod: 0.6, normalMap: false, texScale: 0.5, dataScale: 0.5, aniso: 1 },
    balanced: { lights: 3, lod: 1.0, normalMap: true, texScale: 1, dataScale: 0.5, aniso: 2 },
    cinematic: { lights: 4, lod: 1.5, normalMap: true, texScale: 1, dataScale: 1, aniso: 4 },
  };
  const A = {
    status: 'idle', progress: 0, error: null, models: {}, ready: false, zone: null, loadMs: 0,
    stats: { draws: 0, tris: 0, lights: 0, culled: 0 },
    state: { power: false, freqIndex: -1, freqSolved: false, crystals: 0, caveSolved: false, labRead: false, artifact: false, drill: false, glyphRead: false, bb: [0, 0, 0, 0], bbSeen: [0, 0, 0, 0], ch2: false, tutorial: {} },
  };
  window.ANTARKTIKA3D = A;
  let E = null, gl = null, ext = {}, programs = {}, time = 0;

  /* ------------------------------------------------------------ math */
  const M4 = {
    ident: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    mul(a, b, o = new Float32Array(16)) {
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
      return o;
    },
    trs(t, q, s, o = new Float32Array(16)) {
      const [x, y, z, w] = q, [sx, sy, sz] = s;
      o[0] = (1 - 2 * (y * y + z * z)) * sx; o[1] = 2 * (x * y + z * w) * sx; o[2] = 2 * (x * z - y * w) * sx; o[3] = 0;
      o[4] = 2 * (x * y - z * w) * sy; o[5] = (1 - 2 * (x * x + z * z)) * sy; o[6] = 2 * (y * z + x * w) * sy; o[7] = 0;
      o[8] = 2 * (x * z + y * w) * sz; o[9] = 2 * (y * z - x * w) * sz; o[10] = (1 - 2 * (x * x + y * y)) * sz; o[11] = 0;
      o[12] = t[0]; o[13] = t[1]; o[14] = t[2]; o[15] = 1;
      return o;
    },
    rotY(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); },
    xform(m, x, y, z) { return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]; },
  };
  const slerp = (a, b, t, o) => {
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3], s = 1;
    if (d < 0) { d = -d; s = -1; }
    let k0 = 1 - t, k1 = t;
    if (d < 0.9995) { const th = Math.acos(d), st = Math.sin(th); k0 = Math.sin((1 - t) * th) / st; k1 = Math.sin(t * th) / st; }
    for (let i = 0; i < 4; i++) o[i] = a[i] * k0 + b[i] * k1 * s;
    const l = Math.hypot(o[0], o[1], o[2], o[3]) || 1; for (let i = 0; i < 4; i++) o[i] /= l;
    return o;
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  /* ------------------------------------------------------------ GLB parsing */
  const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
  const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const NORM = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

  function parseGLB(buf) {
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x46546c67 || dv.getUint32(4, true) !== 2) throw Error('GLB 2.0 başlığı geçersiz');
    let off = 12, json = null, bin = null;
    while (off + 8 <= buf.byteLength) {
      const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
      off += 8;
      if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off, len)));
      else if (type === 0x004e4942) bin = new Uint8Array(buf, off, len);
      off += len;
    }
    if (!json || !bin) throw Error('GLB JSON/BIN eksik');
    return { json, bin };
  }

  function readAccessor(g, i, asFloat = false) {
    const a = g.json.accessors[i], bv = g.json.bufferViews[a.bufferView];
    if (a.sparse) throw Error('seyrek accessor desteklenmiyor');
    const T = COMP[a.componentType], n = NCOMP[a.type], es = T.BYTES_PER_ELEMENT;
    const stride = bv.byteStride || n * es, start = g.bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0);
    const out = new (asFloat ? Float32Array : T)(a.count * n);
    const dv = new DataView(g.bin.buffer);
    const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
    const scale = a.normalized && asFloat ? 1 / NORM[a.componentType] : 1;
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) {
      out[k * n + c] = dv[get](start + k * stride + c * es, true) * scale;
    }
    return { data: out, count: a.count, n, min: a.min, max: a.max, type: a.componentType };
  }

  async function loadImage(g, idx) {
    const im = g.json.images[idx], bv = g.json.bufferViews[im.bufferView];
    const bytes = new Uint8Array(g.bin.buffer, g.bin.byteOffset + (bv.byteOffset || 0), bv.byteLength);
    const url = URL.createObjectURL(new Blob([bytes], { type: im.mimeType || 'image/jpeg' }));
    try {
      const img = new Image();
      img.src = url;
      await (img.decode ? img.decode() : new Promise((r, j) => { img.onload = r; img.onerror = j; }));
      return img;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }

  function makeTexture(img, colorData) {
    const q = QUALITY[window.ICEWALK_VISUALS?.quality] || QUALITY.balanced;
    let src = img;
    const scale = colorData ? q.texScale : q.dataScale;
    if (scale < 1 && img.width > 256) {
      const c = document.createElement('canvas');
      c.width = img.width * scale; c.height = img.height * scale;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      src = c;
    }
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (ext.aniso && colorData) gl.texParameterf(gl.TEXTURE_2D, ext.aniso.TEXTURE_MAX_ANISOTROPY_EXT, q.aniso);
    A.texBytes = (A.texBytes || 0) + src.width * src.height * 4 * 1.33;
    return t;
  }

  async function buildModel(name, buf) {
    const g = parseGLB(buf), J = g.json;
    const images = await Promise.all((J.images || []).map((_, i) => loadImage(g, i)));
    const texCache = {};
    const tex = (info, color) => {
      if (!info) return null;
      const src = J.textures[info.index].source, key = src + (color ? 'c' : 'd');
      return texCache[key] || (texCache[key] = makeTexture(images[src], color));
    };
    const materials = (J.materials || []).map((m) => {
      const pbr = m.pbrMetallicRoughness || {}, ex = m.extras || {};
      const strength = m.extensions?.KHR_materials_emissive_strength?.emissiveStrength || 1;
      const ef = m.emissiveFactor || [0, 0, 0];
      return {
        name: m.name, base: pbr.baseColorFactor || [1, 1, 1, 1], baseTex: tex(pbr.baseColorTexture, true),
        orm: tex(pbr.metallicRoughnessTexture), nrm: tex(m.normalTexture), emiTex: tex(m.emissiveTexture, true),
        rough: pbr.roughnessFactor ?? 1, metal: pbr.metallicFactor ?? 1,
        emissive: ef.map((v) => v * strength), blend: m.alphaMode === 'BLEND',
        interior: !!ex.a3d_interior, ice: !!ex.a3d_ice, glass: !!ex.a3d_glass,
      };
    });
    const meshes = (J.meshes || []).map((me) => me.primitives.map((p) => {
      const pos = readAccessor(g, p.attributes.POSITION, true);
      const attrs = { aPos: pos };
      if (p.attributes.NORMAL !== undefined) attrs.aNorm = readAccessor(g, p.attributes.NORMAL, true);
      if (p.attributes.TEXCOORD_0 !== undefined) attrs.aUV = readAccessor(g, p.attributes.TEXCOORD_0, true);
      if (p.attributes.TANGENT !== undefined) attrs.aTan = readAccessor(g, p.attributes.TANGENT, true);
      if (p.attributes.JOINTS_0 !== undefined) attrs.aJoint = readAccessor(g, p.attributes.JOINTS_0, true);
      if (p.attributes.WEIGHTS_0 !== undefined) attrs.aWeight = readAccessor(g, p.attributes.WEIGHTS_0, true);
      const bufs = {};
      for (const [k, v] of Object.entries(attrs)) {
        const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, v.data, gl.STATIC_DRAW);
        bufs[k] = { b, n: v.n };
      }
      let index = null, count = pos.count, itype = gl.UNSIGNED_SHORT;
      if (p.indices !== undefined) {
        const ia = readAccessor(g, p.indices);
        let data = ia.data;
        if (data instanceof Uint32Array) {
          if (pos.count < 65536) data = Uint16Array.from(data);
          else if (ext.uint) itype = gl.UNSIGNED_INT;
          else throw Error('32-bit indeks desteklenmiyor');
        } else if (data instanceof Uint8Array) data = Uint16Array.from(data);
        index = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, gl.STATIC_DRAW);
        count = ia.count;
      }
      const mn = pos.min || [0, 0, 0], mx = pos.max || [0, 0, 0];
      const center = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
      const radius = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2;
      return { bufs, index, count, itype, mat: materials[p.material ?? 0] || materials[0], skinned: !!attrs.aJoint, center, radius, tris: count / 3 };
    }));
    // node hierarchy
    const nodes = J.nodes.map((n, i) => ({
      i, name: n.name || '', extras: n.extras || {}, mesh: n.mesh, skin: n.skin, children: n.children || [], parent: -1,
      t: n.translation ? [...n.translation] : [0, 0, 0], r: n.rotation ? [...n.rotation] : [0, 0, 0, 1], s: n.scale ? [...n.scale] : [1, 1, 1],
      matrix: n.matrix ? new Float32Array(n.matrix) : null, world: M4.ident(), local: M4.ident(),
    }));
    nodes.forEach((n) => n.children.forEach((c) => { nodes[c].parent = n.i; }));
    const order = [];
    const visit = (i) => { order.push(i); nodes[i].children.forEach(visit); };
    nodes.filter((n) => n.parent < 0).forEach((n) => visit(n.i));
    const model = { name, nodes, order, meshes, materials, skins: [], clips: {}, rest: nodes.map((n) => ({ t: [...n.t], r: [...n.r], s: [...n.s] })) };
    updateWorld(model);
    for (const s of J.skins || []) {
      const ibm = readAccessor(g, s.inverseBindMatrices, true).data;
      model.skins.push({ joints: s.joints, ibm, mats: new Float32Array(MAXB * 16) });
    }
    for (const an of J.animations || []) {
      const ch = an.channels.map((c) => {
        const smp = an.samplers[c.sampler];
        return { node: c.target.node, path: c.target.path, input: readAccessor(g, smp.input, true).data, output: readAccessor(g, smp.output, true).data, step: smp.interpolation === 'STEP' };
      });
      model.clips[an.name] = { channels: ch, duration: Math.max(...ch.map((c) => c.input[c.input.length - 1])) };
    }
    return model;
  }

  function updateWorld(model) {
    for (const i of model.order) {
      const n = model.nodes[i];
      if (n.matrix) n.local.set(n.matrix); else M4.trs(n.t, n.r, n.s, n.local);
      if (n.parent >= 0) M4.mul(model.nodes[n.parent].world, n.local, n.world); else n.world.set(n.local);
    }
  }

  function sampleChannel(c, t, out) {
    const inp = c.input, n = c.path === 'rotation' ? 4 : 3, o = c.output;
    if (t <= inp[0]) { for (let k = 0; k < n; k++) out[k] = o[k]; return out; }
    const last = inp.length - 1;
    if (t >= inp[last]) { for (let k = 0; k < n; k++) out[k] = o[last * n + k]; return out; }
    let lo = 0, hi = last;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (inp[mid] <= t) lo = mid; else hi = mid; }
    const f = c.step ? 0 : (t - inp[lo]) / (inp[hi] - inp[lo]);
    if (n === 4) return slerp(o.subarray(lo * 4, lo * 4 + 4), o.subarray(hi * 4, hi * 4 + 4), f, out);
    for (let k = 0; k < n; k++) out[k] = o[lo * n + k] + (o[hi * n + k] - o[lo * n + k]) * f;
    return out;
  }

  /* ------------------------------------------------------------ shaders */
  const VS = `
attribute vec3 aPos;attribute vec3 aNorm;attribute vec2 aUV;attribute vec4 aTan;
#ifdef SKIN
attribute vec4 aJoint;attribute vec4 aWeight;uniform mat4 uBones[${MAXB}];
#endif
uniform mat4 uModel,uView,uProj;
varying vec3 vPos,vNorm;varying vec2 vUV;varying vec4 vTan;varying float vDist;
void main(){vec4 p=vec4(aPos,1.);vec4 n=vec4(aNorm,0.);vec4 t=vec4(aTan.xyz,0.);
#ifdef SKIN
mat4 sk=uBones[int(aJoint.x)]*aWeight.x+uBones[int(aJoint.y)]*aWeight.y+uBones[int(aJoint.z)]*aWeight.z+uBones[int(aJoint.w)]*aWeight.w;
p=sk*p;n=sk*n;t=sk*t;
#endif
vec4 w=uModel*p;vPos=w.xyz;vNorm=(uModel*n).xyz;vTan=vec4((uModel*t).xyz,aTan.w==0.?1.:aTan.w);vUV=aUV;
vec4 e=uView*w;vDist=length(e.xyz);gl_Position=uProj*e;}`;
  const FS = `
precision highp float;
varying vec3 vPos,vNorm;varying vec2 vUV;varying vec4 vTan;varying float vDist;
uniform sampler2D uBaseTex,uOrmTex,uNrmTex,uEmiTex;
uniform vec4 uBase;uniform vec3 uEmissive;uniform vec4 uHas;uniform float uRough,uMetal,uInterior,uIce,uDecal,uAlpha;
uniform vec3 uCam,uCamF,uAmbient,uFogC,uTorchP,uTorchD;uniform float uTime,uFlash,uFogD;
uniform vec4 uLP[4];uniform vec3 uLC[4];uniform vec4 uScan;uniform float uScanAmt,uScanSel;
void main(){
vec4 base=uBase;if(uHas.x>.5)base*=texture2D(uBaseTex,vUV);
float fog=clamp(1.-exp(-pow(vDist*uFogD,1.32)),0.,.98);
if(uDecal>.5){gl_FragColor=vec4(vec3(.05,.11,.15),(1.-base.r)*.78*(1.-fog));return;}
vec3 orm=vec3(1.,uRough,uMetal);if(uHas.y>.5){vec3 o=texture2D(uOrmTex,vUV).rgb;orm=vec3(o.r,o.g*uRough,o.b*uMetal);}
vec3 n=normalize(vNorm);
#ifdef NORMALMAP
if(uHas.z>.5){vec3 t=normalize(vTan.xyz-n*dot(n,vTan.xyz));vec3 b=cross(n,t)*vTan.w;vec3 m=texture2D(uNrmTex,vUV).xyz*2.-1.;n=normalize(t*m.x+b*m.y+n*m.z);}
#endif
vec3 V=normalize(uCam-vPos);if(dot(n,V)<-.05&&uIce<.5)n=-n;
vec3 L=normalize(vec3(${SUN.join(',')}));float ao=orm.r,rough=clamp(orm.g,.05,1.),metal=orm.b;
vec3 alb=base.rgb,col;float ndl=max(dot(n,L),0.);
if(uInterior<.5){float sky=clamp(n.y*.28+.72,.37,1.);col=alb*((.43+.27*sky)*ao+.30*ndl*mix(1.,ao,.6));}
else col=alb*uAmbient*ao;
vec3 spec=vec3(0.);float shin=mix(96.,6.,rough);vec3 F0=mix(vec3(.04),alb,metal);
if(uInterior<.5){vec3 H=normalize(L+V);spec+=F0*pow(max(dot(n,H),0.),shin)*ndl*(1.-rough)*1.6;}
for(int i=0;i<4;i++){vec3 d=uLP[i].xyz-vPos;float dist=length(d);float att=clamp(1.-dist/max(uLP[i].w,.01),0.,1.);att*=att;vec3 l=d/max(dist,.001);
float nl=max(dot(n,l),0.);col+=alb*uLC[i]*nl*att*(1.-metal*.5);vec3 H=normalize(l+V);spec+=F0*uLC[i]*pow(max(dot(n,H),0.),shin)*nl*att*(1.-rough)*2.;}
vec3 dv=vPos-uTorchP;float len=length(dv);float cone=dot(dv/max(len,.001),uTorchD);
float spot=smoothstep(.86,.975,cone)*(1.-smoothstep(9.,42.,len));col+=alb*vec3(1.,.95,.86)*spot*uFlash*(.35+.65*max(dot(n,-dv/max(len,.001)),0.))*1.25;
col+=spec;
if(uIce>.5){float fr=pow(1.-max(dot(n,V),0.),3.);col+=vec3(.26,.58,.72)*fr*.32*(uInterior>.5?ao:1.);col+=alb*vec3(.08,.30,.42)*(uInterior>.5?ao*ao*1.1:.22);}
vec3 emi=uEmissive;if(uHas.w>.5)emi*=texture2D(uEmiTex,vUV).rgb;col+=emi;
float sd=length(vPos-uScan.xyz);col+=vec3(.25,.95,1.)*exp(-pow((sd-uScan.w)*1.3,2.))*uScanAmt*(.18+.82*uScanSel);
col=mix(col,uFogC,fog);col=col/(vec3(.70)+col*.38);
gl_FragColor=vec4(clamp(pow(max(col,0.),vec3(.95)),0.,1.),base.a*uAlpha);}`;

  function compile(defs) {
    const key = defs.join(',');
    if (programs[key]) return programs[key];
    const pre = defs.map((d) => '#define ' + d + '\n').join('');
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, pre + VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, pre + FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p));
    const u = {}, a = {};
    const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < nu; i++) { const info = gl.getActiveUniform(p, i), nm = info.name.replace(/\[0\]$/, ''); u[nm] = gl.getUniformLocation(p, nm.includes('[') ? info.name : nm); }
    for (const nm of ['uLP', 'uLC']) u[nm] = gl.getUniformLocation(p, nm + '[0]') || gl.getUniformLocation(p, nm);
    if (defs.includes('SKIN')) u.uBones = gl.getUniformLocation(p, 'uBones[0]') || gl.getUniformLocation(p, 'uBones');
    for (const nm of ['aPos', 'aNorm', 'aUV', 'aTan', 'aJoint', 'aWeight']) a[nm] = gl.getAttribLocation(p, nm);
    return (programs[key] = { p, u, a });
  }

  /* ------------------------------------------------------------ world data */
  const world = { colliders: [], floors: [], volumes: [], anchors: [], lights: [], path: [], draw: [], dynamic: {}, groups: {} };

  function obb(n) {
    const m = n.world, cx = m[12], cy = m[13], cz = m[14];
    const ax = [m[0], m[2]], az = [m[8], m[10]];
    const sx = Math.hypot(m[0], m[1], m[2]), sy = Math.hypot(m[4], m[5], m[6]), sz = Math.hypot(m[8], m[9], m[10]);
    return { x: cx, y: cy, z: cz, ux: ax[0] / sx, uz: ax[1] / sx, vx: az[0] / sz, vz: az[1] / sz, hx: sx, hy: sy, hz: sz, r: Math.hypot(sx, sz) };
  }

  function harvest(model) {
    for (const n of model.nodes) {
      const ex = n.extras, nm = n.name;
      if (ex.a3d_kind === 'collider') world.colliders.push({ ...obb(n), name: nm, door: ex.a3d_door || null });
      else if (ex.a3d_kind === 'floor') world.floors.push({ ...obb(n), name: nm, ramp: !!ex.a3d_ramp });
      else if (ex.a3d_kind === 'volume') world.volumes.push({ ...obb(n), name: nm, zone: ex.a3d_zone });
      else if (ex.a3d_kind === 'interact') world.anchors.push({ id: ex.a3d_id, label: ex.a3d_label, radius: ex.a3d_radius || 2, x: n.world[12], y: n.world[13], z: n.world[14] });
      else if (ex.a3d_kind === 'light') world.lights.push({ name: nm.replace('LIGHT_', ''), x: n.world[12], y: n.world[13], z: n.world[14], color: ex.a3d_color, intensity: ex.a3d_intensity, range: ex.a3d_range, flicker: ex.a3d_flicker || 0, power: ex.a3d_power ?? 0, group: ex.a3d_group || null });
      else if (ex.a3d_kind === 'path') world.path.push({ x: n.world[12], z: n.world[14], order: ex.a3d_order, wait: ex.a3d_wait || 0 });
      if (n.mesh !== undefined && n.skin === undefined) {
        const entry = { model, node: n, prims: model.meshes[n.mesh], ex, base: new Float32Array(n.world), m: new Float32Array(n.world), emissiveScale: 1, visible: !ex.a3d_hidden, open: 0 };
        world.draw.push(entry);
        if (ex.a3d_group) (world.groups[ex.a3d_group] = world.groups[ex.a3d_group] || []).push(entry);
        if (nm.startsWith('DOOR_')) world.dynamic[nm] = entry;
      }
    }
    world.path.sort((a, b) => a.order - b.order);
  }

  /* ------------------------------------------------------------ NPC (Dr. Selin) */
  const npc = { model: null, x: 17.5, z: 17.6, yaw: 0, target: 1, wait: 2, clip: 'Idle', prev: null, blend: 1, t: 0, tPrev: 0, talkUntil: 0, lastPhase: 0, speed: 0 };

  function npcUpdate(dt, px, pz) {
    if (!npc.model || !world.path.length) return;
    const d = Math.hypot(px - npc.x, pz - npc.z);
    const talking = time < npc.talkUntil;
    let want = 'Idle', move = 0;
    if (talking || d < 3.6) {
      const face = Math.atan2(px - npc.x, pz - npc.z);
      npc.yaw += Math.atan2(Math.sin(face - npc.yaw), Math.cos(face - npc.yaw)) * Math.min(1, dt * 4);
      want = talking ? 'Interact' : 'Idle';
    } else if (npc.wait > 0) {
      npc.wait -= dt;
    } else {
      const wp = world.path[npc.target], dx = wp.x - npc.x, dz = wp.z - npc.z, dist = Math.hypot(dx, dz);
      const storm = E.storm, run = storm > 0.62 && dist > 5;
      if (dist < 0.25) { npc.wait = wp.wait; npc.target = (npc.target + 1) % world.path.length; }
      else {
        const face = Math.atan2(dx, dz);
        npc.yaw += Math.atan2(Math.sin(face - npc.yaw), Math.cos(face - npc.yaw)) * Math.min(1, dt * 5);
        move = run ? 3.6 : 1.35; want = run ? 'Run' : 'Walk';
        const step = Math.min(dist, move * dt);
        npc.x += dx / dist * step; npc.z += dz / dist * step;
      }
    }
    npc.speed = move;
    if (want !== npc.clip) { npc.prev = { clip: npc.clip, t: npc.t }; npc.clip = want; npc.t = 0; npc.blend = 0; }
    npc.blend = Math.min(1, npc.blend + dt / 0.28);
    npc.tPrev = npc.t; npc.t += dt;
    const ch = window.ICEWALK_MESHY?.characters?.find((c) => c.id === 'explorer');
    if (ch) { ch.x = npc.x; ch.z = npc.z; }
    // footsteps locked to the walk/run contacts (phase 0 and 0.5)
    const clip = npc.model.clips[npc.clip];
    if (clip && (npc.clip === 'Walk' || npc.clip === 'Run')) {
      const ph = (npc.t % clip.duration) / clip.duration, prev = npc.lastPhase;
      if ((prev > ph) || (prev < 0.5 && ph >= 0.5)) footstep(Math.max(0, 1 - d / 22) * (npc.clip === 'Run' ? 1.2 : 0.8), 'snow');
      npc.lastPhase = ph;
    }
  }

  const tmpQ = [0, 0, 0, 1], tmpV = [0, 0, 0];
  function poseNPC() {
    const m = npc.model, cur = m.clips[npc.clip], prv = npc.prev && m.clips[npc.prev.clip];
    m.nodes.forEach((n, i) => { const r = m.rest[i]; n.t = [...r.t]; n.r = [...r.r]; n.s = [...r.s]; });
    const apply = (clip, t, w) => {
      if (!clip) return;
      const tt = npc.clip === 'Interact' && clip === cur ? Math.min(t, clip.duration) : t % clip.duration;
      for (const c of clip.channels) {
        const n = m.nodes[c.node];
        if (c.path === 'rotation') { sampleChannel(c, tt, tmpQ); n.r = w >= 1 ? [...tmpQ] : slerp(n.r, tmpQ, w, [0, 0, 0, 0]); }
        else if (c.path === 'translation') { sampleChannel(c, tt, tmpV); n.t = n.t.map((v, k) => v + (tmpV[k] - v) * w); }
        else if (c.path === 'scale') { sampleChannel(c, tt, tmpV); n.s = n.s.map((v, k) => v + (tmpV[k] - v) * w); }
      }
    };
    if (prv && npc.blend < 1) { apply(prv, npc.prev.t + npc.t, 1); apply(cur, npc.t, npc.blend); } else apply(cur, npc.t, 1);
    updateWorld(m);
    const place = M4.mul(M4.mul(new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, npc.x, groundY(npc.x, npc.z), npc.z, 1]), M4.rotY(npc.yaw)), M4.ident());
    for (const s of m.skins) {
      for (let j = 0; j < s.joints.length && j < MAXB; j++) {
        const jm = M4.mul(place, m.nodes[s.joints[j]].world), out = M4.mul(jm, s.ibm.subarray(j * 16, j * 16 + 16));
        s.mats.set(out, j * 16);
      }
    }
  }

  /* ------------------------------------------------------------ gameplay geometry */
  function insideOBB(o, x, z, pad = 0) {
    const dx = x - o.x, dz = z - o.z, lx = dx * o.ux + dz * o.uz, lz = dx * o.vx + dz * o.vz;
    return Math.abs(lx) <= o.hx + pad && Math.abs(lz) <= o.hz + pad ? [lx, lz] : null;
  }

  function groundY(x, z) {
    let best = null;
    for (const f of world.floors) {
      const l = insideOBB(f, x, z);
      if (!l) continue;
      let h = f.y + f.hy;
      if (f.ramp) h = (f.y - f.hy) + 2 * f.hy * clamp((-l[1] / f.hz + 1) / 2, 0, 1);
      best = best === null ? h : Math.max(best, h);
    }
    return best === null ? E.terrainY(x, z) : best;
  }

  function collide(x0, z0, x1, z1, r = 0.32) {
    let x = x1, z = z1;
    for (let it = 0; it < 3; it++) {
      for (const c of world.colliders) {
        if (c.door && world.dynamic[c.door] && world.dynamic[c.door].open > 0.65) continue;
        const dx = x - c.x, dz = z - c.z;
        if (Math.abs(dx) > c.r + r + 0.5 || Math.abs(dz) > c.r + r + 0.5) continue;
        const lx = dx * c.ux + dz * c.uz, lz = dx * c.vx + dz * c.vz;
        const qx = clamp(lx, -c.hx, c.hx), qz = clamp(lz, -c.hz, c.hz);
        let ex = lx - qx, ez = lz - qz, dist = Math.hypot(ex, ez);
        if (dist >= r) continue;
        if (dist < 1e-5) {   // centre inside the box: push out along the shallowest axis
          const px = c.hx - Math.abs(lx), pz = c.hz - Math.abs(lz);
          if (px < pz) { ex = Math.sign(lx) || 1; ez = 0; dist = 0; x += (ex * (px + r)) * c.ux; z += (ex * (px + r)) * c.uz; }
          else { ez = Math.sign(lz) || 1; ex = 0; x += (ez * (pz + r)) * c.vx; z += (ez * (pz + r)) * c.vz; }
          continue;
        }
        const push = (r - dist) / dist;
        x += (ex * push) * c.ux + (ez * push) * c.vx;
        z += (ex * push) * c.uz + (ez * push) * c.vz;
      }
      if (npc.model) {
        const dx = x - npc.x, dz = z - npc.z, d = Math.hypot(dx, dz), rr = r + 0.38;
        if (d < rr && d > 1e-4) { x = npc.x + dx / d * rr; z = npc.z + dz / d * rr; }
      }
    }
    return [x, z];
  }

  function zoneAt(x, z) {
    for (const v of world.volumes) if (insideOBB(v, x, z)) return v.zone;
    return null;
  }

  function nearestAnchor(x, z) {
    let best = null;
    for (const a of world.anchors) {
      if (a.id === 'entrance' || a.id === 'cargo_e1') continue;
      if (a.id === 'a1core' && !A.state.caveSolved) continue;
      if (a.id.startsWith('bb')) { const i = +a.id.slice(2); if (!A.state.caveSolved || A.state.bb[i] || !A.state.bbSeen[i]) continue; }
      const d = Math.hypot(a.x - x, a.z - z);
      if (d <= a.radius && (!best || d < best.d)) best = { ...a, d };
    }
    return best;
  }
  const anchor = (id) => world.anchors.find((a) => a.id === id);

  /* ------------------------------------------------------------ audio */
  let hum = null;
  function ac() { return E && E.audio; }
  function tone(freq, dur = 0.4, type = 'sine', gain = 0.16, glide = 1.4) {
    const a = ac(); if (!a) return;
    const t = a.currentTime, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * glide, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(E.master); o.start(t); o.stop(t + dur + 0.02);
  }
  function noiseBurst(dur, f0, f1, gain, q = 0.8) {
    const a = ac(); if (!a) return;
    const t = a.currentTime, len = Math.floor(a.sampleRate * dur), b = a.createBuffer(1, len, a.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.5);
    const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = b; f.type = 'bandpass'; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.value = gain; s.connect(f); f.connect(g); g.connect(E.master); s.start(t);
  }
  function footstep(vol, surface) {
    if (vol <= 0.01 || !ac()) return;
    if (surface === 'metal') { noiseBurst(0.09, 2200, 1500, vol * 0.5, 2.5); tone(310 + Math.random() * 40, 0.12, 'triangle', vol * 0.05, 0.9); }
    else noiseBurst(0.12, 620, 420, vol * 0.45, 0.7);
  }
  function startHum() {
    const a = ac(); if (!a || hum) return;
    const o = a.createOscillator(), o2 = a.createOscillator(), f = a.createBiquadFilter(), g = a.createGain();
    o.type = 'sawtooth'; o.frequency.value = 49; o2.type = 'square'; o2.frequency.value = 98.5;
    f.type = 'lowpass'; f.frequency.value = 260; g.gain.value = 0;
    o.connect(f); o2.connect(f); f.connect(g); g.connect(E.master); o.start(); o2.start();
    hum = { g };
  }

  /* ------------------------------------------------------------ puzzles & interactions */
  const FREQS = [1.42, 2.91, 3.17, 7.03, 5.66];
  const CRYSTAL_NAMES = ['MAVİ', 'ALTIN', 'MOR'];
  let freqLockAt = 0, crystalDemo = -1, scan = { x: 0, z: 0, t: -99 }, toastLock = 0;

  function journal(title, body) {
    const root = document.getElementById('journalEntries'); if (!root) return;
    const a = document.createElement('article'), h = document.createElement('h3'), p = document.createElement('p');
    h.textContent = title; p.textContent = body; a.append(h, p); root.appendChild(a);
  }

  function flash(color = '120,240,255', strength = 0.55) {
    let f = document.getElementById('a3dFlash');
    if (!f) { f = document.createElement('div'); f.id = 'a3dFlash'; f.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:40;opacity:0;transition:opacity 1.4s ease-out'; document.body.appendChild(f); }
    f.style.background = 'radial-gradient(ellipse at center,rgba(' + color + ',' + strength + '),rgba(' + color + ',0) 70%)';
    f.style.transition = 'none'; f.style.opacity = '1';
    requestAnimationFrame(() => requestAnimationFrame(() => { f.style.transition = 'opacity 1.6s ease-out'; f.style.opacity = '0'; }));
  }

  function setPower(on) {
    A.state.power = on;
    if (on) { startHum(); tone(80, 1.4, 'sawtooth', 0.12, 1.9); noiseBurst(0.8, 300, 900, 0.18); flash('255,214,150', 0.35); }
  }

  let lastMsgAt = -99;
  function interact(px, pz) {
    hands.poke = 1;
    const r = interactInner(px, pz);
    if (r) lastMsgAt = time;
    return r;
  }
  function interactInner(px, pz) {
    if (!A.ready) return null;
    const a = nearestAnchor(px, pz); if (!a) return null;
    const S = A.state, mission = E.mission, pro = window.ICEWALK_PROLOGUE;
    switch (a.id) {
      case 'generator':
        if (S.power) return 'JENERATÖR ÇALIŞIYOR · İSTASYONDA ELEKTRİK VAR';
        setPower(true); E.save?.();
        return 'JENERATÖR ÇALIŞTI · Işıklar, ekranlar ve telsiz enerjilendi';
      case 'radio':
        if (!S.power) { tone(140, 0.3, 'square', 0.06, 0.8); return 'TELSİZ ENERJİSİZ · Önce dışarıdaki JENERATÖRÜ çalıştır'; }
        if (pro?.active && pro.summary().stage === 1) return null;   // prologue step handles it
        if (!S.ch2 && S.bb.every(Boolean)) {
          S.ch2 = true; tone(317, 1.4, 'sine', 0.16, 1.0); flash('255,210,150', 0.5);
          journal('BÖLÜM 2 — GELECEKTEN YAYIN', 'Dört parça birleşti. Kaydın sonunda konuşan ses benim. Kayıt 03:17’de, Selin istasyona gelmeden 40 dakika önce yapılmış — ama Selin’in sesi de içinde. Ona güvenebilir miyim?');
          E.save?.();
          return 'KAYIT BİRLEŞTİ · “Sinyali kapatmayın. Cevap kapının ardında.” · BÖLÜM 2 TAMAMLANDI';
        }
        if (S.caveSolved && !S.ch2) { tone(660, 0.25); return 'TELSİZ · Kara kutu kaydı eksik · ' + S.bb.reduce((t, v) => t + v, 0) + '/4 parça'; }
        tone(660, 0.25); return 'TELSİZ · MERKEZ SESSİZ · Kayıtlı son çağrı: “İkinci yarığa yaklaşmayın.”';
      case 'labterminal':
        if (!S.power) return 'LAB TERMİNALİ KARANLIK · Enerji yok';
        if (!S.labRead) { S.labRead = true; journal('LAB TERMİNALİ — SON KAYIT', 'HELIKON-14 laboratuvarındaki bütün saatler 03:17’de durmuş. Terminalin son satırı: “FREKANS = ZAMAN”.'); }
        tone(520, 0.2);
        return 'LAB TERMİNALİ · “SAATLER DURDU: 03:17 · FREKANS = ZAMAN” · J: kayıt';
      case 'freq': {
        if (!S.power) return 'FREKANS ÇÖZÜCÜ ENERJİSİZ · Jeneratörü çalıştır';
        if (S.freqSolved) return 'ŞİFRE ÇÖZÜLDÜ · Kayıt günlükte (J)';
        if (mission !== 2) return 'FREKANS ÇÖZÜCÜ · Şu an çözülecek bir şifreli yayın yok';
        S.freqIndex = (S.freqIndex + 1) % FREQS.length;
        const f = FREQS[S.freqIndex];
        if (f === 3.17) { freqLockAt = time + 1.6; tone(317 * 1.5, 0.6, 'sine', 0.14, 1.02); return 'FREKANS 3.17 MHz · SİNYAL KİLİTLENİYOR...'; }
        freqLockAt = 0; noiseBurst(0.35, 900, 2400, 0.2, 0.4);
        return 'FREKANS ' + f.toFixed(2) + ' MHz · PARAZİT · E: sonraki kanal';
      }
      case 'artifact':
        if (!S.artifact) { S.artifact = true; journal('HELIKON KRİSTALİ — NUMUNE B7', 'Kafesin içindeki kristal tarayıcıya yanıt veriyor. Titreşimi telsizdeki yankıyla aynı ritimde: kristal bir alıcı.'); }
        tone(880, 0.5, 'sine', 0.1, 1.5); scan = { x: a.x, z: a.z, t: time };
        return 'HELIKON KRİSTALİ · Titreşim telsiz yankısıyla eşleşiyor · J: kayıt';
      case 'drill':
        if (!S.drill) { S.drill = true; journal('HELIKON SONDAJI', 'Sondaj borusu 840 metrede durmuş. Delikten mavi bir ışık yükseliyor; buzun altında boşluk var.'); }
        return 'SONDAJ DELİĞİ · 840 m derinlikte boşluk · Mavi ışık yükseliyor';
      case 'uplink':
        if (!S.power) return 'UPLINK ENERJİSİZ · Jeneratörü çalıştır';
        if (mission === 5) return null;   // final mission completes through the engine
        return 'BİRLİK UPLINK · 3/8 uydu bağlı · Görev bekleniyor';
      case 'glyph':
        if (pro?.active && pro.summary().stage === 3) return null;
        if (!S.glyphRead) { S.glyphRead = true; journal('BUZ MAĞARASI — HELIKON İŞARETİ', 'İşaretin çevresinde üç kristal var. Tarayıcı sinyali şiiri çözdü: “Önce su, sonra yıldız, en son karanlık.”'); }
        return 'HELIKON İŞARETİ · “Önce su, sonra yıldız, en son karanlık.” · Kristalleri sırayla uyandır';
      case 'crystal1': case 'crystal2': case 'crystal3': {
        const k = +a.id.slice(-1) - 1;
        if (S.caveSolved) return 'KRİSTALLER UYANIK · Rezonans çekirdeği serbest';
        if (k === S.crystals) {
          S.crystals++; tone([392, 523, 659][k], 0.9, 'sine', 0.16, 1.01); tone([784, 1046, 1318][k], 1.2, 'triangle', 0.05, 1.0);
          if (S.crystals === 3) {
            S.caveSolved = true; tone(196, 2.4, 'sine', 0.2, 2.0); flash('140,220,255', 0.7);
            journal('BUZ MAĞARASI — REZONANS', 'Üç kristal aynı anda titreşti ve işaret duvarının önünde bir çekirdek belirdi. HELIKON’un kapıları bu sırayı tanıyor.');
            E.save?.();
            return 'ÜÇ KRİSTAL UYANDI · REZONANS ÇEKİRDEĞİ AÇIĞA ÇIKTI · Q ile tara, E ile topla';
          }
          return CRYSTAL_NAMES[k] + ' KRİSTAL UYANDI · ' + S.crystals + '/3';
        }
        S.crystals = 0; noiseBurst(0.7, 180, 90, 0.3, 0.6); tone(110, 0.8, 'sawtooth', 0.08, 0.7);
        return 'REZONANS ÇAKIŞMASI · Kristaller söndü · İpucu: işarete bak (E) veya tara (Q)';
      }
      case 'a1core':
        return null;   // field scanner collects it
      case 'bb0': case 'bb1': case 'bb2': case 'bb3': {
        const i = +a.id.slice(2);
        if (S.bb[i]) return null;
        S.bb[i] = 1; S.bbSeen[i] = 1; noiseBurst(0.5, 300, 900, 0.18, 0.6); tone(523, 0.3, 'triangle', 0.1, 1.2);
        journal('KARA KUTU — ' + BB_NAMES[i], BB_LOG[i]);
        const n = S.bb.reduce((t, v) => t + v, 0); E.save?.();
        return 'KARA KUTU PARÇASI · ' + n + '/4' + (n === 4 ? ' · TELSİZDE BİRLEŞTİR' : ' · Q ile sonrakini ara');
      }
      default:
        return null;
    }
  }

  function onScan(px, pz) {
    hands.raise = 1;
    scan = { x: px, z: pz, t: time };
    if (zoneAt(px, pz) === 'cave' && !A.state.caveSolved) crystalDemo = time;
    const msg = A.state.caveSolved && zoneAt(px, pz) !== 'cave' ? bbScan(px, pz) : null;
    if (msg) { E.toast(msg); lastMsgAt = time; }
    return msg;
  }

  function blocksMission(m, px, pz) {
    if (!A.ready) return null;
    if (m === 2 && !A.state.freqSolved) return A.state.power ? 'ŞİFRE İÇİN KONTROL ODASINDAKİ FREKANS ÇÖZÜCÜYÜ KULLAN · İpucu: lab terminali' : 'İSTASYON KARANLIK · Önce JENERATÖRÜ çalıştır';
    if (m === 5 && !A.state.power) return 'UPLINK ENERJİSİZ · Önce JENERATÖRÜ çalıştır';
    return null;
  }

  /* ------------------------------------------------------------ update + draw */
  let doorSoundState = 0;
  function update(dt) {
    time += dt;
    const p = E.player;
    A.zone = zoneAt(p.x, p.z);
    handsUpdate(dt);
    npcUpdate(dt, p.x, p.z);
    for (const d of Object.values(world.dynamic)) {
      const near = Math.hypot(p.x - d.base[12], p.z - d.base[14]) < (d.ex.a3d_trigger || 2.5) || Math.hypot(npc.x - d.base[12], npc.z - d.base[14]) < 2;
      const prevOpen = d.open; d.open = clamp(d.open + (near ? dt : -dt) * 1.8, 0, 1);
      if ((prevOpen === 0 && d.open > 0) || (prevOpen === 1 && d.open < 1)) { if (doorSoundState !== (near ? 1 : 2)) { noiseBurst(0.6, 400, 1400, 0.12, 0.5); doorSoundState = near ? 1 : 2; } }
    }
    if (freqLockAt && time >= freqLockAt) {
      freqLockAt = 0; A.state.freqSolved = true;
      journal('SIĞINAK — ÇÖZÜLEN YAYIN (3.17 MHz)', 'Şifre çözüldü: yayın bizim istasyonumuzdan, yarının tarihiyle gönderilmiş. Koordinatlar kıta sahanlığındaki ikinci yarığı gösteriyor.');
      tone(990, 0.8, 'sine', 0.15, 1.2); flash('200,170,255', 0.45);
      E.toast('ŞİFRE ÇÖZÜLDÜ · YAYIN YARINDAN GELİYOR');
      E.completeMission();
    }
    if (hum) {
      const g = anchor('generator'), dist = g ? Math.hypot(p.x - g.x, p.z - g.z) : 99;
      hum.g.gain.setTargetAtTime(A.state.power ? 0.05 * Math.max(0, 1 - dist / 30) + (A.zone === 'indoor' ? 0.008 : 0) : 0, ac().currentTime, 0.2);
    }
    // context hint: show the anchor label on the existing interaction prompt
    const hint = document.getElementById('interactHint');
    const a = E.state === 'play' ? nearestAnchor(p.x, p.z) : null;
    if (hint) {
      if (a) { if (!hint.dataset.a3d) hint.dataset.orig = hint.innerHTML; hint.dataset.a3d = a.id; hint.innerHTML = '<b>E</b> ' + a.label; hint.classList.add('show'); }
      else if (hint.dataset.a3d) { hint.innerHTML = hint.dataset.orig || hint.innerHTML; delete hint.dataset.a3d; }
    }
    if (E.state === 'play') { tutorial(p); guide(); ambience(dt, p); }
  }

  // Dr. Selin tells the player what the world is waiting for, so nobody is stuck.
  const SELIN_DEFAULT = window.ICEWALK_MESHY?.characters?.find((c) => c.id === 'explorer')?.spoken;
  function guide() {
    const c = window.ICEWALK_MESHY?.characters?.find((ch) => ch.id === 'explorer'); if (!c) return;
    const S = A.state, pro = window.ICEWALK_PROLOGUE, stage = pro?.active ? pro.summary().stage : -1, m = E.mission;
    let line = SELIN_DEFAULT;
    if (stage === 0) line = 'Ekipman kontrolü kampta. Sonra rampadan çık, sığınağın telsizine geç.';
    else if (!S.power && (stage === 1 || m === 2 || m === 5)) line = 'İstasyon karanlık. Jeneratör rampanın güneyinde, sarı konteyner. Yanına git, E ile çalıştır.';
    else if (stage === 1) line = 'Telsiz kontrol odasında, en doğu uçta. Ada’nın son çağrısı orada kayıtlı.';
    else if (stage === 2) line = 'Bilinmeyen frekans kuzeyde, buzulun üstünde. Yaklaş ve Q ile tara.';
    else if (stage === 3) line = 'Mavi işaret buz mağarasının en dibinde. İçerisi karanlık: F ile fenerini aç.';
    else if (m === 2 && !S.freqSolved) line = 'Lab terminali bütün saatlerin 03:17’de durduğunu yazıyor. Frekans çözücüde bu sayıyı ara.';
    else if (!S.caveSolved && S.glyphRead) line = 'Mağaradaki şiir bir sıra anlatıyor: su, yıldız, karanlık. Kristallerin renklerine bak. Q sırayı gösterir.';
    else if (S.caveSolved && !S.ch2) line = S.bb.every(Boolean) ? 'Dört parça tamam. Kontrol odasındaki telsizde kaydı birleştir.' : 'Ada’nın kara kutusu düşerken dağıldı. Dışarıda Q ile tara: tarayıcı en yakın parçanın yönünü verir.';
    else if (m === 5 && S.power) line = 'Uplink direğin dibindeki terminalde. Dünya İttifakı’na bağlan.';
    c.spoken = line;
  }

  // Positional ambience: ice creaks and drips in the cave, radio static near the powered radio.
  let nextCreak = 2, staticNode = null;
  function ambience(dt, p) {
    const a = ac(); if (!a) return;
    if (A.zone === 'cave') {
      nextCreak -= dt;
      if (nextCreak <= 0) {
        nextCreak = 2.5 + Math.random() * 5;
        if (Math.random() < 0.55) { tone(1400 + Math.random() * 900, 0.18, 'sine', 0.035, 0.55); }
        else { noiseBurst(1.1 + Math.random(), 120, 60, 0.12, 2.2); }
      }
    }
    const r = anchor('radio');
    if (r && A.state.power) {
      if (!staticNode) {
        const len = a.sampleRate * 2, b = a.createBuffer(1, len, a.sampleRate), d = b.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (0.6 + 0.4 * Math.sin(i / a.sampleRate * 7.3));
        const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
        src.buffer = b; src.loop = true; f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 1.4; g.gain.value = 0;
        src.connect(f); f.connect(g); g.connect(E.master); src.start(); staticNode = g;
      }
      const dist = Math.hypot(p.x - r.x, p.z - r.z);
      staticNode.gain.setTargetAtTime(0.03 * Math.max(0, 1 - dist / 6), a.currentTime, 0.2);
    }
  }

  function tutorial(p) {
    const T = A.state.tutorial;
    if (time - lastMsgAt < 4) return;   // never talk over a message the player just triggered
    const st = anchor('generator');
    if (!T.cave && A.zone === 'cave') { T.cave = 1; if (!E.torch) E.toast('BUZ MAĞARASI · Karanlık · F ile feneri aç'); }
    if (!T.station && A.zone === 'indoor') { T.station = 1; if (!A.state.power) E.toast('İSTASYON KARANLIK · Jeneratör dışarıda, rampanın güneyinde'); }
    if (!T.gen && st && Math.hypot(p.x - st.x, p.z - st.z) < 8 && !A.state.power) { T.gen = 1; E.toast('JENERATÖR · Yaklaş ve E ile çalıştır'); }
  }

  function lightState(L) {
    let k = L.intensity;
    if (L.power === 1 && !A.state.power) k = 0;
    if (L.power === -1 && A.state.power) k = 0;
    if (L.power === -1) k *= 0.6 + 0.4 * Math.sin(time * 3.1);
    if (L.group && L.group.startsWith('crystal')) {
      const i = +L.group.slice(-1) - 1;
      k = (A.state.caveSolved || i < A.state.crystals) ? 1.1 : demoFlash(i) * 1.2;
    }
    if (L.name === 'glyph' && A.state.caveSolved) k *= 1.5;
    if (L.flicker) k *= 1 - L.flicker * (0.5 + 0.5 * Math.sin(time * 13.7 + Math.sin(time * 4.1) * 3));
    return k;
  }
  function demoFlash(i) {
    if (crystalDemo < 0) return 0;
    const t = time - crystalDemo - 0.5 - i * 0.9;
    return t > 0 && t < 0.7 ? Math.sin(t / 0.7 * Math.PI) : 0;
  }

  function groupScale(e) {
    const g = e.ex.a3d_group, S = A.state;
    if (!g) return 1;
    if (g.startsWith('crystal')) { const i = +g.slice(-1) - 1; return (S.caveSolved || i < S.crystals) ? 1.25 : 0.18 + demoFlash(i) * 1.3; }
    if (g === 'glyph') return S.caveSolved ? 1.4 : 0.55;
    if (g === 'a1core') { e.visible = S.caveSolved && !(window.ICEWALK_FIELD?.diagnostics().taken || []).includes('A1'); return 1.4; }
    return 1;
  }

  function planes(vp) {
    const P = [];
    const row = (r) => [vp[r], vp[4 + r], vp[8 + r], vp[12 + r]];
    const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
    for (const [s, r] of [[1, r0], [-1, r0], [1, r1], [-1, r1], [1, r2], [-1, r2]]) {
      const p = r3.map((v, i) => v + s * r[i]), l = Math.hypot(p[0], p[1], p[2]);
      P.push(p.map((v) => v / l));
    }
    return P;
  }

  const attribsOn = new Set();
  function bindAttr(prog, name, buf, n) {
    const loc = prog.a[name]; if (loc < 0 || loc === undefined) return;
    if (!buf) { gl.disableVertexAttribArray(loc); attribsOn.delete(loc); gl.vertexAttrib4f(loc, 0, 0, 0, name === 'aTan' ? 1 : 0); return; }
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.b); gl.enableVertexAttribArray(loc); attribsOn.add(loc);
    gl.vertexAttribPointer(loc, buf.n, gl.FLOAT, false, 0, 0);
  }

  function draw(view, proj, eye, fwd, opts) {
    if (!A.ready) return;
    const q = QUALITY[window.ICEWALK_VISUALS?.quality] || QUALITY.balanced;
    A.stats.draws = 0; A.stats.tris = 0; A.stats.culled = 0;
    const vp = M4.mul(proj, view), P = planes(vp);
    const storm = opts.storm, fogD = 0.0015 + storm * 0.0100, fogC = [0.72 + (0.81 - 0.72) * storm * 0.65, 0.80 + (0.85 - 0.80) * storm * 0.65, 0.83 + (0.85 - 0.83) * storm * 0.65];
    // lights: nearest active N
    const lights = world.lights.map((L) => ({ L, k: lightState(L), d: Math.hypot(L.x - eye[0], L.y - eye[1], L.z - eye[2]) }))
      .filter((o) => o.k > 0.01 && o.d < o.L.range + 45).sort((a, b) => a.d - b.d).slice(0, q.lights);
    const LP = new Float32Array(16), LC = new Float32Array(12);
    lights.forEach((o, i) => { LP.set([o.L.x, o.L.y, o.L.z, o.L.range], i * 4); LC.set(o.L.color.map((c) => c * o.k), i * 3); });
    A.stats.lights = lights.length;
    const scanAge = time - scan.t, scanR = scanAge * 22, scanAmt = scanAge < 3.2 ? (1 - scanAge / 3.2) * 1.4 : 0;
    const indoorAmb = A.zone === 'cave' ? [0.10, 0.17, 0.22] : A.state.power ? [0.30, 0.31, 0.32] : [0.11, 0.115, 0.13];

    const items = [];
    for (const e of world.draw) {
      if (!e.visible && !e.ex.a3d_hidden) continue;
      // per-node animation
      const ex = e.ex;
      let m = e.base;
      if (ex.a3d_spin || ex.a3d_bob || ex.a3d_slide) {
        m = new Float32Array(e.base);
        if (ex.a3d_spin) { const r = M4.rotY(time * ex.a3d_spin); const t = [m[12], m[13], m[14]]; m = M4.mul(r, m); m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; }
        if (ex.a3d_bob) m[13] += Math.sin(time * 2.1) * ex.a3d_bob;
        if (ex.a3d_slide) { const s = smooth(0, 1, e.open); m[12] += ex.a3d_slide[0] * s; m[13] += ex.a3d_slide[1] * s; m[14] += ex.a3d_slide[2] * s; }
      }
      e.m = m;
      let es = groupScale(e);
      if (!e.visible) continue;
      if (ex.a3d_glow !== undefined) es *= ex.a3d_glow;
      if (ex.a3d_power) es *= A.state.power ? 1 : 0.05;
      if (ex.a3d_pulse) es *= 0.7 + 0.3 * Math.sin(time * ex.a3d_pulse * Math.PI * 2);
      if (ex.a3d_blink) es *= (time * ex.a3d_blink) % 1 < 0.35 ? 1.2 : 0.08;
      e.emissiveScale = es;
      const dx = m[12] - eye[0], dz = m[14] - eye[2];
      for (const pr of e.prims) {
        const c = M4.xform(m, pr.center[0], pr.center[1], pr.center[2]);
        const dist = Math.hypot(c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]) - pr.radius;
        if (ex.a3d_cull && dist > ex.a3d_cull * q.lod) { A.stats.culled++; continue; }
        if (ex.a3d_lod_far && dist > ex.a3d_lod_far * q.lod) continue;
        if (ex.a3d_lod_near && dist <= ex.a3d_lod_near * q.lod) continue;
        let out = false;
        for (const pl of P) if (pl[0] * c[0] + pl[1] * c[1] + pl[2] * c[2] + pl[3] < -pr.radius) { out = true; break; }
        if (out) { A.stats.culled++; continue; }
        items.push({ e, pr, m, d: Math.hypot(dx, dz), decal: !!ex.a3d_decal, blend: pr.mat.blend || ex.a3d_group === 'glyph', additive: ex.a3d_group === 'glyph' });
      }
    }
    if (npc.model) {
      poseNPC();
      const d = Math.hypot(npc.x - eye[0], npc.z - eye[2]);
      for (const n of npc.model.nodes) {
        if (n.mesh === undefined || n.skin === undefined) continue;
        const lod = n.extras.a3d_lod || 0, far = (n.extras.a3d_lod_far || 1e9) * q.lod, near = (n.extras.a3d_lod_near || 0) * q.lod;
        if ((lod === 0 && d > far) || (lod === 1 && d <= near) || d > 160) continue;
        for (const pr of npc.model.meshes[n.mesh]) items.push({ e: null, pr, m: M4.ident(), skin: npc.model.skins[n.skin], d, decal: false, blend: false });
      }
    }
    items.sort((a, b) => (a.decal - b.decal) || (a.blend - b.blend) || (a.blend ? b.d - a.d : 0));

    let cur = null;
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    for (const it of items) {
      const defs = [];
      if (it.skin) defs.push('SKIN');
      if (q.normalMap) defs.push('NORMALMAP');
      const prog = compile(defs);
      if (prog !== cur) {
        cur = prog; gl.useProgram(prog.p);
        const u = prog.u;
        gl.uniformMatrix4fv(u.uView, false, view); gl.uniformMatrix4fv(u.uProj, false, proj);
        gl.uniform3fv(u.uCam, eye); gl.uniform3fv(u.uCamF, fwd); gl.uniform1f(u.uTime, time);
        gl.uniform3fv(u.uTorchP, (opts.xr && opts.xr.torch) ? opts.xr.torch.p : eye); gl.uniform3fv(u.uTorchD, (opts.xr && opts.xr.torch) ? opts.xr.torch.d : fwd);
        gl.uniform1f(u.uFlash, opts.torch ? 1 : 0); gl.uniform1f(u.uFogD, fogD); gl.uniform3fv(u.uFogC, fogC);
        gl.uniform3fv(u.uAmbient, indoorAmb);
        gl.uniform4fv(u.uLP, LP); gl.uniform3fv(u.uLC, LC);
        gl.uniform4f(u.uScan, scan.x, groundY(scan.x, scan.z) + 1, scan.z, scanR); gl.uniform1f(u.uScanAmt, scanAmt);
        gl.uniform1i(u.uBaseTex, 2); gl.uniform1i(u.uOrmTex, 3); gl.uniform1i(u.uNrmTex, 4); gl.uniform1i(u.uEmiTex, 5);
      }
      const u = cur.u, mat = it.pr.mat;
      gl.uniformMatrix4fv(u.uModel, false, it.m);
      if (it.skin) gl.uniformMatrix4fv(u.uBones, false, it.skin.mats);
      gl.uniform4fv(u.uBase, mat.base);
      const es = it.e ? it.e.emissiveScale : 1;
      gl.uniform3f(u.uEmissive, mat.emissive[0] * es, mat.emissive[1] * es, mat.emissive[2] * es);
      gl.uniform4f(u.uHas, mat.baseTex ? 1 : 0, mat.orm ? 1 : 0, mat.nrm ? 1 : 0, mat.emiTex ? 1 : 0);
      gl.uniform1f(u.uRough, mat.rough); gl.uniform1f(u.uMetal, mat.metal);
      gl.uniform1f(u.uInterior, mat.interior ? 1 : 0); gl.uniform1f(u.uIce, mat.ice ? 1 : 0);
      gl.uniform1f(u.uDecal, it.decal ? 1 : 0); gl.uniform1f(u.uAlpha, 1);
      gl.uniform1f(u.uScanSel, it.e && it.e.ex.a3d_scan ? 1 : 0);
      [[mat.baseTex, 2], [mat.orm, 3], [mat.nrm, 4], [mat.emiTex, 5]].forEach(([t, unit]) => { if (t) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); } });
      const b = it.pr.bufs;
      bindAttr(cur, 'aPos', b.aPos, 3); bindAttr(cur, 'aNorm', b.aNorm, 3); bindAttr(cur, 'aUV', b.aUV, 2); bindAttr(cur, 'aTan', b.aTan, 4);
      if (it.skin) { bindAttr(cur, 'aJoint', b.aJoint, 4); bindAttr(cur, 'aWeight', b.aWeight, 4); }
      if (it.blend || it.decal) {
        gl.enable(gl.BLEND); if (it.additive) gl.blendFunc(gl.ONE, gl.ONE); else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
        if (it.decal) { gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -4); }
      }
      if (it.pr.index) { gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, it.pr.index); gl.drawElements(gl.TRIANGLES, it.pr.count, it.pr.itype, 0); }
      else gl.drawArrays(gl.TRIANGLES, 0, it.pr.count);
      if (it.blend || it.decal) { gl.disable(gl.BLEND); gl.depthMask(true); gl.disable(gl.POLYGON_OFFSET_FILL); }
      A.stats.draws++; A.stats.tris += it.pr.tris;
    }
    drawHands(eye, fwd, opts, view, proj);
    for (const loc of attribsOn) gl.disableVertexAttribArray(loc);
    attribsOn.clear();
    gl.activeTexture(gl.TEXTURE0);
  }

  /* ------------------------------------------------------------ first-person hands */
  const hands = { phase: 0, last: null, sway: [0, 0], yawPrev: null, lag: 0, raise: 0, poke: 0 };
  function handsUpdate(dt) {
    const p = E.player;
    if (hands.last) {
      const v = Math.hypot(p.x - hands.last[0], p.z - hands.last[1]) / Math.max(dt, 1e-3);
      hands.speed = Math.min(8, v);
      hands.phase += Math.min(8, v) * dt * 1.45;
    }
    hands.last = [p.x, p.z];
    if (hands.yawPrev !== null) {
      let dy = p.yaw - hands.yawPrev; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      hands.lag += (clamp(-dy * 1.6, -0.05, 0.05) - hands.lag) * Math.min(1, dt * 6);
    }
    hands.yawPrev = p.yaw;
    hands.raise = Math.max(0, hands.raise - dt / 1.8);
    hands.poke = Math.max(0, hands.poke - dt / 0.45);
  }
  const GRIP = { right: [0.212, -0.132, -0.19], left: [-0.23, -0.206, -0.287] };   // palm centres in the authored view space
  function drawHands(eye, fwd, opts, view, worldProj) {
    const m = A.models.fp_hands; if (!m || E.state !== 'play') return;
    const xr = opts.xr && opts.xr.hands;
    const p = E.player, r = [Math.cos(p.yaw), 0, Math.sin(p.yaw)];
    const u = [r[1] * fwd[2] - r[2] * fwd[1], r[2] * fwd[0] - r[0] * fwd[2], r[0] * fwd[1] - r[1] * fwd[0]];
    const cam = new Float32Array([r[0], r[1], r[2], 0, u[0], u[1], u[2], 0, -fwd[0], -fwd[1], -fwd[2], 0, eye[0], eye[1], eye[2], 1]);
    const v = hands.speed || 0, ph = hands.phase;
    const bob = Math.sin(ph * 2) * Math.min(0.012, v * 0.003), sway = Math.sin(ph) * Math.min(0.012, v * 0.003);
    const breathe = Math.sin(time * 1.4) * 0.003;
    const asp = gl.drawingBufferWidth / gl.drawingBufferHeight, q = 1 / Math.tan(76 * Math.PI / 360), n = 0.01, f = 10;
    const hp = new Float32Array([q / asp, 0, 0, 0, 0, q, 0, 0, 0, 0, -(f + n) / (f - n), -1, 0, 0, -2 * f * n / (f - n), 0]);
    if (!xr) gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    const progH = compile(QUALITY[window.ICEWALK_VISUALS?.quality]?.normalMap === false ? [] : ['NORMALMAP']);
    gl.useProgram(progH.p);
    const U = progH.u;
    gl.uniformMatrix4fv(U.uView, false, view); gl.uniformMatrix4fv(U.uProj, false, xr ? worldProj : hp);
    gl.uniform3fv(U.uCam, eye); gl.uniform3fv(U.uCamF, fwd); gl.uniform3fv(U.uTorchP, eye); gl.uniform3fv(U.uTorchD, fwd); gl.uniform1f(U.uFlash, 0); gl.uniform1f(U.uFogD, 0);
    gl.uniform1f(U.uScanAmt, 0); gl.uniform1i(U.uBaseTex, 2); gl.uniform1i(U.uOrmTex, 3); gl.uniform1i(U.uNrmTex, 4); gl.uniform1i(U.uEmiTex, 5);
    const rs = smooth(0, 1, hands.raise), pk = Math.sin(hands.poke * Math.PI);
    for (const n2 of m.nodes) {
      if (n2.mesh === undefined) continue;
      const side = n2.extras.a3d_side || 'right';
      const off = side === 'left'
        ? [sway * 0.8 + hands.lag + rs * 0.05, bob + breathe + rs * 0.085, rs * -0.06]
        : [sway + hands.lag, bob * 1.2 + breathe, pk * -0.05];
      const local = M4.trs(off, side === 'left' ? [rs * 0.17, 0, 0, 1] : [0, 0, 0, 1], [1, 1, 1]);
      let model;
      if (xr) { const base = xr[side]; if (!base) continue; const g0 = GRIP[side]; model = M4.mul(base, M4.mul(M4.trs([-g0[0], -g0[1], -g0[2]], [0, 0, 0, 1], [1, 1, 1]), n2.world)); }
      else model = M4.mul(cam, M4.mul(local, n2.world));
      const g = n2.extras.a3d_group;
      const es = g === 'torch' ? (opts.torch || (E.torch && xr) ? 1.6 : 0.03) : g === 'scanner' ? 0.55 + rs * 1.2 + 0.15 * Math.sin(time * 5) : 1;
      for (const pr of m.meshes[n2.mesh]) {
        const mat = pr.mat;
        gl.uniformMatrix4fv(U.uModel, false, model);
        gl.uniform4fv(U.uBase, mat.base);
        gl.uniform3f(U.uEmissive, mat.emissive[0] * es, mat.emissive[1] * es, mat.emissive[2] * es);
        gl.uniform4f(U.uHas, mat.baseTex ? 1 : 0, mat.orm ? 1 : 0, mat.nrm ? 1 : 0, mat.emiTex ? 1 : 0);
        gl.uniform1f(U.uRough, mat.rough); gl.uniform1f(U.uMetal, mat.metal);
        gl.uniform1f(U.uInterior, A.zone ? 1 : 0); gl.uniform1f(U.uIce, 0); gl.uniform1f(U.uDecal, 0); gl.uniform1f(U.uAlpha, 1); gl.uniform1f(U.uScanSel, 0);
        [[mat.baseTex, 2], [mat.orm, 3], [mat.nrm, 4], [mat.emiTex, 5]].forEach(([t, unit]) => { if (t) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); } });
        const b = pr.bufs;
        bindAttr(progH, 'aPos', b.aPos, 3); bindAttr(progH, 'aNorm', b.aNorm, 3); bindAttr(progH, 'aUV', b.aUV, 2); bindAttr(progH, 'aTan', b.aTan, 4);
        if (pr.index) { gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, pr.index); gl.drawElements(gl.TRIANGLES, pr.count, pr.itype, 0); } else gl.drawArrays(gl.TRIANGLES, 0, pr.count);
        A.stats.draws++; A.stats.tris += pr.tris;
      }
    }
  }

  /* ------------------------------------------------------------ boot */
  async function load() {
    const t0 = performance.now();
    A.status = 'loading';
    const results = await Promise.all(MODELS.map(async (url) => {
      const r = await fetch(url);
      if (!r.ok) throw Error(url + ' ' + r.status);
      const buf = await r.arrayBuffer();
      A.progress += 1 / MODELS.length;
      const name = url.split('/').pop().replace('.glb', '');
      return buildModel(name, buf);
    }));
    for (const m of results) A.models[m.name] = m;
    harvest(A.models.station); harvest(A.models.ice_cave);
    if (A.models.fp_hands) { const arm = document.getElementById('arm'); if (arm) arm.style.display = 'none'; }
    npc.model = A.models.explorer;
    const p0 = world.path[0]; if (p0) { npc.x = p0.x; npc.z = p0.z; }
    compile(['NORMALMAP']); compile([]); compile(['SKIN', 'NORMALMAP']); compile(['SKIN']);
    relocateStory(); placeBlackBox();
    A.loadMs = Math.round(performance.now() - t0);
    A.status = 'ready'; A.ready = true;
    E.onReady?.();
  }

  /* ------------------------------------------------------------ chapter 2: black box */
  // Four recorder fragments lie buried in the snow around the station. The field scanner (Q)
  // pings the nearest one with distance and bearing; E digs it out; the radio plays the
  // reassembled recording.
  const BB_NAMES = ['KAYIT 1/4 · 02:58', 'KAYIT 2/4 · 03:06', 'KAYIT 3/4 · 03:12', 'KAYIT 4/4 · 03:17'];
  const BB_LOG = [
    'Ada (telsiz): “Yarıktan gelen ışık ritim tutuyor. Selin ölçüm yapmak için aşağı indi.”',
    'Ada: “Selin dönmedi ama sesi telsizde. Bize yarın neler olacağını anlatıyor.”',
    'Ada: “Kristal numunesi B7 kafesinde çınlıyor. Saatler geri sayıyor.”',
    'Bilinmeyen ses — senin sesin: “Sinyali kapatmayın. Cevap kapının ardında.”',
  ];
  function placeBlackBox() {
    const offs = [['drill', 7, 5], ['uplink', -6, 7], ['generator', -11, -7], ['entrance', 5, 7]];
    offs.forEach(([id, dx, dz], i) => {
      const a = anchor(id) || anchor('generator'); if (!a) return;
      const x = a.x + dx, z = a.z + dz;
      world.anchors.push({ id: 'bb' + i, label: 'KARA KUTU PARÇASI', radius: 2.2, x, y: groundY(x, z), z });
    });
  }
  function bbScan(px, pz) {
    const S = A.state; if (!S.caveSolved || S.ch2) return null;
    let best = null;
    for (let i = 0; i < 4; i++) {
      if (S.bb[i]) continue;
      const a = anchor('bb' + i); if (!a) continue;
      const d = Math.hypot(a.x - px, a.z - pz);
      if (!best || d < best.d) best = { i, d, a };
    }
    if (!best) return 'TÜM PARÇALAR TOPLANDI · Kontrol odasındaki TELSİZE götür';
    if (best.d < 12) S.bbSeen[best.i] = 1;
    const ang = Math.atan2(best.a.x - px, -(best.a.z - pz));   // 0 = north (−z)
    const dirs = ['KUZEY', 'KUZEYDOĞU', 'DOĞU', 'GÜNEYDOĞU', 'GÜNEY', 'GÜNEYBATI', 'BATI', 'KUZEYBATI'];
    const dir = dirs[(Math.round(ang / (Math.PI / 4)) + 8) % 8];
    tone(best.d < 12 ? 1320 : 660, 0.12, 'square', 0.08, 1.0);
    return 'KARA KUTU SİNYALİ · ' + Math.round(best.d) + ' m ' + dir + (best.d < 12 ? ' · Yakında: E ile kaz' : '');
  }

  function relocateStory() {
    const at = (id) => anchor(id);
    const pro = window.ICEWALK_PROLOGUE, radio = at('radio'), glyph = at('glyph');
    if (pro?.relocate) { if (radio) pro.relocate(1, radio.x, radio.z, radio.radius); if (glyph) pro.relocate(3, glyph.x, glyph.z, glyph.radius); }
    const freq = at('freq'), up = at('uplink');
    if (freq) Object.assign(E.objects[2], { x: freq.x, z: freq.z });
    if (up) Object.assign(E.objects[5], { x: up.x, z: up.z });
    const camp = window.ICEWALK_CAMPAIGN?.targets;
    if (camp) { if (freq) Object.assign(camp[2], { x: freq.x, z: freq.z }); if (up) Object.assign(camp[5], { x: up.x, z: up.z }); }
    const core = at('a1core'), field = window.ICEWALK_FIELD?.sites?.find((s) => s.id === 'A1');
    if (core && field) Object.assign(field, { x: core.x, z: core.z });
    const e1 = at('cargo_e1'), cargo = window.ICEWALK_CARGO?.sites?.find((s) => s.id === 'E1');
    if (e1 && cargo) Object.assign(cargo, { x: e1.x, z: e1.z });
  }

  Object.assign(A, {
    init(engine) {
      E = engine; gl = engine.gl;
      ext.uint = gl.getExtension('OES_element_index_uint');
      ext.aniso = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
      if (location.protocol === 'file:') { A.status = 'unavailable'; A.error = 'file:// — modeller için uygulama veya http sunucusu gerekir'; return; }
      load().catch((e) => { A.status = 'failed'; A.error = String(e && e.message || e); console.warn('A3D yüklenemedi, prosedürel sahne kullanılıyor:', e); });
    },
    replaces(tag) { return A.ready && ['station', 'cave', 'crew:explorer'].includes(tag); },
    groundY: (x, z) => (A.ready ? groundY(x, z) : E.terrainY(x, z)),
    collide: (x0, z0, x1, z1, r) => (A.ready ? collide(x0, z0, x1, z1, r) : [x1, z1]),
    surface: (x, z) => (A.ready && world.floors.some((f) => insideOBB(f, x, z)) ? 'metal' : 'snow'),
    update, draw, interact, onScan, blocksMission, footstep,
    talk(id) { if (id === 'explorer') npc.talkUntil = time + 2.2; },
    npcPlace(x, z, yaw = 0, hold = 8) { npc.x = x; npc.z = z; npc.yaw = yaw; npc.wait = hold; },
    blockCollect(px, pz) {
      if (!A.ready || A.state.caveSolved) return null;
      const c = anchor('a1core');
      return c && Math.hypot(px - c.x, pz - c.z) < 5 ? 'ÇEKİRDEK BUZDA MÜHÜRLÜ · Kristalleri doğru sırayla uyandır' : null;
    },
    snowFactor() { return A.zone === 'indoor' ? 0 : A.zone === 'cave' ? 0.15 : 1; },
    serialize() { return JSON.parse(JSON.stringify(A.state)); },
    restore(s) { if (!s) return; Object.assign(A.state, s, { tutorial: s.tutorial || {}, bb: s.bb || [0, 0, 0, 0], bbSeen: s.bbSeen || [0, 0, 0, 0], ch2: !!s.ch2 }); if (A.state.power) startHum(); },
    resetState() { if (staticNode) staticNode.gain.value = 0; A.state = { power: false, freqIndex: -1, freqSolved: false, crystals: 0, caveSolved: false, labRead: false, artifact: false, drill: false, glyphRead: false, bb: [0, 0, 0, 0], bbSeen: [0, 0, 0, 0], ch2: false, tutorial: {} }; },
    world,
    diagnostics() {
      return { status: A.status, error: A.error, loadMs: A.loadMs, zone: A.zone, state: A.serialize(), stats: { ...A.stats }, textureMB: +((A.texBytes || 0) / 1048576).toFixed(1),
        colliders: world.colliders.length, floors: world.floors.length, anchors: world.anchors.map((a) => a.id), lights: world.lights.length, npc: A.npc,
        models: Object.fromEntries(Object.entries(A.models).map(([k, m]) => [k, { meshes: m.meshes.length, clips: Object.keys(m.clips) }])) };
    },
  });
  // Live getter (Object.assign would have copied a one-time snapshot).
  Object.defineProperty(A, 'npc', { enumerable: true, get: () => ({ x: npc.x, z: npc.z, clip: npc.clip }) });
})();
