/* Shared shot list for capture_gameplay.cjs (video) and capture_stills.cjs (store screenshots). */
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);
// Each shot: initial game state, a camera path (x,z,yaw,pitch keys) and timed events.
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
];

function camAt(keys, t) {
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
  const a = keys[i], b = keys[i + 1], u = ease(Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0]))));
  return { x: lerp(a[1], b[1], u), z: lerp(a[2], b[2], u), yaw: lerp(a[3], b[3], u), pitch: lerp(a[4], b[4], u) };
}

module.exports = { SHOTS, camAt, lerp, ease };
