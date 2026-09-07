import { Rand, hashString } from '../math/rand.js';
import { vec3 } from '../math/vec3.js';
import { LevelBuilder } from './builder.js';
import type { LevelDef } from './level.js';

export const JUNGLE_SEED = hashString('kangaroo-chase/jungle-world/v1');

/**
 * Jungle World — the launch map.
 *
 * Three connected districts, each with a distinct movement vocabulary:
 *   Jungle  (x ≈ 0)    climbing trees, branch hopping, bouncy mushrooms — the tutorial ground.
 *   Cave    (x ≈ -70)  tight, dark, slippery: short sightlines favour the runner.
 *   Canyon  (x ≈ +75)  vertical walls and gaps: wall-bounce and long jumps rule here.
 *
 * Generated deterministically from a seed so client and server build an identical world
 * without shipping mesh data, and so a bug is always reproducible.
 */
export function buildJungleWorld(seed = JUNGLE_SEED): LevelDef {
  const rand = new Rand(seed);
  const b = new LevelBuilder(rand);

  buildTerrain(b);
  buildJungleDistrict(b, rand);
  buildCaveDistrict(b, rand);
  buildCanyonDistrict(b, rand);
  buildParkourRoute(b);

  b.zone('jungle', vec3(0, 0, 0), 60, 'jungle', 0.05);
  b.zone('cave', vec3(-72, 0, 0), 34, 'cave', 0.75);
  b.zone('canyon', vec3(76, 0, 6), 42, 'canyon', 0.15);

  return b.build({
    id: 'jungle-world',
    name: 'Jungle World',
    version: 1,
    seed,
    killPlaneY: -35,
    playRadius: 150,
    ambientColor: 0x4c6b3f,
    skyColor: 0x8fd3ff,
    fogDensity: 0.0075,
  });
}

function buildTerrain(b: LevelBuilder): void {
  // Main jungle floor.
  b.box(vec3(0, -2, 0), vec3(62, 2, 62), 'dirt', 0, 'jungle');
  // Sand shoreline strip to the south — open ground where chasers can catch runners.
  b.box(vec3(0, -1.8, 70), vec3(62, 2, 12), 'sand', 0, 'jungle');
  // River between jungle and canyon: slows you down, so bridges and vines matter.
  b.box(vec3(46, -1.6, 10), vec3(10, 1.6, 44), 'water', 0, 'jungle');
  // Canyon floor.
  b.box(vec3(84, -6, 6), vec3(30, 2, 40), 'rock', 0, 'canyon');
  // Cave floor (lower, wet).
  b.box(vec3(-78, -6, 0), vec3(28, 2, 30), 'wetRock', 0, 'cave');
  // Ramps connecting the three districts.
  b.ramp(-46, 0, 12, 22, 0, -8, Math.PI / 2, 'cave');
  b.ramp(62, 6, 14, 26, 0, -8, Math.PI / 2, 'canyon');
}

function buildJungleDistrict(b: LevelBuilder, rand: Rand): void {
  // A ring of climbable trees. Branch grips form the aerial route across the district.
  const treeCount = 26;
  for (let i = 0; i < treeCount; i++) {
    const angle = (i / treeCount) * Math.PI * 2 + rand.range(-0.12, 0.12);
    const dist = rand.range(12, 52);
    const x = Math.sin(angle) * dist;
    const z = Math.cos(angle) * dist;
    b.tree(x, z, rand.range(9, 19), 'jungle', i % 3);
  }

  // Central landmark tree — tall, always visible, the natural rally point.
  b.tree(0, 0, 26, 'jungle', 0);
  for (let i = 0; i < 5; i++) {
    const y = 5 + i * 4;
    const angle = i * 1.9;
    b.platform(Math.sin(angle) * 4.5, y, Math.cos(angle) * 4.5, 3.4, 3.4, 'jungle', angle);
  }

  // Bouncy mushrooms: the fastest way up, and readable to a brand-new player.
  b.mushroom(-14, 0, 8, 1.6);
  b.mushroom(11, 0, -17, 1.4);
  b.mushroom(24, 0, 20, 1.5);
  b.mushroom(-28, 0, -22, 1.7);

  // Rocks for cover and short wall-bounce lines.
  b.rocks(18, 6, 5, 2.1);
  b.rocks(-22, 24, 6, 1.8);
  b.rocks(6, -32, 4, 2.6);

  // Fallen logs — low obstacles that reward the auto step-up.
  for (let i = 0; i < 6; i++) {
    const x = rand.range(-40, 40);
    const z = rand.range(-40, 40);
    const yaw = rand.range(0, Math.PI);
    b.cylinder(vec3(x, 0.55, z), 0.55, 3.4, 'wood', 'jungle');
    b.prop('log', vec3(x, 0, z), yaw, 1, 0);
  }

  // Tree village: linked one-way platforms high in the canopy.
  const villageRadius = 16;
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2;
    const x = -30 + Math.sin(angle) * villageRadius;
    const z = 10 + Math.cos(angle) * villageRadius;
    b.platform(x, 12 + (i % 3) * 2.2, z, 5, 5, 'jungle', angle);
    b.prop('banner', vec3(x, 12 + (i % 3) * 2.2, z), angle, 1, i % 3);
  }

  // Undergrowth props (no colliders — pure decoration, instanced by the renderer).
  for (let i = 0; i < 160; i++) {
    const angle = rand.range(0, Math.PI * 2);
    const dist = rand.range(4, 58);
    b.prop(
      rand.bool(0.6) ? 'bush' : 'flower',
      vec3(Math.sin(angle) * dist, 0, Math.cos(angle) * dist),
      rand.range(0, Math.PI * 2),
      rand.range(0.7, 1.5),
      i % 4,
    );
  }

  b.spawn(vec3(0, 0.5, -14), 0, 'jungle', 'runner');
  b.spawn(vec3(14, 0.5, 12), -2.2, 'jungle', 'runner');
  b.spawn(vec3(-16, 0.5, 6), 1.6, 'jungle', 'runner');
  b.spawn(vec3(8, 0.5, 26), 3.1, 'jungle', 'runner');
  b.spawn(vec3(-8, 0.5, 30), 3.0, 'jungle', 'runner');
  b.spawn(vec3(0, 0.5, 44), Math.PI, 'jungle', 'chaser');
  b.spawn(vec3(22, 0.5, -26), 0.6, 'jungle', 'chaser');
}

function buildCaveDistrict(b: LevelBuilder, rand: Rand): void {
  const cx = -78;
  // Cave shell: walls and ceiling made of large boxes; the mouth faces the jungle.
  b.box(vec3(cx, 6, -30), vec3(28, 14, 2), 'rock', 0, 'cave');
  b.box(vec3(cx, 6, 30), vec3(28, 14, 2), 'rock', 0, 'cave');
  b.box(vec3(cx - 28, 6, 0), vec3(2, 14, 30), 'rock', 0, 'cave');
  b.box(vec3(cx, 18, 0), vec3(28, 2, 30), 'rock', 0, 'cave');
  // Entrance pillars leave two gaps: a wide one and a crouch-only shortcut.
  b.box(vec3(cx + 27, 6, -12), vec3(2, 14, 12), 'rock', 0, 'cave');
  b.box(vec3(cx + 27, 10, 12), vec3(2, 10, 12), 'rock', 0, 'cave');

  // Stalagmites and stalactites: cover, and wall-bounce surfaces in a tight space.
  for (let i = 0; i < 22; i++) {
    const x = cx + rand.range(-24, 24);
    const z = rand.range(-26, 26);
    const h = rand.range(1.6, 5.2);
    b.cylinder(vec3(x, -4 + h / 2, z), rand.range(0.5, 1.1), h / 2, 'wetRock', 'cave');
    b.prop('stalagmite', vec3(x, -4, z), rand.range(0, Math.PI * 2), h / 3, 1);
  }

  // Crystal ledges — the climbing route to the upper tunnel.
  for (let i = 0; i < 8; i++) {
    const t = i / 7;
    const x = cx - 18 + t * 34;
    const y = -3 + t * 12;
    const z = Math.sin(t * 5.5) * 16;
    b.box(vec3(x, y, z), vec3(2.6, 0.4, 2.6), 'rock', t * 0.7, 'cave');
    b.grip(vec3(x, y + 0.4, z), vec3(0, 1, 0), 'ledge');
    b.prop('crystal', vec3(x, y + 0.4, z), t * 3, 1 + t, 2);
  }

  // Underground pool: slows anyone who drops in, punishing a careless chase.
  b.box(vec3(cx - 10, -4.4, 14), vec3(8, 0.6, 8), 'water', 0, 'cave');

  b.spawn(vec3(cx + 10, -3.5, 4), -Math.PI / 2, 'cave', 'runner');
  b.spawn(vec3(cx - 12, -3.5, -10), Math.PI / 2, 'cave', 'runner');
}

function buildCanyonDistrict(b: LevelBuilder, rand: Rand): void {
  const cx = 84;
  // Two tall canyon walls with a gap between: the wall-bounce corridor.
  b.box(vec3(cx - 12, 10, 6), vec3(3, 18, 38), 'smoothStone', 0, 'canyon');
  b.box(vec3(cx + 14, 10, 6), vec3(3, 18, 38), 'smoothStone', 0, 'canyon');
  // Climbable ledges staggered up both faces.
  for (let i = 0; i < 12; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const y = -2 + i * 2.4;
    const z = -28 + i * 5.2;
    const x = cx + side * (i % 2 === 0 ? 8.4 : 10.4);
    b.box(vec3(x, y, z), vec3(2.2, 0.35, 2.4), 'rock', 0, 'canyon');
    b.grip(vec3(x, y + 0.35, z), vec3(0, 1, 0), 'ledge');
  }

  // Floating rock islands across the gap — the long-jump gauntlet.
  for (let i = 0; i < 7; i++) {
    const y = 4 + i * 2.1;
    const z = -22 + i * 7.5;
    b.sphere(vec3(cx + (i % 2 === 0 ? -3 : 3), y, z), rand.range(2.2, 3.2), 'rock', 'canyon');
  }

  // Waterfall + plunge pool at the canyon head.
  b.box(vec3(cx, -4.4, 40), vec3(12, 0.6, 8), 'water', 0, 'canyon');
  b.prop('rock', vec3(cx, 0, 44), 0, 4, 1);

  // Ruined arch: a landmark that doubles as a climb.
  b.box(vec3(cx - 2, 2, -34), vec3(1.2, 6, 1.2), 'rock', 0.2, 'canyon');
  b.box(vec3(cx + 4, 2, -34), vec3(1.2, 6, 1.2), 'rock', -0.2, 'canyon');
  b.box(vec3(cx + 1, 8.5, -34), vec3(4.6, 0.9, 1.2), 'rock', 0, 'canyon');
  b.grip(vec3(cx + 1, 9.4, -34), vec3(0, 1, 0), 'ledge');

  b.spawn(vec3(cx, -3.5, -20), 0, 'canyon', 'runner');
  b.spawn(vec3(cx + 6, -3.5, 20), Math.PI, 'canyon', 'runner');
}

/** Parkour route: jungle floor → canopy → canyon walls → cave → finish. */
function buildParkourRoute(b: LevelBuilder): void {
  b.spawn(vec3(0, 0.5, -50), 0, 'jungle', 'start');
  b.checkpoint(vec3(0, 0.5, -50), 4);
  b.checkpoint(vec3(11, 1.4, -17), 3.5); // first mushroom
  b.checkpoint(vec3(0, 13, 4.5), 4); // central tree platforms
  b.checkpoint(vec3(-30, 12.6, 26), 4.5); // tree village
  b.checkpoint(vec3(62, 2, 6), 5); // canyon ramp
  b.checkpoint(vec3(84, 12, 12), 5); // canyon ledges
  b.checkpoint(vec3(-51, -3, 0), 5); // cave entrance
  b.checkpoint(vec3(-96, 8, 0), 5, true); // cave summit — finish
}
