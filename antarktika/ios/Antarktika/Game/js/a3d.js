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
  const MODELS = ['models/station.glb', 'models/ice_cave.glb', 'models/explorer.glb', 'models/fp_hands.glb', 'models/helikon_hall.glb', 'models/helikon_city.glb', 'models/helikon_grid.glb', 'models/drill_camp.glb'];
  const SUN = [-0.58, 0.47, -0.68];
  const MAXB = 20;
  const QUALITY = {
    low: { lights: 2, lod: 0.6, normalMap: false, texScale: 0.5, dataScale: 0.5, aniso: 1, shadow: 0, shadowR: 0 },
    balanced: { lights: 3, lod: 1.0, normalMap: true, texScale: 1, dataScale: 0.5, aniso: 2, shadow: 1024, shadowR: 30 },
    cinematic: { lights: 4, lod: 1.5, normalMap: true, texScale: 1, dataScale: 1, aniso: 4, shadow: 2048, shadowR: 44 },
  };
  const A = {
    status: 'idle', progress: 0, error: null, models: {}, ready: false, zone: null, loadMs: 0,
    stats: { draws: 0, tris: 0, lights: 0, culled: 0 },
    state: { power: false, freqIndex: -1, freqSolved: false, crystals: 0, caveSolved: false, labRead: false, artifact: false, drill: false, glyphRead: false, bb: [0, 0, 0, 0], bbSeen: [0, 0, 0, 0], ch2: false, inHall: false, ch3: false, kaanSeen: false, kaanFree: false, kaanTalk: 0, kaanTrust: 0, heatCell: 0, steles: [0, 0, 0, 0, 0], stars: [], inCity: false, ch4: false, syms: [0, 0, 0, 0, 0, 0], stones: [0, 0, 0], bridge: false, voice: 0, ending4: '', inGrid: false, plane5: 0, left5: 0, cable5: 0, dials: [2, 0, 1], grid5: false, ch5: false, load5: '', inCamp: false, pump6: 0, pumpP: 38, relay6: 0, soldier6: '', spill6: 0, spot6: 0, ch6: false, ch7: false, ending7: '', tutorial: {} },
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
uniform mat4 uModel,uView,uProj,uShadowM;
varying vec3 vPos,vNorm;varying vec2 vUV;varying vec4 vTan;varying float vDist;varying vec4 vSh;
void main(){vec4 p=vec4(aPos,1.);vec4 n=vec4(aNorm,0.);vec4 t=vec4(aTan.xyz,0.);
#ifdef SKIN
mat4 sk=uBones[int(aJoint.x)]*aWeight.x+uBones[int(aJoint.y)]*aWeight.y+uBones[int(aJoint.z)]*aWeight.z+uBones[int(aJoint.w)]*aWeight.w;
p=sk*p;n=sk*n;t=sk*t;
#endif
vec4 w=uModel*p;vPos=w.xyz;vNorm=(uModel*n).xyz;vTan=vec4((uModel*t).xyz,aTan.w==0.?1.:aTan.w);vUV=aUV;
vSh=uShadowM*w;vec4 e=uView*w;vDist=length(e.xyz);gl_Position=uProj*e;}`;
  const FS = `
precision highp float;
varying vec3 vPos,vNorm;varying vec2 vUV;varying vec4 vTan;varying float vDist;varying vec4 vSh;
uniform sampler2D uBaseTex,uOrmTex,uNrmTex,uEmiTex,uShadow;uniform float uShadowOn,uShadowTx;
uniform vec4 uBase;uniform vec3 uEmissive;uniform vec4 uHas;uniform float uRough,uMetal,uInterior,uIce,uDecal,uAlpha;
uniform vec3 uCam,uCamF,uAmbient,uFogC,uTorchP,uTorchD;uniform float uTime,uFlash,uFogD;
uniform vec4 uLP[4];uniform vec3 uLC[4];uniform vec4 uScan;uniform float uScanAmt,uScanSel;
float unpackD(vec4 c){return dot(c,vec4(1.,1./255.,1./65025.,1./16581375.));}
float sTap(vec2 uv,float z){vec2 px=uv/uShadowTx-.5;vec2 f=fract(px);vec2 b=(floor(px)+.5)*uShadowTx;float a=step(z,unpackD(texture2D(uShadow,b))),c=step(z,unpackD(texture2D(uShadow,b+vec2(uShadowTx,0.)))),d=step(z,unpackD(texture2D(uShadow,b+vec2(0.,uShadowTx)))),e=step(z,unpackD(texture2D(uShadow,b+vec2(uShadowTx))));return mix(mix(a,c,f.x),mix(d,e,f.x),f.y);}
float sPCF(vec2 uv,float z){float o=uShadowTx*.75;return (sTap(uv+vec2(-o,-o),z)+sTap(uv+vec2(o,-o),z)+sTap(uv+vec2(-o,o),z)+sTap(uv+vec2(o,o),z))*.25;}
float sunShadow(float ndl){if(uShadowOn<.01)return 1.;vec3 s=vSh.xyz/vSh.w;if(s.x<.0||s.x>1.||s.y<.0||s.y>1.||s.z>1.)return 1.;
float bias=.0008+.0025*(1.-ndl);float t=sPCF(s.xy,s.z-bias);
float edge=smoothstep(0.,.06,min(min(s.x,1.-s.x),min(s.y,1.-s.y)));return mix(1.,t,edge*uShadowOn);}
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
vec3 alb=base.rgb,col;float ndl=max(dot(n,L),0.);float nv=max(dot(n,V),.001);
vec3 spec=vec3(0.);float shin=mix(96.,6.,rough);vec3 F0=mix(vec3(.04),alb,metal);vec3 dif=alb*(1.-metal*.8);
if(uInterior<.5){float sky=clamp(n.y*.28+.72,.37,1.);float sh=sunShadow(ndl);
vec3 skyC=vec3(.78,.86,1.)*(.36+.24*sky),sunC=vec3(1.,.93,.80)*.62;
col=dif*(skyC*ao+sunC*ndl*sh*mix(1.,ao,.6));
vec3 H=normalize(L+V);float nh=max(dot(n,H),0.),vh=max(dot(V,H),0.),a=rough*rough,a2=a*a,dd=nh*nh*(a2-1.)+1.,k=a*.5;
float D=a2/(3.14159*dd*dd),Vis=.25/((ndl*(1.-k)+k)*(nv*(1.-k)+k));vec3 F=F0+(1.-F0)*pow(1.-vh,5.);
spec+=min(D*Vis,30.)*F*ndl*sunC*sh*1.9;
vec3 R=reflect(-V,n);vec3 env=mix(vec3(.80,.85,.86),vec3(.46,.57,.68),clamp(R.y*1.6,0.,1.));
vec3 Fv=F0+(max(vec3(1.-rough),F0)-F0)*pow(1.-nv,5.);spec+=Fv*env*ao*(1.-rough*.75)*.55;}
else{col=dif*uAmbient*ao;vec3 Fv=F0+(max(vec3(1.-rough),F0)-F0)*pow(1.-nv,5.);spec+=Fv*uAmbient*ao*(1.-rough*.8)*.6;}
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

  // layer: null = the outdoor world; 'hall' = the Chapter 3 interior, only live while state.inHall
  function harvest(model, layer = null) {
    for (const n of model.nodes) {
      const ex = n.extras, nm = n.name;
      if (ex.a3d_kind === 'collider') world.colliders.push({ ...obb(n), name: nm, door: ex.a3d_door || null, layer, cond: ex.a3d_cond || null });
      else if (ex.a3d_kind === 'floor') world.floors.push({ ...obb(n), name: nm, ramp: !!ex.a3d_ramp, layer, cond: ex.a3d_cond || null });
      else if (ex.a3d_kind === 'volume') world.volumes.push({ ...obb(n), name: nm, zone: ex.a3d_zone, layer });
      else if (ex.a3d_kind === 'interact') world.anchors.push({ id: ex.a3d_id, label: ex.a3d_label, radius: ex.a3d_radius || 2, x: n.world[12], y: n.world[13], z: n.world[14], layer });
      else if (ex.a3d_kind === 'light') world.lights.push({ name: nm.replace('LIGHT_', ''), x: n.world[12], y: n.world[13], z: n.world[14], color: ex.a3d_color, intensity: ex.a3d_intensity, range: ex.a3d_range, flicker: ex.a3d_flicker || 0, power: ex.a3d_power ?? 0, group: ex.a3d_group || null, layer });
      else if (ex.a3d_kind === 'path') world.path.push({ x: n.world[12], z: n.world[14], order: ex.a3d_order, wait: ex.a3d_wait || 0 });
      if (n.mesh !== undefined && n.skin === undefined) {
        const entry = { model, node: n, prims: model.meshes[n.mesh], ex, base: new Float32Array(n.world), m: new Float32Array(n.world), emissiveScale: 1, visible: !ex.a3d_hidden, open: 0, layer };
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

  // layers: null = outdoor world, 'hall' = chapter 3 interior, 'city' = chapter 4 lake basin, 'grid' = chapter 5 gallery, 'camp' = chapter 6 drill camp.
  // cond: 'bridge' = only once the crystal bridge is up, 'nobridge' = only before.
  const curLayer = () => (A.state.inCamp ? 'camp' : A.state.inGrid ? 'grid' : A.state.inCity ? 'city' : A.state.inHall ? 'hall' : null);
  const live = (o) => (o.layer || null) === curLayer() && (!o.cond || (o.cond === 'bridge') === !!A.state.bridge);
  function groundY(x, z) {
    let best = null;
    for (const f of world.floors) {
      if (!live(f)) continue;
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
        if (!live(c)) continue;
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
      if (A.state.inCamp) { const c = campClamp(x, z); x = c[0]; z = c[1]; }
      if (npc.model && !curLayer()) {
        const dx = x - npc.x, dz = z - npc.z, d = Math.hypot(dx, dz), rr = r + 0.38;
        if (d < rr && d > 1e-4) { x = npc.x + dx / d * rr; z = npc.z + dz / d * rr; }
      }
    }
    return [x, z];
  }

  function zoneAt(x, z) {
    for (const v of world.volumes) if (live(v) && insideOBB(v, x, z)) return v.zone;
    return null;
  }

  function nearestAnchor(x, z) {
    let best = null;
    for (const a of world.anchors) {
      if (a.id === 'entrance' || a.id === 'cargo_e1' || a.id === 'hall_spawn' || a.id === 'grid_spawn' || a.id === 'camp_spawn' || !live(a)) continue;
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
    o.connect(g); g.connect(bus()); o.start(t); o.stop(t + dur + 0.02);
  }
  function noiseBurst(dur, f0, f1, gain, q = 0.8) {
    const a = ac(); if (!a) return;
    const t = a.currentTime, len = Math.floor(a.sampleRate * dur), b = a.createBuffer(1, len, a.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.5);
    const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = b; f.type = 'bandpass'; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.value = gain; s.connect(f); f.connect(g); g.connect(bus()); s.start(t);
  }
  /* ------------------------------------------------------------ sound realism
   * Dry polar snow does not "thud": a boot compacting it makes a burst of tiny fractures (a crunch/squeak,
   * most energy 1-5 kHz) in two clusters, heel then toe, over a low boot thump. Those are synthesised
   * sample by sample into a small bank of variations at start. Wind is three layers: the engine's low
   * rumble, a gusting band that howls, and a narrow whistle that rises in a storm. Parka nylon swishes
   * with each step, breath is audible when running or cold, caves drip, and every sound gets the
   * reverb of the space you are in (a long cold ring in ice caves and halls, a short one in the station). */
  const SFX = { ready: false, bank: {}, bus: null, wet: null, conv: null, irZone: '', gust: null, whistle: null, hiss: null, gustT: 0, gustV: 0, nextDrip: 3, cave: null };
  function bus() {
    const a = ac(); if (!a) return E.master;
    if (!SFX.bus) {
      SFX.bus = a.createGain(); SFX.bus.connect(E.master);
      SFX.conv = a.createConvolver(); SFX.wet = a.createGain(); SFX.wet.gain.value = 0;
      SFX.bus.connect(SFX.conv); SFX.conv.connect(SFX.wet); SFX.wet.connect(E.master);
    }
    return SFX.bus;
  }
  function impulse(a, secs, bright) {
    const len = Math.floor(a.sampleRate * secs), b = a.createBuffer(2, len, a.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); let lp = 0;
      for (let i = 0; i < len; i++) { const t = i / len, n = Math.random() * 2 - 1; lp += (n - lp) * (bright - t * bright * 0.8); d[i] = lp * Math.pow(1 - t, 2.2) * (i < a.sampleRate * 0.004 ? i / (a.sampleRate * 0.004) : 1); } }
    return b;
  }
  function crunchBuffer(a, kind) {
    const sr = a.sampleRate, dur = kind === 'ice' ? 0.16 : 0.24, len = Math.floor(sr * dur), b = a.createBuffer(1, len, sr), d = b.getChannelData(0);
    const thumpF = kind === 'ice' ? 140 : 95;
    for (let i = 0; i < len; i++) { const t = i / sr; d[i] = Math.sin(2 * Math.PI * thumpF * t) * Math.exp(-t * 38) * (kind === 'ice' ? 0.35 : 0.55); }
    const events = kind === 'ice' ? 10 + (Math.random() * 6 | 0) : 34 + (Math.random() * 22 | 0);
    for (let e = 0; e < events; e++) {
      const heel = Math.random() < 0.55, t0 = heel ? Math.abs(rndN()) * 0.025 : 0.075 + Math.abs(rndN()) * 0.04;
      const start = Math.floor(t0 * sr); if (start >= len) continue;
      const ms = (kind === 'ice' ? 0.5 : 1) + Math.random() * 3, l = Math.floor(sr * ms / 1000), amp = (0.25 + Math.random() * 0.75) * (heel ? 1 : 0.7);
      const ring = kind === 'ice' ? 2600 + Math.random() * 2400 : 0;
      let hp = 0, prev = 0;
      for (let i = 0; i < l && start + i < len; i++) {
        const env = Math.exp(-i / (l * 0.28)); let n = Math.random() * 2 - 1;
        hp = 0.82 * (hp + n - prev); prev = n;                                // one-pole high-pass: crisp, not hissy
        d[start + i] += (ring ? Math.sin(2 * Math.PI * ring * i / sr) * 0.6 + hp * 0.4 : hp) * env * amp * 0.5;
      }
    }
    let peak = 0; for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
    for (let i = 0; i < len; i++) d[i] /= peak || 1;
    return b;
  }
  function rndN() { return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; }
  function sfxInit() {
    const a = ac(); if (!a || SFX.ready) return;
    SFX.ready = true;
    for (const k of ['snow', 'ice']) SFX.bank[k] = Array.from({ length: 8 }, () => crunchBuffer(a, k));
    // nylon swish and breath share a short filtered noise buffer
    const len = Math.floor(a.sampleRate * 0.5), nb = a.createBuffer(1, len, a.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1;
    SFX.noise = nb;
    // wind layers on a looping noise source
    const wlen = a.sampleRate * 4, wb = a.createBuffer(1, wlen, a.sampleRate), wd = wb.getChannelData(0); let pink = 0;
    for (let i = 0; i < wlen; i++) { pink = 0.97 * pink + 0.03 * (Math.random() * 2 - 1); wd[i] = pink * 6 + (Math.random() * 2 - 1) * 0.15; }
    const layer = (type, f, q) => { const src = a.createBufferSource(), fl = a.createBiquadFilter(), g = a.createGain(), pan = a.createStereoPanner ? a.createStereoPanner() : null;
      src.buffer = wb; src.loop = true; src.loopStart = 0; src.playbackRate.value = 0.8 + Math.random() * 0.4; fl.type = type; fl.frequency.value = f; fl.Q.value = q; g.gain.value = 0;
      src.connect(fl); fl.connect(g); if (pan) { g.connect(pan); pan.connect(E.master); } else g.connect(E.master); src.start(0, Math.random() * 3); return { fl, g, pan }; };
    SFX.gust = layer('bandpass', 420, 0.9); SFX.whistle = layer('bandpass', 900, 14); SFX.hiss = layer('highpass', 3800, 0.5);
    SFX.cave = layer('bandpass', 260, 2.2);
  }
  function oneShot(buf, gain, rate = 1, f = null) {
    const a = ac(); if (!a || !buf) return;
    const s = a.createBufferSource(), g = a.createGain(); s.buffer = buf; s.playbackRate.value = rate; g.gain.value = gain;
    if (f) { const fl = a.createBiquadFilter(); fl.type = f.type; fl.frequency.value = f.freq; fl.Q.value = f.q || 0.7; s.connect(fl); fl.connect(g); } else s.connect(g);
    g.connect(bus()); s.start(); return { s, g };
  }
  function swish(vol) {
    const a = ac(); if (!a || !SFX.noise) return;
    const t = a.currentTime, s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = SFX.noise; f.type = 'bandpass'; f.frequency.setValueAtTime(3200 + Math.random() * 1500, t); f.frequency.linearRampToValueAtTime(4800 + Math.random() * 1500, t + 0.14); f.Q.value = 1.3;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    s.connect(f); f.connect(g); g.connect(bus()); s.start(t, Math.random() * 0.3); s.stop(t + 0.2);
  }
  function breathe(run, cold) {
    const a = ac(); if (!a || !SFX.noise) return;
    const t = a.currentTime, vol = (run ? 0.05 : 0.018) * (0.7 + cold * 0.6);
    for (const [st, dur, f0, f1, v] of [[0, run ? 0.32 : 0.5, 900, 1300, vol * 0.7], [run ? 0.4 : 0.9, run ? 0.42 : 0.7, 1400, 700, vol]]) {
      const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
      s.buffer = SFX.noise; s.loop = true; f.type = 'bandpass'; f.Q.value = 0.9; f.frequency.setValueAtTime(f0, t + st); f.frequency.linearRampToValueAtTime(f1, t + st + dur);
      g.gain.setValueAtTime(0.0001, t + st); g.gain.linearRampToValueAtTime(v, t + st + dur * 0.35); g.gain.linearRampToValueAtTime(0.0001, t + st + dur);
      s.connect(f); f.connect(g); g.connect(bus()); s.start(t + st); s.stop(t + st + dur + 0.05);
    }
  }
  function footstep(vol, surface) {
    if (vol <= 0.01 || !ac()) return;
    sfxInit();
    if (surface === 'metal') { noiseBurst(0.09, 2200, 1500, vol * 0.5, 2.5); tone(310 + Math.random() * 40, 0.12, 'triangle', vol * 0.05, 0.9); }
    else {
      const kind = surface === 'ice' || A.zone === 'cave' ? 'ice' : 'snow', bank = SFX.bank[kind];
      oneShot(bank[(Math.random() * bank.length) | 0], vol * (kind === 'ice' ? 0.22 : 0.3), 0.92 + Math.random() * 0.16);
    }
    swish(0.012 + vol * 0.012);
  }
  function sfxUpdate(dt) {
    const a = ac(); if (!a) return;
    sfxInit(); bus();
    const p = E.player, now = a.currentTime;
    const outdoor = !curLayer() && A.zone !== 'cave' && A.zone !== 'indoor', storm = FX.storm || 0;
    // reverb of the space you are in
    const zone = A.zone === 'cave' ? 'cave' : (A.zone === 'hall' || A.zone === 'city' || A.zone === 'grid' || A.zone === 'camp') ? 'hall' : A.zone === 'indoor' ? 'room' : 'out';
    if (zone !== SFX.irZone) {
      SFX.irZone = zone;
      if (zone !== 'out') SFX.conv.buffer = impulse(a, zone === 'cave' ? 2.6 : zone === 'hall' ? 3.4 : 0.45, zone === 'room' ? 0.5 : 0.25);
      SFX.wet.gain.setTargetAtTime(zone === 'cave' ? 0.55 : zone === 'hall' ? 0.45 : zone === 'room' ? 0.18 : 0, now, 0.3);
    }
    // gusts: a slowly wandering target strength, a little faster in a storm
    SFX.gustT -= dt;
    if (SFX.gustT <= 0) { SFX.gustT = 1.2 + Math.random() * 3.5 * (1 - storm * 0.5); SFX.gustV = Math.random() ** 1.6; }
    const sheltered = outdoor ? 1 : zone === 'room' ? 0.12 : 0.05, g = (0.012 + storm * 0.07) * (0.35 + SFX.gustV) * sheltered;
    SFX.gust.g.gain.setTargetAtTime(g, now, 0.6); SFX.gust.fl.frequency.setTargetAtTime(260 + SFX.gustV * 520 + storm * 200, now, 0.8);
    SFX.whistle.g.gain.setTargetAtTime((storm > 0.25 ? (storm - 0.25) * 0.05 : 0) * SFX.gustV * sheltered, now, 0.7);
    SFX.whistle.fl.frequency.setTargetAtTime(700 + SFX.gustV * 600, now, 1.2);
    SFX.hiss.g.gain.setTargetAtTime(outdoor ? (0.004 + storm * 0.03) * (0.5 + SFX.gustV) : 0, now, 0.5);
    if (SFX.gust.pan) SFX.gust.pan.pan.setTargetAtTime(Math.sin(time * 0.13) * 0.6, now, 1);
    if (SFX.whistle.pan) SFX.whistle.pan.pan.setTargetAtTime(Math.sin(time * 0.21 + 1) * 0.7, now, 1);
    // ice caves: a hollow draught and water dripping somewhere in the dark
    SFX.cave.g.gain.setTargetAtTime(zone === 'cave' ? 0.02 + 0.015 * Math.sin(time * 0.3) : zone === 'hall' ? 0.008 : 0, now, 0.8);
    SFX.nextDrip -= dt;
    if (SFX.nextDrip <= 0 && (zone === 'cave' || zone === 'hall')) {
      SFX.nextDrip = 1.5 + Math.random() * 5;
      const o = a.createOscillator(), gg = a.createGain(), pan = a.createStereoPanner ? a.createStereoPanner() : null, t = now, f = 900 + Math.random() * 900;
      o.type = 'sine'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 2.3, t + 0.05);
      gg.gain.setValueAtTime(0.0001, t); gg.gain.exponentialRampToValueAtTime(0.03 + Math.random() * 0.03, t + 0.004); gg.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      o.connect(gg); if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; gg.connect(pan); pan.connect(bus()); } else gg.connect(bus()); o.start(t); o.stop(t + 0.1);
    }
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
        if (S.power && S.kaanSeen && !S.heatCell) {
          S.heatCell = 1; tone(440, 0.5, 'square', 0.08, 1.4); E.save?.();
          return 'YEDEK ISI HÜCRESİ ALINDI · Buz mağarasından HELIKON salonuna, Kaan’a götür';
        }
        if (S.power) return 'JENERATÖR ÇALIŞIYOR · İSTASYONDA ELEKTRİK VAR';
        setPower(true); E.save?.();
        return 'JENERATÖR ÇALIŞTI · Işıklar, ekranlar ve telsiz enerjilendi';
      case 'radio':
        if (!S.power) { tone(140, 0.3, 'square', 0.06, 0.8); return 'TELSİZ ENERJİSİZ · Önce dışarıdaki JENERATÖRÜ çalıştır'; }
        if (pro?.active && pro.summary().stage === 1) return null;   // prologue step handles it
        if (S.ch4 && !S.plane5) return lastPlane();
        if (S.ch7) { tone(660, 0.25); return 'TELSİZ · Sessiz · Son: ' + ENDINGS7[S.ending7][0]; }
        if (S.ch6) { tone(660, 0.25); return 'TELSİZ · SELİN: “Ağustos. İlk güneş ufukta; Helikonlar kıyı buz sahanlığını yarmaya hazırlanıyor, koalisyon da tahliye ediyor. Kristal kule seni çağırıyor: kayıt 03:17’de başlayacak.”'; }
        if (S.ch5 && !S.ch6) { tone(660, 0.25); return 'TELSİZ · SELİN: “Haziran. Koalisyon sondaj ekibi göl havzasının üstüne indi. Isı kuyusu galerisindeki çekirdek kuzeyde bir tünel gösteriyor — sıvı pompasını, uydu rölesini ve donan askeri hallet.”'; }
        if (S.plane5 && !S.ch5) { tone(660, 0.25); return S.cable5 ? 'TELSİZ · SELİN: “Kablo aşağıda. Şalteri kapatmadan önce üç değerin de istasyonla aynı olduğundan emin ol.”' : 'TELSİZ · SELİN: “Kalan yakıt 83 gün. Isı kuyusunun altındaki galeriye in; istasyon kablosunu sondaj kuyusundan sarktım.”'; }
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
        if (S.ch2) return enterHall();
        if (S.caveSolved) return 'HELIKON İŞARETİ · Duvarın ardında boşluk var · “Cevap kapının ardında” — önce kara kutu kaydını birleştir';
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
      case 'hall_exit': return exitHall();
      case 'city_exit': return exitCity();
      case 'sym1': case 'sym2': case 'sym3': return readStone(+a.id.slice(-1) - 1);
      case 'bridgestone': return bridgeStone();
      case 'spire': return talkSpire();
      case 'kaan': return talkKaan();
      case 'vent': return S.plane5 ? enterGrid() : 'ISI KUYUSU · Sıcak hava yükseliyor · Burada ısınıyorsun';
      case 'grid_exit': return exitGrid();
      case 'j1': case 'j2': case 'j3': return turnDial(+a.id.slice(1) - 1);
      case 'cable': return connectCable();
      case 'sync': return syncPanel();
      case 'core': return talkCore();
      case 'camp_exit': return exitCamp();
      case 'pump': return pumpAct();
      case 'relay': return relayAct();
      case 'soldier': return soldierAct();
      case 'stele1': case 'stele2': case 'stele3': case 'stele4': case 'stele5': {
        const i = +a.id.slice(-1) - 1;
        readStele(i);
        if (!S.kaanFree) return steleText(i) + ' · Taş sessiz: nasıl uyandığını bilen biri lazım';
        if (S.ch3) return steleText(i) + (S.stars.includes(i) ? ' · YANIYOR' : ' · KARANLIK — henüz değil');
        return lightStele(i);
      }
      case 'dais':
        if (S.ch3) return 'YILDIZ HARİTASI · Dört yıldız yanıyor · Kapı uyandı';
        return 'YILDIZ HARİTASI · ' + S.stars.length + '/4 yıldız' + (S.kaanFree ? ' · Stelleri o gecenin saat sırasıyla yak' : ' · Buzdaki adam bir şey biliyor olmalı');
      case 'gate4':
        if (!S.ch3) return 'ÜÇ HALKALI KAPI · Mühürlü · Yıldız haritası karanlık';
        return enterCity();
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
    if (A.state.inCity) {
      let best = null;
      for (let i = 0; i < 3; i++) { const a = anchor('sym' + (i + 1)); if (!a) continue; const d = Math.hypot(a.x - px, a.z - pz); if (d < 4.5 && (!best || d < best.d)) best = { i, d }; }
      const cm = best ? readStone(best.i) : 'HELIKON HAVZASI · Su −3°C, basınç altında sıvı · Kristal kule rezonansta';
      tone(880, 0.12, 'square', 0.06, 1.0); E.toast(cm); lastMsgAt = time; return cm;
    }
    if (A.state.inHall) {
      let best = null;
      for (let i = 0; i < 5; i++) { const a = anchor('stele' + (i + 1)); if (!a) continue; const d = Math.hypot(a.x - px, a.z - pz); if (d < 4.5 && (!best || d < best.d)) best = { i, d }; }
      const hm = best ? (readStele(best.i), steleText(best.i)) : 'HELIKON SALONU · 5 stel · Yakına git ve Q ile oku · −41°C';
      tone(880, 0.12, 'square', 0.06, 1.0); E.toast(hm); lastMsgAt = time; return hm;
    }
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
    A.frameNo = (A.frameNo | 0) + 1;
    try { fxUpdate(dt); } catch (err) { if (!A.fxError) A.fxError = String(err && err.message || err); }
    try { sfxUpdate(dt); } catch (err) { if (!A.sfxError) A.sfxError = String(err && err.message || err); }
    time += dt;
    const p = E.player;
    A.zone = zoneAt(p.x, p.z);
    if (A.state.inGrid && p.warmth !== undefined && time >= blackoutUntil) p.warmth = Math.min(100, p.warmth + 4 * dt);
    syncUpdate(p);
    campUpdate(p, dt);
    clockUpdate(p);
    if (A.state.inHall) { const v = anchor('vent'); if (v && Math.hypot(p.x - v.x, p.z - v.z) < 3.2 && p.warmth !== undefined) p.warmth = Math.min(100, p.warmth + 10 * dt); }
    handsUpdate(dt);
    if (!hudQueued) { hudQueued = true; queueMicrotask(ch3Hud); }
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
    else if (S.ch2 && !S.tutorial.hall) line = 'Kaydı birleştirdin: “Cevap kapının ardında.” Mağaradaki işaret duvarına git, E ile dokun.';
    else if (S.kaanSeen && !S.kaanFree) line = S.heatCell === 1 ? 'Isı hücresi sende. Mağaradaki kapıdan salona in, buzdaki adama götür.' : 'Buzdaki adamı eritmek için jeneratörün yedek ısı hücresi lazım. Sarı konteynere git, E ile al.';
    else if (S.kaanFree && !S.ch3) line = 'Kaan saatlerden söz ediyor. Stelleri Q ile oku; en erken saatten 03:17’ye yak. Sonrasına dokunma.';
    else if (S.ch3 && !S.ch4) line = S.tutorial.city ? 'Göldeki taşlar bir dil öğretiyor. Sözlüğü tamamla, sonra kulenin ne istediğini dinle.' : 'Yıldız haritası açıldı. Salonun sonundaki üç halkalı kapıdan geç.';
    else if (S.ch7) line = { antlasma: 'Toplantı konsensüsle bitti. Havza korunuyor; artık yalnız değiliz.', muhur: 'Şehir gömüldü. Raporda “sondaj kazası” yazıyor; tek tanık sensin.', dongu: 'Saat 03:17. İstasyonun ışıkları… bu geceyi daha önce yaşadım.' }[S.ending7] || line;
    else if (S.ch6) line = 'Ağustos. İlk güneş ufukta. Kristal kuleye git; kayıt saat 03:17’de başlayacak, E’ye tam o anda bas.';
    else if (S.ch5 && S.inCamp) line = 'Pompa, röle, asker. Dronlar sıcak olanı uzaktan görür: soğuk kal, kar duvarlarının arkasından git. Pompada önce motoru durdur, basınç sıfırlanınca vanayı kapat.';
    else if (S.ch5 && S.load5) line = 'Haziran. Koalisyon sondajı göl havzasının üstüne indi. Isı kuyusu galerisindeki çekirdek kuzeyde bir tünel gösteriyor.';
    else if (S.ch5) line = { tam: 'İstasyon tam yükte. Ama göldeki ısı kuyuları soğuyor; Helikonlar bunu fark edecek.', denge: 'Yükü paylaştık. İkimiz de kışı ancak geçiririz.', sinir: 'İstasyon idareli çalışacak. Kaan haklı olabilir; ama konsorsiyum bunu sevmeyecek.' }[S.load5] || line;
    else if (S.ch4 && S.plane5) line = !S.inGrid ? 'Isı kuyusu salonda, batı duvarında. Aşağı inen bir merdiven var.' : !S.cable5 ? 'Kabloyu sondaj kuyusundan sarktım. Galerinin sonunda, sağda.' : 'Senkronoskop panelinde istasyon değerleri yazıyor. Üç düğümü onlara eşle, sonra ibre tepedeyken şalteri kapat.';
    else if (S.ch4 && !S.plane5) line = 'Son uçak pistte. Telsize gel; kalıp kalmayacağını pilota söylemen lazım.';
    else if (S.ch4) line = { sus: 'Sinyali kapattın. Ama uydu kaydı yakaladı. Mart geliyor; son uçak kalkmadan karar ver.', cevap: 'Dünya duydu. Antlaşma toplantısı olağanüstü gündemle toplanıyor. Son uçak Mart’ta.', gec: 'Kapıdan geçtin… telsiz hâlâ senin sesinle konuşuyor. Neredesin?' }[S.ending4] || line;
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
    if (!T.deja && !A.state.ch2 && endingsSeen().includes('dongu')) { T.deja = 1; journal('DÉJÀ VU', 'Bu istasyon, bu rüzgâr… Daha önce buradaydım. 03:17’de biri bana “Sinyali kapatmayın” demişti. O ses benimdi.'); }
    if (time - lastMsgAt < 4) return;   // never talk over a message the player just triggered
    const st = anchor('generator');
    if (A.state.inHall && !T.kaanHint) { const k = anchor('kaan'); if (k && Math.hypot(p.x - k.x, p.z - k.z) < 6) { T.kaanHint = 1; E.toast('BUZUN İÇİNDE BİRİ VAR · Yaklaş ve E ile bak'); } }
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
    if (L.group === 'starmap') k *= 0.4 + 0.6 * (A.state.stars.length / 4);
    if (L.group === 'gate4') k = A.state.ch3 ? 1.4 + 0.3 * Math.sin(time * 1.3) : 0;
    if (L.group === 'bridge') k = A.state.bridge ? k : 0;
    if (L.group === 'citylights') k *= A.state.bridge ? 1 : 0.2;
    if (L.group === 'spire') k *= 0.6 + 0.2 * A.state.voice;
    if (L.group === 'pump') k *= A.state.pump6 ? 0.25 : 1;
    if (L.group === 'relay') k *= A.state.relay6 ? 0 : 1;
    if (L.group === 'bore') k *= A.state.pump6 >= 2 ? 0.5 : 1;
    if (L.group === 'conduit') k = time < blackoutUntil ? 0 : k * (A.state.grid5 ? 1.5 : 0.65);
    if (L.group === 'core') k = time < blackoutUntil ? k * 0.1 : k * (A.state.grid5 ? 1.4 : 0.7);
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
    if (g.startsWith('stele')) { const i = +g.slice(-1) - 1; return S.stars.includes(i) ? 1.6 : S.steles[i] ? 0.75 : 0.35; }
    if (g === 'starmap') return 0.35 + 0.3 * S.stars.length;
    if (/^star\d$/.test(g)) { const i = +g.slice(-1) - 1; e.visible = i < S.stars.length; return 1.6; }
    if (g === 'gate4') return S.ch3 ? 1.5 + 0.3 * Math.sin(time * 1.3) : 0.12;
    if (g === 'kaan_ice') { e.visible = !S.kaanFree; return 1; }
    if (/^sym\d$/.test(g)) return S.stones[+g.slice(-1) - 1] ? 1.5 : 0.45 + 0.25 * Math.sin(time * 2.0);
    if (g === 'bridgestone') return S.bridge ? 1.4 : (S.stones[0] && S.stones[1]) ? 1.0 + 0.4 * Math.sin(time * 4.0) : 0.35;
    if (g === 'bridge') { e.visible = !!S.bridge; return 0.55 + 0.1 * Math.sin(time * 1.7); }
    if (g === 'citylights') return S.ch4 ? 0.85 : S.bridge ? 0.5 : 0.1;
    if (g === 'spire') { const v = Math.min(1.5, 0.7 + 0.35 * S.voice + (S.ch4 && S.ending4 !== 'sus' ? 0.4 : 0)); return S.ch7 && S.ending7 === 'muhur' ? 0.3 : v; }
    if (g === 'pump') return S.pump6 ? 0.15 : 1.1;
    if (g === 'relay') return S.relay6 ? 0.08 : 1.2;
    if (g === 'bore') return S.pump6 >= 2 ? 0.4 : 1.2;
    if (/^drone\d$/.test(g)) return S.relay6 ? 0.7 : 1.1;
    if (g === 'conduit') return time < blackoutUntil ? 0.04 : S.grid5 ? 1.6 : 0.55;
    if (g === 'core') return time < blackoutUntil ? 0.08 : S.grid5 ? 1.7 + 0.2 * Math.sin(time * 2.2) : 0.6 + 0.12 * Math.sin(time * 1.1);
    if (/^j\d$/.test(g)) { const i = +g.slice(1) - 1; return time < blackoutUntil ? 0.1 : dialPulse[i] > time ? 1.6 : 1.0; }
    if (g === 'sync') return time < blackoutUntil ? 0.15 : 1.1;
    if (g === 'cablelamp') { e.visible = !S.cable5; return 1.4; }
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

  /* ------------------------------------------------------------ sun shadows
   * One ortho shadow map that follows the player (outdoors only). Depth is packed into RGBA8 so it works on
   * every WebGL1 device (no depth-texture extension needed). Models sample it in the main shader; the snow
   * receives model shadows through a thin "shadow catcher" built on the engine's own terrain grid, multiplied
   * over the terrain with the blue-sky shade ratio, so a shadow on snow is blue like a real one. */
  const SH = { size: 0, fb: null, tex: null, rb: null, m: new Float32Array(16), lvp: new Float32Array(16), frame: -1, on: 0, c: null, catcher: null };
  const SVS = `attribute vec3 aPos;
#ifdef SKIN
attribute vec4 aJoint;attribute vec4 aWeight;uniform mat4 uBones[${MAXB}];
#endif
uniform mat4 uModel,uLVP;void main(){vec4 p=vec4(aPos,1.);
#ifdef SKIN
p=(uBones[int(aJoint.x)]*aWeight.x+uBones[int(aJoint.y)]*aWeight.y+uBones[int(aJoint.z)]*aWeight.z+uBones[int(aJoint.w)]*aWeight.w)*p;
#endif
gl_Position=uLVP*uModel*p;}`;
  const SFS = `precision highp float;void main(){vec4 e=fract(gl_FragCoord.z*vec4(1.,255.,65025.,16581375.));e-=e.yzww*vec4(1./255.,1./255.,1./255.,0.);gl_FragColor=e;}`;
  const CVS = `attribute vec3 aPos;attribute vec3 aNorm;uniform mat4 uView,uProj,uShadowM;varying vec4 vSh;varying vec3 vN;varying float vDist,vR;uniform vec2 uC;uniform float uR;
void main(){vSh=uShadowM*vec4(aPos,1.);vN=aNorm;vR=length(aPos.xz-uC)/uR;vec4 e=uView*vec4(aPos,1.);vDist=length(e.xyz);gl_Position=uProj*e;}`;
  const CFS = `precision highp float;varying vec4 vSh;varying vec3 vN;varying float vDist,vR;uniform sampler2D uShadow;uniform float uShadowOn,uShadowTx,uFogD;
float unpackD(vec4 c){return dot(c,vec4(1.,1./255.,1./65025.,1./16581375.));}
float sTap(vec2 uv,float z){vec2 px=uv/uShadowTx-.5;vec2 f=fract(px);vec2 b=(floor(px)+.5)*uShadowTx;float a=step(z,unpackD(texture2D(uShadow,b))),c=step(z,unpackD(texture2D(uShadow,b+vec2(uShadowTx,0.)))),d=step(z,unpackD(texture2D(uShadow,b+vec2(0.,uShadowTx)))),e=step(z,unpackD(texture2D(uShadow,b+vec2(uShadowTx))));return mix(mix(a,c,f.x),mix(d,e,f.x),f.y);}
float sPCF(vec2 uv,float z){float o=uShadowTx*.75;return (sTap(uv+vec2(-o,-o),z)+sTap(uv+vec2(o,-o),z)+sTap(uv+vec2(-o,o),z)+sTap(uv+vec2(o,o),z))*.25;}
void main(){vec3 s=vSh.xyz/vSh.w;if(s.x<0.||s.x>1.||s.y<0.||s.y>1.)discard;float t=sPCF(s.xy,s.z-.0012)*9.;
vec3 n=normalize(vN);vec3 L=normalize(vec3(${SUN.join(',')}));float direct=max(dot(n,L),0.),sky=clamp(n.y*.28+.72,.37,1.);
vec3 skyC=vec3(.78,.86,1.)*(.36+.24*sky);vec3 lit=skyC+vec3(1.,.93,.80)*.62*direct;
float fog=clamp(1.-exp(-pow(vDist*uFogD,1.32)),0.,.98);float amt=(1.-t/9.)*uShadowOn*(1.-fog)*(1.-smoothstep(.82,1.,vR));
if(amt<.003)discard;gl_FragColor=vec4(mix(vec3(1.),skyC/lit,amt),1.);}`;
  // the engine's terrain grid (index.html: RES 246 over x -325..325, z -390..135); the catcher reuses its exact vertices
  const TG = { res: 246, x0: -325, x1: 325, z0: -390, z1: 135 };
  let shadowProg = {}, catcherProg = null;
  function shProgram(skin) {
    const k = skin ? 'skin' : 'rigid';
    if (shadowProg[k]) return shadowProg[k];
    const pre = skin ? '#define SKIN\n' : '';
    const mk = (t, src) => { const o = gl.createShader(t); gl.shaderSource(o, src); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(o)); return o; };
    const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, pre + SVS)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, SFS)); gl.linkProgram(p);
    return (shadowProg[k] = { p, uModel: gl.getUniformLocation(p, 'uModel'), uLVP: gl.getUniformLocation(p, 'uLVP'), uBones: gl.getUniformLocation(p, 'uBones[0]') || gl.getUniformLocation(p, 'uBones'),
      aPos: gl.getAttribLocation(p, 'aPos'), aJoint: gl.getAttribLocation(p, 'aJoint'), aWeight: gl.getAttribLocation(p, 'aWeight') });
  }
  function shadowTarget(size) {
    if (SH.size === size) return;
    if (SH.fb) { gl.deleteFramebuffer(SH.fb); gl.deleteTexture(SH.tex); gl.deleteRenderbuffer(SH.rb); }
    SH.size = size; SH.tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, SH.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    SH.rb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, SH.rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, size, size);
    SH.fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, SH.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, SH.tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, SH.rb);
  }
  // light view/projection centred on c, snapped to whole texels so the shadow edges do not crawl as you walk
  function sunMatrices(c, R, size) {
    const L = SUN.map((v) => v / Math.hypot(...SUN)), f = [-L[0], -L[1], -L[2]];
    let sx = f[1] * 0 - f[2] * 1, sy = f[2] * 0 - f[0] * 0, sz = f[0] * 1 - f[1] * 0; const sl = Math.hypot(sx, sy, sz); sx /= sl; sy /= sl; sz /= sl;
    const ux = sy * f[2] - sz * f[1], uy = sz * f[0] - sx * f[2], uz = sx * f[1] - sy * f[0];
    const ts = (2 * R) / size, cr = c[0] * sx + c[1] * sy + c[2] * sz, cu = c[0] * ux + c[1] * uy + c[2] * uz;
    const dr = cr - Math.round(cr / ts) * ts, du = cu - Math.round(cu / ts) * ts;
    const cc = [c[0] - sx * dr - ux * du, c[1] - sy * dr - uy * du, c[2] - sz * dr - uz * du], D = 160;
    const e = [cc[0] + L[0] * D, cc[1] + L[1] * D, cc[2] + L[2] * D];
    const view = new Float32Array([sx, ux, -f[0], 0, sy, uy, -f[1], 0, sz, uz, -f[2], 0,
      -(sx * e[0] + sy * e[1] + sz * e[2]), -(ux * e[0] + uy * e[1] + uz * e[2]), f[0] * e[0] + f[1] * e[1] + f[2] * e[2], 1]);
    const n = 1, fa = D + 140, ortho = new Float32Array([1 / R, 0, 0, 0, 0, 1 / R, 0, 0, 0, 0, -2 / (fa - n), 0, 0, 0, -(fa + n) / (fa - n), 1]);
    const lvp = M4.mul(ortho, view), bias = new Float32Array([0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, 0.5, 0.5, 0.5, 1]);
    SH.lvp = lvp; SH.m = M4.mul(bias, lvp);
  }
  function renderShadows(eye, q, items, storm) {
    const outdoor = !curLayer() && A.zone !== 'cave' && A.zone !== 'indoor';
    SH.on = outdoor && q.shadow ? Math.max(0, 1 - storm * 0.85) : 0;
    if (!SH.on) return;
    if (SH.frame === A.frameNo) return;            // XR renders two eyes per frame: one shadow pass is enough
    SH.frame = A.frameNo;
    const R = q.shadowR, fwdX = Math.sin(E.player.yaw), fwdZ = -Math.cos(E.player.yaw);
    const c = [eye[0] + fwdX * R * 0.45, E.terrainY(eye[0], eye[2]), eye[2] + fwdZ * R * 0.45];   // most of the map in front of you
    const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING), vp = gl.getParameter(gl.VIEWPORT);   // read before shadowTarget binds its own
    SH.c = c; shadowTarget(q.shadow); sunMatrices(c, R, q.shadow);
    gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, null);   // never sample the map while drawing into it
    gl.bindFramebuffer(gl.FRAMEBUFFER, SH.fb); gl.viewport(0, 0, SH.size, SH.size);
    gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.BLEND);
    const casters = [];
    for (const e of world.draw) {
      if (!live(e) || !e.visible || !e.m || e.ex.a3d_decal || e.ex.a3d_group === 'glyph' || e.ex.a3d_noshadow) continue;
      for (const pr of e.prims) {
        if (pr.mat.blend) continue;
        const cc = M4.xform(e.m, pr.center[0], pr.center[1], pr.center[2]);
        if (Math.hypot(cc[0] - c[0], cc[2] - c[2]) - pr.radius > R * 1.42) continue;
        casters.push({ pr, m: e.m });
      }
    }
    for (const it of items) if (it.skin) casters.push(it);
    const off = new Set();
    for (const it of casters) {
      const P = shProgram(!!it.skin); gl.useProgram(P.p);
      gl.uniformMatrix4fv(P.uLVP, false, SH.lvp); gl.uniformMatrix4fv(P.uModel, false, it.m);
      if (it.skin) gl.uniformMatrix4fv(P.uBones, false, it.skin.mats);
      const b = it.pr.bufs;
      gl.bindBuffer(gl.ARRAY_BUFFER, b.aPos.b); gl.enableVertexAttribArray(P.aPos); gl.vertexAttribPointer(P.aPos, 3, gl.FLOAT, false, 0, 0); off.add(P.aPos);
      if (it.skin) for (const [nm, loc] of [['aJoint', P.aJoint], ['aWeight', P.aWeight]]) { gl.bindBuffer(gl.ARRAY_BUFFER, b[nm].b); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 0, 0); off.add(loc); }
      if (it.pr.index) { gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, it.pr.index); gl.drawElements(gl.TRIANGLES, it.pr.count, it.pr.itype, 0); }
      else gl.drawArrays(gl.TRIANGLES, 0, it.pr.count);
      A.stats.shadowDraws = (A.stats.shadowDraws || 0) + 1;
    }
    for (const loc of off) gl.disableVertexAttribArray(loc);
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb); gl.viewport(vp[0], vp[1], vp[2], vp[3]);
  }
  function catcherMesh(c, R) {
    const key = Math.round(c[0] / 6) + ',' + Math.round(c[2] / 6) + ',' + R;
    if (SH.catcher && SH.catcher.key === key) return SH.catcher;
    const dx = (TG.x1 - TG.x0) / TG.res, dz = (TG.z1 - TG.z0) / TG.res;
    const i0 = Math.max(0, Math.floor((c[0] - R - TG.x0) / dx)), i1 = Math.min(TG.res, Math.ceil((c[0] + R - TG.x0) / dx));
    const j0 = Math.max(0, Math.floor((c[2] - R - TG.z0) / dz)), j1 = Math.min(TG.res, Math.ceil((c[2] + R - TG.z0) / dz));
    const W = i1 - i0 + 1, pos = [], nrm = [], idx = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = TG.x0 + i * dx, z = TG.z0 + j * dz, y = E.terrainY(x, z);
      const nx = E.terrainY(x - 0.6, z) - E.terrainY(x + 0.6, z), nz = E.terrainY(x, z - 0.6) - E.terrainY(x, z + 0.6), l = Math.hypot(nx, 1.2, nz);
      pos.push(x, y + 0.03, z); nrm.push(nx / l, 1.2 / l, nz / l);
    }
    for (let j = 0; j < j1 - j0; j++) for (let i = 0; i < i1 - i0; i++) { const a = j * W + i, b = a + W; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    if (SH.catcher) { gl.deleteBuffer(SH.catcher.p); gl.deleteBuffer(SH.catcher.n); gl.deleteBuffer(SH.catcher.i); }
    const mk = (target, data) => { const b = gl.createBuffer(); gl.bindBuffer(target, b); gl.bufferData(target, data, gl.STATIC_DRAW); return b; };
    SH.catcher = { key, p: mk(gl.ARRAY_BUFFER, new Float32Array(pos)), n: mk(gl.ARRAY_BUFFER, new Float32Array(nrm)), i: mk(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx)), count: idx.length };
    return SH.catcher;
  }
  function drawCatcher(view, proj, fogD) {
    if (!SH.on || !SH.c) return;
    const q = QUALITY[window.ICEWALK_VISUALS?.quality] || QUALITY.balanced, R = q.shadowR, C = catcherMesh(SH.c, R);
    if (!catcherProg) {
      const mk = (t, src) => { const o = gl.createShader(t); gl.shaderSource(o, src); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(o)); return o; };
      const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, CVS)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, CFS)); gl.linkProgram(p);
      catcherProg = { p, aPos: gl.getAttribLocation(p, 'aPos'), aNorm: gl.getAttribLocation(p, 'aNorm') };
      for (const nm of ['uView', 'uProj', 'uShadowM', 'uShadow', 'uShadowOn', 'uShadowTx', 'uFogD', 'uC', 'uR']) catcherProg[nm] = gl.getUniformLocation(p, nm);
    }
    const P = catcherProg; gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.uView, false, view); gl.uniformMatrix4fv(P.uProj, false, proj); gl.uniformMatrix4fv(P.uShadowM, false, SH.m);
    gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, SH.tex); gl.uniform1i(P.uShadow, 6);
    gl.uniform1f(P.uShadowOn, SH.on); gl.uniform1f(P.uShadowTx, 1 / SH.size); gl.uniform1f(P.uFogD, fogD); gl.uniform2f(P.uC, SH.c[0], SH.c[2]); gl.uniform1f(P.uR, R);
    gl.bindBuffer(gl.ARRAY_BUFFER, C.p); gl.enableVertexAttribArray(P.aPos); gl.vertexAttribPointer(P.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, C.n); gl.enableVertexAttribArray(P.aNorm); gl.vertexAttribPointer(P.aNorm, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, C.i);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.DST_COLOR, gl.ZERO);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-1, -3);
    gl.drawElements(gl.TRIANGLES, C.count, gl.UNSIGNED_SHORT, 0);
    gl.disable(gl.POLYGON_OFFSET_FILL); gl.disable(gl.BLEND); gl.depthMask(true);
    gl.disableVertexAttribArray(P.aPos); gl.disableVertexAttribArray(P.aNorm);
  }

  /* ------------------------------------------------------------ atmosphere effects
   * Breath vapour (cold air, faster when running), spindrift (wind-blown snow skimming the ground outdoors),
   * ice dust that only shows inside the torch beam in dark places, and frost creeping in at the screen edges
   * when body heat drops. All camera-facing soft particles in one dynamic buffer. */
  const WIND = [0.85, 0, 0.53];
  const FX = { breath: [], drift: [], motes: [], next: 0, buf: null, prog: null, storm: 0, frost: null, frostA: 0 };
  const FXVS = `attribute vec3 aC;attribute vec4 aQ;attribute vec2 aK;uniform mat4 uView,uProj;uniform vec3 uRight,uUp,uWind;
varying vec2 vUV;varying float vA,vK,vDist;
void main(){vec3 r=uRight,u=uUp;float sz=aQ.z;if(aK.x>.5&&aK.x<1.5){r=uWind*aK.y;u=vec3(0.,.28,0.);}
vec3 p=aC+(r*aQ.x+u*aQ.y)*sz;vUV=aQ.xy*.5+.5;vA=aQ.w;vK=aK.x;vec4 e=uView*vec4(p,1.);vDist=length(e.xyz);gl_Position=uProj*e;}`;
  const FXFS = `precision mediump float;varying vec2 vUV;varying float vA,vK,vDist;uniform float uFogD;
void main(){vec2 q=vUV*2.-1.;float r=length(q);float a=(1.-smoothstep(.15,1.,r));
vec3 c=vK<.5?vec3(.86,.90,.93):vK<1.5?vec3(.93,.96,.98):vec3(1.,.96,.86);
if(vK>1.5)a=pow(a,3.);a*=vA*(1.-clamp(1.-exp(-pow(vDist*uFogD,1.32)),0.,.98));if(a<.004)discard;gl_FragColor=vec4(c,a);}`;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const coldHere = () => !(A.zone === 'indoor' && A.state.power) && A.zone !== 'camp_hut';
  const darkHere = () => A.zone === 'cave' || A.zone === 'hall' || A.zone === 'grid' || (A.zone === 'indoor' && !A.state.power) || A.zone === 'city';
  function fxUpdate(dt) {
    const p = E.player; if (!p || E.state !== 'play') return;
    const ex = [Math.sin(p.yaw), 0, -Math.cos(p.yaw)], eyeY = (E.eyeY ? E.eyeY() : groundY(p.x, p.z) + 1.72);
    const speed = hands.speed || 0, outdoor = !curLayer() && A.zone !== 'cave' && A.zone !== 'indoor';
    // breath: a puff every 2.2-3.6 s walking, 1.1 s running; bigger when cold
    FX.next -= dt;
    if (FX.next <= 0 && coldHere()) {
      const run = speed > 4.2, cold = 1 - clamp((p.warmth ?? 100) / 100, 0, 1);
      FX.next = run ? rnd(1.0, 1.25) : rnd(2.2, 3.6);
      if (run || cold > 0.55) try { breathe(run, cold); } catch (e) { /* audio not started */ }
      const n = run ? 7 : 5;
      for (let i = 0; i < n; i++) FX.breath.push({ x: p.x + ex[0] * 0.42, y: eyeY - 0.14, z: p.z + ex[2] * 0.42,
        vx: ex[0] * rnd(0.45, 0.9) + WIND[0] * 0.25 * FX.storm + rnd(-0.08, 0.08), vy: rnd(0.04, 0.16), vz: ex[2] * rnd(0.35, 0.8) + WIND[2] * 0.25 * FX.storm + rnd(-0.08, 0.08),
        age: -i * 0.035, life: rnd(1.1, 1.6) * (run ? 0.8 : 1), s0: rnd(0.05, 0.08), a: (run ? 0.30 : 0.24) * (0.75 + cold * 0.5) });
    }
    for (const b of FX.breath) { b.age += dt; if (b.age < 0) continue; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; b.vx *= 1 - dt * 1.4; b.vz *= 1 - dt * 1.4; }
    FX.breath = FX.breath.filter((b) => b.age < b.life);
    // spindrift: streaks racing along the wind just above the snow, denser in a storm
    const nDrift = outdoor ? Math.round(30 + FX.storm * 110) : 0;
    while (FX.drift.length < nDrift) FX.drift.push({ x: p.x + rnd(-22, 22), z: p.z + rnd(-22, 22), h: rnd(0.02, 0.7), sp: rnd(4, 9), life: rnd(0.6, 2), age: 0, len: rnd(0.6, 1.8) });
    if (FX.drift.length > nDrift) FX.drift.length = nDrift;
    for (const d of FX.drift) {
      d.age += dt; const v = d.sp * (0.6 + FX.storm);
      d.x += WIND[0] * v * dt; d.z += WIND[2] * v * dt;
      if (d.age > d.life || Math.hypot(d.x - p.x, d.z - p.z) > 24) { d.x = p.x + rnd(-22, 22); d.z = p.z + rnd(-22, 22); d.age = 0; d.life = rnd(0.6, 2); d.h = rnd(0.02, 0.7); }
    }
    // ice dust: drifts slowly around you in dark places, visible only where the torch beam catches it
    const nMotes = darkHere() ? 140 : 0;
    while (FX.motes.length < nMotes) FX.motes.push({ x: p.x + rnd(-7, 7), y: eyeY + rnd(-1.6, 1.4), z: p.z + rnd(-7, 7), vx: rnd(-0.05, 0.05), vy: rnd(-0.07, 0.01), vz: rnd(-0.05, 0.05), ph: rnd(0, 6.3) });
    if (FX.motes.length > nMotes) FX.motes.length = nMotes;
    for (const m of FX.motes) {
      m.x += (m.vx + Math.sin(time * 0.7 + m.ph) * 0.03) * dt; m.y += m.vy * dt; m.z += (m.vz + Math.cos(time * 0.6 + m.ph) * 0.03) * dt;
      if (Math.hypot(m.x - p.x, m.z - p.z) > 7.5 || m.y < eyeY - 1.8) { m.x = p.x + rnd(-7, 7); m.y = eyeY + rnd(-0.2, 1.5); m.z = p.z + rnd(-7, 7); }
    }
    // frost on the visor edges: below 55 % body heat it creeps in, and clears slowly in the warm
    const target = clamp((55 - (p.warmth ?? 100)) / 45, 0, 1) * (E.xr ? 0 : 1);
    FX.frostA += (target - FX.frostA) * Math.min(1, dt * (target > FX.frostA ? 0.25 : 0.6));
    frostOverlay(FX.frostA);
  }
  function frostOverlay(a) {
    if (!FX.frost) {
      if (a < 0.01) return;
      const c = document.createElement('canvas'); c.id = 'a3dFrost'; c.width = 512; c.height = 288;
      c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:15;opacity:0;mix-blend-mode:screen';
      const g = c.getContext('2d'), W = c.width, H = c.height;
      // dendritic frost: many short branching strokes seeded from the edges, thinning towards the centre
      for (let i = 0; i < 260; i++) {
        const side = i % 4; let x = side === 0 ? 0 : side === 1 ? W : Math.random() * W, y = side === 2 ? 0 : side === 3 ? H : Math.random() * H;
        if (side < 2) y = Math.random() * H; let ang = Math.atan2(H / 2 - y, W / 2 - x) + rnd(-0.9, 0.9), len = rnd(18, 70);
        g.strokeStyle = `rgba(225,242,250,${rnd(0.18, 0.45)})`; g.lineWidth = rnd(0.5, 1.4);
        for (let k = 0; k < 6 && len > 3; k++) {
          const nx = x + Math.cos(ang) * len, ny = y + Math.sin(ang) * len;
          g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
          for (let b = 0; b < 2; b++) { const ba = ang + (b ? 1 : -1) * rnd(0.6, 1.0), bl = len * 0.45; g.beginPath(); g.moveTo((x + nx) / 2, (y + ny) / 2); g.lineTo((x + nx) / 2 + Math.cos(ba) * bl, (y + ny) / 2 + Math.sin(ba) * bl); g.stroke(); }
          x = nx; y = ny; ang += rnd(-0.5, 0.5); len *= 0.7;
        }
      }
      const rg = g.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, W * 0.62);
      rg.addColorStop(0, 'rgba(0,0,0,1)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalCompositeOperation = 'destination-out'; g.fillStyle = rg; g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'source-over';
      const edge = g.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, W * 0.7);
      edge.addColorStop(0, 'rgba(200,230,245,0)'); edge.addColorStop(1, 'rgba(200,230,245,0.35)');
      g.fillStyle = edge; g.fillRect(0, 0, W, H);
      document.body.appendChild(c); FX.frost = c;
    }
    FX.frost.style.opacity = (a * 0.9).toFixed(3);
  }
  function drawFX(view, proj, opts, fogD) {
    const quads = [];
    const push = (x, y, z, size, alpha, kind, stretch) => { for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]]) quads.push(x, y, z, cx, cy, size, alpha, kind, stretch); };
    for (const b of FX.breath) { if (b.age < 0) continue; const t = b.age / b.life; push(b.x, b.y, b.z, b.s0 + t * 0.32, b.a * Math.sin(Math.PI * Math.min(1, t * 1.6 + 0.08)) * (1 - t), 0, 1); }
    const st = 0.20 + FX.storm * 0.35;
    for (const d of FX.drift) { const t = d.age / d.life; push(d.x, groundY(d.x, d.z) + d.h, d.z, 0.16, st * Math.sin(Math.PI * t), 1, d.len); }
    if (opts.torch && FX.motes.length) {
      const P = (opts.xr && opts.xr.torch) ? opts.xr.torch.p : opts.eye, D = (opts.xr && opts.xr.torch) ? opts.xr.torch.d : opts.fwd;
      for (const m of FX.motes) {
        const dx = m.x - P[0], dy = m.y - P[1], dz = m.z - P[2], l = Math.hypot(dx, dy, dz); if (l < 0.25) continue;
        const cone = (dx * D[0] + dy * D[1] + dz * D[2]) / l, inBeam = clamp((cone - 0.90) / 0.07, 0, 1) * (1 - clamp(l / 7.5, 0, 1));
        if (inBeam > 0.02) push(m.x, m.y, m.z, 0.018, inBeam * (0.55 + 0.45 * Math.sin(time * 9 + m.ph * 3)), 2, 1);
      }
    }
    if (!quads.length) return;
    if (!FX.prog) {
      const mk = (t, src) => { const o = gl.createShader(t); gl.shaderSource(o, src); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(o)); return o; };
      const pr = gl.createProgram(); gl.attachShader(pr, mk(gl.VERTEX_SHADER, FXVS)); gl.attachShader(pr, mk(gl.FRAGMENT_SHADER, FXFS)); gl.linkProgram(pr);
      FX.prog = { p: pr, aC: gl.getAttribLocation(pr, 'aC'), aQ: gl.getAttribLocation(pr, 'aQ'), aK: gl.getAttribLocation(pr, 'aK') };
      for (const nm of ['uView', 'uProj', 'uRight', 'uUp', 'uWind', 'uFogD']) FX.prog[nm] = gl.getUniformLocation(pr, nm);
      FX.buf = gl.createBuffer();
    }
    const P = FX.prog; gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.uView, false, view); gl.uniformMatrix4fv(P.uProj, false, proj);
    gl.uniform3f(P.uRight, view[0], view[4], view[8]); gl.uniform3f(P.uUp, view[1], view[5], view[9]); gl.uniform3fv(P.uWind, WIND); gl.uniform1f(P.uFogD, fogD);
    gl.bindBuffer(gl.ARRAY_BUFFER, FX.buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(quads), gl.DYNAMIC_DRAW);
    const st9 = 36;
    gl.enableVertexAttribArray(P.aC); gl.vertexAttribPointer(P.aC, 3, gl.FLOAT, false, st9, 0);
    gl.enableVertexAttribArray(P.aQ); gl.vertexAttribPointer(P.aQ, 4, gl.FLOAT, false, st9, 12);
    gl.enableVertexAttribArray(P.aK); gl.vertexAttribPointer(P.aK, 2, gl.FLOAT, false, st9, 28);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.enable(gl.DEPTH_TEST);
    gl.drawArrays(gl.TRIANGLES, 0, quads.length / 9);
    gl.depthMask(true); gl.disable(gl.BLEND);
    gl.disableVertexAttribArray(P.aC); gl.disableVertexAttribArray(P.aQ); gl.disableVertexAttribArray(P.aK);
    A.stats.fx = quads.length / 54;
  }

  function draw(view, proj, eye, fwd, opts) {
    if (!A.ready) return;
    const q = QUALITY[window.ICEWALK_VISUALS?.quality] || QUALITY.balanced;
    A.stats.draws = 0; A.stats.tris = 0; A.stats.culled = 0;
    const vp = M4.mul(proj, view), P = planes(vp);
    const storm = opts.storm, hall = A.zone === 'hall' || A.zone === 'city' || A.zone === 'grid' || A.zone === 'camp';
    const fogD = hall ? 0.009 : 0.0015 + storm * 0.0100, fogC = hall ? [0.07, 0.12, 0.16] : [0.72 + (0.81 - 0.72) * storm * 0.65, 0.80 + (0.85 - 0.80) * storm * 0.65, 0.83 + (0.85 - 0.83) * storm * 0.65];
    // lights: nearest active N
    const lights = world.lights.filter(live).map((L) => ({ L, k: lightState(L), d: Math.hypot(L.x - eye[0], L.y - eye[1], L.z - eye[2]) }))
      .filter((o) => o.k > 0.01 && o.d < o.L.range + 45).sort((a, b) => a.d - b.d).slice(0, q.lights);
    const LP = new Float32Array(16), LC = new Float32Array(12);
    lights.forEach((o, i) => { LP.set([o.L.x, o.L.y, o.L.z, o.L.range], i * 4); LC.set(o.L.color.map((c) => c * o.k), i * 3); });
    A.stats.lights = lights.length;
    const scanAge = time - scan.t, scanR = scanAge * 22, scanAmt = scanAge < 3.2 ? (1 - scanAge / 3.2) * 1.4 : 0;
    const indoorAmb = hall ? [0.20, 0.26, 0.32] : A.zone === 'cave' ? [0.10, 0.17, 0.22] : A.state.power ? [0.30, 0.31, 0.32] : [0.11, 0.115, 0.13];

    const items = [];
    for (const e of world.draw) {
      if (!live(e)) continue;
      if (!e.visible && !e.ex.a3d_hidden && !e.ex.a3d_group) continue;   // grouped nodes re-evaluate visibility
      // per-node animation
      const ex = e.ex;
      let m = e.base;
      if (ex.a3d_spin || ex.a3d_bob || ex.a3d_slide || ex.a3d_drone) {
        m = new Float32Array(e.base);
        if (ex.a3d_spin) { const r = M4.rotY(time * ex.a3d_spin); const t = [m[12], m[13], m[14]]; m = M4.mul(r, m); m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; }
        if (ex.a3d_bob) m[13] += Math.sin(time * 2.1) * ex.a3d_bob;
        if (ex.a3d_drone) { const o = campOrigin(); if (o) { const i = ex.a3d_drone - 1, a = dronePos(i, o), s0 = DRONE_PATHS[i][0]; m[12] += a[0] - (o.x + s0[0]); m[14] += a[1] - (o.z + s0[1]); m[13] += Math.sin(time * 3.0 + i) * 0.05; } }
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
    if (npc.model && !curLayer()) {
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
    A.stats.shadowDraws = 0;
    try { renderShadows(eye, q, items, storm); drawCatcher(view, proj, fogD); } catch (err) { SH.on = 0; if (!A.shadowError) { A.shadowError = String(err && err.message || err); console.warn('A3D gölge kapatıldı:', err); } }
    if (SH.on) { gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, SH.tex); }

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
        gl.uniform1i(u.uShadow, 6); gl.uniform1f(u.uShadowOn, SH.on); gl.uniform1f(u.uShadowTx, 1 / Math.max(1, SH.size)); gl.uniformMatrix4fv(u.uShadowM, false, SH.m);
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
    FX.storm = storm;
    try { drawFX(view, proj, { ...opts, eye, fwd }, fogD); } catch (err) { if (!A.fxError) { A.fxError = String(err && err.message || err); console.warn('A3D efekt:', err); } }
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
    gl.uniform1f(U.uScanAmt, 0); gl.uniform1f(U.uShadowOn, 0); gl.uniform1i(U.uBaseTex, 2); gl.uniform1i(U.uOrmTex, 3); gl.uniform1i(U.uNrmTex, 4); gl.uniform1i(U.uEmiTex, 5);
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
    harvest(A.models.station); harvest(A.models.ice_cave); if (A.models.helikon_hall) harvest(A.models.helikon_hall, 'hall'); if (A.models.helikon_city) harvest(A.models.helikon_city, 'city'); if (A.models.helikon_grid) harvest(A.models.helikon_grid, 'grid'); if (A.models.drill_camp) harvest(A.models.drill_camp, 'camp');
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
    // 03:17 draws closer with every fragment: the blizzard thickens until the recording is assembled.
    const F = window.ICEWALK_FIELD;
    if (F && F.pressure && !F.pressure.__ch2) {
      const base = F.pressure.bind(F);
      F.pressure = Object.assign((t) => base(t) + chapter2Pressure() + hallPressure(), { __ch2: true });
    }
  }
  function chapter2Pressure() {
    const S = A.state;
    if (!A.ready || !S.caveSolved || S.ch2 || A.zone) return 0;   // shelter indoors / in the cave
    return 0.05 + 0.055 * S.bb.reduce((t, v) => t + v, 0);
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


  /* ------------------------------------------------------------ chapter 3: HELIKON hall */
  // The glyph wall in the cave opens once the black box is assembled (Chapter 2). The hall is an
  // instanced interior (layer 'hall'): five steles carry constellations and clock marks; the
  // star map wakes when the steles are lit in the order of the night's clocks — and the one
  // whose time has not come yet (03:41) is left dark. Kaan, frozen in the ice, knows the rule;
  // thawing him needs the generator's spare heat cell from the surface.
  const STELES = [
    { name: 'KUZGUN', time: '03:12' }, { name: 'BALIK', time: '02:58' }, { name: 'TERAZİ', time: '03:41' },
    { name: 'YILAN', time: '03:06' }, { name: 'KAPI', time: '03:17' },
  ];
  const STAR_ORDER = [1, 3, 0, 4];          // 02:58 → 03:06 → 03:12 → 03:17 (03:41 is still to come)
  const KAAN_LINES = [
    'KAAN: “…Ada? Hayır. Sen… istasyondan mısın? Kaç saat geçti?”',
    'KAAN: “Selin bizi buraya indirdi. Yıldız haritasını açarsak eve dönebiliriz dedi.”',
    'KAAN: “Steller o gecenin saatlerini tutuyor. Kapı saatlere göre açılır, sırayla.”',
  ];

  // Chapter 3 HUD: the engine's campaign panel knows nothing about the hall, so after its frame
  // (microtask) the objective, distance and temperature are overwritten while a chapter 3 step is live.
  function ch3Goal(p) {
    const S = A.state;
    if (S.ch4 && !S.ch5) return ch5Goal(p);
    if (S.ch5 && !S.ch6) return ch6Goal(p);
    if (S.ch6 && !S.ch7) return ch7Goal(p);
    if (S.ch7) return { text: 'OYUN TAMAMLANDI · SON: ' + ENDINGS7[S.ending7][0], d: null, ch: 7 };
    if (S.ch5) return { text: 'TAMAMLANDI · ' + (LOADS[S.load5] || ['—'])[0] + ' · DEVAMI: BÖLÜM 6', d: null, ch: 5 };
    if (S.inCity) { const g = cityGoal(); return g && { text: g[0], d: g[1] ? Math.hypot(g[1].x - p.x, g[1].z - p.z) : 0, ch: 4 }; }
    if (!S.ch2 || !S.tutorial.hall || S.ch4) return null;
    let text, id;
    if (S.inHall) {
      if (!S.kaanSeen) { text = 'BUZDAKİ ADAMI İNCELE'; id = 'kaan'; }
      else if (!S.heatCell) { text = 'YÜZEYE ÇIK · JENERATÖRDEN ISI HÜCRESİ AL'; id = 'hall_exit'; }
      else if (!S.kaanFree) { text = 'ISI HÜCRESİYLE KAAN’I ÇÖZ'; id = 'kaan'; }
      else if (S.kaanTalk < KAAN_LINES.length || !S.kaanTrust) { text = 'KAAN İLE KONUŞ'; id = 'kaan'; }
      else if (!S.ch3) { text = 'STELLERİ SAAT SIRASIYLA YAK · ' + S.stars.length + '/4'; id = 'dais'; }
      else { text = 'ÜÇ CEVAP KAPISI · İÇERİ GİR'; id = 'gate4'; }
    } else if (S.kaanSeen && !S.heatCell) { text = 'JENERATÖRDEN YEDEK ISI HÜCRESİ AL'; id = 'generator'; }
    else if (S.heatCell === 1 && !S.kaanFree) { text = 'ISI HÜCRESİNİ KAAN’A GÖTÜR · MAĞARA KAPISI'; id = 'glyph'; }
    else return null;
    const a = anchor(id);
    return { text, d: a ? Math.hypot(a.x - p.x, a.z - p.z) : 0, ch: 3 };
  }
  let hudQueued = false, hudSaved = null;
  function ch3Hud() {
    hudQueued = false;
    if (!A.ready || E.state !== 'play') return;
    const p = E.player, g = ch3Goal(p), $ = (id) => document.getElementById(id);
    const ids = ['missionName', 'objectiveHint'];
    if (g && !hudSaved) { hudSaved = {}; for (const id of ids) if ($(id)) hudSaved[id] = $(id).textContent; }
    if (!g && hudSaved) { for (const id of ids) if ($(id) && hudSaved[id] !== undefined) $(id).textContent = hudSaved[id]; hudSaved = null; }
    if (g) {
      if ($('missionName')) $('missionName').textContent = 'BÖLÜM ' + g.ch + ' · ' + g.text;
      if ($('distance')) $('distance').textContent = g.d == null ? '—' : Math.round(g.d) + ' m';
      if ($('objectiveHint')) $('objectiveHint').textContent = A.state.inCamp ? 'KOALİSYON KAMPI · BUZUN 35 m ALTI' : A.state.inGrid ? 'İLETİM GALERİSİ · BUZUN 36 m ALTI' : A.state.inCity ? 'HELIKON HAVZASI · BUZ ALTI GÖLÜ' : A.state.inHall ? 'HELIKON SALONU · BUZUN 30 m ALTI' : g.ch === 7 ? 'BÖLÜM 7 · 03:17 · AĞUSTOS' : g.ch === 6 ? 'BÖLÜM 6 · KIŞ ABLUKASI · HAZİRAN' : g.ch === 5 ? 'BÖLÜM 5 · İLK TEMAS · MART' : 'BÖLÜM 3 · HELIKON KAPISI';
    }
    if (A.state.inCity && $('temperature')) $('temperature').textContent = '−4°C';
    if (A.state.inCamp && $('temperature')) $('temperature').textContent = '−11°C';
    if (A.state.inGrid && $('temperature')) $('temperature').textContent = time < blackoutUntil ? '−18°C' : A.state.grid5 ? '+9°C' : '+4°C';
    if (A.state.inHall && $('temperature')) {
      const v = anchor('vent'), dv = v ? Math.hypot(v.x - p.x, v.z - p.z) : 99;
      $('temperature').textContent = '−' + Math.round(dv < 3.2 ? 9 : dv < 7 ? 9 + (dv - 3.2) / 3.8 * 32 : 41) + '°C';
    }
  }

  /* ------------------------------------------------------------ chapter 4: the lake basin ("Üç Cevap") */
  // Behind the three-ring gate lies a subglacial lake (kept liquid by pressure and geothermal heat,
  // like Lake Vostok). Symbol stones teach the crystal language; two of them wake the bridge stone,
  // the third (on the island) completes the dictionary; the spire speaks in symbols and asks for
  // one of three answers. Whatever is chosen, the 03:17 broadcast has already been caught by a satellite.
  const SYMS = [{ g: '◆', w: 'BİZ' }, { g: '◇', w: 'SİZ' }, { g: '△', w: 'ZAMAN' }, { g: '≈', w: 'SU' }, { g: '□', w: 'KAPI' }, { g: '○', w: 'SESSİZLİK' }];
  const SYM_STONES = [[0, 3], [1, 2], [4, 5]];
  const VOICE = [
    { s: [0, 3, 2], t: '“Biz suyun altında zamanı tutarız.”' },
    { s: [1, 2, 4], t: '“Siz zamanın kapısını açtınız.”' },
    { s: [5, 4, 1], t: '“Sessizlik mi, kapı mı? Seçim sizin.”' },
  ];
  const ENDINGS = {
    sus: ['SUS', 'Uplink’i kapattın ve kristallerin sesi kesildi. Şehir yeniden karanlığa gömüldü. Ama uplink günlüğünde son bir satır var: 03:17 kaydı bir yer gözlem uydusuna çoktan iletilmiş — “KAYNAK BİLİNMİYOR · 86° GÜNEY”.'],
    cevap: ['CEVAP VER', 'Kuleye uplink frekansında cevap verdin. Sinyal uydu ağına yayıldı. Birkaç saat içinde Antarktika Antlaşması Danışma Toplantısı olağanüstü gündemle toplanıyor; dünya ilk kez dinliyor.'],
    gec: ['KAPIDAN GEÇ', 'Kulenin ışığına yürüdün. Su yükseldi, ses içini doldurdu. Yüzeyde istasyonun telsizi senin sesinle tek bir cümleyi tekrarlıyor: “Sinyali kapatmayın.” Bir uydu bunu da kaydetti.'],
  };
  function symText(k) { return A.state.syms[k] ? SYMS[k].g + ' ' + SYMS[k].w : SYMS[k].g + ' ?'; }
  function enterCity() {
    const S = A.state, sp = anchor('city_spawn'), p = E.player; if (!sp) return null;
    S.inHall = false; S.inCity = true; p.x = sp.x; p.z = sp.z; p.yaw = 0; p.pitch = -0.05; p.spdX = 0; p.spdZ = 0;
    A.zone = zoneAt(p.x, p.z);
    flash('200,240,255', 0.95); tone(110, 2.6, 'sine', 0.2, 1.6); noiseBurst(2.0, 120, 50, 0.18, 2.4);
    if (!S.tutorial.city) {
      S.tutorial.city = 1;
      journal('BÖLÜM 4 — ÜÇ CEVAP', 'Kapının ardında buzun altında bir göl var. Tavan buz, duvarlar kaya; su donmamış — üstteki buzun basıncı ve dipteki ısı onu sıvı tutuyor (Vostok Gölü gibi). Kuzey duvarında basamak basamak bir şehir. Ortadaki adada bir kristal kule titreşiyor.');
    }
    E.save?.();
    return 'BÖLÜM 4 · ÜÇ CEVAP · Buz altı gölü · Kıyıdaki sembol taşlarını oku (Q / E)';
  }
  function exitCity() {
    const S = A.state, g = anchor('gate4'), p = E.player; if (!g) return null;
    S.inCity = false; S.inHall = true; p.x = g.x; p.z = g.z + 1.2; p.yaw = Math.PI; p.pitch = 0; p.spdX = 0; p.spdZ = 0;
    A.zone = zoneAt(p.x, p.z);
    flash('200,240,255', 0.7); tone(220, 1.0, 'sine', 0.12, 0.7);
    E.save?.();
    return 'HELIKON SALONU · Üç halkalı kapı arkanda';
  }
  function readStone(i) {
    const S = A.state, [a, b] = SYM_STONES[i];
    if (!S.stones[i]) {
      S.stones[i] = 1; S.syms[a] = 1; S.syms[b] = 1;
      tone([523, 587, 659][i], 0.7, 'sine', 0.13, 1.0); tone([1046, 1174, 1318][i], 0.9, 'triangle', 0.04, 1.0);
      journal('KRİSTAL DİLİ — SÖZLÜK', SYMS[a].g + ' = ' + SYMS[a].w + ' · ' + SYMS[b].g + ' = ' + SYMS[b].w + '. Taşın titreşimi tarayıcıda bir sözcüğe dönüşüyor; anlam sesle değil ritimle taşınıyor.');
      E.save?.();
      const n = S.syms.reduce((t, v) => t + v, 0);
      return 'SEMBOL TAŞI · ' + symText(a) + ' · ' + symText(b) + ' öğrenildi · Sözlük ' + n + '/6';
    }
    return 'SEMBOL TAŞI · ' + symText(a) + ' · ' + symText(b) + ' (sözlükte)';
  }
  function bridgeStone() {
    const S = A.state;
    if (S.bridge) return 'KÖPRÜ TAŞI · Kristal köprü açık · Adaya geç';
    const need = [0, 3, 1, 2];
    if (!need.every((k) => S.syms[k])) return 'KÖPRÜ TAŞI · Dört yuva: ' + need.map(symText).join(' · ') + ' · Kıyıdaki iki sembol taşını oku';
    S.bridge = true; tone(147, 2.4, 'sine', 0.18, 1.5); noiseBurst(2.2, 300, 900, 0.16, 2.0); flash('150,235,255', 0.6);
    journal('KRİSTAL KÖPRÜ', 'Dört sembolü taşa okuttuğumda suyun altından kristal levhalar yükseldi ve adaya bir köprü oluştu. Kuzey duvarındaki şehrin pencerelerinde ışıklar yandı — birileri, ya da bir şeyler, bizi fark etti.');
    E.save?.();
    return 'KRİSTAL KÖPRÜ SUDAN YÜKSELDİ · Şehrin pencereleri aydınlandı';
  }
  function endCard(key) { const [title, body] = ENDINGS[key]; showCard('BÖLÜM 4 · ÜÇ CEVAP', title, body, 'Devamı: Bölüm 5 · “İlk Temas” — Mart, son uçak.'); }
  function showCard(kicker, title, body, next) {
    let el = document.getElementById('a3dEndCard');
    if (!el) {
      el = document.createElement('div'); el.id = 'a3dEndCard';
      el.style.cssText = 'position:fixed;inset:0;z-index:30001;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at center,#06202ee8,#010608f5);color:#e6fbff;font:500 14px/1.55 system-ui;padding:24px';
      document.body.appendChild(el);
    }
    document.exitPointerLock?.();
    el.innerHTML = '';
    const box = document.createElement('div'); box.style.cssText = 'max-width:620px;text-align:center';
    const k = document.createElement('div'); k.textContent = kicker; k.style.cssText = 'letter-spacing:3px;font-size:11px;color:#8fd7e6;margin-bottom:10px';
    const h = document.createElement('div'); h.textContent = title; h.style.cssText = 'font:800 30px system-ui;letter-spacing:4px;margin-bottom:14px;color:#ffd3a3';
    const pTxt = document.createElement('p'); pTxt.textContent = body;
    const nx = document.createElement('p'); nx.textContent = next; nx.style.cssText = 'color:#8fb9c4;font-size:12px;margin-top:14px';
    const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = 'DEVAM';
    btn.style.cssText = 'margin-top:18px;min-height:44px;padding:8px 26px;border-radius:8px;border:1px solid #b7e7ef99;background:#0d3346;color:#fff;font:700 13px system-ui;pointer-events:auto';
    btn.addEventListener('click', () => el.remove());
    box.append(k, h, pTxt, nx, btn); el.appendChild(box);
  }
  function finale(key) {
    const S = A.state;
    S.ch4 = true; S.ending4 = key;
    tone(key === 'sus' ? 82 : key === 'cevap' ? 330 : 196, 3.2, 'sine', 0.2, key === 'sus' ? 0.5 : 1.8); flash(key === 'gec' ? '255,255,255' : '160,230,255', 0.95);
    journal('BÖLÜM 4 — CEVAP: ' + ENDINGS[key][0], ENDINGS[key][1]);
    E.save?.();
    endCard(key);
  }
  function talkSpire() {
    const S = A.state;
    if (S.ch7) return 'KRİSTAL KULE · Sustu · Son: ' + ENDINGS7[S.ending7][0];
    if (S.ch6) return spire7();
    if (S.ch4) return 'KRİSTAL KULE · Sessiz · Cevabın: ' + ENDINGS[S.ending4][0];
    if (S.voice < VOICE.length) {
      const L = VOICE[S.voice], known = L.s.every((k) => S.syms[k]);
      tone(196 + S.voice * 60, 0.9, 'sine', 0.12, 1.02);
      const shown = 'SES · ' + L.s.map(symText).join(' · ');
      if (!known) return shown + ' — çeviri eksik · Adadaki sembol taşını oku (Q)';
      S.voice++;
      journal('KRİSTAL KULE — SES ' + S.voice + '/3', L.s.map((k) => SYMS[k].g).join(' ') + ' → ' + L.t);
      E.save?.();
      return shown + ' — ' + L.t + (S.voice === VOICE.length ? ' · E: cevabını seç' : '');
    }
    choice('KRİSTAL KULE: “Sessizlik mi, kapı mı? Seçim sizin.” — Ne cevap vereceksin?',
      [['sus', 'Sus — uplink’i kapat'], ['cevap', 'Cevap ver — dünyaya duyur'], ['gec', 'Kapıdan geç — şehre katıl']], finale);
    return null;
  }
  function cityGoal() {
    const S = A.state, p = E.player;
    if (S.ch4) return null;
    const near = (ids) => ids.map((id) => anchor(id)).filter(Boolean).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
    if (!S.stones[0] || !S.stones[1]) return ['KIYIDAKİ SEMBOL TAŞLARINI OKU · ' + (S.stones[0] + S.stones[1]) + '/2', near(['sym1', 'sym2'].filter((_, i) => !S.stones[i]))];
    if (!S.bridge) return ['KÖPRÜ TAŞINI UYANDIR', anchor('bridgestone')];
    if (S.voice === 1 && !S.stones[2]) return ['ADADAKİ SEMBOL TAŞINI OKU', anchor('sym3')];
    if (S.voice < 3) return ['KRİSTAL KULEYİ DİNLE · ' + S.voice + '/3', anchor('spire')];
    return ['CEVABINI SEÇ', anchor('spire')];
  }

  /* ------------------------------------------------------------ chapter 5: first contact ("İlk Temas") */
  // March: the season's last aircraft leaves and nobody can fly in for ~6 months. The station's diesel
  // will not last the polar night, so the player couples the station to the Helikon geothermal network
  // through a gallery under the hall's heat well. Paralleling two AC sources needs equal voltage,
  // frequency and phase sequence, and the breaker may only close near zero phase angle (synchroscope
  // needle at 12 o'clock); anything else trips the protection relay — a blackout in the gallery.
  const DIAL_SPEC = [
    { name: 'GERİLİM', opts: ['230 V', '400 V', '690 V', '11 kV'], want: 1 },
    { name: 'FREKANS', opts: ['3,17 Hz', '48 Hz', '50 Hz', '60 Hz'], want: 2 },
    { name: 'FAZ SIRASI', opts: ['L1-L2-L3', 'L1-L3-L2', 'L2-L1-L3'], want: 0 },
  ];
  const SYNC_RPS = 0.3, SYNC_WINDOW = 20;   // needle turns at 0.3 rev/s (slip); close within ±20°
  const LOADS = {
    tam: ['TAM YÜK', 'Şalteri tam yüke aldın: 60 kW istasyona akıyor. Işıklar, seralar, lab — her şey çalışıyor. Ama galerideki iletkenlerin ışığı sarardı; göl havzasındaki ısı kuyuları soğumaya başladı. Kristal çekirdek tek bir sembol yineliyor: ◇ — “siz”.'],
    denge: ['PAYLAŞ', 'Yükü 35 kW’a ayarladın. İstasyon kışı idareli geçirecek, Helikon kuyuları da sıcak kalacak. Çekirdek iki sembolü birlikte gösteriyor: ◆ ◇ — “biz, siz”. Bir anlaşmaya benziyor.'],
    sinir: ['SINIRLI YÜK', 'Yükü 20 kW’ta tuttun: istasyon yalnızca ısınma ve telsizle yaşayacak. Selin’in sesi telsizde gergin: “Konsorsiyum bunu bir tercih olarak görecek.” Çekirdek ◆ ≈ gösteriyor — “biz, su”. Kaan gülümsüyor.'],
  };
  let sync5 = null, blackoutUntil = 0, syncEl = null;
  const dialPulse = [0, 0, 0];
  const dialOk = () => A.state.dials.every((v, i) => v === DIAL_SPEC[i].want);
  function syncAngle() { if (!sync5) return null; const a = ((time - sync5.t0) * SYNC_RPS * 360 + 180) % 360; return a > 180 ? a - 360 : a; }
  function lastPlane() {
    const S = A.state;
    tone(392, 0.5, 'square', 0.06, 1.0);
    choice('TELSİZ · PİLOT: “Kayaklı Basler pistte, 40 dakika sonra kalkıyoruz. Bu sezonun son uçağı — Ekim’e kadar kimse gelemez. Biniyor musun?”',
      [['kal', 'Kal — kışı istasyonda geçir'], ['git', 'Uçağa bin']], (k) => {
        if (k === 'git') {
          S.left5++; E.save?.();
          journal('BÖLÜM 5 — AYRILIŞ', 'Uçak kalktı. Rapora yazdıklarına kimse inanmadı: “Buz altında bir şehir.” Ekim’de ilk uçakla dönüldüğünde istasyonun ışıkları sönüktü, ısı kuyusu soğuktu.');
          showCard('BÖLÜM 5 · İLK TEMAS', 'AYRILIŞ', 'Uçağa bindin. Altı ay boyunca Helikonlar hakkında bildiklerin bir rapor dosyasında kaldı. Ekim’de dönen ekip istasyonu boş, ısı kuyusunu soğuk buldu. Ne olduğunu kimse bilmiyor.', 'Bu bir son. Telsize yeniden gidersen son anda kalmayı seçebilirsin.');
          return;
        }
        S.plane5 = 1; tone(196, 2.4, 'sine', 0.16, 0.7); flash('255,220,170', 0.4);
        const news = { sus: 'Sinyali kapatmıştım ama uydu kaydı sızdı; haber ajansları “86° Güney’den bilinmeyen yayın” diye yazıyor.', cevap: 'Cevabımız dünyaya ulaştı; ajanslar 03:17 kaydını yayımlıyor.', gec: 'Telsiz hâlâ benim sesimle “Sinyali kapatmayın” diyor; kayıt bütün ajanslarda.' }[S.ending4] || '';
        journal('BÖLÜM 5 — İLK TEMAS', 'Uçak kalktı, ben kaldım. Kış boyunca (≈6 ay) kıtaya uçuş yok. ' + news + ' Uplink’ten: Antarktika Antlaşması Danışma Toplantısı olağanüstü oturumda. Bazı taraflar, 1991 Madrid Protokolü’nün maden kaynakları yasağının (Madde 7) “bilinmeyen bir enerji kaynağını” kapsamadığını savunuyor. Konsorsiyum diğer istasyonlarını boşaltıyor.');
        journal('KIŞLAMA — YAKIT HESABI', 'Tankta 16.000 litre Antarktika dizeli var. 60 kVA jeneratör kış yükünde saatte ~8 litre yakıyor: 2.000 saat, yani 83 gün. Kutup gecesi ~180 gün. Eksik: 97 gün. Kaan: “Isı kuyusunun altında bir iletim galerisi var. Helikonların enerjisi oradan geçiyor. Senin sondaj kuyun galerinin tavanına çıkıyor.”');
        E.save?.();
        E.toast('BÖLÜM 5 · İLK TEMAS · Uçak kalktı · Yakıt 83 gün · Salondaki ISI KUYUSUNDAN galeriye in');
      });
    return null;
  }
  function enterGrid() {
    const S = A.state, sp = anchor('grid_spawn'), p = E.player; if (!sp) return null;
    S.inHall = false; S.inGrid = true; p.x = sp.x; p.z = sp.z; p.yaw = 0; p.pitch = -0.05; p.spdX = 0; p.spdZ = 0;
    A.zone = zoneAt(p.x, p.z); sync5 = null;
    flash('255,190,120', 0.8); tone(98, 2.2, 'sine', 0.16, 1.4); noiseBurst(1.4, 300, 90, 0.14, 1.6);
    if (!S.tutorial.grid) {
      S.tutorial.grid = 1;
      journal('İLETİM GALERİSİ', 'Isı kuyusundaki merdiven 12 metre aşağı, oyulmuş bir galeriye iniyor. Duvarlarda ışıyan iletkenler; hava +4°C — geotermal ısı. Galerinin sonunda bir çekirdek ve tavanı delip geçen çelik bir boru: bizim 840 metrelik sondaj kuyumuz. Selin kabloyu oradan sarktı.');
    }
    E.save?.();
    return 'BÖLÜM 5 · İLETİM GALERİSİ · +4°C · Galerinin sonunda istasyon kablosu';
  }
  function exitGrid() {
    const S = A.state, v = anchor('vent'), p = E.player; if (!v) return null;
    S.inGrid = false; S.inHall = true; p.x = v.x + 0.6; p.z = v.z; p.yaw = 0; p.pitch = 0; p.spdX = 0; p.spdZ = 0;
    A.zone = zoneAt(p.x, p.z); sync5 = null;
    flash('255,190,120', 0.6); tone(220, 1.0, 'sine', 0.12, 0.7);
    E.save?.();
    return 'HELIKON SALONU · Isı kuyusundan çıktın';
  }
  function dialText(i) { const d = DIAL_SPEC[i]; return 'DÜĞÜM ' + (i + 1) + ' · ' + d.name + ': ' + d.opts[A.state.dials[i]]; }
  function turnDial(i) {
    const S = A.state;
    if (S.grid5) return dialText(i) + ' · Kilitli (şebeke bağlı)';
    if (time < blackoutUntil) return 'KARARTMA · Düğümler enerjisiz';
    S.dials[i] = (S.dials[i] + 1) % DIAL_SPEC[i].opts.length; dialPulse[i] = time + 0.5; sync5 = null;
    tone(330 + 60 * S.dials[i], 0.18, 'triangle', 0.08, 1.0); noiseBurst(0.12, 1800, 900, 0.05, 0.6);
    E.save?.();
    return dialText(i) + ' · E: sonraki kademe';
  }
  function connectCable() {
    const S = A.state;
    if (S.cable5) return 'İSTASYON KABLOSU · Bağlı · 400 V / 50 Hz hat panele geliyor';
    S.cable5 = 1; tone(220, 0.4, 'square', 0.08, 1.0); noiseBurst(0.4, 600, 300, 0.12, 0.8);
    journal('İSTASYON KABLOSU', 'Zırhlı kabloyu sondaj kuyusundan gelen makaradan bağlantı kutusuna taktım. Panelde istasyon tarafı canlandı: 400 V, 50 Hz, faz sırası L1-L2-L3. Helikon tarafını üç düğümle buna eşlemem lazım — gerilim, frekans, faz sırası. Ancak üçü de tutunca ve senkronoskobun ibresi saat 12’deyken şalteri kapatabilirim.');
    E.save?.();
    return 'KABLO BAĞLANDI · İstasyon hattı canlı · Senkronoskop panelini oku';
  }
  function syncReadout() {
    const S = A.state;
    return 'İSTASYON 400 V · 50 Hz · L1-L2-L3 | HELIKON ' + S.dials.map((v, i) => DIAL_SPEC[i].opts[v]).join(' · ');
  }
  function trip(reason) {
    const p = E.player; sync5 = null; blackoutUntil = time + 6;
    p.warmth = Math.max(0, (p.warmth ?? 100) - 15);
    tone(70, 1.6, 'sawtooth', 0.14, 0.5); noiseBurst(1.8, 2600, 120, 0.3, 0.9); flash('10,20,30', 0.95);
    if (!A.state.tutorial.trip) { A.state.tutorial.trip = 1; journal('KORUMA RÖLESİ', 'Şalter attı, galeri karardı. Röle ekranı: ' + reason + '. İki şebeke birbirine uymazken bağlanırsa ani akım jeneratörü de, iletkenleri de yakabilir; röle bu yüzden açıyor.'); }
    return 'KARARTMA · KORUMA RÖLESİ AÇTI · ' + reason + ' · Soğuk dalgası';
  }
  function syncPanel() {
    const S = A.state;
    if (S.grid5 && !S.load5) { loadChoice(); return null; }
    if (S.grid5) return 'ŞEBEKE BAĞLI · ' + LOADS[S.load5][0] + ' · Çekirdek sıcak';
    if (!S.cable5) return 'SENKRONOSKOP · İstasyon hattı bağlı değil · Sondaj kuyusundaki kabloyu bağla';
    if (time < blackoutUntil) return 'KARARTMA · Röle kendini sıfırlıyor…';
    if (!sync5) {
      const bad = DIAL_SPEC.map((d, i) => (S.dials[i] === d.want ? null : d.name)).filter(Boolean);
      if (bad.length) return trip(bad[0] + ' UYUŞMUYOR');
      sync5 = { t0: time }; tone(523, 0.3, 'sine', 0.1, 1.0);
      return 'SENKRONİZASYON · ' + syncReadout() + ' · İbre saat 12’ye gelince E (şalteri kapat)';
    }
    const ang = Math.round(syncAngle());
    if (Math.abs(ang) > SYNC_WINDOW) return trip('FAZ AÇISI ' + Math.abs(ang) + '° · ani akım');
    sync5 = null; S.grid5 = true;
    tone(130.8, 3.0, 'sine', 0.2, 1.5); tone(261.6, 2.4, 'triangle', 0.06, 1.5); flash('150,235,255', 0.85);
    journal('ŞEBEKE BAĞLANDI', 'İbre tepedeyken şalteri kapattım (faz açısı ' + Math.abs(ang) + '°). İki şebeke aynı ritimde. İletkenler parladı, çekirdek ilk kez bize dönük bir desen gösterdi: ◆ ≈ ◇ — “biz · su · siz”. İlk temas bu mu?');
    E.save?.();
    loadChoice();
    return 'ŞALTER KAPANDI · İKİ ŞEBEKE SENKRON · Çekirdek bir desen gösteriyor: ◆ ≈ ◇';
  }
  function loadChoice() {
    const S = A.state;
    const kaan = S.kaanTrust > 0 ? 'KAAN (kristal ağından): “Selin’e güvendiğini biliyorum. Ama bu ısı şehrin kalbi.”' : 'KAAN (kristal ağından): “Haklıydın: konsorsiyum ısının hepsini isteyecek. Şehrin kuyuları soğursa onlar da cevap verir.”';
    choice('TELSİZ · SELİN: “Tam yük ver, kışı rahat geçirelim.” · ' + kaan + ' — Şebekeden ne kadar çekeceksin?',
      [['tam', 'Tam yük — 60 kW (Selin)'], ['denge', 'Paylaş — 35 kW'], ['sinir', 'Sınırlı — 20 kW (Kaan)']], finale5);
  }
  function finale5(key) {
    const S = A.state;
    S.ch5 = true; S.load5 = key;
    tone(key === 'tam' ? 110 : key === 'denge' ? 196 : 262, 3.0, 'sine', 0.18, key === 'tam' ? 0.7 : 1.4); flash('255,220,170', 0.7);
    journal('BÖLÜM 5 — YÜK: ' + LOADS[key][0], LOADS[key][1]);
    E.save?.();
    showCard('BÖLÜM 5 · İLK TEMAS', LOADS[key][0], LOADS[key][1], 'Devamı: Bölüm 6 · “Kış Ablukası” — Haziran, kutup gecesi.');
  }
  function talkCore() {
    const S = A.state;
    if (S.ch5 && !S.ch6) return enterCamp();
    if (S.ch5) return 'HELIKON ÇEKİRDEĞİ · ' + { tam: '◇ … ◇ … (soğuyor)', denge: '◆ ◇ (sabit, sıcak)', sinir: '◆ ≈ (sakin)' }[S.load5];
    if (S.grid5) return 'HELIKON ÇEKİRDEĞİ · ◆ ≈ ◇ — ' + symText(0) + ' · ' + symText(3) + ' · ' + symText(1);
    tone(147, 0.8, 'sine', 0.1, 1.02);
    return 'HELIKON ÇEKİRDEĞİ · Yavaş bir nabız · İki şebeke ayrık: bağlantı galerinin sonundaki panelden';
  }
  function syncUpdate(p) {
    const on = !!sync5 && A.state.inGrid;
    if (on) {
      const s = anchor('sync');
      if (!s || Math.hypot(p.x - s.x, p.z - s.z) > 3.5 || time - sync5.t0 > 30) sync5 = null;
    }
    if (!sync5) { if (syncEl) { syncEl.remove(); syncEl = null; } return; }
    if (!syncEl) {
      syncEl = document.createElement('canvas'); syncEl.id = 'a3dSync'; syncEl.width = 160; syncEl.height = 160;
      syncEl.style.cssText = 'position:fixed;left:50%;bottom:24%;transform:translateX(-50%);width:120px;height:120px;z-index:29000;pointer-events:none';
      document.body.appendChild(syncEl);
    }
    const c = syncEl.getContext('2d'), a = syncAngle() * Math.PI / 180;
    c.clearRect(0, 0, 160, 160);
    c.fillStyle = '#0a0e10e0'; c.beginPath(); c.arc(80, 80, 76, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#ddddcc'; c.lineWidth = 3; c.stroke();
    c.fillStyle = '#2aa04a'; c.beginPath(); c.moveTo(80, 80); c.arc(80, 80, 70, -Math.PI / 2 - SYNC_WINDOW * Math.PI / 180, -Math.PI / 2 + SYNC_WINDOW * Math.PI / 180); c.fill();
    c.strokeStyle = '#ffcf80'; c.lineWidth = 5; c.beginPath(); c.moveTo(80, 80); c.lineTo(80 + 62 * Math.sin(a), 80 - 62 * Math.cos(a)); c.stroke();
    c.fillStyle = '#e8e8dc'; c.font = '700 13px system-ui'; c.textAlign = 'center'; c.fillText('E', 80, 132);
  }
  function ch5Goal(p) {
    const S = A.state;
    let text, id;
    if (!S.plane5) {
      text = 'SON UÇAK KALKIYOR · TELSİZE GİT';
      id = S.inCity ? 'city_exit' : S.inHall ? 'hall_exit' : S.inGrid ? 'grid_exit' : 'radio';
    } else if (!S.inGrid) {
      text = 'ISI KUYUSUNDAN İLETİM GALERİSİNE İN';
      id = S.inCity ? 'city_exit' : S.inHall ? 'vent' : 'glyph';
    } else if (!S.cable5) { text = 'İSTASYON KABLOSUNU BAĞLA'; id = 'cable'; }
    else if (S.grid5) { text = 'YÜKÜ SEÇ'; id = 'sync'; }
    else if (!dialOk()) { text = 'DÜĞÜMLERİ İSTASYONA EŞLE · ' + S.dials.filter((v, i) => v === DIAL_SPEC[i].want).length + '/3'; id = S.dials.map((v, i) => (v === DIAL_SPEC[i].want ? null : 'j' + (i + 1))).filter(Boolean)[0]; }
    else { text = 'ŞALTERİ KAPAT · İBRE SAAT 12’DEYKEN'; id = 'sync'; }
    const a = anchor(id);
    return { text, d: a ? Math.hypot(a.x - p.x, a.z - p.z) : 0, ch: 5 };
  }

  /* ------------------------------------------------------------ chapter 6: winter siege ("Kış Ablukası") */
  // June, polar night. An emergency coalition has airdropped a drilling team above the Helikon lake. They use
  // kerosene-based drilling fluid (the real Vostok borehole was filled with kerosene + HCFC-141b; hot-water
  // drilling as at Lake Whillans is the clean, slower alternative). The player is unarmed: stop the pump
  // without a pressure surge, cut the Iridium relay (geostationary satellites are not visible this far south,
  // so polar-orbit Iridium is the link), and decide about a hypothermic soldier — all while thermal drones
  // patrol: the warmer the body, the farther it is seen; snow-block windbreaks halve that distance.
  const DRONE_PATHS = [[[2, -17], [15, -17], [15, -30], [2, -30]], [[-19, -24], [-6, -24], [-6, -46], [-19, -46]]];
  const DRONE_SPEED = 2.4, CAMP_DC = -28, CAMP_RX = 20.8, CAMP_RZ = 22.8;
  let detect6 = 0, caughtUntil = 0, detectEl = null, lastWarn6 = 0;
  function campOrigin() { const e = anchor('camp_exit'); return e ? { x: e.x, y: e.y, z: e.z - 1.8 } : null; }
  function dronePos(i, o) {
    const path = DRONE_PATHS[i], seg = path.map((q, k) => Math.hypot(path[(k + 1) % path.length][0] - q[0], path[(k + 1) % path.length][1] - q[1]));
    const per = seg.reduce((t, v) => t + v, 0);
    let d = ((time * DRONE_SPEED + i * per * 0.37) % per + per) % per, k = 0;
    while (d > seg[k]) { d -= seg[k]; k++; }
    const a = path[k], b = path[(k + 1) % path.length], t = d / seg[k];
    return [o.x + a[0] + (b[0] - a[0]) * t, o.z + a[1] + (b[1] - a[1]) * t];
  }
  const detectRange = (warm, cover) => (5 + 7 * clamp((warm ?? 100) / 100, 0, 1)) * (cover ? 0.45 : 1);
  function inCover(x, z) { return world.volumes.some((v) => live(v) && v.zone === 'cover' && insideOBB(v, x, z)); }
  function campClamp(x, z) {
    const o = campOrigin(); if (!o) return [x, z];
    const lx = x - o.x, lz = z - o.z;
    if (Math.abs(lx) < 2.4 && lz > -7.5) return [x, z];   // entry corridor
    const q = (lx / CAMP_RX) ** 2 + ((lz - CAMP_DC) / CAMP_RZ) ** 2;
    if (q <= 1 || lz > -5) return [x, z];
    const k = 0.999 / Math.sqrt(q);
    return [o.x + lx * k, o.z + CAMP_DC + (lz - CAMP_DC) * k];
  }
  function enterCamp() {
    const S = A.state, sp = anchor('camp_spawn'), p = E.player; if (!sp) return null;
    S.inGrid = false; S.inCamp = true; p.x = sp.x; p.z = sp.z; p.yaw = 0; p.pitch = -0.03; p.spdX = 0; p.spdZ = 0;
    A.zone = zoneAt(p.x, p.z); sync5 = null; detect6 = 0;
    flash('180,220,255', 0.8); tone(90, 2.0, 'sine', 0.14, 1.3); noiseBurst(1.2, 400, 120, 0.12, 1.6);
    if (!S.tutorial.camp) {
      S.tutorial.camp = 1;
      journal('BÖLÜM 6 — KIŞ ABLUKASI', 'Çekirdeğin gösterdiği tünel buzun 35 m altında bir mağaraya açılıyor. Koalisyon sondaj kampı: üç konteyner, matkap kulesi, kırmızı sıvı tankları. Sondaj sıvısı kerosen bazlı (Vostok kuyusuna da kerosen ve HCFC-141b doldurulmuştu); göle bir damla sızarsa şehir kirlenir. Tavanda termal kameralı iki dron dolaşıyor: vücut ne kadar sıcaksa o kadar uzaktan görüyorlar. Kar bloklarının arkası menzili yarıya indiriyor.');
    }
    E.save?.();
    return 'BÖLÜM 6 · KIŞ ABLUKASI · Koalisyon kampı · Dronlar sıcak olanı görür: soğuk kal, kar duvarlarının arkasından git';
  }
  function exitCamp() {
    const S = A.state, c = anchor('core'), p = E.player; if (!c) return null;
    S.inCamp = false; S.inGrid = true; p.x = c.x; p.z = c.z + 0.5; p.yaw = 0; p.pitch = 0; p.spdX = 0; p.spdZ = 0;
    A.zone = zoneAt(p.x, p.z); detect6 = 0;
    flash('180,220,255', 0.6); tone(220, 0.9, 'sine', 0.1, 0.7);
    E.save?.();
    return 'İLETİM GALERİSİ · Çekirdek odasına döndün';
  }
  function checkDone6() {
    const S = A.state;
    if (S.ch6 || S.pump6 < 2 || !S.relay6 || !S.soldier6) return;
    S.ch6 = true;
    const pumpTxt = S.spill6 ? 'Vana basınç varken kapandı: hortum patladı ve birkaç yüz litre kerosen kamp tabanına yayıldı. Göl suyu henüz temiz, ama ilk damla düştü.' : 'Vana basınç sıfırlandıktan sonra kapandı: tek damla sıvı çıkmadı. Matkap hattı kuru.';
    const soldierTxt = S.soldier6 === 'save' ? 'Çavuş Dagan nefes alıyor; seni görmediğini söyleyecek.' : 'Çavuş’u bıraktın. Ona ne olduğunu hiçbir zaman bilmeyeceksin.';
    const spotTxt = S.spot6 ? 'Dronlar seni ' + S.spot6 + ' kez yakaladı: koalisyon artık “yetkisiz bir sivil” kaydı tutuyor.' : 'Hiç yakalanmadın: koalisyon sabotajı bir ekipman arızası sandı.';
    const body = 'Üç iş bitti: sondaj sıvısı pompası durdu, uydu bağlantısı kesildi. ' + pumpTxt + ' ' + soldierTxt + ' ' + spotTxt;
    tone(130.8, 3.0, 'sine', 0.2, 1.4); flash('200,230,255', 0.8);
    journal('BÖLÜM 6 — KUTUP GECESİ', body);
    E.save?.();
    showCard('BÖLÜM 6 · KIŞ ABLUKASI', 'KUTUP GECESİ', body, 'Devamı: Bölüm 7 · “03:17” — Ağustos, ilk güneş.');
  }
  function pumpAct() {
    const S = A.state;
    if (S.pump6 === 0) {
      S.pump6 = 1; S.pumpP = 38; tone(120, 1.8, 'sawtooth', 0.08, 0.4); noiseBurst(1.5, 300, 80, 0.12, 1.2);
      E.save?.();
      return 'MOTOR DURDU · Basınç 38 bar ve düşüyor · Vanayı basınç SIFIRA inince kapat';
    }
    if (S.pump6 === 1) {
      if (S.pumpP > 1) {
        S.pump6 = 3; S.spill6 = 1; detect6 = Math.max(detect6, 0.6);
        noiseBurst(1.4, 2400, 200, 0.3, 0.8); tone(70, 1.2, 'square', 0.1, 0.5); flash('255,140,60', 0.5);
        journal('SONDAJ SIVISI — HORTUM PATLADI', 'Vanayı basınç ' + Math.round(S.pumpP) + ' bar iken kapattım: su darbesi hortumu yırttı, kerosen tabana yayıldı. Basınç sıfıra inmeden kapatmamalıydım.');
        E.save?.(); checkDone6();
        return 'SU DARBESİ · Hortum patladı, kerosen yayıldı · Pompa durdu ama sızıntı var';
      }
      S.pump6 = 2; tone(196, 0.5, 'square', 0.07, 1.0);
      journal('SONDAJ SIVISI — POMPA DURDU', 'Motoru durdurdum, basınç sıfıra inince vanayı kapattım. Hat kuru; sıvı göle inmeyecek.');
      E.save?.(); checkDone6();
      return 'VANA KAPANDI · Pompa güvenle durdu · Matkap hattı kuru' + (A.state.ch6 ? '' : ' · ' + todo6());
    }
    return S.pump6 === 3 ? 'POMPA · Hortum patlak, kerosen tabanda' : 'POMPA · Durdu, vana kapalı';
  }
  function todo6() {
    const S = A.state, left = [];
    if (S.pump6 < 2) left.push('pompa');
    if (!S.relay6) left.push('röle');
    if (!S.soldier6) left.push('asker');
    return left.length ? 'Kalan: ' + left.join(', ') : '';
  }
  function relayAct() {
    const S = A.state;
    if (S.relay6) return 'UYDU RÖLESİ · Anten fişi çekili · Link kopuk';
    S.relay6 = 1; tone(660, 0.12, 'square', 0.06, 0.6); noiseBurst(0.6, 3000, 400, 0.15, 1.0);
    journal('UYDU RÖLESİ', 'Kampın bağlantısı Iridium üzerinden: bu enlemde jeostasyoner uydular ufkun altında kalıyor, alçak yörüngedeki Iridium ağı kutupları kapsıyor. Anten kablosunu çektim; kamp dünyayla konuşamıyor.');
    E.save?.(); checkDone6();
    return 'ANTEN FİŞİ ÇEKİLDİ · Kampın uydu bağlantısı kesildi' + (S.ch6 ? '' : ' · ' + todo6());
  }
  function soldierAct() {
    const S = A.state, p = E.player;
    if (S.soldier6) return 'ÇAVUŞ DAGAN · ' + (S.soldier6 === 'save' ? 'Battaniyeye sarılı, nefes alıyor' : 'Yalnız bırakıldı');
    choice('ÇAVUŞ DAGAN (kısık sesle): “Donuyorum… ısıtmaya yardım eder misin?” — Ne yapacaksın?',
      [['save', 'Isıt ve kurtar (vücut ısısı −30)'], ['leave', 'Bırak, sessiz kal']], (k) => {
        S.soldier6 = k;
        if (k === 'save') { p.warmth = Math.max(8, (p.warmth ?? 100) - 30); tone(262, 0.8, 'sine', 0.12, 1.2); }
        journal('ÇAVUŞ DAGAN', k === 'save' ? 'Battaniyemi ve vücut ısımı verdim. Koalisyon çavuşu Dagan, matkap vardiyasında kalmış, ekibi onu geride bırakmış. Konuşmaya başladı: “Bu göl bir sondaj hedefi değil, değil mi?”' : 'Sessiz kaldım ve yanından geçtim. Çavuş tek kelime etmedi.');
        E.save?.(); checkDone6();
        E.toast(k === 'save' ? 'ÇAVUŞ DAGAN KURTARILDI · Vücut ısın −30' : 'ÇAVUŞ BIRAKILDI · Sessizce uzaklaştın');
      });
    return null;
  }
  function campUpdate(p, dt) {
    const S = A.state;
    if (!S.inCamp) { if (detectEl) { detectEl.remove(); detectEl = null; } return; }
    if (S.pump6 === 1) S.pumpP = Math.max(0, S.pumpP - 38 / 4 * dt);
    // heat from the containers
    for (const L of world.lights) if (L.layer === 'camp' && L.name.startsWith('cont') && Math.hypot(L.x - p.x, L.z - p.z) < 4.5 && p.warmth !== undefined) p.warmth = Math.min(100, p.warmth + 5 * dt);
    const o = campOrigin(); if (!o) return;
    const range = detectRange(p.warmth, inCover(p.x, p.z));
    let worst = 0;
    DRONE_PATHS.forEach((_, i) => { const a = dronePos(i, o), d = Math.hypot(a[0] - p.x, a[1] - p.z); if (d < range) worst = Math.max(worst, 1 - d / range); });
    if (time < caughtUntil) worst = 0;
    if (worst > 0) detect6 += dt * (0.9 + worst * 1.4); else detect6 = Math.max(0, detect6 - dt * 0.6);
    if (detect6 > 0.5 && time - lastWarn6 > 1.5) { lastWarn6 = time; tone(880, 0.1, 'square', 0.05, 1.0); }
    if (detect6 >= 1) caught(p);
    if (!detectEl) {
      detectEl = document.createElement('div'); detectEl.id = 'a3dDetect';
      detectEl.style.cssText = 'position:fixed;left:50%;bottom:26%;transform:translateX(-50%);z-index:29000;pointer-events:none;width:200px;font:700 11px system-ui;color:#e8f6ff;text-align:center;text-shadow:0 1px 2px #000';
      detectEl.innerHTML = '<div id="a3dDetectT"></div><div style="height:7px;background:#0a1418cc;border:1px solid #8ac7d6;border-radius:4px;margin-top:3px"><div id="a3dDetectB" style="height:100%;width:0;border-radius:3px"></div></div>';
      document.body.appendChild(detectEl);
    }
    const t = detectEl.querySelector('#a3dDetectT'), b = detectEl.querySelector('#a3dDetectB');
    t.textContent = 'TERMAL İZ · menzil ' + range.toFixed(1) + ' m' + (inCover(p.x, p.z) ? ' (siperde)' : '');
    b.style.width = Math.min(100, detect6 * 100) + '%'; b.style.background = detect6 > 0.66 ? '#ff5a3c' : detect6 > 0.33 ? '#ffc04a' : '#6fd4ff';
  }
  function caught(p) {
    const S = A.state, sp = anchor('camp_spawn'); if (!sp) return;
    S.spot6++; detect6 = 0; caughtUntil = time + 3;
    p.x = sp.x; p.z = sp.z; p.yaw = 0; p.pitch = 0; p.spdX = 0; p.spdZ = 0; p.warmth = Math.max(0, (p.warmth ?? 100) - 8);
    flash('255,60,40', 0.8); tone(520, 0.8, 'sawtooth', 0.1, 0.5); noiseBurst(0.8, 2000, 300, 0.2, 0.8);
    if (!S.tutorial.caught) { S.tutorial.caught = 1; journal('TERMAL TESPİT', 'Bir dron beni gördü: ışık spotu üzerime kilitlendi, kaçıp tünele çekildim. Dron vücut ısısını sayıyor; sıcak olduğum sürece uzaktan görünüyorum. Soğuk kalmalı ve kar duvarlarının arkasından gitmeliyim.'); }
    E.save?.();
    E.toast('DRON SENİ GÖRDÜ · Tünele çekildin · Soğuk kal, siper kullan (' + S.spot6 + ')');
  }
  function ch6Goal(p) {
    const S = A.state;
    let text, id;
    if (!S.inCamp) {
      text = 'ÇEKİRDEKTEN KUZEY TÜNELİNE GİR';
      id = S.inGrid ? 'core' : S.inCity ? 'city_exit' : S.inHall ? 'vent' : 'glyph';
    } else if (S.pump6 < 2 && S.pump6 !== 3) { text = S.pump6 === 1 ? 'BASINÇ SIFIRA İNİNCE VANAYI KAPAT · ' + Math.round(S.pumpP) + ' bar' : 'SONDAJ SIVISI POMPASINI DURDUR'; id = 'pump'; }
    else if (!S.relay6) { text = 'UYDU RÖLESİNİN ANTEN FİŞİNİ ÇEK'; id = 'relay'; }
    else { text = 'DONAN ASKER İÇİN KARAR VER'; id = 'soldier'; }
    const a = anchor(id);
    return { text, d: a ? Math.hypot(a.x - p.x, a.z - p.z) : 0, ch: 6 };
  }

  /* ------------------------------------------------------------ chapter 7: 03:17 */
  // August, first sun. The Helikons prepare to split the coastal ice shelf (a sea-level threat) and the coalition
  // evacuates. The 03:17 recording turns out to be the player's own voice: the tower's crystal resonance carries a
  // signal 72 hours back. At the tower the transmission must start when the tower's clock reads 03:17. The ending
  // depends on goodwill earned earlier (rescued soldier, no spill, balanced load, rarely spotted); a treaty
  // outcome needs 3 of 4 — Antarctic Treaty decisions are taken by consensus, trust is the currency.
  const ENDINGS7 = {
    antlasma: ['ANTLAŞMA', 'Uplink’ten Antarktika Antlaşması Danışma Toplantısı’na canlı bağlandın ve 03:17 kaydını tüm tarafların önünde oynattın. Konsensüs gerektiren karar saatler sürdü; sonunda Helikon havzası, Madrid Protokolü’nün Ek V’i kapsamında “özel korunan alan” ilan edildi: sondaj durdu, ortak bir bilim komisyonu kuruldu, kıyı sahanlığı yarılmadı. Kimse silah çekmedi. Kaan ve Selin, kristal sözlüğü birlikte yazmaya başladı.'],
    muhur: ['MÜHÜR', 'Kristal kule ışığını söndürdü; Helikonlar şehri 4 km buzun altına gömdü ve tüneller içe çöktü. Koalisyon kampını boşalttı, dünya olanları “sondaj kazası” diye öğrendi. Kıyı sahanlığı yarılmadı ama kimse nedenini bilmiyor. Günlüğün tek tanık; Kaan ve Selin sana sessizce el salladı.'],
    dongu: ['DÖNGÜ', 'Yayını gönderdin: kristallerin rezonansı kaydı 72 saat geriye taşıdı. Telsizdeki ses senin sesindi; 03:17 kaydını yapan hep sendin. Işık beyaza döndü ve kendini istasyonun önünde, ilk gecede buldun. Ana menüden yeni oyun başlattığında günlüğünde “déjà vu” notları olacak.'],
  };
  const ENDINGS_KEY = 'antarktika_endings';
  function endingsSeen() { try { return JSON.parse(localStorage.getItem(ENDINGS_KEY) || '[]'); } catch (e) { return []; } }
  function rememberEnding(key) { try { const l = endingsSeen(); if (!l.includes(key)) { l.push(key); localStorage.setItem(ENDINGS_KEY, JSON.stringify(l)); } return l.length; } catch (e) { return 1; } }
  let clock7 = null, clockEl = null;
  const clockMin = () => 190 + ((time - clock7.t0) * 1) % 14;   // one in-game minute per second, 03:10 → 03:24
  const clockText = (m) => { const mm = Math.floor(m) - 180; return '03:' + (mm < 10 ? '0' : '') + mm; };
  const goodwill = () => { const S = A.state; return [S.soldier6 === 'save', !S.spill6, S.load5 !== 'tam', S.spot6 <= 1].filter(Boolean).length; };

  // Main-menu endings gallery: which of the three endings this device has seen (localStorage).
  const ENDING_HINTS = {
    antlasma: 'Güven puanı en az 3/4 iken kuleden ATCM’ye bağlan.',
    muhur: 'Kulede şehrin buzun altına gömülmesine izin ver.',
    dongu: 'Kulede yayını 72 saat geriye gönder.',
  };
  function endingsButton() {
    const q = document.getElementById('qualityBtn'); if (!q) return;
    let b = document.getElementById('endingsBtn');
    if (!b) {
      b = document.createElement('button'); b.id = 'endingsBtn'; b.type = 'button';
      const cs = getComputedStyle(q);
      for (const k of ['font', 'letterSpacing', 'color', 'background', 'border', 'borderRadius', 'padding', 'minHeight', 'marginTop', 'marginLeft', 'marginRight', 'cursor', 'textTransform', 'pointerEvents']) b.style[k] = cs[k];
      b.addEventListener('click', (ev) => { ev.stopPropagation(); endingsGallery(); });
      q.after(b);
    }
    b.textContent = 'SONLAR · ' + endingsSeen().length + '/3';
  }
  function endingsGallery() {
    const seen = endingsSeen();
    let el = document.getElementById('a3dEndings');
    if (!el) { el = document.createElement('div'); el.id = 'a3dEndings'; document.body.appendChild(el); }
    el.style.cssText = 'position:fixed;inset:0;z-index:30002;display:flex;align-items:center;justify-content:center;background:#010608ee;color:#e6fbff;font:500 13px/1.5 system-ui;padding:20px;overflow:auto';
    el.innerHTML = '';
    const box = document.createElement('div'); box.style.cssText = 'max-width:900px;width:100%;text-align:center';
    const h = document.createElement('div'); h.textContent = 'SONLAR · ' + seen.length + '/3'; h.style.cssText = 'font:800 22px system-ui;letter-spacing:4px;margin-bottom:14px';
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;justify-content:center';
    for (const key of ['antlasma', 'muhur', 'dongu']) {
      const open = seen.includes(key), c = document.createElement('div');
      c.className = 'a3dEndingCard'; c.dataset.key = key; c.dataset.open = open ? '1' : '0';
      c.style.cssText = 'flex:1 1 240px;max-width:290px;border:1px solid ' + (open ? '#ffd3a3aa' : '#5c7c8866') + ';border-radius:8px;padding:12px;background:' + (open ? '#0d2a38' : '#06141c') + ';text-align:left';
      const t = document.createElement('div'); t.textContent = open ? ENDINGS7[key][0] : '? ? ?'; t.style.cssText = 'font:800 15px system-ui;letter-spacing:3px;color:' + (open ? '#ffd3a3' : '#7d97a2') + ';margin-bottom:6px';
      const p = document.createElement('div'); p.textContent = open ? ENDINGS7[key][1] : 'Kilitli · ' + ENDING_HINTS[key]; p.style.cssText = 'font-size:12px;color:' + (open ? '#cfe9f2' : '#7d97a2');
      c.append(t, p); row.appendChild(c);
    }
    const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = 'KAPAT';
    btn.style.cssText = 'margin-top:16px;min-height:44px;padding:8px 26px;border-radius:8px;border:1px solid #b7e7ef99;background:#0d3346;color:#fff;font:700 13px system-ui;pointer-events:auto';
    btn.addEventListener('click', () => el.remove());
    box.append(h, row, btn); el.appendChild(box);
  }
  function spire7() {
    const S = A.state;
    if (!S.tutorial.reveal7) {
      S.tutorial.reveal7 = 1;
      journal('03:17 — KAYDI YAPAN', 'Kule, kayıtla aynı frekansta titreşiyor. Telsizdeki ses… benim sesim. “Sinyali kapatmayın” cümlesini ben söyleyeceğim; kristal rezonansı bu sözü 72 saat geriye taşıyor. Kulenin saati 03:17’yi gösterdiği anda yayını başlatmalıyım.');
    }
    if (!clock7) { clock7 = { t0: time }; tone(196, 0.8, 'sine', 0.12, 1.02); return 'KRİSTAL KULE · Kayıt başlıyor · Saat 03:17’yi gösterirken tekrar E (yayını başlat)'; }
    const m = clockMin();
    if (Math.abs(m - 197) <= 0.9) {
      clock7 = null;
      const good = goodwill();
      const opts = [];
      if (good >= 3) opts.push(['antlasma', 'Antlaşma — ATCM’ye canlı bağlan']);
      opts.push(['muhur', 'Mühür — şehri buzun altına bırak']);
      opts.push(['dongu', 'Döngü — yayını 72 saat geriye gönder']);
      choice('KRİSTAL KULE · Saat 03:17. Yayın hazır. Güven puanın ' + good + '/4' + (good >= 3 ? '.' : ' — ATCM’yi ikna etmeye yetmiyor (en az 3 gerek: askeri kurtar, sızıntı olmasın, yükü tam çekme, az yakalan).') + ' Ne yapacaksın?', opts, finale7);
      return null;
    }
    clock7 = { t0: time }; tone(150, 0.4, 'square', 0.06, 0.7);
    return 'SAAT ' + clockText(m) + ' · ' + (m < 197 ? 'erken' : 'geç') + ' · Kule saati yeniden başlıyor · 03:17’de E';
  }
  function finale7(key) {
    const S = A.state;
    S.ch7 = true; S.ending7 = key; clock7 = null;
    const n = rememberEnding(key); endingsButton();
    tone(key === 'muhur' ? 82 : key === 'dongu' ? 392 : 262, 3.4, 'sine', 0.2, key === 'muhur' ? 0.5 : 1.6); flash(key === 'dongu' ? '255,255,255' : key === 'muhur' ? '20,40,60' : '255,230,170', 0.95);
    journal('BÖLÜM 7 — 03:17 · SON: ' + ENDINGS7[key][0], ENDINGS7[key][1]);
    E.save?.();
    showCard('BÖLÜM 7 · 03:17', ENDINGS7[key][0], ENDINGS7[key][1], 'ANTARKTIKA: WHITEOUT — SON · Açılan sonlar: ' + n + '/3');
  }
  function clockUpdate(p) {
    const S = A.state, sp = S.inCity ? anchor('spire') : null;
    if (clock7 && !(sp && Math.hypot(p.x - sp.x, p.z - sp.z) < 8)) clock7 = null;   // walking away resets the tower clock
    if (!clock7) { if (clockEl) { clockEl.remove(); clockEl = null; } return; }
    if (!clockEl) {
      clockEl = document.createElement('div'); clockEl.id = 'a3dClock';
      clockEl.style.cssText = 'position:fixed;left:50%;bottom:24%;transform:translateX(-50%);z-index:29000;pointer-events:none;font:800 34px system-ui;letter-spacing:3px;text-shadow:0 0 12px #5fd0ff,0 1px 2px #000;text-align:center';
      document.body.appendChild(clockEl);
    }
    const m = clockMin();
    clockEl.textContent = clockText(m); clockEl.style.color = Math.abs(m - 197) <= 0.9 ? '#9dffb4' : '#cfefff';
  }
  function ch7Goal(p) {
    const S = A.state;
    let text, id;
    if (!S.inCity) {
      text = 'KRİSTAL KULEYE GİT · AĞUSTOS';
      id = S.inCamp ? 'camp_exit' : S.inGrid ? 'grid_exit' : S.inHall ? 'gate4' : 'glyph';
    } else { text = clock7 ? 'KULE SAATİ 03:17’Yİ GÖSTERİRKEN E' : 'KRİSTAL KULEYİ DİNLE · 03:17'; id = 'spire'; }
    const a = anchor(id);
    return { text, d: a ? Math.hypot(a.x - p.x, a.z - p.z) : 0, ch: 7 };
  }
  function enterHall() {
    const S = A.state, sp = anchor('hall_spawn'), p = E.player; if (!sp) return null;
    S.inHall = true; p.x = sp.x; p.z = sp.z; p.yaw = 0; p.pitch = 0; p.spdX = 0; p.spdZ = 0;
    A.zone = zoneAt(p.x, p.z);
    flash('170,235,255', 0.9); tone(147, 2.2, 'sine', 0.18, 2.0); noiseBurst(1.6, 200, 60, 0.15, 1.8);
    if (!S.tutorial.hall) {
      S.tutorial.hall = 1;
      journal('BÖLÜM 3 — HELIKON KAPISI', 'İşaret duvarı açıldı ve beni buzun 30 metre altına indirdi. Taş sütunlar, beş stel, ortada bir yıldız haritası. Burası insanlıktan eski. Hava −41°C: ısı kuyusundan uzak kalmamalıyım.');
    }
    E.save?.();
    return 'BÖLÜM 3 · HELIKON KAPISI · Salon çok soğuk: ısı kuyusunda ısın';
  }
  function exitHall() {
    const S = A.state, g = anchor('glyph'), p = E.player; if (!g) return null;
    S.inHall = false; p.x = g.x; p.z = g.z + 2.2; p.yaw = Math.PI; p.pitch = 0; p.spdX = 0; p.spdZ = 0;
    A.zone = zoneAt(p.x, p.z);
    flash('170,235,255', 0.7); tone(220, 1.2, 'sine', 0.12, 0.6);
    E.save?.();
    return 'BUZ MAĞARASI · Kapı arkanda açık kaldı';
  }
  function hallPressure() { return !A.ready ? 0 : A.state.inCamp ? 0.14 : A.state.inGrid ? (time < blackoutUntil ? 0.35 : 0) : A.state.inHall ? 0.3 : A.state.inCity ? 0.04 : 0; }
  function steleText(i) { const d = STELES[i]; return 'TAŞ STEL ' + (i + 1) + ' · ' + d.name + ' TAKIMYILDIZI · Saat işareti ' + d.time; }
  function readStele(i) {
    const S = A.state;
    if (!S.steles[i]) {
      S.steles[i] = 1;
      journal('STEL ' + (i + 1) + ' — ' + STELES[i].name, 'Taşın tepesinde ' + (i + 3) + ' yıldızlı bir takımyıldız, ayağında bir saat işareti: ' + STELES[i].time + '.');
    }
  }
  function lightStele(i) {
    const S = A.state, p = E.player;
    if (S.stars.includes(i)) return steleText(i) + ' · YANIYOR';
    const want = STAR_ORDER[S.stars.length];
    if (i === want) {
      S.stars.push(i); tone([392, 466, 523, 659][S.stars.length - 1], 1.1, 'sine', 0.15, 1.01); flash('150,230,255', 0.35);
      if (S.stars.length === 4) {
        S.ch3 = true; tone(98, 3.0, 'sine', 0.22, 2.0); flash('255,215,140', 0.8);
        journal('BÖLÜM 3 — YILDIZ HARİTASI', 'Dört yıldız yandı: 02:58, 03:06, 03:12, 03:17. 03:41 karanlık kaldı — o saat daha gelmedi. Salonun sonundaki üç halkalı kapı uyandı. Kaan: “Üç cevap var. Hangisini seçeceğin senin işin.”');
        E.save?.();
        return 'YILDIZ HARİTASI TAMAMLANDI · ÜÇ CEVAP KAPISI uyandı · BÖLÜM 3 TAMAMLANDI';
      }
      E.save?.();
      return STELES[i].name + ' YANDI · ' + S.stars.length + '/4 yıldız';
    }
    S.stars = []; p.warmth = Math.max(0, (p.warmth ?? 100) - 12);
    noiseBurst(1.2, 160, 70, 0.3, 1.2); tone(98, 1.0, 'sawtooth', 0.09, 0.6); flash('120,170,255', 0.6);
    if (i === 2) return 'HENÜZ OLMADI · 03:41 gelecekte · Harita söndü, soğuk dalgası';
    return 'YANLIŞ SAAT · Harita söndü, soğuk dalgası · Sıra o gecenin saatleri';
  }
  function choice(question, options, cb) {   // options: [[value, label], ...]; keys 1..n also pick
    let el = document.getElementById('a3dChoice');
    if (!el) {
      el = document.createElement('div'); el.id = 'a3dChoice';
      el.style.cssText = 'position:fixed;left:50%;bottom:18%;transform:translateX(-50%);z-index:30000;display:flex;flex-direction:column;gap:8px;align-items:center;padding:12px 14px;background:#061c28e6;border:1px solid #8ac7d6;border-radius:8px;color:#e6fbff;font:600 13px system-ui;max-width:min(560px,90vw);text-align:center';
      document.body.appendChild(el);
    }
    document.exitPointerLock?.();   // desktop: free the cursor so the buttons can be clicked (1/2 keys also work)
    el.innerHTML = ''; const q = document.createElement('div'); q.textContent = question; el.appendChild(q);
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;justify-content:center'; el.appendChild(row);
    const done = (k) => { el.remove(); removeEventListener('keydown', onKey, true); cb(k); };
    const onKey = (ev) => { const i = +ev.key - 1; if (i >= 0 && i < options.length) { ev.stopPropagation(); done(options[i][0]); } };
    options.map(([k, t], i) => [k, (i + 1) + ' · ' + t]).forEach(([k, t]) => {
      const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = t;
      btn.style.cssText = 'min-height:44px;padding:8px 16px;border-radius:8px;border:1px solid #b7e7ef99;background:#0d3346;color:#fff;font:700 12px system-ui;pointer-events:auto';
      btn.addEventListener('click', () => done(k)); row.appendChild(btn);
    });
    addEventListener('keydown', onKey, true);
  }
  function talkKaan() {
    const S = A.state;
    if (!S.kaanFree) {
      if (S.heatCell === 1) {
        S.heatCell = 2; S.kaanFree = true; tone(196, 1.6, 'sine', 0.14, 1.5); noiseBurst(1.4, 600, 1500, 0.18, 1.4); flash('255,170,90', 0.6);
        journal('KAAN ÇÖZÜLDÜ', 'Isı hücresi buzu bir dakikada eritti. Kaan Erdem, HELIKON-14 mühendisi. Selin’le birlikte aşağı inmiş. Saatin 03:17 olduğunu sanıyor.');
        E.save?.();
        return 'ISI HÜCRESİ BUZU ERİTTİ · Kaan nefes alıyor · E ile konuş';
      }
      if (!S.kaanSeen) {
        S.kaanSeen = true;
        journal('BUZDAKİ ADAM', 'Buzun içinde turuncu bir tulum: HELIKON-14. Göğsü çok yavaş inip kalkıyor. Buzu eritmek için ısı lazım — istasyon jeneratörünün yedek ISI HÜCRESİ işe yarar.');
        E.save?.();
      }
      return 'BUZDAKİ ADAM · Hâlâ nefes alıyor · Jeneratörün yedek ISI HÜCRESİNİ getir';
    }
    if (S.kaanTalk < KAAN_LINES.length) { const l = KAAN_LINES[S.kaanTalk++]; tone(330, 0.15, 'triangle', 0.05, 1.0); return l; }
    if (!S.kaanTrust) {
      choice('KAAN: “Selin’e güveniyor musun? Kaydın sonundaki ses senindi.”', [[1, 'Selin’e güveniyorum'], [-1, 'Selin bir şey saklıyor']], (k) => {
        S.kaanTrust = k; E.save?.();
        E.toast(k > 0 ? 'KAAN: “İyi. O zaman sırayla: en erken saatten 03:17’ye. Sonrasına dokunma.”' : 'KAAN: “Ben de öyle düşünüyorum. Saatleri en erkenden 03:17’ye yak — sonrasına dokunma.”');
        journal('KAAN — KURAL', 'Stelleri o gecenin saatlerine göre, en erkenden 03:17’ye kadar yak. 03:17’den sonraki saat henüz yaşanmadı; ona dokunma. (Q: stelin saatini okur, E: yakar)');
      });
      return null;
    }
    return S.ch3 ? 'KAAN: “Kapı uyandı. Üç cevap var: susmak, cevap vermek, geçmek.”' : 'KAAN: “En erken saatten 03:17’ye. Q ile stelleri oku, E ile yak.”';
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
      try { endingsButton(); } catch (e) { /* menu not present */ }
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
    chapter2Pressure,
    hallPressure,
    endingsGallery, endingsButton, syncAngle, clockMinutes: () => (clock7 ? clockMin() : null), dronePos: (i) => { const o = campOrigin(); return o ? dronePos(i, o) : null; }, detectRange: (warm, cover) => detectRange(warm, cover),
    snowFactor() { return A.zone === 'indoor' || A.zone === 'hall' || A.zone === 'city' || A.zone === 'grid' || A.zone === 'camp' ? 0 : A.zone === 'cave' ? 0.15 : 1; },
    serialize() { return JSON.parse(JSON.stringify(A.state)); },
    restore(s) { if (!s) return; Object.assign(A.state, s, { tutorial: s.tutorial || {}, bb: s.bb || [0, 0, 0, 0], bbSeen: s.bbSeen || [0, 0, 0, 0], ch2: !!s.ch2, inHall: !!s.inHall, ch3: !!s.ch3, kaanSeen: !!s.kaanSeen, kaanFree: !!s.kaanFree, kaanTalk: s.kaanTalk | 0, kaanTrust: s.kaanTrust | 0, heatCell: s.heatCell | 0, steles: s.steles || [0, 0, 0, 0, 0], stars: s.stars || [], inCity: !!s.inCity, ch4: !!s.ch4, syms: s.syms || [0, 0, 0, 0, 0, 0], stones: s.stones || [0, 0, 0], bridge: !!s.bridge, voice: s.voice | 0, ending4: s.ending4 || '', inGrid: !!s.inGrid, plane5: s.plane5 | 0, left5: s.left5 | 0, cable5: s.cable5 | 0, dials: s.dials || [2, 0, 1], grid5: !!s.grid5, ch5: !!s.ch5, load5: s.load5 || '', inCamp: !!s.inCamp, pump6: s.pump6 | 0, pumpP: s.pumpP ?? 38, relay6: s.relay6 | 0, soldier6: s.soldier6 || '', spill6: s.spill6 | 0, spot6: s.spot6 | 0, ch6: !!s.ch6, ch7: !!s.ch7, ending7: s.ending7 || '' }); sync5 = null; blackoutUntil = 0; detect6 = 0; caughtUntil = 0; clock7 = null; if (A.state.power) startHum(); },
    resetState() { if (staticNode) staticNode.gain.value = 0; A.state = { power: false, freqIndex: -1, freqSolved: false, crystals: 0, caveSolved: false, labRead: false, artifact: false, drill: false, glyphRead: false, bb: [0, 0, 0, 0], bbSeen: [0, 0, 0, 0], ch2: false, inHall: false, ch3: false, kaanSeen: false, kaanFree: false, kaanTalk: 0, kaanTrust: 0, heatCell: 0, steles: [0, 0, 0, 0, 0], stars: [], inCity: false, ch4: false, syms: [0, 0, 0, 0, 0, 0], stones: [0, 0, 0], bridge: false, voice: 0, ending4: '', inGrid: false, plane5: 0, left5: 0, cable5: 0, dials: [2, 0, 1], grid5: false, ch5: false, load5: '', inCamp: false, pump6: 0, pumpP: 38, relay6: 0, soldier6: '', spill6: 0, spot6: 0, ch6: false, ch7: false, ending7: '', tutorial: {} }; },
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
