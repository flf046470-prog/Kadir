import { Rand, hashString } from '../math/rand.js';
import { vec3 } from '../math/vec3.js';
import { LevelBuilder } from './builder.js';
import { registerLevel } from './registry.js';
import type { BoxCollider } from '../physics/types.js';
import type { LevelDef, PropKind } from './level.js';
import { LOBBY_MODE_IDS } from './level.js';

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
  dressWorld(b, rand);
  buildParkourRoute(b);

  /**
   * The lobby: where you land, ringed by a door into every mode.
   *
   * The ring stays centred on the origin — the landmark tree in the middle of it is the rally
   * point and looks like one. The *spawn* sits three metres south of it, because the origin is
   * the tree's own axis: the first version of this put every arriving player inside a 26-metre
   * trunk, dead centre, and left the physics to shove them out. Nothing failed loudly, which is
   * why it survived until a test went looking for spawns buried in scenery.
   */
  b.spawn(vec3(0, 0.5, 3), 0, 'jungle', 'lobby');
  b.addModePortals(LOBBY_MODE_IDS, vec3(0, 0.5, 0));

  b.zone('jungle', vec3(0, 0, 0), 72, 'jungle', 0.05);
  b.zone('cave', vec3(-72, 0, 0), 34, 'cave', 0.75);
  b.zone('canyon', vec3(76, 0, 6), 42, 'canyon', 0.15);

  // Last, so it measures every floor that exists: wall off each edge that drops straight to the
  // kill plane with a cliff nobody can jump or climb. See `LevelBuilder.enclose`.
  const killPlaneY = -35;
  b.enclose(killPlaneY, 'cliffRock');

  return b.build({
    id: 'jungle-world',
    name: 'Jungle World',
    // 2: the cave and canyon ramps reach their own floors. `ramp()` stopped inflating low steps
    // upward, and both ramps now ask for the -4 those floors actually sit at instead of the -8
    // that only looked right while the builder was halving it.
    // 3: yawed boxes collide where they are drawn (physics used the mirror rotation), and tree
    // branches run out of their trunks instead of across them.
    // 4: walled edges, and the cave and canyon ramps are solid to their floors.
    version: 4,
    seed,
    killPlaneY,
    // 90 is the largest radius that abandons the empty margin and the smallest that keeps every
    // authored zone in play. See `LevelDef.playRadius`; measured per map, not chosen as a round number.
    playRadius: 90,
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
  // Ramps connecting the three districts. Each ends at its district's floor: the canyon and cave
  // floors above are boxes centred at y -6 with a half-height of 2, so both walking surfaces are
  // at **-4**, and that is what a ramp down to them has to ask for.
  //
  // Both said -8 until now, and looked right anyway, because `LevelBuilder.ramp()` was halving
  // every descent: its step tops landed at `y/2 + 0.3`, so -8 drew a ramp bottoming out at -3.7,
  // a third of a metre above the -4 floor. The number in the level was tuned against the bug
  // rather than against the geometry. With `ramp()` fixed, -8 would drive the lower half of each
  // ramp underneath its own floor — walkable only down to -4, so the same drop covered in half
  // the run, twice as steep as the map has ever played.
  b.ramp(-46, 0, 12, 22, 0, -4, Math.PI / 2, 'cave');
  b.ramp(62, 6, 14, 26, 0, -4, Math.PI / 2, 'canyon');
}

/**
 * Scatter decorative props across a rectangle of ground.
 *
 * Shared by all three districts, because the alternative is three copies of the same loop that
 * drift apart — and the first version of this, written inline for the jungle, put fifteen props
 * off the edge of the map. A circular scatter of radius 78 around a floor that is a 62-metre
 * *square* leaves everything past the edge floating over nothing, which is invisible from the
 * middle of the map and obvious from anywhere near the rim.
 *
 * So the area is a rectangle, matching the floors, and every position is checked against the
 * ground it is supposed to be standing on. Two rules do the work:
 *
 *   - **Stand on something.** A position with no floor under it is rejected outright.
 *   - **Do not stand inside something.** A position under a wall, a pillar, a tree trunk or a
 *     boulder is rejected too, or bushes sprout through the rock.
 *
 * Weighted rather than uniform: a forest floor is mostly leaves with the occasional rock, and an
 * even mix of six kinds reads as a display case.
 */
function scatter(
  b: LevelBuilder,
  rand: Rand,
  options: {
    kinds: [PropKind, number][];
    count: number;
    /** Ground rectangle: [minX, maxX, minZ, maxZ]. */
    area: [number, number, number, number];
    /** Height the props sit at — the top of the floor they stand on. */
    y: number;
    scale: [number, number];
    tint?: number;
  },
): number {
  const { kinds, count, area, y, scale } = options;
  const [minX, maxX, minZ, maxZ] = area;
  const total = kinds.reduce((sum, [, w]) => sum + w, 0);

  // `Collider` is a union and only the box arm has half-extents, so the narrowing is explicit.
  // Spheres and cylinders are skipped on purpose: every floor in this world is a box, and a
  // rounded obstacle is small enough that a bush beside it costs nothing.
  const boxes = b.colliders.filter((c): c is BoxCollider => c.kind === 'box');
  const floors = boxes.filter((c) => c.center.y + c.half.y <= y + 0.75);
  /**
   * Something solid standing in the space a prop would occupy — not merely something above it.
   *
   * The distinction is the whole rule. "Anything whose top is higher than the floor" also
   * describes a ceiling, and the cave has one covering every square metre of it: under that
   * reading the cave rejected all 150 attempts and came out as bare as before, which is exactly
   * the emptiness this was meant to fix. What matters is whether the box's *vertical span*
   * overlaps the couple of metres the prop stands in.
   */
  const standHeight = 2;
  const obstacles = boxes.filter(
    (c) => c.center.y - c.half.y < y + standHeight && c.center.y + c.half.y > y + 0.2,
  );
  const covers = (list: BoxCollider[], x: number, z: number, pad: number): boolean =>
    list.some((c) => Math.abs(x - c.center.x) <= c.half.x + pad && Math.abs(z - c.center.z) <= c.half.z + pad);

  let placed = 0;
  for (let i = 0; i < count; i++) {
    let x = 0;
    let z = 0;
    let ok = false;
    // A bounded search, not a while(true): a badly chosen area must cost a few wasted rolls, not
    // hang the level build — and the caller finds out by getting fewer props than it asked for.
    for (let attempt = 0; attempt < 12 && !ok; attempt++) {
      x = rand.range(minX, maxX);
      z = rand.range(minZ, maxZ);
      ok = covers(floors, x, z, -0.5) && !covers(obstacles, x, z, 0.4);
    }
    if (!ok) continue;

    let roll = rand.range(0, total);
    let kind: PropKind = (kinds[0] as [PropKind, number])[0];
    for (const [candidate, weight] of kinds) {
      roll -= weight;
      if (roll <= 0) {
        kind = candidate;
        break;
      }
    }
    b.prop(kind, vec3(x, y, z), rand.range(0, Math.PI * 2), rand.range(scale[0], scale[1]), options.tint ?? i % 4);
    placed++;
  }
  return placed;
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
  //
  // The range stops well short of the mouth on purpose. The jungle floor slab reaches x = -62 and
  // fills the four metres directly above the cave floor from there inwards, so a stalagmite in the
  // last stretch of the mouth grew straight into it — buried to the tip in rock nobody could see
  // it through. Ending at -66 leaves a couple of metres of margin and still gives forty metres of
  // cave to stand in.
  for (let i = 0; i < 22; i++) {
    const x = cx + rand.range(-24, 12);
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

/**
 * Decorative ground cover, applied after every district is standing.
 *
 * Ordering is the whole reason this is its own pass. `scatter` avoids the colliders it can see,
 * and when the jungle dressed itself inside `buildJungleDistrict` the cave and canyon did not
 * exist yet — so ten props were placed straight through the cave entrance pillars, which are
 * built two functions later. Nothing about the scattering was wrong; it was simply asked the
 * question too early.
 */
function dressWorld(b: LevelBuilder, rand: Rand): void {
  const caveX = -78;
  const canyonX = 84;

  // Undergrowth. Square, not circular: the jungle floor is a 62-metre square, so a circle wide
  // enough to reach the corners spills off the edges — and one that fits inside leaves the corners
  // bare. The floors decide the shape.
  scatter(b, rand, {
    kinds: [
      ['bush', 34],
      ['flower', 22],
      ['mushroom', 14],
      ['rock', 14],
      ['log', 9],
      ['boulder', 7],
    ],
    count: 300,
    area: [-58, 58, -58, 58],
    y: 0,
    scale: [0.75, 1.4],
  });

  // The southern shoreline is its own strip of ground and was left completely bare. Sparser and
  // scrubbier than the forest floor, because sand is.
  scatter(b, rand, {
    kinds: [
      ['bush', 30],
      ['rock', 34],
      ['flower', 18],
      ['log', 18],
    ],
    count: 60,
    area: [-58, 58, 60, 80],
    y: 0.2,
    scale: [0.7, 1.2],
  });
  /**
   * Cave floor dressing.
   *
   * The cave was 22 stalagmites and eight crystal ledges on bare wet rock — readable, and
   * completely empty between the landmarks. Short sightlines are the point of this district, so
   * the floor is what a player actually sees: it gets rubble and small crystal clusters, with the
   * crystals frequent enough to give the dark a little glint without turning it into a cavern of
   * treasure.
   *
   * The area stops short of the shell walls on every side; `scatter` would reject anything inside
   * them anyway, but wasting eleven of twelve attempts per prop just to be told so is a poor way
   * to spend a level build.
   */
  scatter(b, rand, {
    kinds: [
      ['rock', 40],
      ['stalagmite', 22],
      ['crystal', 16],
      ['boulder', 14],
      ['mushroom', 8],
    ],
    count: 150,
    area: [caveX - 24, caveX + 24, -26, 26],
    y: -4,
    scale: [0.5, 1.05],
    tint: 2,
  });
  /**
   * Canyon floor dressing.
   *
   * Rubble and scrub, with almost no foliage: this is the dry district, and the point of contrast
   * with the jungle is that things do not grow here. Scattered across the whole canyon floor
   * rather than only the corridor between the walls, because the aprons outside them are ground a
   * player runs over on the way in and were bare.
   *
   * `scatter` keeps props out of the wall footprints itself, so the area can simply be the floor.
   */
  scatter(b, rand, {
    kinds: [
      ['rock', 44],
      ['boulder', 26],
      ['bush', 16],
      ['log', 8],
      ['flower', 6],
    ],
    count: 170,
    area: [canyonX - 28, canyonX + 28, -32, 44],
    y: -4,
    scale: [0.6, 1.25],
    tint: 1,
  });}

registerLevel({
  id: 'jungle-world',
  name: 'Jungle World',
  description: 'Climb the trees, hop the branches, bounce the mushrooms. The map the game teaches you on.',
  build: buildJungleWorld,
});
