/**
 * Bot stuck-share harness: `npx tsx scripts/measure-stuck.ts [level] [seeds] [seconds]`.
 *
 * A bot-second is "stuck" when the bot commanded movement (|move| > 0.5) but covered under
 * PROGRESS_MIN metres over the trailing PROGRESS_WINDOW seconds — the same window the bot itself
 * uses, measured from outside so a bot that fails to notice is still counted. Prints the share
 * and the dominant 4 m cells so a fix can be aimed and then re-measured.
 */
import { Bot, Simulation, buildLevel, listLevels } from '@kc/core';

const levelId = process.argv[2] ?? 'outback-station';
const seeds = Number(process.argv[3] ?? 8);
const seconds = Number(process.argv[4] ?? 90);
const BOTS = 6;
// buildLevel silently falls back to the default map on an unknown id, which would measure the
// wrong level and look plausible; refuse instead.
if (!listLevels().some((l) => l.id === levelId)) {
  console.error(`unknown level "${levelId}"; known: ${listLevels().map((l) => l.id).join(', ')}`);
  process.exit(1);
}
const WINDOW = 72; // 1.2 s at 60 Hz
const MIN = 1.4;
const CELL = 4;

let botTicks = 0;
let stuckTicks = 0;
let tags = 0;
const cells = new Map<string, number>();
const roles = new Map<string, number>();
const ys = new Map<string, number[]>();

for (let seed = 1; seed <= seeds; seed++) {
  const level = buildLevel(levelId);
  const sim = new Simulation({ level, modeId: 'kangaroo-chase', seed });
  const bots: Bot[] = [];
  const trail = new Map<string, { x: number; z: number }[]>();
  for (let i = 0; i < BOTS; i++) {
    sim.addPlayer({ id: `p${i}`, name: `P${i}` });
    bots.push(new Bot(`p${i}`, { skill: 0.45 + (i % 4) * 0.15, seed: 900 + i * 17 + seed }));
    trail.set(`p${i}`, []);
  }
  for (let tick = 0; tick < 60 * seconds; tick++) {
    const moving = new Set<string>();
    for (const [i, bot] of bots.entries()) {
      const self = sim.players.get(`p${i}`);
      if (!self) continue;
      const intent = bot.think(self, sim.players.values(), level, 1 / 60, sim.mode.objectiveFor?.(self) ?? null);
      intent.tick = sim.tick + 1;
      sim.setIntent(`p${i}`, intent);
      if (Math.hypot(intent.moveX, intent.moveZ) > 0.5) moving.add(`p${i}`);
    }
    sim.step();
    // The queue is not an array and nothing drains it here; count tags per tick and drain.
    for (const e of sim.events.drain()) if (e.type === 'tag') tags++;
    for (const [id, p] of sim.players) {
      const t = trail.get(id)!;
      t.push({ x: p.position.x, z: p.position.z });
      if (t.length > WINDOW) t.shift();
      if (!p.alive || t.length < WINDOW) continue;
      botTicks++;
      if (!moving.has(id)) continue;
      if (Math.hypot(p.position.x - t[0]!.x, p.position.z - t[0]!.z) < MIN) {
        stuckTicks++;
        roles.set(p.role, (roles.get(p.role) ?? 0) + 1);
        if (process.env.KC_SAMPLE && tick % 120 === 0 && p.position.y < -12) console.error(`seed ${seed} t${tick} ${id} pos ${p.position.x.toFixed(1)},${p.position.y.toFixed(1)},${p.position.z.toFixed(1)} role ${p.role}`);
        const key = `${Math.round(p.position.x / CELL) * CELL},${Math.round(p.position.z / CELL) * CELL}`;
        cells.set(key, (cells.get(key) ?? 0) + 1);
        (ys.get(key) ?? ys.set(key, []).get(key)!).push(p.position.y);
      }
    }
  }
}

console.log('by role:', [...roles.entries()].map(([r, n]) => `${r} ${((100 * n) / Math.max(1, stuckTicks)).toFixed(0)}%`).join(', '));
const top = [...cells.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
console.log(`${levelId}: ${seeds} seeds x ${BOTS} bots x ${seconds}s`);
console.log(`tags ${tags} (${(tags / seeds).toFixed(1)} per ${seconds}s match)`);
console.log(`stuck ${((100 * stuckTicks) / botTicks).toFixed(1)} % of ${(botTicks / 60).toFixed(0)} bot-seconds`);
for (const [k, n] of top) {
  const y = ys.get(k)!.sort((a, b) => a - b);
  console.log(`  cell (${k})  ${((100 * n) / Math.max(1, stuckTicks)).toFixed(1)} % of stuck  y ${y[0]!.toFixed(1)}..${y[y.length - 1]!.toFixed(1)} (median ${y[y.length >> 1]!.toFixed(1)})`);
}
