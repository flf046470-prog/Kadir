// Shared core: math helpers, the single mutable game context `G`, static
// collision, swept body movement and ray casting. Every other module imports
// from here; nothing in this file imports another game module.
import * as THREE from 'three';

export { THREE };
export const V3 = THREE.Vector3;

// ---------------------------------------------------------------- math
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
/** Frame-rate independent exponential approach of `a` toward `b`. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export function dampAngle(a, b, lambda, dt) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * (1 - Math.exp(-lambda * dt));
}
/** GLSL-style smoothstep; also valid with a > b (reversed edge). */
export const ss = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ---------------------------------------------------------------- settings
const DEFAULT_SETTINGS = { sens: 1.0, fov: 78, quality: 'high', volume: 0.8, announcer: true };

function loadSettings() {
  const s = { ...DEFAULT_SETTINGS };
  try {
    Object.assign(s, JSON.parse(localStorage.getItem('bzh-settings') || '{}'));
  } catch (e) { /* storage unavailable: defaults */ }
  return s;
}

export function saveSettings() {
  try { localStorage.setItem('bzh-settings', JSON.stringify(G.settings)); } catch (e) { /* ignore */ }
}

export function loadBest() {
  try { return JSON.parse(localStorage.getItem('bzh-best') || 'null') || { wave: 0, score: 0 }; } catch (e) { return { wave: 0, score: 0 }; }
}

export function saveBest(best) {
  try { localStorage.setItem('bzh-best', JSON.stringify(best)); } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- context
export function freshState() {
  return {
    state: 'loading', // 'loading' | 'menu' | 'playing' | 'paused' | 'dead'
    wave: 0,
    money: 800,
    score: 0,
    kills: 0,
    headshots: 0,
    shots: 0,
    hits: 0,
    streak: 0,
    bestStreak: 0,
    intermission: false,
    intermissionT: 0,
    buyOpen: false,
    toSpawn: [],
    spawnT: 0,
    uavT: 0,
    airstrikes: 0,
    nukeReady: false,
    nukeUsed: false,
    lastKillT: -99,
    multiKill: 0,
    // post-processing drivers (decay toward 0 in main.js)
    redFlash: 0,
    flash: 0,
    aberr: 0,
    slowmoT: 0,
    deathT: 0,
    prompt: '', // cleared by main.js at the start of every frame
  };
}

export function freshPlayer() {
  return {
    pos: new V3(0, 0, 30),
    vel: new V3(),
    yaw: 0,
    pitch: 0,
    r: 0.38,
    h: 1.8,
    onGround: false,
    crouch: 0, // 0 standing .. 1 crouched
    health: 100,
    armor: 0,
    lastHit: -99,
    sliding: 0, // seconds of slide left
    slideDir: new V3(),
    sprinting: false,
    moving: false,
    eye: new V3(0, 1.65, 30), // world eye position, written by player.js
    bobT: 0,
    shake: 0,
    recoil: { p: 0, y: 0 }, // recoverable recoil accumulator (radians)
    grenades: 2,
    dead: false,
  };
}

export const G = {
  // set by main.js
  renderer: null,
  scene: null,
  camera: null,
  wScene: null, // viewmodel scene, rendered over the world with cleared depth
  wCam: null,
  // set by textures.js (buildMaterials)
  M: null, // materials
  T: null, // textures (decals, sprites)
  // set by level.js
  sunDir: new V3(-0.55, 0.42, 0.72).normalize(),
  spawnPoints: [], // V3[] enemy spawn spots on the floor
  playerSpawn: { pos: new V3(0, 0, 30), yaw: 0 },
  propSpots: [], // { type: 'crate' | 'barrel', pos: V3 }
  mapRects: [], // { x0, z0, x1, z1 } footprints for the radar
  // live world
  statics: [], // { mn:[x,y,z], mx:[x,y,z], surf, noRay, noCollide }
  props: [],
  enemies: [],
  pickups: [],
  // state
  settings: loadSettings(),
  S: freshState(),
  player: freshPlayer(),
  W: { cur: 'rifle', name: 'KR-47', mag: 30, res: 120, reloading: false, spread: 0, ads: 0, held: null },
  BUY: [], // filled by game.js
  input: {
    keys: {}, // e.code -> held
    pressed: {}, // e.code -> pressed this frame (cleared each frame)
    mouse: { left: false, right: false, leftPressed: false, rightPressed: false, dx: 0, dy: 0, wheel: 0 },
    locked: false,
  },
  time: 0, // game time (scaled by timeScale)
  rtime: 0, // real time
  timeScale: 1,
  debug: /[?&]debug=1/.test(location.search),
};

// ---------------------------------------------------------------- statics
export const SURF = ['concrete', 'metal', 'wood', 'sand', 'flesh'];

/** Register an axis-aligned static collider. mn/mx are [x,y,z] arrays. */
export function addStatic(mn, mx, surf = 'concrete', opts = {}) {
  const b = { mn, mx, surf, noRay: !!opts.noRay, noCollide: !!opts.noCollide };
  G.statics.push(b);
  return b;
}

/** AABB of a prop written into the given arrays. */
export function propBounds(pr, mn, mx) {
  mn[0] = pr.pos.x - pr.half[0]; mn[1] = pr.pos.y - pr.half[1]; mn[2] = pr.pos.z - pr.half[2];
  mx[0] = pr.pos.x + pr.half[0]; mx[1] = pr.pos.y + pr.half[1]; mx[2] = pr.pos.z + pr.half[2];
}

function ovl(p, r, h, mn, mx) {
  return p.x + r > mn[0] && p.x - r < mx[0] && p.z + r > mn[2] && p.z - r < mx[2] && p.y + h > mn[1] && p.y < mx[1];
}

const _pmn = [0, 0, 0];
const _pmx = [0, 0, 0];

function eachBox(useProps, skip, fn) {
  const st = G.statics;
  for (let i = 0; i < st.length; i++) {
    const b = st[i];
    if (!b.noCollide) fn(b.mn, b.mx);
  }
  if (!useProps) return;
  const ps = G.props;
  for (let i = 0; i < ps.length; i++) {
    const pr = ps[i];
    if (pr.dead || pr.held || !pr.solid || pr === skip) continue;
    propBounds(pr, _pmn, _pmx);
    fn(_pmn, _pmx);
  }
}

export const STEP = 0.45;

/**
 * Move a vertical-cylinder body (approximated as an AABB of half-width r,
 * height h, feet at pos.y) through the world, axis by axis.
 * body: { pos: V3, vel?: V3, r, h, onGround }
 * opts: { props = true, skipProp = null, noSnap = false }
 * Returns bit flags: 1 = blocked on X, 2 = blocked on Z, 4 = hit ceiling.
 * Steps up ledges <= STEP when grounded and snaps down small drops.
 */
export function moveBody(body, dx, dy, dz, opts = {}) {
  const p = body.pos;
  const r = body.r;
  const h = body.h;
  const useProps = opts.props !== false;
  const skip = opts.skipProp || null;
  const wasGround = body.onGround;
  let hit = 0;

  if (dx) {
    p.x += dx;
    eachBox(useProps, skip, (mn, mx) => {
      if (!ovl(p, r, h, mn, mx)) return;
      const rise = mx[1] - p.y;
      if (wasGround && rise > 0 && rise <= STEP) { p.y = mx[1]; return; }
      p.x = dx > 0 ? mn[0] - r - 1e-4 : mx[0] + r + 1e-4;
      hit |= 1;
    });
  }
  if (dz) {
    p.z += dz;
    eachBox(useProps, skip, (mn, mx) => {
      if (!ovl(p, r, h, mn, mx)) return;
      const rise = mx[1] - p.y;
      if (wasGround && rise > 0 && rise <= STEP) { p.y = mx[1]; return; }
      p.z = dz > 0 ? mn[2] - r - 1e-4 : mx[2] + r + 1e-4;
      hit |= 2;
    });
  }

  body.onGround = false;
  p.y += dy;
  eachBox(useProps, skip, (mn, mx) => {
    if (!ovl(p, r, h, mn, mx)) return;
    if (dy <= 0) {
      p.y = mx[1];
      body.onGround = true;
      if (body.vel && body.vel.y < 0) body.vel.y = 0;
    } else {
      p.y = mn[1] - h - 1e-4;
      if (body.vel && body.vel.y > 0) body.vel.y = 0;
      hit |= 4;
    }
  });

  // Snap down onto ground just below (stairs, small drops) while walking.
  if (!body.onGround && wasGround && dy <= 0 && !opts.noSnap) {
    let best = -Infinity;
    const y0 = p.y;
    eachBox(useProps, skip, (mn, mx) => {
      if (p.x + r > mn[0] && p.x - r < mx[0] && p.z + r > mn[2] && p.z - r < mx[2]) {
        if (mx[1] <= y0 + 1e-3 && mx[1] >= y0 - 0.36 && mx[1] > best) best = mx[1];
      }
    });
    if (best > -Infinity) {
      p.y = best;
      body.onGround = true;
      if (body.vel && body.vel.y < 0) body.vel.y = 0;
    }
  }
  return hit;
}

/** True if a body at pos with radius r and height h overlaps any collider. */
export function bodyBlocked(pos, r, h, opts = {}) {
  let blocked = false;
  eachBox(opts.props !== false, opts.skipProp || null, (mn, mx) => {
    if (!blocked && ovl(pos, r, h, mn, mx)) blocked = true;
  });
  return blocked;
}

// ---------------------------------------------------------------- rays
let _ax = -1;
let _sg = 0;

/** Slab test. O, D are [x,y,z]. Returns entry t or -1 (also -1 if O is inside). */
export function rayAABB(O, D, mn, mx, maxT) {
  let tmin = 0;
  let tmax = maxT;
  let ax = -1;
  let sg = 0;
  for (let a = 0; a < 3; a++) {
    const o = O[a];
    const d = D[a];
    if (d > -1e-9 && d < 1e-9) {
      if (o < mn[a] || o > mx[a]) return -1;
      continue;
    }
    const inv = 1 / d;
    let t1 = (mn[a] - o) * inv;
    let t2 = (mx[a] - o) * inv;
    let s = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
    if (t1 > tmin) { tmin = t1; ax = a; sg = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (ax < 0) return -1;
  _ax = ax;
  _sg = sg;
  return tmin;
}

/** Ray vs sphere. Returns t >= 0 or -1. Origin inside returns 0. */
export function raySphere(O, D, cx, cy, cz, r, maxT) {
  const lx = O[0] - cx;
  const ly = O[1] - cy;
  const lz = O[2] - cz;
  const b = lx * D[0] + ly * D[1] + lz * D[2];
  const c = lx * lx + ly * ly + lz * lz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  let t = -b - sq;
  if (t < 0) {
    if (-b + sq < 0) return -1;
    t = 0;
  }
  return t <= maxT ? t : -1;
}

/** Hit volumes of an enemy, shared by bullets, melee and splash checks. */
export const HIT = {
  crawler: { cy: 0.35, r: 0.42 },
  headR: 0.17,
  bodyHalf: 0.3,
  bodyTop: 1.52,
  legsTop: 0.85,
};

export function enemyHeadY(e) {
  return e.pos.y + (e.headY || 1.66);
}

/**
 * Cast a ray through the world.
 * opts: { statics = true, props = true, enemies = true, exclude = null (Set of props/enemies) }
 * Returns null or { type: 'world'|'prop'|'enemy', t, point: V3, normal: V3,
 *   surf, prop, enemy, part: 'head'|'body'|'legs' }.
 */
export function castRay(origin, dir, maxDist, opts = {}) {
  const O = [origin.x, origin.y, origin.z];
  const D = [dir.x, dir.y, dir.z];
  const ex = opts.exclude || null;
  let bt = maxDist;
  let type = null;
  let surf = 'concrete';
  let obj = null;
  let part = null;
  let nAx = -1;
  let nSg = 0;
  let sphere = null;

  if (opts.statics !== false) {
    const st = G.statics;
    for (let i = 0; i < st.length; i++) {
      const b = st[i];
      if (b.noRay) continue;
      const t = rayAABB(O, D, b.mn, b.mx, bt);
      if (t >= 0 && t < bt) {
        bt = t; type = 'world'; surf = b.surf; obj = null; nAx = _ax; nSg = _sg; sphere = null;
      }
    }
  }
  if (opts.props !== false) {
    const ps = G.props;
    for (let i = 0; i < ps.length; i++) {
      const pr = ps[i];
      if (pr.dead || (ex && ex.has(pr))) continue;
      propBounds(pr, _pmn, _pmx);
      const t = rayAABB(O, D, _pmn, _pmx, bt);
      if (t >= 0 && t < bt) {
        bt = t; type = 'prop'; surf = pr.surf || 'wood'; obj = pr; nAx = _ax; nSg = _sg; sphere = null;
      }
    }
  }
  if (opts.enemies !== false) {
    const es = G.enemies;
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      if (e.dead || (ex && ex.has(e))) continue;
      const p = e.pos;
      if (e.kind === 'crawler') {
        const cy = p.y + HIT.crawler.cy;
        const t = raySphere(O, D, p.x, cy, p.z, HIT.crawler.r, bt);
        if (t >= 0 && t < bt) {
          bt = t; type = 'enemy'; surf = 'flesh'; obj = e; part = 'body'; sphere = [p.x, cy, p.z];
        }
        continue;
      }
      const hy = enemyHeadY(e);
      const th = raySphere(O, D, p.x, hy, p.z, HIT.headR, bt);
      if (th >= 0 && th < bt) {
        bt = th; type = 'enemy'; surf = 'flesh'; obj = e; part = 'head'; sphere = [p.x, hy, p.z];
      }
      _pmn[0] = p.x - HIT.bodyHalf; _pmn[1] = p.y; _pmn[2] = p.z - HIT.bodyHalf;
      _pmx[0] = p.x + HIT.bodyHalf; _pmx[1] = p.y + HIT.bodyTop; _pmx[2] = p.z + HIT.bodyHalf;
      const tb = rayAABB(O, D, _pmn, _pmx, bt);
      if (tb >= 0 && tb < bt) {
        bt = tb; type = 'enemy'; surf = 'flesh'; obj = e; nAx = _ax; nSg = _sg; sphere = null;
        const hitY = O[1] + D[1] * tb;
        part = hitY < p.y + HIT.legsTop ? 'legs' : 'body';
      }
    }
  }
  if (!type) return null;

  const point = new V3(O[0] + D[0] * bt, O[1] + D[1] * bt, O[2] + D[2] * bt);
  const normal = new V3();
  if (sphere) {
    normal.set(point.x - sphere[0], point.y - sphere[1], point.z - sphere[2]);
    if (normal.lengthSq() < 1e-8) normal.set(-D[0], -D[1], -D[2]);
    normal.normalize();
  } else if (nAx >= 0) {
    normal.setComponent(nAx, nSg);
  } else {
    normal.set(-D[0], -D[1], -D[2]);
  }
  return {
    type,
    t: bt,
    point,
    normal,
    surf,
    prop: type === 'prop' ? obj : null,
    enemy: type === 'enemy' ? obj : null,
    part: type === 'enemy' ? part : null,
  };
}

const _ld = new V3();
/** Line of sight between two points against statics and props (not enemies). */
export function losClear(a, b) {
  _ld.subVectors(b, a);
  const dist = _ld.length();
  if (dist < 1e-4) return true;
  _ld.multiplyScalar(1 / dist);
  const h = castRay(a, _ld, dist, { enemies: false });
  return !h || h.t >= dist - 0.05;
}

/** Highest walkable surface under (x, z) at or below y (for decals, drops). */
export function groundY(x, z, y = 50) {
  const h = castRay(new V3(x, y, z), new V3(0, -1, 0), y + 5, { enemies: false });
  return h ? h.point.y : 0;
}

// ---------------------------------------------------------------- timers
const timers = [];

/** Run fn after `sec` seconds of game time. Returns a cancel function. */
export function after(sec, fn) {
  const t = { at: G.time + sec, fn, dead: false };
  timers.push(t);
  return () => { t.dead = true; };
}

export function updateTimers() {
  for (let i = 0; i < timers.length; i++) {
    const t = timers[i];
    if (t.dead) { timers.splice(i--, 1); continue; }
    if (G.time >= t.at) {
      timers.splice(i--, 1);
      try { t.fn(); } catch (err) { console.error(err); }
    }
  }
}

export function clearTimers() {
  timers.length = 0;
}

// ---------------------------------------------------------------- misc
/** Unit forward vector on the XZ plane for a yaw (yaw 0 faces -Z). */
export function yawForward(yaw, out = new V3()) {
  return out.set(-Math.sin(yaw), 0, -Math.cos(yaw));
}

/** Unit right vector on the XZ plane for a yaw. */
export function yawRight(yaw, out = new V3()) {
  return out.set(Math.cos(yaw), 0, -Math.sin(yaw));
}

/** Camera look direction (unit) including pitch. */
export function viewDir(out = new V3()) {
  const p = G.player;
  const cp = Math.cos(p.pitch);
  return out.set(-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp);
}

/** Stereo pan (-1..1) and distance of a world position relative to the camera. */
export function listenerInfo(pos) {
  const p = G.player;
  const dx = pos.x - p.eye.x;
  const dy = pos.y - p.eye.y;
  const dz = pos.z - p.eye.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const rx = Math.cos(p.yaw);
  const rz = -Math.sin(p.yaw);
  const pan = dist > 1e-3 ? clamp((dx * rx + dz * rz) / Math.max(dist, 1), -1, 1) : 0;
  return { dist, pan };
}
