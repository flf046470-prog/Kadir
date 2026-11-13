/* Shared shot list for capture_gameplay.cjs (video) and capture_stills.cjs (store screenshots). */
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);
// Each shot: initial game state, a camera path (x,z,yaw,pitch keys) and timed events.
// a3d save states for the later chapters (same shape as ANTARKTIKA3D.serialize())
const base = { power: true, freqSolved: true, crystals: 3, caveSolved: true, glyphRead: true, bb: [1, 1, 1, 1], bbSeen: [1, 1, 1, 1], ch2: true };
const ST = {};
ST.ch2 = { ...base };
ST.ch3done = { ...base, kaanSeen: true, heatCell: 2, kaanFree: true, kaanTalk: 3, kaanTrust: 1, steles: [1, 1, 1, 1, 1], stars: [1, 3, 0, 4], ch3: true, tutorial: { hall: 1 } };
ST.ch4mid = { ...ST.ch3done, syms: [1, 1, 1, 1, 0, 0], stones: [1, 1, 0], bridge: true, voice: 1, tutorial: { hall: 1, city: 1 } };
ST.ch4 = { ...ST.ch4mid, syms: [1, 1, 1, 1, 1, 1], stones: [1, 1, 1], voice: 3, ch4: true, ending4: 'cevap' };
ST.ch5grid = { ...ST.ch4, plane5: 1, dials: [2, 0, 1], tutorial: { hall: 1, city: 1, grid: 1 } };
ST.ch6 = { ...ST.ch5grid, cable5: 1, dials: [1, 2, 0], grid5: true, ch5: true, load5: 'denge', tutorial: { hall: 1, city: 1, grid: 1, camp: 1, caught: 1 } };
ST.ch7 = { ...ST.ch6, pump6: 2, relay6: 1, soldier6: 'save', ch6: true };
const SHOTS = [
  { id: 'g1_match', secs: 3.5, hud: false, torch: false, mission: 0, a3d: {}, keys: [[0, -2.0, 33.0, 1.35, 0.02], [1, 0.6, 31.2, 1.42, 0.0]] },
  { id: 'g2_ramp_door', secs: 4.5, hud: true, mission: 0, a3d: {}, keys: [[0, 3.0, 27.0, 1.5708, 0.02], [0.75, 11.4, 27.0, 1.5708, 0.0], [1, 13.6, 27.0, 1.62, -0.03]] },
  { id: 'g3_generator', secs: 3.5, hud: true, mission: 0, a3d: {}, keys: [[0, 11.2, 33.8, 1.3, -0.06], [1, 12.6, 34.6, 1.45, -0.04]], events: [[0.45, 'e']] },
  { id: 'g4_lab_power', secs: 3.5, hud: false, mission: 2, a3d: { power: true }, keys: [[0, 16.6, 27.4, 1.9, -0.05], [1, 18.4, 26.4, 2.2, -0.07]] },
  { id: 'g5_frequency', secs: 4.0, hud: true, mission: 2, a3d: { power: true }, keys: [[0, 28.4, 26.8, -0.15, -0.12], [1, 28.9, 25.6, -0.05, -0.18]], events: [[0.15, 'e'], [0.35, 'e'], [0.55, 'e']] },
  { id: 'g6_cave_torch', secs: 4.5, hud: false, torch: true, mission: 3, a3d: { power: true, freqSolved: true }, keys: [[0, -8.6, -29.0, 0.0, 0.04], [1, -8.3, -38.5, 0.04, 0.06]] },
  { id: 'g7_crystals', secs: 4.0, hud: true, torch: true, mission: 3, a3d: { power: true, freqSolved: true, glyphRead: true }, keys: [[0, -8.2, -42.0, 0.05, 0.12], [1, -8.1, -43.4, 0.05, 0.14]], events: [[0.05, 'q'], [0.3, 'crystal1'], [0.5, 'crystal2'], [0.7, 'crystal3']] },
  { id: 'g8_selin', secs: 3.5, hud: true, mission: 3, a3d: { power: true }, npc: [17.5, 18.4, Math.PI], keys: [[0, 17.4, 22.5, 0.0, -0.1], [1, 17.5, 21.3, 0.0, -0.12]], events: [[0.35, 'e']] },
  { id: 'g9_wide', secs: 3.0, hud: false, mission: 3, a3d: { power: true }, keys: [[0, -14, 44, 0.95, 0.05], [1, -12, 42.5, 1.0, 0.06]] },
  // chapters 3–7 (instanced interiors under the plateau; yaw 0 looks toward −z)
  { id: 'h1_hall_stars', secs: 4.0, hud: true, mission: 3, a3d: { ...ST.ch3done, inHall: true }, keys: [[0, 200.0, -290.5, 0.0, 0.03], [1, 200.0, -296.0, 0.0, 0.06]] },
  { id: 'h2_kaan', secs: 3.5, hud: false, mission: 3, a3d: { ...ST.ch2, inHall: true, kaanSeen: true, tutorial: { hall: 1, kaanHint: 1 } }, keys: [[0, 203.6, -290.2, 1.75, -0.06], [1, 204.6, -290.9, 1.68, -0.1]] },
  { id: 'c1_city_bridge', secs: 4.5, hud: true, mission: 3, a3d: { ...ST.ch4mid, inCity: true }, keys: [[0, -198.5, -276.5, -0.05, -0.04], [1, -199.0, -284.0, 0.0, -0.02]] },
  { id: 'c2_spire', secs: 3.5, hud: false, mission: 3, a3d: { ...ST.ch4mid, inCity: true, voice: 3 }, keys: [[0, -200.0, -294.5, 0.0, 0.10], [1, -200.0, -299.5, 0.0, 0.2]] },
  { id: 'gr1_gallery', secs: 4.0, hud: true, mission: 3, a3d: { ...ST.ch5grid, inGrid: true, cable5: 0 }, keys: [[0, 80.0, -289.5, 0.0, 0.0], [1, 80.0, -303.0, 0.0, 0.02]] },
  { id: 'gr2_sync', secs: 3.5, hud: true, mission: 3, a3d: { ...ST.ch5grid, inGrid: true, cable5: 1, dials: [1, 2, 0] }, keys: [[0, 76.2, -339.9, -0.1, -0.08], [1, 76.0, -340.3, -0.05, -0.1]], events: [[0.1, 'e']] },
  { id: 'k1_camp_drone', secs: 4.5, hud: true, mission: 3, a3d: { ...ST.ch6, inCamp: true }, warmth: 55, keys: [[0, -60.0, -293.5, 0.25, 0.10], [1, -58.6, -298.5, 0.32, 0.12]] },
  { id: 'k2_camp_pump', secs: 3.5, hud: false, mission: 3, a3d: { ...ST.ch6, inCamp: true }, warmth: 40, keys: [[0, -53.5, -303.5, 0.55, 0.0], [1, -52.2, -305.6, 0.6, -0.04]] },
  { id: 't1_tower_clock', secs: 4.0, hud: true, mission: 3, a3d: { ...ST.ch7, inCity: true }, keys: [[0, -200.0, -305.1, 0.0, 0.32], [1, -200.0, -305.3, 0.0, 0.36]], events: [[0.02, 'e']] },
];

function camAt(keys, t) {
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
  const a = keys[i], b = keys[i + 1], u = ease(Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0]))));
  return { x: lerp(a[1], b[1], u), z: lerp(a[2], b[2], u), yaw: lerp(a[3], b[3], u), pitch: lerp(a[4], b[4], u) };
}

module.exports = { SHOTS, ST, camAt, lerp, ease };
